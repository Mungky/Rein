"""JWKS cache: TTL, refresh paksa (rotasi kunci), dan fallback cache basi.

Tanpa jaringan — httpx.AsyncClient dipalsukan.
"""

import asyncio
import time

import app.dependencies as deps

# Contoh kunci EC publik dari RFC 7517 §A.1 (bukan rahasia) — cukup untuk
# menguji pencocokan kid tanpa membuat kunci sungguhan.
_EC_JWK = {
    "kty": "EC",
    "crv": "P-256",
    "x": "MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4",
    "y": "4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM",
    "alg": "ES256",
    "kid": "kid-lama",
}


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class _FakeClient:
    """Pengganti httpx.AsyncClient dengan payload JWKS kalengan."""

    calls = 0
    payload: dict = {"keys": []}
    fail = False

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url):
        type(self).calls += 1
        if type(self).fail:
            raise ConnectionError("supabase down")
        return _FakeResponse(type(self).payload)


def _setup(monkeypatch, payload=None):
    monkeypatch.setattr(deps.httpx, "AsyncClient", _FakeClient)
    monkeypatch.setattr(deps, "_jwks_cache", None)
    monkeypatch.setattr(deps, "_jwks_fetched_at", 0.0)
    _FakeClient.calls = 0
    _FakeClient.fail = False
    _FakeClient.payload = payload or {"keys": [_EC_JWK]}


def test_cache_dipakai_dalam_ttl(monkeypatch):
    _setup(monkeypatch)
    asyncio.run(deps._get_jwks())
    asyncio.run(deps._get_jwks())
    assert _FakeClient.calls == 1


def test_cache_kedaluwarsa_setelah_ttl(monkeypatch):
    _setup(monkeypatch)
    asyncio.run(deps._get_jwks())
    # Mundurkan stempel fetch melewati TTL → panggilan berikut harus refetch.
    monkeypatch.setattr(
        deps, "_jwks_fetched_at", time.monotonic() - deps._JWKS_TTL_S - 1
    )
    asyncio.run(deps._get_jwks())
    assert _FakeClient.calls == 2


def test_force_refresh_menembus_cache(monkeypatch):
    _setup(monkeypatch)
    asyncio.run(deps._get_jwks())
    asyncio.run(deps._get_jwks(force_refresh=True))
    assert _FakeClient.calls == 2


def test_refresh_gagal_pakai_cache_basi(monkeypatch):
    _setup(monkeypatch)
    hasil_awal = asyncio.run(deps._get_jwks())
    _FakeClient.fail = True
    hasil_stale = asyncio.run(deps._get_jwks(force_refresh=True))
    assert hasil_stale == hasil_awal  # tidak melempar error


def test_fetch_pertama_gagal_tetap_error(monkeypatch):
    _setup(monkeypatch)
    _FakeClient.fail = True
    try:
        asyncio.run(deps._get_jwks())
        raise AssertionError("harusnya melempar ConnectionError")
    except ConnectionError:
        pass


def test_find_signing_key():
    jwks = {"keys": [_EC_JWK]}
    assert deps._find_signing_key(jwks, "kid-lama") is not None
    assert deps._find_signing_key(jwks, "kid-baru") is None
    assert deps._find_signing_key({"keys": []}, "apapun") is None
