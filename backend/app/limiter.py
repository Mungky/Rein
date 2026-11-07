"""Shared rate-limit instance — import from main.py and routers."""

from starlette.requests import Request
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


def get_client_ip(request: Request) -> str:
    """Ekstraksi IP client: prioritaskan X-Forwarded-For bila ada (reverse proxy), fallback ke remote address."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return get_remote_address(request)


def user_or_ip(request: Request) -> str:
    """Kunci limiter: gunakan remote address / proxy-aware client IP sebagai default yang aman.

    jwt.get_unverified_claims dihindari karena rentan DoS/spoofing sub tanpa verifikasi signature.
    """
    return get_client_ip(request)


limiter = Limiter(key_func=get_client_ip)
