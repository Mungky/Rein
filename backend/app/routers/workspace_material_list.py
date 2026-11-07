"""Project material rows and a validated, atomic Excel import."""
import asyncio
import hashlib
import io
import json
import re
import uuid
import zipfile
from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from app.routers.workspace import _can, _require_project_access
from app.routers.workspace_board import DB, Reader
from app.routers.workspace_coordination import project_task
from app.services import workspace_coordination as ops
from db.models.workspace import WorkspaceTask, WorkspacePhase
from db.models.workspace_coordination import MaterialItem, MaterialRequest, StockBalance

router = APIRouter()
STATUS_LABELS = {"requested": "Add Req", "stock": "Stock", "purchased": "PO", "received": "Recieved"}
HEADERS = ["Nomor", "Description Material", "Size Or Spesification", "QTY", "Satuan", "Status", "Note", "WO"]


class MaterialLineIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    request_id: uuid.UUID
    line_number: int | None = Field(default=None, ge=1, le=1000000)
    description: str = Field(min_length=1, max_length=255)
    specification: str = Field(default="", max_length=500)
    quantity: Decimal = Field(gt=0, max_digits=16, decimal_places=3)
    unit: str = Field(min_length=1, max_length=40)
    status: Literal["requested", "stock", "purchased", "received"] = "requested"
    notes: str = Field(default="", max_length=3000)
    task_id: uuid.UUID | None = None
    expected_updated_at: datetime | None = None


async def status_permission(db, profile, status):
    if await _can(db, profile, "workspace:manage") or status == "requested":
        return
    key = "workspace:purchase" if status == "purchased" else "workspace:warehouse"
    if not await _can(db, profile, key):
        raise HTTPException(403, f"Permission {key} diperlukan untuk status {STATUS_LABELS[status]}")


async def material_item(db, body):
    identity = json.dumps([body.description.casefold(), body.specification.casefold(), body.unit.casefold()], ensure_ascii=False)
    key = uuid.uuid5(uuid.NAMESPACE_URL, "rein-material:" + identity)
    sku = "MAT-" + key.hex[:24].upper()
    await db.execute(insert(MaterialItem).values(id=key, sku=sku, name=body.description, unit=body.unit).on_conflict_do_nothing())
    await db.execute(insert(StockBalance).values(item_id=key).on_conflict_do_nothing())
    return key


async def create_line(db, profile, project_id, body):
    digest = hashlib.sha256(body.model_dump_json(exclude={"expected_updated_at"}).encode()).hexdigest()
    existing = await db.get(MaterialRequest, body.request_id)
    if existing:
        if existing.project_id != project_id or existing.author_id != profile.id or existing.creation_hash != digest:
            raise HTTPException(409, "ID material telah digunakan untuk data berbeda")
        return existing
    await project_task(db, project_id, body.task_id)
    await status_permission(db, profile, body.status)
    number = body.line_number or (await db.scalar(select(func.coalesce(func.max(MaterialRequest.line_number), 0)).where(MaterialRequest.project_id == project_id))) + 1
    if await db.scalar(select(MaterialRequest.id).where(MaterialRequest.project_id == project_id, MaterialRequest.line_number == number)):
        raise HTTPException(409, f"Nomor material {number} sudah digunakan")
    item_id = await material_item(db, body)
    row = MaterialRequest(id=body.request_id, project_id=project_id, item_id=item_id, author_id=profile.id,
        line_number=number, creation_hash=digest, **body.model_dump(exclude={"request_id", "line_number", "unit", "expected_updated_at"}))
    db.add(row)
    await db.flush()
    return row


@router.post("/projects/{project_id}/material-list", status_code=201)
async def add_material_line(project_id: uuid.UUID, body: MaterialLineIn, db: DB, profile: Reader):
    await ops.writable_project(db, profile, project_id)
    row = await create_line(db, profile, project_id, body)
    await ops.event(db, project_id, profile, "Material proyek ditambahkan", row.task_id, {"name": row.description})
    return {"id": str(row.id)}


