"""Frontend ↔ backend permission parity.

The frontend keeps a compile-time `Permission` union (roles.ts) and groups
permissions into admin-UI cards (PERM_MODULE_CARDS). Both must track the
backend's ALL_PERMISSIONS exactly — this is the drift that once hid the
SCADA menu from the sidebar. These tests parse the actual frontend source,
so any mismatch fails CI before it reaches a browser.
"""

import re
from pathlib import Path

from db.models.role_permission import ALL_PERMISSIONS

REPO_ROOT = Path(__file__).resolve().parents[2]
ROLES_TS = REPO_ROOT / "frontend" / "src" / "lib" / "utils" / "roles.ts"
ADMIN_PAGE = (
    REPO_ROOT / "frontend" / "src" / "features" / "admin" / "permissions-tab.tsx"
)

PERM_RE = re.compile(r'"([a-z_]+:[a-z_]+)"')


def _frontend_permission_union() -> set[str]:
    source = ROLES_TS.read_text(encoding="utf-8")
    match = re.search(r"export type Permission =(.*?);", source, re.DOTALL)
    assert match, "Union `Permission` tidak ditemukan di roles.ts"
    return set(PERM_RE.findall(match.group(1)))


def _admin_card_permissions() -> list[str]:
    source = ADMIN_PAGE.read_text(encoding="utf-8")
    match = re.search(
        r"const PERM_MODULE_CARDS[^=]*=\s*\[(.*?)\n\];", source, re.DOTALL
    )
    assert match, "PERM_MODULE_CARDS tidak ditemukan di admin/page.tsx"
    return PERM_RE.findall(match.group(1))


def test_roles_ts_union_matches_backend():
    frontend = _frontend_permission_union()
    backend = set(ALL_PERMISSIONS)
    assert frontend == backend, (
        f"Hanya di frontend: {sorted(frontend - backend)} | "
        f"Hanya di backend: {sorted(backend - frontend)}"
    )


def test_admin_cards_cover_every_permission_exactly_once():
    card_perms = _admin_card_permissions()
    assert len(card_perms) == len(set(card_perms)), "Ada permission di dua kartu admin"
    missing = set(ALL_PERMISSIONS) - set(card_perms)
    assert not missing, (
        f"Permission tidak muncul di kartu admin (tak bisa dicentang!): {sorted(missing)}"
    )
    unknown = set(card_perms) - set(ALL_PERMISSIONS)
    assert not unknown, f"Kartu admin memakai permission tak dikenal: {sorted(unknown)}"


# --- R-Net settings: interface TS ↔ _SETTINGS_FIELDS ------------------------
#
# Kelas drift yang sama, dan yang ini sudah pernah menggigit: frontend menanam
# durasi level sampling sendiri (2/5/30/60) dan tidak pernah menanyakannya ke
# server, jadi admin yang menyetel ulang level_slow_s membuat halaman menandai
# sensor sehat sebagai offline. Sekarang durasinya diambil dari endpoint ini —
# yang berarti bentuk payload-nya jadi kontrak, bukan kebetulan.

TYPES_TS = REPO_ROOT / "frontend" / "src" / "features" / "scada" / "types.ts"
SAMPLING_TS = REPO_ROOT / "frontend" / "src" / "features" / "scada" / "sampling.ts"


def _ts_interface_fields(path: Path, name: str) -> set[str]:
    source = path.read_text(encoding="utf-8")
    match = re.search(rf"export interface {name} \{{(.*?)\n\}}", source, re.DOTALL)
    assert match, f"Interface `{name}` tidak ditemukan di {path.name}"
    return set(re.findall(r"^\s*([a-z_]+)\s*[?:]", match.group(1), re.MULTILINE))


def test_rnet_settings_interface_matches_backend():
    from app.routers.scada import _SETTINGS_FIELDS

    frontend = _ts_interface_fields(TYPES_TS, "RnetSettings")
    backend = set(_SETTINGS_FIELDS)
    assert frontend == backend, (
        f"Hanya di frontend: {sorted(frontend - backend)} | "
        f"Hanya di backend: {sorted(backend - frontend)}"
    )


def test_every_sampling_level_maps_to_a_settings_column():
    """LEVEL_FIELD di sampling.ts memetakan level → kolom setelan. Level yang
    tidak terpetakan diam-diam jatuh ke nilai fallback selamanya — persis bug
    yang baru saja diperbaiki, cuma lewat pintu lain."""
    from app.schemas.scada import SAMPLING_LEVELS

    source = SAMPLING_TS.read_text(encoding="utf-8")
    match = re.search(r"const LEVEL_FIELD[^=]*=\s*\{(.*?)\n\};", source, re.DOTALL)
    assert match, "LEVEL_FIELD tidak ditemukan di sampling.ts"
    mapped = dict(re.findall(r"(\w+):\s*\"(\w+)\"", match.group(1)))

    assert set(mapped) == set(SAMPLING_LEVELS), (
        f"Level tak terpetakan: {sorted(set(SAMPLING_LEVELS) - set(mapped))}"
    )
    from app.routers.scada import _SETTINGS_FIELDS

    unknown = set(mapped.values()) - set(_SETTINGS_FIELDS)
    assert not unknown, f"LEVEL_FIELD menunjuk kolom yang tak ada: {sorted(unknown)}"
