"""Project material requirements and a serialized, immutable warehouse movement ledger."""
import hashlib
import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict, model_validator
from sqlalchemy import select, func, case
from sqlalchemy.exc import IntegrityError

from app.dependencies import require_permission
from app.routers.workspace_board import DB, Reader
from app.routers.workspace import _can, _require_project_access, _visible_project_ids
from app.routers.workspace_coordination import require_coordination, project_task
from app.services import workspace_coordination as ops
from db.models.profile import Profile
from db.models.workspace import WorkspaceProject
from db.models.workspace_coordination import MaterialItem, StockBalance, MaterialRequest, StockMovement

router = APIRouter(dependencies=[Depends(require_coordination)])
Warehouse = Annotated[Profile, Depends(require_permission("workspace:view", "workspace:warehouse"))]
Purchaser = Annotated[Profile, Depends(require_permission("workspace:view", "workspace:purchase"))]


class MaterialInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class ItemIn(MaterialInput):
    sku: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=255)
    unit: str = Field(min_length=1, max_length=40)


class RequestIn(MaterialInput):
    request_id: uuid.UUID
    item_id: uuid.UUID
    task_id: uuid.UUID | None = None
    quantity: Decimal = Field(gt=0, max_digits=16, decimal_places=3)
    notes: str = Field(min_length=3, max_length=3000)


class PurchaseIn(MaterialInput):
    status: Literal["purchased", "in_transit"]
    order_reference: str = Field(min_length=1, max_length=150)
    eta: date
    notes: str = Field(min_length=3, max_length=3000)


class MovementIn(MaterialInput):
    request_id: uuid.UUID
    item_id: uuid.UUID
    material_request_id: uuid.UUID | None = None
    related_move_id: uuid.UUID | None = None
    kind: Literal["receipt", "receipt_rejected", "reserve", "unreserve", "issue", "loan", "return_loan", "return_project", "quarantine", "restore", "stocktake"]
    quantity: Decimal = Field(ge=0, max_digits=16, decimal_places=3)
    reference: str = Field(min_length=3, max_length=255)
    notes: str = Field(min_length=3, max_length=3000)

    @model_validator(mode="after")
    def valid(self):
        if self.kind != "stocktake" and self.quantity <= 0:
            raise ValueError("Jumlah harus lebih dari nol")
        if self.kind in {"reserve", "unreserve", "issue"} and not self.material_request_id:
            raise ValueError("Pilih kebutuhan material proyek")
        if self.kind in {"return_loan", "return_project"} and not self.related_move_id:
            raise ValueError("Pilih mutasi asal untuk pengembalian")
        if len(self.reference.strip()) < 3 or len(self.notes.strip()) < 3:
            raise ValueError("Referensi dan alasan wajib diisi")
        return self


@router.get("/materials/catalog")
async def catalog(db: DB, profile: Reader):
    rows = (await db.execute(select(MaterialItem, StockBalance).join(StockBalance))).all()
    loans = dict((await db.execute(select(StockMovement.item_id,
        func.sum(case((StockMovement.kind == "loan", StockMovement.quantity), else_=-StockMovement.quantity)))
        .where(StockMovement.kind.in_(["loan", "return_loan"])).group_by(StockMovement.item_id))).all())
    return [{"id": str(i.id), "sku": i.sku, "name": i.name, "unit": i.unit,
        "usable": float(b.usable), "reserved": float(b.reserved), "available": float(b.usable-b.reserved), "unusable": float(b.unusable), "loaned": float(loans.get(i.id,0))} for i,b in rows]


@router.post("/materials/catalog", status_code=201)
async def create_item(body: ItemIn, db: DB, profile: Warehouse):
    if not all(v.strip() for v in body.model_dump().values()):
        raise HTTPException(422, "SKU, nama dan satuan wajib diisi")
    item = MaterialItem(sku=body.sku.strip().upper(), name=body.name.strip(), unit=body.unit.strip())
    db.add(item)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "SKU sudah terdaftar")
    db.add(StockBalance(item_id=item.id))
    return {"id": str(item.id)}


@router.get("/projects/{project_id}/materials")
async def project_materials(project_id: uuid.UUID, db: DB, profile: Reader):
    await _require_project_access(db, profile, project_id)
    rows = (await db.execute(select(MaterialRequest, MaterialItem).join(MaterialItem)
        .where(MaterialRequest.project_id == project_id).order_by(MaterialRequest.line_number.asc().nullslast(), MaterialRequest.created_at))).all()
    return [{"id": str(r.id), "task_id": str(r.task_id) if r.task_id else None, "item_id": str(i.id),
        "sku": i.sku, "name": r.description or i.name, "unit": i.unit, "line_number": r.line_number, "specification": r.specification, "updated_at": ops.stamp(r.updated_at), "author_id": str(r.author_id), "quantity": float(r.quantity), "received": float(r.received),
        "reserved": float(r.reserved), "issued": float(r.issued), "shortage": float(r.quantity-r.reserved-r.issued),
        "status": r.status, "eta": ops.stamp(r.eta), "order_reference": r.order_reference, "notes": r.notes} for r,i in rows]


