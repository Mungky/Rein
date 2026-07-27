"""W5 — /summary per-tag cache + single-flight coalescing.

Verifies the load-collapsing promise ("dihitung sekali"): a burst of concurrent
requests for the same (tag, window) triggers exactly one aggregation, later
requests within the TTL trigger none, and TTL=0 disables the cache while still
deduping a simultaneous burst.

Uses asyncio.run (no pytest-asyncio dependency) and a stub DB that counts the
aggregation queries actually issued.

QUERIES PER COMPUTATION = 4 in the WORST case, and the point of these tests is
that the number does not depend on how many tags or how many concurrent callers
there are:
  1. min/max/avg over the window from scada_rollup_1m, batched for every tag,
  2. the scada_samples_all fallback, only when step 1 returned nothing at all
     (a summary that has not been backfilled yet),
  3. current value from scada_tag_latest, batched (audit D-11 — this replaced a
     DISTINCT ON over the scada_samples_all UNION),
  4. the scada_samples_all fallback for tags with no row in scada_tag_latest.

The stub DB returns empty rows for EVERY query, so both fallbacks always fire.
That is deliberately the worst case: on a populated database steps 2 and 4 do
not run at all and a computation costs 2 queries.
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
    # 50 simultaneous requests over 6 tags → still one batched computation.
    assert counter[0] == 4
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
    assert first == 4  # first request computed
    assert second == 4  # second served entirely from cache — no new queries


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
    assert after_burst == 4  # burst coalesced
    assert after_second == 8  # second call recomputed (cache disabled)


def test_inflight_registry_empties_after_completion():
    _reset(45.0)
    ids, visible = _page(2)
    start, end = _window()

    async def go():
        db = _FakeDB([0])
        await scada._summarize(db, ids, visible, start, end)

    asyncio.run(go())
    assert scada._summary_inflight == {}  # no leaked claims
