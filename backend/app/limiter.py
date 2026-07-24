"""Shared rate-limit instance — import from main.py and routers."""

from fastapi import Request
from jose import jwt
from slowapi import Limiter
from slowapi.util import get_remote_address

# Batas bersama untuk endpoint data (dipakai router lewat @limiter.limit).
# Angka besar karena limiter ini untuk mencegah ABUSE, bukan mencekik pemakaian
# normal: halaman Data mem-fan-out SATU request per tag (14 tag = 14 panggilan
# baca sekali muat) + sparkline + history/summary per baris + polling Monitor,
# lalu Export menambah beberapa lagi. 60/menit membuat semuanya 429. Kunci
# per-user (bukan per-IP), jadi ini plafon per orang.
READ_LIMIT = "600/minute"
WRITE_LIMIT = "120/minute"


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
