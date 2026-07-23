"""Setiap tabel di schema public WAJIB ber-Row Level Security (kebijakan K-1).

Migrasi t4u5v6w7x8y9 mendaftar tabel secara manual — tabel baru yang lupa
ENABLE ROW LEVEL SECURITY tidak akan ketahuan dari daftar itu. Tes ini
bertanya langsung ke katalog Postgres (pg_class.relrowsecurity), jadi
dinamis: tabel apa pun yang muncul di schema public tanpa RLS = merah.

Butuh DATABASE_URL (dibaca dari env atau .env root proyek, sama seperti
db/session.py):
- Lokal tanpa kredensial / DB tak terjangkau → tes di-SKIP.
- CI men-set RLS_TEST_REQUIRED=1 → tidak boleh skip; masalah koneksi pun
  dianggap gagal (di CI database service + migrasi selalu tersedia).
"""

import os

import pytest
from dotenv import load_dotenv

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
load_dotenv(os.path.join(_ROOT, ".env"), override=False)

_REQUIRED = os.getenv("RLS_TEST_REQUIRED", "") == "1"

# Bukan tabel aplikasi — pembukuan Alembic sendiri, tak tersentuh PostgREST
# karena tidak pernah di-expose lewat API Supabase dengan data sensitif.
_EXCLUDED = {"alembic_version"}


def _fetch_tables_without_rls() -> tuple[list[str], int]:
    """Return (tabel tanpa RLS, jumlah seluruh tabel public)."""
    url = os.getenv("DATABASE_URL", "").replace("+asyncpg", "")
    if not url:
        if _REQUIRED:
            pytest.fail("RLS_TEST_REQUIRED=1 tapi DATABASE_URL tidak diset")
        pytest.skip("DATABASE_URL tidak diset — lewati cek RLS")

    import psycopg2

    try:
        conn = psycopg2.connect(url, connect_timeout=10)
    except Exception as exc:
        if _REQUIRED:
            pytest.fail(f"RLS_TEST_REQUIRED=1 tapi database tak terjangkau: {exc}")
        pytest.skip(f"Database tak terjangkau — lewati cek RLS: {exc}")

    try:
        with conn.cursor() as cur:
            # relkind 'r' = tabel biasa, 'p' = tabel partisi induk.
            cur.execute(
                """
                SELECT c.relname, c.relrowsecurity
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                ORDER BY c.relname
                """
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    tanpa_rls = [
        name for name, has_rls in rows if not has_rls and name not in _EXCLUDED
    ]
    return tanpa_rls, len(rows)


def test_semua_tabel_public_ber_rls():
    tanpa_rls, total = _fetch_tables_without_rls()

    # Penjaga vakum: database kosong (migrasi belum jalan) tidak boleh
    # dianggap lulus — berarti setup CI-nya yang rusak.
    assert total >= 30, (
        f"Hanya {total} tabel di schema public — migrasi belum diterapkan? "
        "Tes ini harus berjalan setelah `alembic upgrade head`."
    )

    assert not tanpa_rls, (
        "Tabel berikut TIDAK ber-Row Level Security — siapa pun yang memegang "
        "anon key Supabase bisa baca/tulis lewat PostgREST. Tambahkan "
        "`ALTER TABLE public.<nama> ENABLE ROW LEVEL SECURITY;` di migrasi "
        f"yang membuat tabelnya: {', '.join(tanpa_rls)}"
    )
