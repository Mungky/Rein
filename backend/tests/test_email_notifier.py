"""email_notifier (Resend): pilih jalur, lampiran besar, daftar penerima."""

import asyncio
import base64

import app.services.email_notifier as en


class _FakeResp:
    def __init__(self, status_code=200, text="ok"):
        self.status_code = status_code
        self.text = text


class _FakeClient:
    """Pengganti httpx.AsyncClient — merekam payload POST."""

    calls: list[dict] = []

    def __init__(self, *a, **kw):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):
        _FakeClient.calls.append({"url": url, "json": json, "headers": headers})
        return _FakeResp()


def _use_resend(monkeypatch, key="re_test123"):
    _FakeClient.calls = []
    monkeypatch.setattr(en.settings, "resend_api_key", key)
    monkeypatch.setattr(en.httpx, "AsyncClient", _FakeClient)


# ------------------------------ jalur kirim -------------------------------- #


def test_tanpa_key_dan_smtp_dilewati(monkeypatch):
    _use_resend(monkeypatch, key="")
    monkeypatch.setattr(en.settings, "smtp_user", "")
    monkeypatch.setattr(en.settings, "smtp_password", "")
    # Tidak melempar, tidak memanggil API apa pun
    asyncio.run(en.send_email("a@b.c", "Subjek", "Isi"))
    assert _FakeClient.calls == []


def test_resend_terpanggil_dengan_bearer(monkeypatch):
    _use_resend(monkeypatch)
    asyncio.run(en.send_email("a@b.c", "Subjek", "Isi"))
    assert len(_FakeClient.calls) == 1
    call = _FakeClient.calls[0]
    assert call["url"] == en.RESEND_URL
    assert call["headers"]["Authorization"] == "Bearer re_test123"
    assert call["json"]["to"] == ["a@b.c"]
    assert call["json"]["text"] == "Isi"
    assert "html" not in call["json"]


def test_penerima_kosong_dilewati(monkeypatch):
    _use_resend(monkeypatch)
    asyncio.run(en.send_email("", "Subjek", "Isi"))
    assert _FakeClient.calls == []


def test_gagal_kirim_tidak_raise(monkeypatch):
    monkeypatch.setattr(en.settings, "resend_api_key", "re_x")

    class _Boom:
        def __init__(self, *a, **kw):
            raise RuntimeError("network down")

    monkeypatch.setattr(en.httpx, "AsyncClient", _Boom)
    asyncio.run(en.send_email("a@b.c", "S", "B"))  # tidak melempar


# ------------------------------- lampiran ---------------------------------- #


def test_lampiran_dikirim_base64(monkeypatch):
    _use_resend(monkeypatch)
    asyncio.run(en.send_email("a@b.c", "S", "B", attachment=("data.xlsx", b"isi")))
    att = _FakeClient.calls[0]["json"]["attachments"][0]
    assert att["filename"] == "data.xlsx"
    assert base64.b64decode(att["content"]) == b"isi"


def test_lampiran_kebesaran_dicopot(monkeypatch):
    _use_resend(monkeypatch)
    monkeypatch.setattr(en, "ATTACH_MAX_MB", 1)
    big = b"x" * (2 * 1024 * 1024)  # 2 MB > batas 1 MB
    asyncio.run(en.send_email("a@b.c", "S", "B", attachment=("big.xlsx", big)))
    payload = _FakeClient.calls[0]["json"]
    assert "attachments" not in payload
    assert "terlalu besar" in payload["text"]


# ---------------------------- daftar penerima ------------------------------- #


def test_send_to_list_pisah_koma(monkeypatch):
    _use_resend(monkeypatch)
    asyncio.run(en.send_to_list("a@b.c, d@e.f,, ", "S", "B"))
    tos = [c["json"]["to"] for c in _FakeClient.calls]
    assert tos == [["a@b.c"], ["d@e.f"]]
