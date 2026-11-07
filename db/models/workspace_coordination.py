"""Operational records shared by engineering, production, purchasing and warehouse."""
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, LargeBinary, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UUIDMixin, TimestampMixin


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_projects.id", ondelete="CASCADE"), primary_key=True)
    profile_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)
    division: Mapped[str] = mapped_column(String(80), default="Umum", server_default="Umum")


class WorkspaceWorkControl(TimestampMixin, Base):
    __tablename__ = "workspace_work_controls"
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), primary_key=True)
    creation_hash: Mapped[str | None] = mapped_column(String(64))
    division: Mapped[str] = mapped_column(String(80), default="Produksi", server_default="Produksi")
    pic_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profiles.id", ondelete="SET NULL"))
    planned_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    planned_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    drawing_required: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    material_required: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    released_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profiles.id", ondelete="SET NULL"))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    release_note: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (CheckConstraint("planned_end IS NULL OR planned_start IS NULL OR planned_end > planned_start", name="ck_work_control_dates"),)


class WorkspaceDocument(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "workspace_documents"
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_projects.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="SET NULL"), index=True)
    attachment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspace_attachments.id", ondelete="RESTRICT"), unique=True)
    code: Mapped[str] = mapped_column(String(100))
    title: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(80))
    revision: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), default="review", server_default="review")
    filename: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(120))
    size: Mapped[int] = mapped_column(Integer)
    content: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    sha256: Mapped[str] = mapped_column(String(64))
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id"))
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profiles.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    client_approved: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    approval_evidence: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (UniqueConstraint("project_id", "code", "revision", name="uq_workspace_document_revision"),
        CheckConstraint("revision > 0", name="ck_document_revision"),
        CheckConstraint("status IN ('review','approved','rejected')", name="ck_document_status"))


class WorkspaceDocumentReceipt(Base):
    __tablename__ = "workspace_document_receipts"
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_documents.id", ondelete="CASCADE"), primary_key=True)
    profile_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorkspaceIssue(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "workspace_issues"
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_projects.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="SET NULL"), index=True)
    source_log_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspace_work_logs.id", ondelete="SET NULL"), unique=True)
    kind: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    pic_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id"))
    due_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="open", server_default="open")
    resolution: Mapped[str | None] = mapped_column(Text)
    evidence: Mapped[str | None] = mapped_column(Text)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profiles.id"))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id"))
    __table_args__ = (CheckConstraint("kind IN ('blocker','punch')", name="ck_issue_kind"),
        CheckConstraint("status IN ('open','resolved','verified')", name="ck_issue_status"))


class MaterialItem(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "material_items"
    sku: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    unit: Mapped[str] = mapped_column(String(40))


class StockBalance(Base):
    __tablename__ = "stock_balances"
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("material_items.id"), primary_key=True)
    usable: Mapped[Decimal] = mapped_column(Numeric(16, 3), default=0, server_default="0")
    reserved: Mapped[Decimal] = mapped_column(Numeric(16, 3), default=0, server_default="0")
    unusable: Mapped[Decimal] = mapped_column(Numeric(16, 3), default=0, server_default="0")
    __table_args__ = (CheckConstraint("usable >= 0 AND reserved >= 0 AND unusable >= 0 AND usable >= reserved", name="ck_stock_nonnegative"),)


class MaterialRequest(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "material_requests"
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_projects.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="SET NULL"), index=True)
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("material_items.id"), index=True)
    line_number: Mapped[int | None] = mapped_column(Integer)
    description: Mapped[str | None] = mapped_column(String(255))
    specification: Mapped[str] = mapped_column(String(500), default="", server_default="")
    creation_hash: Mapped[str | None] = mapped_column(String(64))
    quantity: Mapped[Decimal] = mapped_column(Numeric(16, 3))
    received: Mapped[Decimal] = mapped_column(Numeric(16, 3), default=0, server_default="0")
    reserved: Mapped[Decimal] = mapped_column(Numeric(16, 3), default=0, server_default="0")
    issued: Mapped[Decimal] = mapped_column(Numeric(16, 3), default=0, server_default="0")
    status: Mapped[str] = mapped_column(String(24), default="requested", server_default="requested")
    eta: Mapped[date | None] = mapped_column(Date)
    order_reference: Mapped[str | None] = mapped_column(String(150))
    notes: Mapped[str | None] = mapped_column(Text)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id"))
    __table_args__ = (CheckConstraint("quantity > 0 AND received >= 0 AND reserved >= 0 AND issued >= 0 AND reserved + issued <= quantity AND received <= quantity", name="ck_material_quantities"),
        CheckConstraint("status IN ('requested','stock','purchased','in_transit','received')", name="ck_material_status"),
        UniqueConstraint("project_id", "line_number", name="uq_material_project_line"))


class StockMovement(UUIDMixin, Base):
    __tablename__ = "stock_movements"
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("material_items.id"), index=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspace_projects.id"), index=True)
    material_request_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("material_requests.id"), index=True)
    related_move_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("stock_movements.id"))
    kind: Mapped[str] = mapped_column(String(32))
    request_hash: Mapped[str] = mapped_column(String(64))
    quantity: Mapped[Decimal] = mapped_column(Numeric(16, 3))
    reference: Mapped[str] = mapped_column(String(255))
    notes: Mapped[str] = mapped_column(Text)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


COORDINATION_MODELS = [WorkspaceMember, WorkspaceWorkControl, WorkspaceDocument, WorkspaceDocumentReceipt,
    WorkspaceIssue, MaterialItem, StockBalance, MaterialRequest, StockMovement]