@router.put("/material-requests/{request_id}/details")
async def update_material_line(request_id: uuid.UUID, body: MaterialLineIn, db: DB, profile: Reader):
    row = await db.get(MaterialRequest, request_id)
    if not row:
        raise HTTPException(404, "Material tidak ditemukan")
    await ops.writable_project(db, profile, row.project_id)
    row = await db.get(MaterialRequest, request_id, populate_existing=True)
    manager = await _can(db, profile, "workspace:manage")
    if row.author_id != profile.id and not (manager or await _can(db, profile, "workspace:purchase") or await _can(db, profile, "workspace:warehouse")):
        raise HTTPException(403, "Hanya pencatat atau role pengelola material dapat mengubah baris ini")
    if not body.expected_updated_at or row.updated_at != body.expected_updated_at:
        raise HTTPException(409, "Material berubah. Muat ulang sebelum mengedit")
    await project_task(db, row.project_id, body.task_id)
    if body.status != ("purchased" if row.status == "in_transit" else row.status):
        await status_permission(db, profile, body.status)
    if body.quantity < max(row.received, row.reserved + row.issued):
        raise HTTPException(409, "QTY tidak boleh kurang dari jumlah yang diterima atau dialokasikan")
    item = await db.get(MaterialItem, row.item_id)
    identity_changed = (row.description or item.name, row.specification, item.unit) != (body.description, body.specification, body.unit)
    if identity_changed:
        if row.received or row.reserved or row.issued:
            raise HTTPException(409, "Identitas material yang sudah dimutasi harus tetap sama. Tambahkan baris material baru")
        row.item_id = await material_item(db, body)
    for key in ("description", "specification", "quantity", "status", "notes", "task_id"):
        setattr(row, key, getattr(body, key))
    row.updated_at = ops.now()
    await ops.event(db, row.project_id, profile, "Material proyek diperbarui", row.task_id, {"name": row.description, "status": row.status})
    return {"ok": True}


async def parse_excel(data: bytes):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if sum(info.file_size for info in archive.infolist()) > 30 * 1024 * 1024:
                raise HTTPException(413, "Ukuran isi Excel maksimal 30 MB")
        workbook = await asyncio.to_thread(
            load_workbook, io.BytesIO(data), read_only=True, data_only=False, keep_links=False
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(422, "Berkas harus Excel .xlsx yang valid")
    try:
        sheet = workbook["Material"] if "Material" in workbook.sheetnames else workbook.active
        rows = sheet.iter_rows(max_row=1002, max_col=12)
        header = [str(c.value or "").strip().casefold() for c in next(rows)]
        aliases = {"size or specification": "size or spesification", "description": "description material"}
        header = [aliases.get(h, h) for h in header]
        expected = [h.casefold() for h in HEADERS]
        if header[:8] != expected:
            raise HTTPException(422, "Kolom tidak sesuai. Gunakan template Excel yang disediakan")
        items, errors = [], []
        for index, cells in enumerate(rows, start=2):
            values = [cell.value for cell in cells[:8]]
            if not any(value is not None and str(value).strip() for value in values):
                continue
            if index > 1001:
                raise HTTPException(413, "Maksimal 1.000 baris material per impor")
            if any(cell.data_type == "f" for cell in cells[:8]):
                errors.append({"row": index, "message": "Gunakan nilai, bukan rumus Excel"}); continue
            status = str(values[5] or "Add Req").strip().casefold()
            status = {"add req": "requested", "stock": "stock", "po": "purchased", "recieved": "received", "received": "received"}.get(status, status)
            try:
                line = MaterialLineIn(request_id=uuid.uuid4(), line_number=values[0], description=values[1], specification=str(values[2] or ""),
                    quantity=values[3], unit=values[4], status=status, notes=str(values[6] or ""))
                items.append({"row": index, **line.model_dump(mode="json", exclude={"request_id", "expected_updated_at"}), "wo": str(values[7] or "").strip()})
            except ValidationError as err:
                errors.append({"row": index, "message": "; ".join(f"{e['loc'][0]}: {e['msg']}" for e in err.errors())})
        if not items and not errors:
            errors.append({"row": 2, "message": "Belum ada baris material"})
        return items, errors
    finally:
        workbook.close()


async def import_rows(db, project_id, data, batch_id=None):
    items, errors = await parse_excel(data)
    tasks = {task.wo_number: task.id for task in (await db.scalars(select(WorkspaceTask).join(WorkspacePhase).where(WorkspacePhase.project_id == project_id))).all()}
    existing_numbers = set((await db.scalars(select(MaterialRequest.line_number).where(MaterialRequest.project_id == project_id))).all())
    seen = set()
    for item in items:
        item["request_id"] = str(uuid.uuid5(batch_id, str(item["row"]))) if batch_id else str(uuid.uuid4())
        match = re.fullmatch(r"WO-(\d+)", item["wo"], re.IGNORECASE) if item["wo"] else None
        if item["wo"] and (not match or int(match[1]) not in tasks):
            errors.append({"row": item["row"], "message": "WO tidak ditemukan dalam proyek ini (contoh: WO-1)"})
        item["task_id"] = str(tasks[int(match[1])]) if match and int(match[1]) in tasks else None
        number = item["line_number"]
        retried = batch_id and await db.get(MaterialRequest, uuid.UUID(item["request_id"]))
        if number in seen or (number and number in existing_numbers and not retried):
            errors.append({"row": item["row"], "message": f"Nomor material {number} sudah digunakan"})
        if number:
            seen.add(number)
    return {"items": items, "errors": errors, "valid": bool(items) and not errors}


async def excel_upload(file):
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(415, "Gunakan format Excel .xlsx")
    data = await file.read(5 * 1024 * 1024 + 1)
    if not data or len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "Ukuran Excel maksimal 5 MB")
    return data


