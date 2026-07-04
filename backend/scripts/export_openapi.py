"""Dump the FastAPI OpenAPI schema to backend/openapi.json.

Usage (from repo root or backend/):
    python backend/scripts/export_openapi.py

The output feeds TypeScript type generation on the frontend:
    cd frontend && bun run gen:api-types

Endpoints only appear with accurate shapes when they declare a Pydantic
`response_model` (see app/routers/scada.py for the template). Endpoints that
return bare dicts show up as untyped objects — convert them incrementally.
"""

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(BACKEND), str(BACKEND.parent)]

from app.main import app  # noqa: E402

out = BACKEND / "openapi.json"
out.write_text(json.dumps(app.openapi(), indent=2, ensure_ascii=False), encoding="utf-8")
print(f"OpenAPI schema ({len(app.routes)} routes) -> {out}")
