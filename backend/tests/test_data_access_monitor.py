"""Monitor akses data (M12): ambang catat, alert sekali per hari, never raises."""

import asyncio
from types import SimpleNamespace

import app.services.data_access_monitor as dam


class _FakeDb:
    """Cukup untuk log_big_read: rekam add(), flush() jadi no-op."""

    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass


def _reset(monkeypatch, daily_total=0):
    monkeypatch.setattr(dam, "_alerted", set())
    alerts = []

    async def fake_total(db, profile_id):
        return daily_total

    async def fake_alert(db, profile, total):
        alerts.append(total)

    monkeypatch.setattr(dam, "_daily_total", fake_total)
    monkeypatch.setattr(dam, "_alert", fake_alert)
    return alerts


_PROFILE = SimpleNamespace(id="p1", full_name="Budi", username="budi")


def test_di_bawah_ambang_tidak_dicatat(monkeypatch):
    _reset(monkeypatch)
    db = _FakeDb()
    asyncio.run(
        dam.log_big_read(db, _PROFILE, "samples", ["Suhu"], None, None,
                         dam.LOG_MIN_ROWS - 1)
    )
    assert db.added == []


def test_di_atas_ambang_dicatat(monkeypatch):
    _reset(monkeypatch)
    db = _FakeDb()
    asyncio.run(
        dam.log_big_read(db, _PROFILE, "samples", ["Suhu", "Tekanan"], None, None,
                         dam.LOG_MIN_ROWS)
    )
    assert len(db.added) == 1
    row = db.added[0]
    assert row.profile_name == "Budi"
    assert row.tag_labels == "Suhu, Tekanan"
    assert row.row_count == dam.LOG_MIN_ROWS


def test_total_harian_lewat_ambang_alert_sekali(monkeypatch):
    alerts = _reset(monkeypatch, daily_total=dam.ALERT_ROWS_PER_DAY + 1)
    db = _FakeDb()

    async def dua_kali():
        await dam.log_big_read(db, _PROFILE, "samples", ["A"], None, None, 1000)
        await dam.log_big_read(db, _PROFILE, "samples", ["A"], None, None, 1000)

    asyncio.run(dua_kali())
    assert alerts == [dam.ALERT_ROWS_PER_DAY + 1]  # alert kedua tertahan


def test_total_di_bawah_ambang_tanpa_alert(monkeypatch):
    alerts = _reset(monkeypatch, daily_total=dam.ALERT_ROWS_PER_DAY - 1)
    db = _FakeDb()
    asyncio.run(dam.log_big_read(db, _PROFILE, "samples", ["A"], None, None, 1000))
    assert alerts == []


def test_gagal_db_tidak_raise(monkeypatch):
    _reset(monkeypatch)

    class _Boom:
        def add(self, obj):
            raise RuntimeError("db down")

    asyncio.run(
        dam.log_big_read(_Boom(), _PROFILE, "samples", ["A"], None, None, 1000)
    )  # tidak melempar