@router.post("/projects/{project_id}/materials/import-preview")
async def preview_import(project_id: uuid.UUID, db: DB, profile: Reader, file: UploadFile = File(...)):
    await _require_project_access(db, profile, project_id)
    return await import_rows(db, project_id, await excel_upload(file))


@router.post("/projects/{project_id}/materials/import")
async def commit_import(project_id: uuid.UUID, db: DB, profile: Reader, file: UploadFile = File(...), request_id: uuid.UUID = Form(...)):
    data = await excel_upload(file)
    await ops.writable_project(db, profile, project_id)
    parsed = await import_rows(db, project_id, data, request_id)
    if not parsed["valid"]:
        raise HTTPException(422, {"message": "Impor dibatalkan; perbaiki baris yang ditandai", "errors": parsed["errors"]})
    for item in parsed["items"]:
        await create_line(db, profile, project_id, MaterialLineIn.model_validate({k: v for k, v in item.items() if k not in {"row", "wo"}}))
    await ops.event(db, project_id, profile, "Material diimpor dari Excel", payload={"rows": len(parsed["items"])})
    return {"count": len(parsed["items"])}


@router.get("/projects/{project_id}/materials/template")
async def excel_template(project_id: uuid.UUID, db: DB, profile: Reader):
    await _require_project_access(db, profile, project_id)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Material"
    sheet.append(HEADERS)
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF"); cell.fill = PatternFill("solid", fgColor="2563EB")
    for column, width in zip("ABCDEFGH", [10, 38, 30, 14, 14, 18, 40, 16]):
        sheet.column_dimensions[column].width = width
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = "A1:H1001"
    validation = DataValidation(type="list", formula1='"Add Req,Stock,PO,Recieved"')
    validation.errorTitle = "Status tidak valid"; validation.error = "Pilih status dari daftar"; validation.showErrorMessage = True
    sheet.add_data_validation(validation); validation.add("F2:F1001")
    instructions = workbook.create_sheet("Petunjuk")
    for line in ["Isi sheet Material. Maksimal 1.000 baris; simpan sebagai .xlsx.", "QTY berupa angka; satuan ditulis di kolom Satuan.", "Nomor boleh kosong untuk penomoran baris otomatis.", "Status: Add Req, Stock, PO, Recieved. Kosong berarti Add Req.", "WO opsional. Gunakan nomor WO dari proyek ini, misalnya WO-1.", "Gunakan nilai biasa, bukan rumus. Lihat pratinjau sebelum impor."]:
        instructions.append([line])
    instructions.column_dimensions["A"].width = 100
    output = io.BytesIO()
    await asyncio.to_thread(workbook.save, output)
    return Response(output.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="Template-Material.xlsx"', "Cache-Control": "no-store"})
