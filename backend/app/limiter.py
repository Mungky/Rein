"""Shared rate-limit instance — import from main.py and routers."""

from fastapi import Request
from jose import jwt
from slowapi import Limiter
from slowapi.util import get_remote_address

# Batas bersama untuk endpoint data (dipakai router lewat @limiter.limit).
READ_LIMIT = "60/minute"
WRITE_LIMIT = "20/minute"


def user_or_ip(request: Request) -> str:
    """Kunci limiter: user ID dari JWT; fallback alamat IP untuk yang publik.

    Klaim `sub` dibaca TANPA verifikasi tanda tangan — aman, karena limiter
    slowapi membungkus fungsi endpoint: dependency auth sudah menolak token
    palsu (401) sebelum hitungan limiter tersentuh. Per-user (bukan per-IP)
    supaya satu kantor di belakang NAT tidak saling menghabiskan jatah, dan
    satu user tidak bisa lolos limit dengan berganti IP.
    """
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        try:
            sub = jwt.get_unverified_claims(auth[7:]).get("sub")
        except Exception:
            sub = None
        if sub:
            return f"user:{sub}"
    return get_remote_address(request)


limiter = Limiter(key_func=user_or_ip)
