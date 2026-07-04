"""Smoke test: the FastAPI app boots and every module's routes are mounted.

Catches broken imports, router-registration slips, and prefix typos without
needing a database or network.
"""

from app.main import app

EXPECTED_PREFIXES = [
    "/api/auth",
    "/api/documents",
    "/api/upload",
    "/api/approvals",
    "/api/access",
    "/api/chat",
    "/api/queue",
    "/api/dashboard",
    "/api/admin",
    "/api/permissions",
    "/api/clients",
    "/api/projects",
    "/api/workspace",
    "/api/library",
    "/api/scada",
]


def _route_paths() -> list[str]:
    return [route.path for route in app.routes if hasattr(route, "path")]


def test_all_module_prefixes_mounted():
    paths = _route_paths()
    for prefix in EXPECTED_PREFIXES:
        assert any(p.startswith(prefix) for p in paths), f"Tidak ada route dengan prefix {prefix}"


def test_scada_endpoints_registered():
    paths = _route_paths()
    for expected in (
        "/api/scada/perspectives",
        "/api/scada/perspectives/{perspective_id}",
        "/api/scada/perspectives/{perspective_id}/default",
        "/api/scada/streams",
        "/api/scada/streams/{stream_id}",
    ):
        assert expected in paths, f"Route SCADA hilang: {expected}"
