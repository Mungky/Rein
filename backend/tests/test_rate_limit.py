"""Rate limiter: kunci per-user dari JWT, fallback IP, dan cakupan endpoint."""

import os
import re

from jose import jwt
from starlette.requests import Request

from app.limiter import READ_LIMIT, WRITE_LIMIT, user_or_ip

_ROUTERS = os.path.join(os.path.dirname(__file__), "..", "app", "routers")


def _req(headers: dict | None = None, ip: str = "10.9.8.7") -> Request:
    raw_headers = [
        (k.lower().encode(), v.encode()) for k, v in (headers or {}).items()
    ]
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": raw_headers,
            "client": (ip, 1234),
        }
    )


def test_kunci_dari_sub_jwt():
    token = jwt.encode({"sub": "user-abc-123"}, "rahasia-apapun", algorithm="HS256")
    key = user_or_ip(_req({"Authorization": f"Bearer {token}"}))
    assert key == "user:user-abc-123"


def test_tanpa_token_fallback_ip():
    assert user_or_ip(_req()) == "10.9.8.7"


def test_token_rusak_fallback_ip():
    assert user_or_ip(_req({"Authorization": "Bearer bukan.jwt.valid"})) == "10.9.8.7"


def test_token_tanpa_sub_fallback_ip():
    token = jwt.encode({"role": "authenticated"}, "x", algorithm="HS256")
    assert user_or_ip(_req({"Authorization": f"Bearer {token}"})) == "10.9.8.7"


def test_batas_baca_tulis():
    assert READ_LIMIT == "60/minute"
    assert WRITE_LIMIT == "20/minute"


def _count(path: str, pattern: str) -> int:
    with open(path, encoding="utf-8") as f:
        return len(re.findall(pattern, f.read(), flags=re.MULTILINE))


def test_semua_endpoint_scada_ber_limiter():
    """Endpoint baru di router scada wajib ikut membawa @limiter.limit —
    tanpa penjaga ini, endpoint baca-data baru diam-diam tak berlimit."""
    for fname in ("scada.py", "scada_alarms.py"):
        path = os.path.join(_ROUTERS, fname)
        n_routes = _count(path, r"^@router\.(get|post|put|patch|delete)\b")
        n_limits = _count(path, r"^@limiter\.limit\(")
        assert n_routes == n_limits, (
            f"{fname}: {n_routes} endpoint tapi {n_limits} @limiter.limit — "
            "tambahkan @limiter.limit(READ_LIMIT/WRITE_LIMIT) di endpoint baru"
        )
