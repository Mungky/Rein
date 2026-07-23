"""Health monitor: transisi 🔴/🟢 sekali per perubahan, dan throttle 5xx."""

import asyncio

import app.services.health_monitor as hm


def _reset(monkeypatch):
    monkeypatch.setattr(hm, "_active", {})
    monkeypatch.setattr(hm, "_err_lock", None)
    monkeypatch.setattr(hm, "_err_count", 0)
    monkeypatch.setattr(hm, "_err_last_sent", None)


# --------------------------- transisi problem ----------------------------- #


def test_problem_baru_kirim_sekali(monkeypatch):
    _reset(monkeypatch)
    msgs = hm._apply_transitions({"bridge": "Bridge MQTT OFFLINE"})
    assert msgs == ["🔴 Bridge MQTT OFFLINE"]
    # Pass berikutnya problem masih ada → tidak ada pesan ulang
    assert hm._apply_transitions({"bridge": "Bridge MQTT OFFLINE"}) == []


def test_pulih_kirim_pesan_hijau(monkeypatch):
    _reset(monkeypatch)
    hm._apply_transitions({"bridge": "Bridge MQTT OFFLINE"})
    msgs = hm._apply_transitions({})
    assert msgs == ["🟢 PULIH: Bridge MQTT OFFLINE"]
    # Sudah pulih → tidak ada pesan lagi
    assert hm._apply_transitions({}) == []


def test_problem_campuran(monkeypatch):
    _reset(monkeypatch)
    hm._apply_transitions({"bridge": "A"})
    msgs = hm._apply_transitions({"tags": "B"})  # bridge pulih, tags muncul
    assert "🔴 B" in msgs and "🟢 PULIH: A" in msgs and len(msgs) == 2


# ----------------------------- throttle 5xx -------------------------------- #


def test_error_pertama_langsung_kirim(monkeypatch):
    _reset(monkeypatch)
    sent = []

    async def fake_send(text):
        sent.append(text)

    monkeypatch.setattr(hm, "_send_text", fake_send)
    asyncio.run(hm.report_server_error("GET", "/api/x", 500))
    assert len(sent) == 1
    assert "HTTP 500" in sent[0] and "/api/x" in sent[0]


def test_error_beruntun_kena_throttle(monkeypatch):
    _reset(monkeypatch)
    sent = []

    async def fake_send(text):
        sent.append(text)

    monkeypatch.setattr(hm, "_send_text", fake_send)

    async def burst():
        for _ in range(10):
            await hm.report_server_error("GET", "/api/x", 500)

    asyncio.run(burst())
    assert len(sent) == 1  # 9 sisanya hanya dihitung


def test_setelah_jendela_kirim_dengan_jumlah(monkeypatch):
    _reset(monkeypatch)
    sent = []

    async def fake_send(text):
        sent.append(text)

    monkeypatch.setattr(hm, "_send_text", fake_send)

    async def scenario():
        for _ in range(5):
            await hm.report_server_error("GET", "/api/x", 500)
        # Mundurkan stempel kiriman terakhir melewati jendela throttle
        hm._err_last_sent = hm._err_last_sent - hm.ERROR_THROTTLE_S - 1
        await hm.report_server_error("POST", "/api/y", 503)

    asyncio.run(scenario())
    assert len(sent) == 2
    assert "HTTP 503" in sent[1]
    assert "+4 error lain" in sent[1]  # 4 tertahan + 1 pemicu = 5


def test_gagal_kirim_tidak_raise(monkeypatch):
    _reset(monkeypatch)

    async def boom(text):
        raise RuntimeError("telegram down")

    monkeypatch.setattr(hm, "_send_text", boom)
    asyncio.run(hm.report_server_error("GET", "/api/x", 500))  # tidak melempar
