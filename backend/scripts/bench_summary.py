#!/usr/bin/env python3
"""W5 benchmark — /summary under ~50 concurrent viewers, before vs after.

Simulates a wall of viewers all opening the SAME page (same set of tags, same
24h window) within the same refresh tick — the exact load the cache + batching
target. The database layer is a stub that sleeps a realistic per-query latency
and COUNTS how many aggregation queries actually reach it, so we measure both
wall-clock latency and DB load without hammering production Supabase.

    BEFORE = each request runs its own aggregation (old behavior: one query pair
             per request; and previously one request PER PANEL, so multiply again
             by tags-per-page for the true old cost — see the printed note).
    AFTER  = the shipped path: per-tag TTL cache + single-flight coalescing
             (app.routers.scada._summarize).

Run:  cd backend && python scripts/bench_summary.py
Tune: QUERY_MS / CONCURRENT / TAGS_PER_PAGE below.
"""

from __future__ import annotations

import asyncio
import os
import statistics
import sys
import time
import uuid
from pathlib import Path
from types import SimpleNamespace

# Make `app` (backend/) and `db` (project root) importable when run standalone.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

QUERY_MS = float(os.getenv("BENCH_QUERY_MS", "40"))  # simulated Supabase agg latency
CONCURRENT = int(os.getenv("BENCH_CONCURRENT", "50"))  # simultaneous viewers
TAGS_PER_PAGE = int(os.getenv("BENCH_TAGS", "12"))  # panels on the page
POOL_LIMIT = int(os.getenv("BENCH_POOL", "5"))  # concurrent DB queries allowed


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def scalars(self):
        return SimpleNamespace(all=lambda: self._rows)


class FakeDB:
    """Counts queries and models a bounded connection pool: only POOL_LIMIT
    aggregations run at once, the rest queue — exactly what a small pool does."""

    def __init__(self, counter: list[int], sem: asyncio.Semaphore):
        self._counter = counter
        self._sem = sem

    async def execute(self, *_a, **_k):
        self._counter[0] += 1
        async with self._sem:
            await asyncio.sleep(QUERY_MS / 1000)
        return FakeResult([])  # empty agg → items with None stats (latency is the point)


def _make_page():
    tag_ids = [uuid.uuid4() for _ in range(TAGS_PER_PAGE)]
    visible = {
        tid: SimpleNamespace(id=tid, label=f"Tag {i}", unit="°C")
        for i, tid in enumerate(tag_ids)
    }
    return tag_ids, visible


async def _run(mode: str, tag_ids, visible, start, end):
    """Fire CONCURRENT requests at once; return (latencies_ms, query_count)."""
    from app.routers import scada

    # Fresh cache/inflight per run so BEFORE and AFTER don't cross-contaminate.
    scada._summary_cache.clear()
    scada._summary_inflight.clear()

    counter = [0]
    sem = asyncio.Semaphore(POOL_LIMIT)
    latencies: list[float] = []

    async def one_request():
        db = FakeDB(counter, sem)
        t0 = time.perf_counter()
        if mode == "before":
            # No cache, no single-flight: every request aggregates independently.
            await scada._compute_summaries(db, visible, start, end)
        else:
            await scada._summarize(db, tag_ids, visible, start, end)
        latencies.append((time.perf_counter() - t0) * 1000)

    await asyncio.gather(*(one_request() for _ in range(CONCURRENT)))
    return latencies, counter[0]


def _stats(latencies):
    s = sorted(latencies)
    p = lambda q: s[min(len(s) - 1, int(q * len(s)))]
    return {
        "mean": statistics.mean(s),
        "p50": p(0.50),
        "p95": p(0.95),
        "max": s[-1],
    }


async def main():
    from datetime import datetime, timedelta, timezone

    # Force cache ON for the "after" run regardless of ambient env.
    from app.routers import scada

    scada._SUMMARY_CACHE_TTL_S = 45.0

    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=24)
    tag_ids, visible = _make_page()

    print(
        f"Scenario: {CONCURRENT} simultaneous viewers, same page of "
        f"{TAGS_PER_PAGE} tags, 24h window\n"
        f"          query latency {QUERY_MS:.0f}ms, DB pool limit {POOL_LIMIT} "
        f"concurrent queries\n"
    )

    before_lat, before_q = await _run("before", tag_ids, visible, start, end)
    after_lat, after_q = await _run("after", tag_ids, visible, start, end)

    bs, as_ = _stats(before_lat), _stats(after_lat)
    print(f"{'':10} {'queries':>9} {'mean':>9} {'p50':>9} {'p95':>9} {'max':>9}")
    print(
        f"{'BEFORE':10} {before_q:>9} {bs['mean']:>8.0f}m {bs['p50']:>8.0f}m "
        f"{bs['p95']:>8.0f}m {bs['max']:>8.0f}m"
    )
    print(
        f"{'AFTER':10} {after_q:>9} {as_['mean']:>8.0f}m {as_['p50']:>8.0f}m "
        f"{as_['p95']:>8.0f}m {as_['max']:>8.0f}m"
    )
    print(
        f"\nDB queries: {before_q} -> {after_q} "
        f"({before_q / max(1, after_q):.0f}x fewer). "
        f"Mean latency: {bs['mean']:.0f}ms -> {as_['mean']:.0f}ms "
        f"({bs['mean'] / max(0.1, as_['mean']):.1f}x faster)."
    )
    print(
        "Note: BEFORE counts one query-pair per request. The true old cost was "
        "HIGHER -- the frontend sent one request PER PANEL, i.e. ~"
        f"{CONCURRENT * TAGS_PER_PAGE} requests for this page; batching folds "
        f"that to {CONCURRENT} before the cache even helps."
    )


if __name__ == "__main__":
    asyncio.run(main())
