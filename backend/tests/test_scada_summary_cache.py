"""W5 — /summary per-tag cache + single-flight coalescing.

Verifies the load-collapsing promise ("dihitung sekali"): a burst of concurrent
requests for the same (tag, window) triggers exactly one aggregation, later
requests within the TTL trigger none, and TTL=0 disables the cache while still
deduping a simultaneous burst.

Uses asyncio.run (no pytest-asyncio dependency) and a stub DB that counts the
aggregation queries actually issued.
"""

import asyncio
import uuid
from types import SimpleNamespace

from app.routers import scada


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def scalars(self):
        return SimpleNamespace(all=lambda: self._rows)


class _FakeDB:
    """Counts execute() calls; each is a no-op returning empty rows."""

    def __init__(self, counter):
        self.counter = counter

    async def execute(self, *_a, **_k):
        self.counter[0] += 1
        await asyncio.sleep(0.01)  # let peers pile up before the first resolves
        return _FakeResult([])


def _page(n=6):
    ids = [uuid.uuid4() for _ in range(n)]
    visible = {tid: SimpleNamespace(id=tid, label=f"T{i}", unit="") for i, tid in enumerate(ids)}
    return ids, visible


def _reset(ttl):
    scada._summary_cache.clear()
    scada._summary_inflight.clear()
    scada._SUMMARY_CACHE_TTL_S = ttl


def _window():
    from datetime import datetime, timedelta, timezone

    end = datetime.now(timezone.utc)
    return end - timedelta(hours=24), end


def test_concurrent_burst_computes_each_tag_once():
    _reset(45.0)
    ids, visible = _page(6)
    start, end = _window()
    counter = [0]

    async def go():
        db = _FakeDB(counter)
        results = await asyncio.gather(
            *(scada._summarize(db, ids, visible, start, end) for _ in range(50))
        )
        return results

    results = asyncio.run(go())
    # 50 simultaneous requests → one agg + one latest query total (6 tags, one batch).
    assert counter[0] == 2
    # Every caller still gets a full page of items.
    assert all(len(r) == 6 for r in results)


def test_second_request_within_ttl_hits_cache():
    _reset(45.0)
    ids, visible = _page(4)
    start, end = _window()
    counter = [0]

    async def go():
        db = _FakeDB(counter)
        await scada._summarize(db, ids, visible, start, end)
        first = counter[0]
        await scada._summarize(db, ids, visible, start, end)
        return first, counter[0]

    first, second = asyncio.run(go())
    assert first == 2  # first request computed
    assert second == 2  # second served entirely from cache — no new queries


def test_ttl_zero_disables_cache_but_still_dedups_burst():
    _reset(0.0)  # cache off
    ids, visible = _page(3)
    start, end = _window()
    counter = [0]

    async def go():
        db = _FakeDB(counter)
        # Simultaneous burst still single-flights to one computation...
        await asyncio.gather(
            *(scada._summarize(db, ids, visible, start, end) for _ in range(10))
        )
        after_burst = counter[0]
        # ...but a later (non-overlapping) request recomputes (nothing cached).
        await scada._summarize(db, ids, visible, start, end)
        return after_burst, counter[0]

    after_burst, after_second = asyncio.run(go())
    assert after_burst == 2  # burst coalesced
    assert after_second == 4  # second call recomputed (cache disabled)


def test_inflight_registry_empties_after_completion():
    _reset(45.0)
    ids, visible = _page(2)
    start, end = _window()

    async def go():
        db = _FakeDB([0])
        await scada._summarize(db, ids, visible, start, end)

    asyncio.run(go())
    assert scada._summary_inflight == {}  # no leaked claims
