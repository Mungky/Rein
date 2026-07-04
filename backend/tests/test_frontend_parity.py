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
