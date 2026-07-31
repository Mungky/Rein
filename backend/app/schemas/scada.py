"""Pydantic schemas for the SCADA Monitor module.

The perspective `layout` JSONB follows a versioned contract:
{"version": 1, "panels": [...]} — each panel is a discriminated union on
`type`. Implemented: "video" (Phase 1), "chart" / "table" / "gauge"
(historian, Phase 2). "alarm" is reserved. Unknown types are rejected at
save time so garbage can never be persisted.

Keep in sync with `frontend/src/features/scada/types.ts`.
"""

import re
import uuid
from typing import Annotated, Literal, Union
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator


class PanelGrid(BaseModel):
    """Legacy (layout v1) react-grid-layout cell: 12-column grid coordinates."""

    x: int = Field(ge=0, le=11)
    y: int = Field(ge=0)
    w: int = Field(ge=1, le=12)
    h: int = Field(ge=1, le=100)


class PanelRect(BaseModel):
    """Layout v2 (OBS-style fixed canvas): absolute CANVAS-pixel rectangle.
    The whole canvas scales uniformly on every screen, so these never reflow."""

    x: float = Field(ge=0, le=7680)
    y: float = Field(ge=0, le=4320)
    w: float = Field(ge=16, le=7680)
    h: float = Field(ge=16, le=4320)


class CanvasSize(BaseModel):
    """Per-page canvas resolution (like an OBS scene), e.g. 1920×1080."""

    w: int = Field(ge=640, le=7680)
    h: int = Field(ge=360, le=4320)


class VideoPanelConfig(BaseModel):
    stream_id: uuid.UUID
    object_fit: Literal["contain", "cover"] = "contain"
    muted: bool = True


class VideoPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["video"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: VideoPanelConfig


ChartRange = Literal["1h", "6h", "24h", "7d", "30d"]

# Warna hex CSS (#rgb / #rrggbb / #rrggbbaa) — dipakai semua komponen HMI.
HEX_COLOR = r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"

HexColor = Annotated[str, Field(pattern=HEX_COLOR)]


class ScreenSize(BaseModel):
    """Mixin: "Resolusi Layar" — every CHANNEL is a screen with a fixed
    resolution; the Monitor page only scales it (aspect locked, letterboxed).
    Optional so legacy panel configs (which share these models) stay valid."""

    view_w: int | None = Field(default=1920, ge=320, le=7680)
    view_h: int | None = Field(default=1080, ge=180, le=4320)


class PanelElements(BaseModel):
    """Elemen modular komponen nilai (gauge/level/led/bar): bagian mana yang
    tampil. Posisi & ukurannya diatur lewat kanvas komponen (PanelLayout)."""

    show_title: bool = True
    show_value: bool = True
    show_status: bool = True
    # Nama perangkat (device_key sensor) — bawaan sembunyi
    show_device: bool = False
    # Baris kecil "Diperbarui HH:mm" / rentang 24 jam
    show_footer: bool = True


class ElementBox(BaseModel):
    """Satu kotak elemen di kanvas komponen — PERSEN (0–100) dari kotak panel,
    jadi ikut menskala bersama panelnya. Kotak boleh sedikit keluar batas
    (-20..120) supaya elemen bisa digeser mepet/menggantung."""

    x: float = Field(ge=-20, le=120)
    y: float = Field(ge=-20, le=120)
    w: float = Field(gt=0, le=140)
    h: float = Field(gt=0, le=140)
    align: Literal["left", "center", "right"] = "center"
    # Tinggi huruf terhadap tinggi kotak
    scale: float = Field(default=0.7, ge=0.2, le=1.0)


class PanelLayout(BaseModel):
    """Tata letak bebas komponen: kotak per elemen. Elemen tanpa entri memakai
    kotak bawaan jenisnya (LAYOUT_PRESETS di frontend panels/elements.tsx)."""

    model_config = {"extra": "forbid"}
    title: ElementBox | None = None
    value: ElementBox | None = None
    status: ElementBox | None = None
    device: ElementBox | None = None
    footer: ElementBox | None = None
    # Gambar komponen: jarum/donat/tangki/lampu/grafik batang
    graphic: ElementBox | None = None


class ChartPanelConfig(ScreenSize):
    # 0 tag = komponen baru dari palet yang belum diatur (placeholder di UI)
    tag_ids: list[uuid.UUID] = Field(default_factory=list, max_length=4)
    range: ChartRange = "24h"
    show_minmax: bool = False
    # Warna per garis, sejajar dengan tag_ids; None = warna slot bawaan
    colors: list[HexColor | None] = Field(default_factory=list, max_length=4)
    # Batas sumbu Y; None = otomatis
    y_min: float | None = None
    y_max: float | None = None
    # Bawaan "linear" = persis tampilan lama; smooth/step opsi baru
    line_style: Literal["smooth", "linear", "step"] = "linear"
    # Angka di belakang koma; None = ikut config.decimals sensor, lalu otomatis
    # (satu aturan di frontend: resolveDecimals, panels/elements.tsx)
    decimals: int | None = Field(default=None, ge=0, le=6)
    show_legend: bool = True
    show_grid: bool = True


class ChartPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["chart"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: ChartPanelConfig


TableColumn = Literal["tag", "device", "unit", "value", "min", "avg", "max"]


class TablePanelConfig(ScreenSize):
    tag_ids: list[uuid.UUID] = Field(default_factory=list, max_length=8)
    range: ChartRange = "24h"
    # Urutan + isi kolom (editor kolom di inspector); None = bawaan
    columns: list[TableColumn] | None = Field(default=None, max_length=7)
    # Angka di belakang koma; None = ikut config.decimals sensor, lalu otomatis
    # (satu aturan di frontend: resolveDecimals, panels/elements.tsx)
    decimals: int | None = Field(default=None, ge=0, le=6)
    show_header: bool = True
    show_footer: bool = True


class TablePanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["table"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: TablePanelConfig


class GaugePanelConfig(ScreenSize):
    # None = dipasang dari palet tapi belum diatur (UI merender placeholder)
    tag_id: uuid.UUID | None = None
    # Status thresholds (optional). `direction` says which side is bad:
    # "above" → value ≥ warning is Waspada, ≥ critical is Kritis;
    # "below" → value ≤ warning is Waspada, ≤ critical is Kritis.
    warning: float | None = None
    critical: float | None = None
    direction: Literal["above", "below"] = "above"
    # Bentuk tampilan: "stat" (angka besar), "arc" (jarum), "donut" (cincin)
    style: Literal["stat", "arc", "donut"] = "stat"
    # Skala gauge untuk arc/donut; None = 0–100
    min: float | None = None
    max: float | None = None
    # Override label/satuan tag; None = ikut tag
    label: str | None = Field(default=None, max_length=120)
    unit: str | None = Field(default=None, max_length=30)
    # Warna zona normal; None = hijau tema
    color: HexColor | None = None
    decimals: int | None = Field(default=None, ge=0, le=6)
    elements: PanelElements | None = None
    layout: PanelLayout | None = None


class GaugePanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["gauge"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: GaugePanelConfig


class BarPanelConfig(ScreenSize):
    # Comparison across tags ("plant 1 vs plant 2") — idealnya ≥2 batang;
    # 0 = belum diatur (placeholder di UI)
    tag_ids: list[uuid.UUID] = Field(default_factory=list, max_length=8)
    range: ChartRange = "24h"
    metric: Literal["avg", "last", "min", "max"] = "avg"
    # Warna batang (satu ukuran = satu warna); None = warna chart bawaan
    color: HexColor | None = None
    # "horizontal" = batang mendatar (bawaan), "vertical" = batang tegak
    orientation: Literal["horizontal", "vertical"] = "horizontal"
    # Angka di belakang koma; None = ikut config.decimals sensor, lalu otomatis
    # (satu aturan di frontend: resolveDecimals, panels/elements.tsx)
    decimals: int | None = Field(default=None, ge=0, le=6)
    elements: PanelElements | None = None
    layout: PanelLayout | None = None


class BarPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["bar"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: BarPanelConfig


AlarmColumn = Literal["tag", "bounds", "device", "value", "status", "time", "ack"]


class AlarmPanelConfig(ScreenSize):
    # Watch a set of tags; thresholds are read from each tag's own
    # config.alarm_min / config.alarm_max (set in Analisis), not here.
    tag_ids: list[uuid.UUID] = Field(default_factory=list, max_length=8)
    range: ChartRange = "24h"
    # Urutan + isi kolom (editor kolom di inspector); None = bawaan
    columns: list[AlarmColumn] | None = Field(default=None, max_length=7)
    # Angka di belakang koma; None = ikut config.decimals sensor, lalu otomatis
    # (satu aturan di frontend: resolveDecimals, panels/elements.tsx)
    decimals: int | None = Field(default=None, ge=0, le=6)
    show_header: bool = True


class AlarmPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["alarm"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: AlarmPanelConfig


class WallCell(BaseModel):
    """One cell of a video wall → one channel = (stream, cell index in its mosaic)."""

    stream_id: uuid.UUID
    cell: int = Field(ge=0, le=35)  # up to a 6×6 mosaic


class WallPanelConfig(BaseModel):
    rows: int = Field(ge=1, le=6)
    cols: int = Field(ge=1, le=6)
    # Row-major cells; null = empty slot. Length should equal rows×cols.
    cells: list[WallCell | None] = Field(default_factory=list, max_length=36)
    # How each channel fills its cell: crop-to-fill or whole-camera-letterboxed.
    fit: Literal["cover", "contain"] = "cover"


class WallPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["wall"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: WallPanelConfig


class ActivityPanelConfig(ScreenSize):
    # No source configuration — always lists everyone currently on REIN.
    # (Screen resolution fields come from the ScreenSize mixin.)
    model_config = {"extra": "forbid"}


class ActivityPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["activity"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: ActivityPanelConfig = Field(default_factory=ActivityPanelConfig)


class WebPanelConfig(BaseModel):
    # Live web page (e.g. Wecon V-Net HMI) embedded in the grid. http(s) only —
    # never javascript:/data: URLs.
    url: str = Field(min_length=8, max_length=2048, pattern=r"^https?://")
    zoom: float = Field(default=1.0, ge=0.25, le=3.0)
    # Shift the page inside the cell (CSS px, pre-zoom) — crops away the
    # embedded site's own navbar/sidebar without fullscreen.
    offset_x: int = Field(default=0, ge=0, le=4000)
    offset_y: int = Field(default=0, ge=0, le=4000)
    # Native viewport (OBS-style source resolution): the page is laid out at
    # exactly this size then scaled into its cell — so the embedded site's own
    # fullscreen fills this viewport (= its panel), and layouts stay stable.
    # None = legacy behavior (fill the cell directly).
    view_w: int | None = Field(default=1920, ge=320, le=7680)
    view_h: int | None = Field(default=1080, ge=180, le=4320)


class VncPanelConfig(ScreenSize):
    # Live VNC source (noVNC/websockify) — a dedicated PC mirrored view-only
    # (e.g. browser showing a cloud SCADA). `url` is the websockify endpoint;
    # http(s) is accepted and normalized to ws(s) client-side. R-Net always
    # connects viewOnly — but the REAL guard is the VNC server's own
    # view-only/input-block setting (client flags can be bypassed).
    url: str = Field(min_length=8, max_length=2048, pattern=r"^(https?|wss?)://")
    # VNC password embedded so the wall auto-connects 24/7. Readable by every
    # scada:view user (the browser needs it to connect) — use a dedicated
    # VIEW-ONLY password, never the control password.
    password: str | None = Field(default=None, max_length=128)


class WebPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["web"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: WebPanelConfig


class ChannelPanelConfig(BaseModel):
    # A layout cell that shows one TV-style channel (see ScadaChannel).
    channel_id: uuid.UUID


class ChannelPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["channel"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: ChannelPanelConfig


# ── Komponen data lanjutan (gaya node-red-dashboard) ───────────────────────


class LevelPanelConfig(ScreenSize):
    """Level/tangki: isi naik-turun mengikuti nilai sensor pada skala min–max."""

    tag_id: uuid.UUID | None = None
    min: float = 0
    max: float = 100
    warning: float | None = None
    critical: float | None = None
    direction: Literal["above", "below"] = "above"
    # Warna cairan saat normal; None = warna chart bawaan
    color: HexColor | None = None
    label: str | None = Field(default=None, max_length=120)
    unit: str | None = Field(default=None, max_length=30)
    # Angka di belakang koma; None = ikut config.decimals sensor, lalu otomatis
    # (satu aturan di frontend: resolveDecimals, panels/elements.tsx)
    decimals: int | None = Field(default=None, ge=0, le=6)
    elements: PanelElements | None = None
    layout: PanelLayout | None = None

    @model_validator(mode="after")
    def _scale_sane(self) -> "LevelPanelConfig":
        if self.max <= self.min:
            raise ValueError("Skala level: max harus lebih besar dari min")
        return self


class LevelPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["level"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: LevelPanelConfig


class LedPanelConfig(ScreenSize):
    """LED indikator: menyala saat nilai berada di sisi `direction` dari ambang."""

    tag_id: uuid.UUID | None = None
    threshold: float = 0
    direction: Literal["above", "below"] = "above"
    on_color: HexColor | None = None
    off_color: HexColor | None = None
    on_label: str = Field(default="AKTIF", max_length=40)
    off_label: str = Field(default="MATI", max_length=40)
    label: str | None = Field(default=None, max_length=120)
    show_value: bool = True
    # Angka di belakang koma; None = ikut config.decimals sensor, lalu otomatis
    # (satu aturan di frontend: resolveDecimals, panels/elements.tsx)
    decimals: int | None = Field(default=None, ge=0, le=6)
    elements: PanelElements | None = None
    layout: PanelLayout | None = None


class LedPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["led"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: LedPanelConfig


class ImagePanelConfig(BaseModel):
    """Gambar/logo pemanis HMI. `src` = data URI hasil impor (browser sudah
    mengecilkannya) atau URL http(s). Dirender lewat <img> saja — atribut
    di-escape React dan script dalam SVG tidak pernah dieksekusi di <img>."""

    model_config = {"extra": "forbid"}
    # ~800 rb karakter ≈ 600 KB gambar terenkode base64 — cukup untuk logo,
    # terlalu kecil untuk menjejalkan foto raksasa ke layout JSONB.
    src: str = Field(
        min_length=10,
        max_length=800_000,
        pattern=r"^(data:image/(png|jpe?g|webp|gif);base64,|https?://)",
    )
    fit: Literal["contain", "cover", "fill"] = "contain"
    opacity: float = Field(default=1.0, ge=0.1, le=1.0)
    radius: int = Field(default=0, ge=0, le=200)


class ImagePanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["image"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: ImagePanelConfig


# ── SCADA HMI decor components (Tahap awal "SCADA beneran") ────────────────
# Static drawing elements for the Monitor canvas: custom text labels and
# basic shapes (kotak / lingkaran / garis). Pure decoration — no data source.


class TextPanelConfig(BaseModel):
    # Plain text ONLY — rendered as text content, never HTML.
    model_config = {"extra": "forbid"}
    content: str = Field(min_length=1, max_length=500)
    # Font size in CANVAS pixels (the whole canvas scales uniformly)
    size: int = Field(default=24, ge=8, le=240)
    # None = follow theme text color
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    align: Literal["left", "center", "right"] = "center"
    bold: bool = True


class TextPanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["text"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: TextPanelConfig


class ShapePanelConfig(BaseModel):
    model_config = {"extra": "forbid"}
    shape: Literal["rect", "circle", "line"] = "rect"
    # None = transparent fill / no border
    fill: str | None = Field(default=None, pattern=HEX_COLOR)
    stroke: str | None = Field(default=None, pattern=HEX_COLOR)
    stroke_w: int = Field(default=2, ge=0, le=40)
    # Corner rounding for "rect" (canvas px)
    radius: int = Field(default=8, ge=0, le=200)


class ShapePanel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["shape"]
    title: str = Field(default="", max_length=120)
    grid: PanelGrid | None = None
    rect: PanelRect | None = None
    config: ShapePanelConfig


Panel = Annotated[
    Union[
        VideoPanel,
        ChartPanel,
        TablePanel,
        GaugePanel,
        BarPanel,
        AlarmPanel,
        WallPanel,
        ActivityPanel,
        WebPanel,
        ChannelPanel,
        TextPanel,
        ShapePanel,
        LevelPanel,
        LedPanel,
        ImagePanel,
    ],
    Field(discriminator="type"),
]


class PerspectiveLayout(BaseModel):
    """v1 = legacy 12-column grid (grid per panel); v2 = OBS-style fixed canvas
    (canvas resolution + absolute rect per panel — never reflows with zoom)."""

    version: Literal[1, 2] = 2
    canvas: CanvasSize | None = None
    # 64: membangun HMI (teks + bentuk + gambar + gauge) cepat melewati 24
    panels: list[Panel] = Field(default_factory=list, max_length=64)

    @model_validator(mode="after")
    def _check_placement(self) -> "PerspectiveLayout":
        if self.version == 2:
            if self.canvas is None:
                self.canvas = CanvasSize(w=1920, h=1080)
            for p in self.panels:
                if p.rect is None:
                    raise ValueError("panel layout v2 wajib punya rect")
        else:
            for p in self.panels:
                if p.grid is None:
                    raise ValueError("panel layout v1 wajib punya grid")
        return self


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------


class PerspectiveCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    layout: PerspectiveLayout = Field(default_factory=PerspectiveLayout)


class PerspectiveUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    layout: PerspectiveLayout | None = None


# A "Screen" source — one addressable place a channel can show. Three kinds:
#   stream → HLS/WebRTC video (MediaMTX)   web → an embedded web page/HMI
#   vnc    → a view-only noVNC mirror of a PC
# All three live in one table (scada_streams) so the channel form and the
# "Kelola Screen" dialog treat them uniformly; a channel just picks a source
# by id and crops it. `mosaic` is gone — cropping is per-channel now.
SourceType = Literal["stream", "web", "vnc"]

# URL scheme allowed per source type (web = http(s); vnc = http(s)/ws(s),
# normalized to ws(s) client-side; stream URL is the HLS playlist).
_WEB_SCHEME = re.compile(r"^https?://", re.IGNORECASE)
_VNC_SCHEME = re.compile(r"^(https?|wss?)://", re.IGNORECASE)


class StreamCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    source_type: SourceType = "stream"
    # stream only — the HLS playlist + optional WebRTC + read credentials.
    hls_url: str | None = Field(default=None, max_length=2048)
    webrtc_url: str | None = Field(default=None, max_length=2048)
    read_user: str | None = Field(default=None, max_length=64)
    read_pass: str | None = Field(default=None, max_length=128)
    # web / vnc — the page URL or the noVNC/websockify endpoint.
    url: str | None = Field(default=None, max_length=2048)
    # vnc only — the VIEW-ONLY password (readable by every scada:view user,
    # exactly like read_pass; the browser needs it to auto-connect the wall).
    secret: str | None = Field(default=None, max_length=128)
    enabled: bool = True

    @model_validator(mode="after")
    def _check_source(self) -> "StreamCreateRequest":
        return _validate_source_fields(self)  # type: ignore[return-value]


class StreamUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    source_type: SourceType | None = None
    hls_url: str | None = Field(default=None, max_length=2048)
    webrtc_url: str | None = Field(default=None, max_length=2048)
    read_user: str | None = Field(default=None, max_length=64)
    read_pass: str | None = Field(default=None, max_length=128)
    url: str | None = Field(default=None, max_length=2048)
    secret: str | None = Field(default=None, max_length=128)
    enabled: bool | None = None


def _validate_source_fields(req: "StreamCreateRequest") -> "StreamCreateRequest":
    """Require the URL fields that the chosen source_type actually needs, and
    check their scheme. Shared entry point so create-time validation lives in
    one place (updates are partial → validated in the router against the
    effective type)."""
    if req.source_type == "stream":
        if not (req.hls_url and req.hls_url.strip()):
            raise ValueError("Stream butuh URL HLS")
    elif req.source_type == "web":
        if not (req.url and req.url.strip()):
            raise ValueError("Sumber web butuh URL halaman")
        if not _WEB_SCHEME.match(req.url.strip()):
            raise ValueError("URL web harus diawali http:// atau https://")
    else:  # vnc
        if not (req.url and req.url.strip()):
            raise ValueError("Sumber VNC butuh alamat noVNC/websockify")
        if not _VNC_SCHEME.match(req.url.strip()):
            raise ValueError("Alamat VNC harus http(s):// atau ws(s)://")
    return req


# --- Channels (TV-style registry: number + nickname + one source) ----------

# "screen" replaces the old "video"/"web"/"vnc" kinds: one channel that shows
# any Source (stream/web/vnc) by id + an optional crop. What KIND of source it
# is comes from the referenced scada_streams row, not the channel.
ChannelKind = Literal[
    "screen", "chart", "table", "gauge", "bar", "alarm", "activity"
]


class CropRect(BaseModel):
    """Manual crop region in SOURCE pixels (relative to src_w×src_h)."""

    x: float = Field(ge=0, le=7680)
    y: float = Field(ge=0, le=4320)
    w: float = Field(ge=8, le=7680)
    h: float = Field(ge=8, le=4320)


class ScreenChannelConfig(ScreenSize):
    """A channel that mirrors one Source (stream/web/vnc) — chosen by id in the
    unified "Kelola Screen" list. Optional crop (drawn in the channel editor:
    grid-divide 2×2/3×3 or a free rectangle) is applied to whatever the source
    renders. `src_w`/`src_h` is the reference resolution the crop was drawn
    against; `view_w`/`view_h` (from ScreenSize) is the channel's own screen."""

    # References a scada_streams row (any source_type). Named stream_id for
    # continuity with the layout VideoPanelConfig / DB column.
    stream_id: uuid.UUID
    crop: CropRect | None = None
    src_w: int | None = Field(default=None, ge=16, le=7680)
    src_h: int | None = Field(default=None, ge=16, le=4320)


# Which config model validates each channel kind — panel configs are reused so
# a channel is exactly "a panel definition without a grid position".
CHANNEL_CONFIG_MODELS: dict[str, type[BaseModel]] = {
    "screen": ScreenChannelConfig,
    "chart": ChartPanelConfig,
    "table": TablePanelConfig,
    "gauge": GaugePanelConfig,
    "bar": BarPanelConfig,
    "alarm": AlarmPanelConfig,
    "activity": ActivityPanelConfig,
}


def validate_channel_config(kind: str, config: dict) -> dict:
    """Validate + normalize a channel config for its kind (raises ValueError)."""
    model = CHANNEL_CONFIG_MODELS[kind]
    return model.model_validate(config).model_dump(mode="json")


class ChannelCreateRequest(BaseModel):
    number: int = Field(ge=1, le=100000)
    name: str = Field(min_length=1, max_length=120)
    kind: ChannelKind
    config: dict = Field(default_factory=dict)
    enabled: bool = True

    @model_validator(mode="after")
    def _check_config(self) -> "ChannelCreateRequest":
        self.config = validate_channel_config(self.kind, self.config)
        return self


class ChannelUpdateRequest(BaseModel):
    number: int | None = Field(default=None, ge=1, le=100000)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: ChannelKind | None = None
    # Validated in the router against the EFFECTIVE kind (new or existing).
    config: dict | None = None
    enabled: bool | None = None


class SiteCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    mqtt_host: str = Field(min_length=1, max_length=200)
    mqtt_port: int = Field(default=1883, ge=1, le=65535)
    mqtt_username: str | None = Field(default=None, max_length=120)
    mqtt_password: str | None = Field(default=None, max_length=200)
    base_topic: str = Field(default="", max_length=200)
    enabled: bool = True


class SiteUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    mqtt_host: str | None = Field(default=None, min_length=1, max_length=200)
    mqtt_port: int | None = Field(default=None, ge=1, le=65535)
    mqtt_username: str | None = Field(default=None, max_length=120)
    # Send a new value to change it; omit to leave unchanged (write-only —
    # the current password is never returned by the API).
    mqtt_password: str | None = Field(default=None, max_length=200)
    base_topic: str | None = Field(default=None, max_length=200)
    enabled: bool | None = None


class SheetCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class SheetUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    position: int | None = Field(default=None, ge=0)


TagSource = Literal["simulator", "mqtt"]


class TagCreateRequest(BaseModel):
    sheet_id: uuid.UUID
    # "simulator" (in-process sampler) or "mqtt" (written by the standalone
    # bridge from broker messages).
    source: TagSource = "simulator"
    # Required for source "mqtt": which site (broker) publishes this tag.
    site_id: uuid.UUID | None = None
    device_key: str = Field(min_length=1, max_length=120)
    label: str = Field(min_length=1, max_length=120)
    unit: str = Field(default="", max_length=30)
    enabled: bool = True
    # Simulator: {preset, base, amplitude, period_s, noise, decimals, min?, max?}
    # MQTT: {mqtt_topic, mqtt_field?, alarm_min?, alarm_max?} — mqtt_topic is
    # required.
    #
    # `mqtt_field` is what makes one topic able to carry a whole plant. Without
    # it a topic delivers exactly one number and the tag takes it. With it, the
    # topic delivers a bundle and this tag takes ONE named value out of it:
    #
    #     topic  rnet/lombok/bulk
    #     field  lombok1.waterlevel1
    #
    # That is the difference between one MQTT topic per sensor (300 topics and
    # 300 messages a second at 300 sensors) and one per plant. Which shape a
    # topic uses is decided by whoever publishes it; the field is simply how
    # R-Net addresses a value inside a bundle.
    config: dict = Field(default_factory=dict)
    # Manual metadata cell values, keyed by workbench column id
    meta: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def _mqtt_needs_site_and_topic(self):
        if self.source == "mqtt":
            if self.site_id is None:
                raise ValueError("Tag MQTT harus punya site")
            if not str(self.config.get("mqtt_topic", "")).strip():
                raise ValueError("Tag MQTT harus punya topic")
        validate_sampling_level(self.config)
        validate_mqtt_field(self.config)
        return self


class TagUpdateRequest(BaseModel):
    sheet_id: uuid.UUID | None = None
    source: TagSource | None = None
    site_id: uuid.UUID | None = None
    device_key: str | None = Field(default=None, min_length=1, max_length=120)
    label: str | None = Field(default=None, min_length=1, max_length=120)
    unit: str | None = Field(default=None, max_length=30)
    enabled: bool | None = None
    config: dict | None = None
    meta: dict | None = None


ColumnKind = Literal["formula", "text", "number"]


class WorkbenchColumnCreateRequest(BaseModel):
    sheet_id: uuid.UUID
    name: str = Field(min_length=1, max_length=60)
    kind: ColumnKind = "formula"
    # Opaque here — evaluated only client-side by the safe arithmetic parser.
    # Required for kind "formula"; must be absent for text/number columns.
    formula: str | None = Field(default=None, min_length=1, max_length=500)
    unit: str = Field(default="", max_length=30)
    decimals: int = Field(default=1, ge=0, le=6)

    @model_validator(mode="after")
    def _formula_matches_kind(self):
        if self.kind == "formula" and not self.formula:
            raise ValueError("Kolom rumus harus punya formula")
        if self.kind != "formula" and self.formula:
            raise ValueError("Kolom metadata tidak boleh punya formula")
        return self


class WorkbenchColumnUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    formula: str | None = Field(default=None, min_length=1, max_length=500)
    unit: str | None = Field(default=None, max_length=30)
    decimals: int | None = Field(default=None, ge=0, le=6)
    position: int | None = Field(default=None, ge=0)


# ---------------------------------------------------------------------------
# Responses — declared as response_model so OpenAPI documents the real shape
# (template for the rest of the codebase; see backend/scripts/export_openapi.py)
# ---------------------------------------------------------------------------


class PerspectiveOut(BaseModel):
    id: str
    name: str
    layout: PerspectiveLayout
    is_default: bool
    # True when this is the single admin-published default layout (Masalah D)
    is_published: bool = False
    # True when this entry is the admin default shown to a user who does NOT own
    # it — the frontend renders it view-only and forks it on edit ("Simpan
    # Sebagai"). Always False for the user's own perspectives.
    read_only: bool = False
    created_at: str | None
    updated_at: str | None


class PerspectiveListOut(BaseModel):
    items: list[PerspectiveOut]


class PublishedLayoutOut(BaseModel):
    """The admin-published default layout, or exists=False when none is set."""

    exists: bool
    name: str | None = None
    layout: PerspectiveLayout | None = None


class StreamOut(BaseModel):
    id: str
    name: str
    source_type: str  # "stream" | "web" | "vnc"
    hls_url: str | None
    webrtc_url: str | None
    # Read credentials are intentionally part of the payload — the endpoint is
    # gated behind scada:view and the browser player needs them (query params).
    read_user: str | None
    read_pass: str | None
    # web/vnc address; `secret` = the VNC view-only password. Exposed on
    # purpose (same rationale as read_pass) — the viewer's browser connects
    # directly and needs it.
    url: str | None
    secret: str | None
    enabled: bool
    created_at: str | None
    updated_at: str | None


class StreamListOut(BaseModel):
    items: list[StreamOut]


class ChannelOut(BaseModel):
    id: str
    number: int
    name: str
    kind: str
    config: dict
    enabled: bool
    created_at: str | None
    updated_at: str | None


class ChannelListOut(BaseModel):
    items: list[ChannelOut]


class SiteOut(BaseModel):
    id: str
    name: str
    enabled: bool
    mqtt_host: str
    mqtt_port: int
    mqtt_username: str | None
    base_topic: str
    # The broker password is intentionally NOT exposed — only whether one is
    # set. The bridge reads the real value directly from the DB (service_role).
    has_password: bool
    created_at: str | None
    updated_at: str | None


class SiteListOut(BaseModel):
    items: list[SiteOut]


class SheetOut(BaseModel):
    id: str
    name: str
    position: int
    created_at: str | None
    updated_at: str | None


class SheetListOut(BaseModel):
    items: list[SheetOut]


class TagOut(BaseModel):
    id: str
    sheet_id: str
    source: str
    site_id: str | None
    device_key: str
    label: str
    unit: str
    enabled: bool
    config: dict
    meta: dict
    created_at: str | None
    updated_at: str | None


class TagListOut(BaseModel):
    items: list[TagOut]


class HistoryPointOut(BaseModel):
    t: str  # bucket start, ISO 8601 UTC
    avg: float
    min: float
    max: float


class HistorySeriesOut(BaseModel):
    tag_id: str
    label: str
    unit: str
    points: list[HistoryPointOut]


class HistoryOut(BaseModel):
    series: list[HistorySeriesOut]


class SummaryItemOut(BaseModel):
    tag_id: str
    label: str
    unit: str
    # Nullable when the tag has no samples in the window yet
    last: float | None
    last_ts: str | None
    min: float | None
    max: float | None
    avg: float | None


class SummaryOut(BaseModel):
    items: list[SummaryItemOut]


class WorkbenchColumnOut(BaseModel):
    id: str
    sheet_id: str
    name: str
    kind: str
    formula: str | None
    unit: str
    decimals: int
    position: int
    created_at: str | None
    updated_at: str | None


class RecentSampleOut(BaseModel):
    ts: str
    value: float


class RecentSamplesOut(BaseModel):
    items: list[RecentSampleOut]


class SamplesPageOut(BaseModel):
    """Satu halaman riwayat mentah (terbaru dulu) untuk tabel scroll tanpa
    batas di halaman Riwayat — `has_more` = masih ada data lebih lama."""

    items: list[RecentSampleOut]
    has_more: bool


class SparkPointOut(BaseModel):
    t: str  # bucket start, ISO 8601 UTC
    v: float  # bucket average


class SparklineOut(BaseModel):
    tag_id: str
    points: list[SparkPointOut]


class SparklinesOut(BaseModel):
    """Bucketed mini-series for EVERY visible tag in one response — the 12-jam
    sparklines in the Analisis table (avoids one request per tag)."""

    items: list[SparklineOut]


class WorkbenchColumnListOut(BaseModel):
    items: list[WorkbenchColumnOut]


class DeletedOut(BaseModel):
    deleted: str


# ---------------------------------------------------------------------------
# Alarms (server-side engine — see app/services/alarm_engine.py)
# ---------------------------------------------------------------------------

AlarmKind = Literal["high", "low", "silent", "expiring"]


class AlarmEventOut(BaseModel):
    id: str
    tag_id: str
    tag_label: str
    tag_unit: str
    kind: str
    triggered_at: str
    trigger_value: float | None
    threshold: float | None
    cleared_at: str | None
    ack_at: str | None
    ack_name: str | None


class AlarmActiveOut(BaseModel):
    items: list[AlarmEventOut]


class AlarmHistoryOut(BaseModel):
    items: list[AlarmEventOut]
    total: int
    page: int
    page_size: int


class AlarmSettingsOut(BaseModel):
    email_enabled: bool
    email_recipients: str
    telegram_enabled: bool
    telegram_chat_id: str
    cooldown_min: int
    sound_enabled: bool
    # Whether TELEGRAM_BOT_TOKEN is configured in the backend env (the token
    # itself is never exposed) — lets the UI hint that Telegram can't work yet.
    telegram_token_set: bool


class AlarmSettingsUpdateRequest(BaseModel):
    email_enabled: bool | None = None
    email_recipients: str | None = Field(default=None, max_length=1000)
    telegram_enabled: bool | None = None
    telegram_chat_id: str | None = Field(default=None, max_length=64)
    cooldown_min: int | None = Field(default=None, ge=0, le=1440)
    sound_enabled: bool | None = None


class ArchiveOut(BaseModel):
    month: str  # first day of the archived month, e.g. "2026-04-01"
    file_name: str
    web_link: str | None
    row_count: int
    created_at: str | None


class ArchiveListOut(BaseModel):
    items: list[ArchiveOut]


class TagArchiveOut(BaseModel):
    """One archived historian cycle (per-tag reset model)."""

    tag_id: str
    tag_label: str
    file_name: str
    web_link: str | None
    row_count: int
    cycle_start: str
    cycle_end: str
    created_at: str | None


class TagArchiveListOut(BaseModel):
    items: list[TagArchiveOut]


class RollupArchiveOut(BaseModel):
    """One archived SUMMARY month for one plant.

    Distinct from TagArchiveOut because the units differ: this covers a whole
    plant for a whole calendar month (every sensor, one CSV each inside the
    zip), where the other covers one sensor for one cycle."""

    site_id: str | None
    plant: str
    month: str
    file_name: str
    web_link: str | None
    row_count: int
    tag_count: int
    created_at: str | None


class RollupArchiveListOut(BaseModel):
    items: list[RollupArchiveOut]


class LaneCoverageOut(BaseModel):
    """How far back ONE storage lane actually reaches, right now.

    `from_ts`/`to_ts` are derived from the live partition names, so they are
    what the database can really answer — not what the retention policy says it
    should keep. The two differ routinely: a day partition survives until ALL of
    it has aged out, so the raw lane is usually 24-48 h rather than exactly 24.
    """

    lane: str
    from_ts: str | None
    to_ts: str | None
    # ring_window_h for raw, keep-months expressed in hours for rollup — the
    # POLICY, next to the reality above, because a user comparing the two is
    # exactly how "why is my export short?" gets answered without asking anyone.
    policy_hours: int | None
    partitions: int


class TagCoverageOut(BaseModel):
    """First/last timestamp one sensor actually has in one lane. NULL means the
    sensor has nothing there — which is information, not an error: it is the
    difference between "no data in this range" and "wrong lane"."""

    tag_id: str
    lane: str
    first_ts: str | None
    last_ts: str | None


class CoverageOut(BaseModel):
    lanes: list[LaneCoverageOut]
    tags: list[TagCoverageOut]


class TopicFieldOut(BaseModel):
    """One name inside a topic's latest payload, and whether a sensor claims it.

    `used_by` is what turns the monitor from "here are some names" into a
    checklist: an operator can see at a glance which of a gateway's 30 values
    are already wired up and which are still on the table."""

    name: str
    value: float
    used_by: list[str] = Field(default_factory=list)


class TopicProbeOut(BaseModel):
    site_id: str
    site_name: str
    topic: str
    # "" for a plain single-value topic.
    gateway: str
    # True when this topic carries a bundle (several named values).
    bundled: bool
    fields: list[TopicFieldOut]
    seen_at: str


class TopicProbeListOut(BaseModel):
    items: list[TopicProbeOut]


class LatestItemOut(BaseModel):
    tag_id: str
    ts: str
    value: float


class LatestOut(BaseModel):
    items: list[LatestItemOut]


# Sampling levels a tag may pick. The name→seconds mapping is admin-editable in
# scada_settings (default fastest 2s / fast 5s / slow 30s / slowest 60s).
#
# All four are legal for every sensor. There used to be a second, narrower list
# (slow/slowest only) that applied when "Simpan data" was ticked — not because
# fast sampling was wrong, but because a month of 2-second rows would overflow
# an Excel sheet in the archive that lane produced. That lane is retired, the
# archive it protected no longer exists, and the restriction went with it.
SAMPLING_LEVELS = ("fastest", "fast", "slow", "slowest")

SamplingLevel = Literal["fastest", "fast", "slow", "slowest"]


def validate_sampling_level(config: dict | None) -> None:
    """Shared by TagCreateRequest and the PATCH /tags router (which must
    validate the MERGED config). Raises ValueError in Bahasa Indonesia like the
    other tag validators. A missing level is allowed (runtime falls back)."""
    cfg = config or {}
    raw = cfg.get("sampling_level")
    if raw is None:
        return
    if raw not in SAMPLING_LEVELS:
        raise ValueError("Level sampling tidak valid")


# Longest accepted config["mqtt_field"]. A field name is "<gateway>.<sensor>"
# from the gateway's own payload, so this is generous by design — the limit is
# there to stop a paste accident, not to constrain naming.
MQTT_FIELD_MAX = 200


def validate_mqtt_field(config: dict | None) -> None:
    """Optional bulk-payload selector — see TagCreateRequest for what it means.

    Absent is the normal case and always valid: one topic carrying one value.
    Present-but-blank is NOT the same thing and is rejected, because the two
    would behave identically at runtime while looking different in the UI, and
    an operator who typed a space would be left staring at a sensor that reads
    the whole payload instead of one field out of it."""
    cfg = config or {}
    if "mqtt_field" not in cfg:
        return
    raw = cfg["mqtt_field"]
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(
            "Field tidak boleh kosong — hapus isinya kalau topik ini hanya "
            "membawa satu nilai"
        )
    if len(raw) > MQTT_FIELD_MAX:
        raise ValueError(f"Field maksimal {MQTT_FIELD_MAX} karakter")


# One import call caps here. A plant is ~300 sensors, so this covers a whole
# plant in one paste with room to spare; past it the request body and the
# all-or-nothing transaction both stop being reasonable.
IMPORT_MAX_ROWS = 500


class TagImportRow(BaseModel):
    """One line of a sensor list, as typed/pasted by an operator.

    Deliberately FLAT, not a nested `config`: the person filling this in is
    reading a PLC tag list, not writing JSON. The router folds these into the
    same config shape create_tag produces, so an imported tag is
    indistinguishable from a hand-made one."""

    label: str = Field(min_length=1, max_length=120)
    unit: str = Field(default="", max_length=30)
    mqtt_topic: str = Field(min_length=1, max_length=300)
    # "Perangkat" — the value's name at the source, and the ONLY thing the
    # bridge routes a bundled payload by. Required: leaving it blank used to be
    # possible and produced a sensor that could never receive anything.
    device_key: str = Field(min_length=1, max_length=120)
    sampling_level: SamplingLevel | None = None
    # ACCEPTED AND IGNORED. The store lane is retired, but operators already
    # have spreadsheets carrying this column; rejecting it would turn a working
    # import into a 422 over a setting that no longer means anything. Kept as a
    # field rather than allowed through `extra` so it stays visible here as a
    # deliberate compatibility shim, not an oversight.
    store_enabled: bool = False
    alarm_min: float | None = None
    alarm_max: float | None = None
    warn_min: float | None = None
    warn_max: float | None = None
    scale: float | None = None
    offset: float | None = None
    decimals: int | None = Field(default=None, ge=0, le=6)


class TagImportRequest(BaseModel):
    sheet_id: uuid.UUID
    site_id: uuid.UUID
    rows: list[TagImportRow] = Field(min_length=1, max_length=IMPORT_MAX_ROWS)


class TagImportErrorOut(BaseModel):
    """`row` is 1-based and counts the rows the user sees, so it lines up with
    the line number in their spreadsheet."""

    row: int
    label: str
    message: str


class TagImportResultOut(BaseModel):
    created: int
    errors: list[TagImportErrorOut]


class RnetSettingsOut(BaseModel):
    """R-Net global settings (single row) — sampling durations, retention, and
    the zone used to LABEL timestamps for humans."""

    level_fastest_s: int
    level_fast_s: int
    level_slow_s: int
    level_slowest_s: int
    ring_window_h: int
    store_months: int
    reset_warn_days: int
    display_timezone: str


class RnetSettingsUpdateRequest(BaseModel):
    # All optional (partial update). Seconds bounded to sane ranges; the fast→
    # slow ordering is not enforced server-side (admin's call).
    level_fastest_s: int | None = Field(default=None, ge=1, le=86400)
    level_fast_s: int | None = Field(default=None, ge=1, le=86400)
    level_slow_s: int | None = Field(default=None, ge=1, le=86400)
    level_slowest_s: int | None = Field(default=None, ge=1, le=86400)
    ring_window_h: int | None = Field(default=None, ge=1, le=168)
    store_months: int | None = Field(default=None, ge=1, le=24)
    reset_warn_days: int | None = Field(default=None, ge=1, le=90)
    # IANA name. Validated HERE, at the write, so a typo is a 422 the admin sees
    # immediately — the readers fall back to UTC and log, which would otherwise
    # turn one bad keystroke into every export and archive silently switching
    # zone.
    display_timezone: str | None = Field(default=None, max_length=64)

    @field_validator("display_timezone")
    @classmethod
    def _known_zone(cls, v: str | None) -> str | None:
        if v is None:
            return v
        name = v.strip()
        if not name:
            raise ValueError("Zona waktu tidak boleh kosong")
        try:
            ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError(
                f"Zona waktu '{name}' tidak dikenal. Pakai nama IANA, "
                f"mis. Asia/Jakarta, Asia/Makassar, Asia/Jayapura, UTC."
            )
        return name