@router.get("/materials/requests")
async def material_queue(db: DB, profile: Reader):
    visible = await _visible_project_ids(db, profile)
    query = select(MaterialRequest, MaterialItem, WorkspaceProject.name).join(MaterialItem).join(WorkspaceProject, MaterialRequest.project_id == WorkspaceProject.id)
    query = query.where(WorkspaceProject.archived_at.is_(None))
    if visible is not None:
        query = query.where(MaterialRequest.project_id.in_(visible))
    rows = (await db.execute(query.order_by(MaterialRequest.created_at.desc()).limit(500))).all()
    return [{"id": str(r.id), "project_id": str(r.project_id), "project_name": name,
        "task_id": str(r.task_id) if r.task_id else None, "item_id": str(i.id), "sku": i.sku, "name": r.description or i.name, "line_number": r.line_number, "specification": r.specification, "updated_at": ops.stamp(r.updated_at), "author_id": str(r.author_id),
        "unit": i.unit, "quantity": float(r.quantity), "received": float(r.received), "reserved": float(r.reserved),
        "issued": float(r.issued), "shortage": float(r.quantity-r.reserved-r.issued), "status": r.status,
        "eta": ops.stamp(r.eta), "order_reference": r.order_reference, "notes": r.notes} for r,i,name in rows]


@router.post("/projects/{project_id}/materials", status_code=201)
async def request_material(project_id: uuid.UUID, body: RequestIn, db: DB, profile: Reader):
    await ops.writable_project(db, profile, project_id)
    await project_task(db, project_id, body.task_id)
    if not await db.get(MaterialItem, body.item_id):
        raise HTTPException(422, "Material belum terdaftar di katalog gudang")
    old = await db.get(MaterialRequest, body.request_id)
    if old:
        if (old.project_id, old.task_id, old.item_id, old.quantity, old.notes, old.author_id) != (project_id, body.task_id, body.item_id, body.quantity, body.notes, profile.id):
            raise HTTPException(409, "ID permintaan sudah dipakai untuk data berbeda")
        return {"id": str(old.id)}
    number = (await db.scalar(select(func.coalesce(func.max(MaterialRequest.line_number), 0)).where(MaterialRequest.project_id == project_id))) + 1
    db.add(MaterialRequest(id=body.request_id, project_id=project_id, author_id=profile.id, line_number=number,
        **body.model_dump(exclude={"request_id"})))
    await ops.invalidate_releases(db, project_id, body.task_id)
    await ops.event(db, project_id, profile, "Kebutuhan material dicatat", body.task_id,
        {"item_id": str(body.item_id), "quantity": str(body.quantity), "notes": body.notes})
    return {"id": str(body.request_id)}


@router.put("/material-requests/{request_id}/purchase")
async def purchase_material(request_id: uuid.UUID, body: PurchaseIn, db: DB, profile: Purchaser):
    request = await db.get(MaterialRequest, request_id)
    if not request:
        raise HTTPException(404, "Permintaan tidak ditemukan")
    await ops.writable_project(db, profile, request.project_id)
    request = await db.get(MaterialRequest, request_id, populate_existing=True)
    if request.status == "received" or (request.status == "in_transit" and body.status == "purchased"):
        raise HTTPException(409, "Status penerimaan tidak dapat dimundurkan")
    for key,value in body.model_dump().items():
        setattr(request, key, value)
    await ops.event(db, request.project_id, profile, "Status pembelian diperbarui", request.task_id,
        {"status": body.status, "reference": body.order_reference, "eta": str(body.eta), "notes": body.notes})
    return {"ok": True}


@router.post("/materials/movements", status_code=201)
async def move_stock(body: MovementIn, db: DB, profile: Warehouse):
    request = await db.get(MaterialRequest, body.material_request_id) if body.material_request_id else None
    if body.material_request_id and (not request or request.item_id != body.item_id):
        raise HTTPException(422, "Permintaan dan material tidak cocok")
    project_id = request.project_id if request else None
    if project_id:
        await ops.writable_project(db, profile, project_id)
    balance = await db.scalar(select(StockBalance).where(StockBalance.item_id == body.item_id).with_for_update())
    if not balance:
        raise HTTPException(404, "Material tidak ditemukan")
    fingerprint = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    old = await db.get(StockMovement, body.request_id)
    if old:
        if old.request_hash != fingerprint or old.actor_id != profile.id:
            raise HTTPException(409, "ID mutasi sudah dipakai untuk data berbeda")
        return {"id": str(old.id), "reused": True}
    if request:
        request = await db.get(MaterialRequest, request.id, populate_existing=True)
    amount = body.quantity
    free = balance.usable - balance.reserved
    delta = amount
    related = None
    if body.related_move_id:
        related = await db.get(StockMovement, body.related_move_id)
        expected = "loan" if body.kind == "return_loan" else "issue"
        if not related or related.item_id != body.item_id or related.kind != expected or body.kind not in {"return_loan", "return_project"}:
            raise HTTPException(422, "Mutasi asal tidak cocok")
        returned = await db.scalar(select(func.coalesce(func.sum(StockMovement.quantity),0)).where(StockMovement.related_move_id == related.id))
        if amount + returned > related.quantity:
            raise HTTPException(409, "Jumlah pengembalian melebihi mutasi asal")
        if related.material_request_id != body.material_request_id:
            raise HTTPException(422, "Pengembalian harus mengacu ke permintaan asal")
    if body.kind in {"receipt", "receipt_rejected"}:
        if request and request.received + amount > request.quantity:
            raise HTTPException(409, "Penerimaan melebihi jumlah permintaan")
        if body.kind == "receipt":
            balance.usable += amount
        else:
            balance.unusable += amount
        if request:
            request.received += amount
            if request.received == request.quantity:
                request.status = "received"
    elif body.kind == "reserve":
        if amount > free or request.reserved + request.issued + amount > request.quantity:
            raise HTTPException(409, "Stok bebas tidak cukup atau alokasi melebihi kebutuhan")
        balance.reserved += amount
        request.reserved += amount
    elif body.kind == "unreserve":
        if amount > request.reserved:
            raise HTTPException(409, "Jumlah melebihi alokasi proyek")
        balance.reserved -= amount
        request.reserved -= amount
    elif body.kind == "issue":
        if amount > request.reserved:
            raise HTTPException(409, "Alokasikan material ke proyek sebelum barang keluar")
        balance.reserved -= amount
        balance.usable -= amount
        request.reserved -= amount
        request.issued += amount
    elif body.kind in {"loan", "quarantine"}:
        if amount > free:
            raise HTTPException(409, "Stok bebas tidak cukup; stok proyek lain tidak boleh diambil")
        balance.usable -= amount
        if body.kind == "quarantine":
            balance.unusable += amount
    elif body.kind == "restore":
        if amount > balance.unusable:
            raise HTTPException(409, "Jumlah melebihi stok karantina")
        balance.unusable -= amount
        balance.usable += amount
    elif body.kind in {"return_loan", "return_project"}:
        balance.usable += amount
        if body.kind == "return_project":
            request.issued -= amount
    elif body.kind == "stocktake":
        if amount < balance.reserved:
            raise HTTPException(409, "Hasil opname di bawah alokasi; selesaikan koreksi alokasi terlebih dahulu")
        delta = amount - balance.usable
        balance.usable = amount
    move = StockMovement(id=body.request_id, request_hash=fingerprint, item_id=body.item_id, project_id=project_id,
        material_request_id=body.material_request_id, related_move_id=body.related_move_id, kind=body.kind,
        quantity=delta, reference=body.reference.strip(), notes=body.notes.strip(), actor_id=profile.id)
    db.add(move)
    if project_id:
        await ops.event(db, project_id, profile, "Mutasi material: " + body.kind, request.task_id,
            {"quantity": str(delta), "reference": body.reference, "notes": body.notes})
    return {"id": str(move.id), "reused": False}


@router.get("/materials/movements")
async def movement_history(db: DB, profile: Reader, project_id: uuid.UUID | None = None, offset: int = 0, limit: int = 50):
    if offset < 0 or not 1 <= limit <= 100:
        raise HTTPException(422, "Batas halaman tidak valid")
    query = select(StockMovement, MaterialItem, Profile.full_name).join(MaterialItem).join(Profile, StockMovement.actor_id == Profile.id)
    if project_id:
        await _require_project_access(db, profile, project_id)
        query = query.where(StockMovement.project_id == project_id)
    else:
        if not await _can(db, profile, "workspace:warehouse"):
            raise HTTPException(403, "Riwayat gudang lintas proyek memerlukan izin gudang")
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = (await db.execute(query.order_by(StockMovement.created_at.desc()).offset(offset).limit(limit))).all()
    return {"total": total, "items": [{"id": str(m.id), "item_id": str(m.item_id), "name": i.name,
        "sku": i.sku, "unit": i.unit, "kind": m.kind, "quantity": float(m.quantity), "reference": m.reference,
        "notes": m.notes, "actor": name, "material_request_id": str(m.material_request_id) if m.material_request_id else None,
        "created_at": ops.stamp(m.created_at)} for m,i,name in rows]}


from app.routers.workspace_material_list import router as material_list_router
router.include_router(material_list_router)
