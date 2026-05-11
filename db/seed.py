"""Seed script for REIN database — creates initial admin user and sample data.

Run from project root:  python db/seed.py
"""

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Ensure project root is on sys.path so `db` package is importable
_project_root = str(Path(__file__).resolve().parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from dotenv import load_dotenv

# Load .env from project root
load_dotenv(Path(_project_root) / ".env", override=False)

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models.approval import Approval, ApprovalAction
from db.models.client import Client
from db.models.document import DocStatus, DocType, Document
from db.models.profile import AppRole, Profile
from db.models.project import Project
from db.models.role_permission import DEFAULT_ROLE_PERMISSIONS, RolePermission
from db.session import async_session_factory

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
ADMIN_FULL_NAME = os.getenv("ADMIN_FULL_NAME", "Administrator")
SYNTHETIC_EMAIL_DOMAIN = "rein.internal"
ADMIN_EMAIL = f"{ADMIN_USERNAME}@{SYNTHETIC_EMAIL_DOMAIN}"

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Sample data
SAMPLE_DOCUMENTS = [
    {
        "doc_number": "DRW-2025-001",
        "doc_type": DocType.DRW,
        "title": "Piping Isometric Drawing - Line 12\"-PW-001",
        "description": "Isometric drawing for process water piping line 12 inch.",
        "client_name": "PT Pertamina",
        "client_code": "PERT",
        "project_name": "Refinery Expansion Phase II",
        "project_code": "REP2",
        "file_name": "DRW-2025-001.pdf",
        "file_size": 2450000,
        "mime_type": "application/pdf",
    },
    {
        "doc_number": "INV-2025-001",
        "doc_type": DocType.INV,
        "title": "Invoice for Steel Materials Supply",
        "description": "Invoice for delivery of carbon steel plates and beams.",
        "client_name": "PT Krakatau Steel",
        "client_code": "KS",
        "project_name": "Warehouse Construction",
        "project_code": "WC2025",
        "file_name": "INV-2025-001.pdf",
        "file_size": 180000,
        "mime_type": "application/pdf",
    },
    {
        "doc_number": "PO-2025-001",
        "doc_type": DocType.PO,
        "title": "Purchase Order - Valve Assembly Kit",
        "description": "Purchase order for high-pressure valve assembly kits.",
        "client_name": "PT Valvindo",
        "client_code": "VALV",
        "project_name": "Pipeline Maintenance Program",
        "project_code": "PMP",
        "file_name": "PO-2025-001.pdf",
        "file_size": 320000,
        "mime_type": "application/pdf",
    },
    {
        "doc_number": "SPEC-2025-001",
        "doc_type": DocType.SPEC,
        "title": "Technical Specification - Centrifugal Pump CP-200",
        "description": "Technical specification document for centrifugal pump model CP-200.",
        "client_name": "PT United Engineers",
        "client_code": "UE",
        "project_name": "Pump Station Upgrade",
        "project_code": "PSU",
        "file_name": "SPEC-2025-001.pdf",
        "file_size": 5100000,
        "mime_type": "application/pdf",
    },
    {
        "doc_number": "RPT-2025-001",
        "doc_type": DocType.RPT,
        "title": "Monthly Progress Report - January 2025",
        "description": "Monthly progress report covering project milestones and deliverables.",
        "client_name": "PT Pertamina",
        "client_code": "PERT",
        "project_name": "Refinery Expansion Phase II",
        "project_code": "REP2",
        "file_name": "RPT-2025-001.docx",
        "file_size": 890000,
        "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
]


SAMPLE_CLIENTS = [
    {"code": "MBP", "name": "PT Musi Bakti Persada"},
    {"code": "PLB", "name": "PT Pelindo II"},
    {"code": "RN", "name": "PT Remula Nusantara"},
    {"code": "KS", "name": "PT Krakatau Steel"},
    {"code": "SP", "name": "PT Semen Padang"},
]

SAMPLE_PROJECTS = [
    {"code": "MUSI-JBT", "name": "Jembatan Sungai Musi", "client_code": "MBP"},
    {"code": "MUSI-DRM", "name": "Dermaga Palembang", "client_code": "MBP"},
    {"code": "PLB-EXP", "name": "Pelindo Expansion", "client_code": "PLB"},
    {"code": "CLG", "name": "Proyek Cilegon", "client_code": "KS"},
    {"code": "SLAB", "name": "Proyek Slab", "client_code": "KS"},
]


async def seed_clients_and_projects(db: AsyncSession) -> dict[str, uuid.UUID]:
    """Seed clients and projects from sample data. Returns a dict of client_code -> client_id."""
    client_ids: dict[str, uuid.UUID] = {}

    # Seed clients
    for client_data in SAMPLE_CLIENTS:
        result = await db.execute(
            select(Client).where(Client.code == client_data["code"])
        )
        existing = result.scalar_one_or_none()
        if existing:
            client_ids[client_data["code"]] = existing.id
            print(f"  [seed] Client {client_data['code']} already exists, skipping.")
            continue

        client = Client(
            code=client_data["code"],
            name=client_data["name"],
        )
        db.add(client)
        await db.flush()
        await db.refresh(client)
        client_ids[client_data["code"]] = client.id
        print(f"  [seed] Client {client.code} - {client.name} created.")

    # Seed projects
    for proj_data in SAMPLE_PROJECTS:
        result = await db.execute(
            select(Project).where(Project.code == proj_data["code"])
        )
        existing = result.scalar_one_or_none()
        if existing:
            print(f"  [seed] Project {proj_data['code']} already exists, skipping.")
            continue

        client_id = client_ids.get(proj_data["client_code"])
        if not client_id:
            print(f"  [seed] Skipping project {proj_data['code']}: client {proj_data['client_code']} not found.")
            continue

        project = Project(
            code=proj_data["code"],
            name=proj_data["name"],
            client_id=client_id,
        )
        db.add(project)
        print(f"  [seed] Project {project.code} - {project.name} created.")

    await db.flush()
    return client_ids


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_supabase_user(email: str, password: str) -> dict:
    """Create a user in Supabase Auth via the Admin API.

    Returns the Supabase user dict on success, or None if the user already exists.
    Raises on unexpected errors.
    """
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "email": email,
                "password": password,
                "email_confirm": True,
            },
        )

    if response.status_code in (200, 201):
        return response.json()

    # Supabase returns 422 or 400 if user already exists
    if response.status_code in (400, 409, 422):
        print(f"  [seed] Supabase user '{email}' may already exist, fetching...")
        # Try to look up the existing user
        async with httpx.AsyncClient() as client:
            list_resp = await client.get(
                f"{SUPABASE_URL}/auth/v1/admin/users",
                headers={
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                },
                params={"email": email},
            )
        if list_resp.status_code == 200:
            users = list_resp.json().get("users", [])
            for u in users:
                if u.get("email") == email:
                    return u
        print(f"  [seed] Warning: Could not confirm existing user '{email}'")
        return None

    print(f"  [seed] Error creating Supabase user: {response.status_code} {response.text}")
    return None


async def _sync_supabase_admin_email(user_id: uuid.UUID) -> None:
    """Ensure the Supabase auth row for the admin matches the synthetic email.

    Prior versions of the seed used `admin@rein.id` as the auth email. The
    username-based login flow now relies on the synthetic `<username>@rein.internal`
    domain, so any admin user that still carries the legacy email cannot log in
    through the new form. Patch the email + password in place when needed.
    """
    async with httpx.AsyncClient(timeout=15.0) as client:
        get_resp = await client.get(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            },
        )

    if get_resp.status_code != 200:
        print(f"  [seed] Warning: could not read Supabase admin user ({get_resp.status_code}).")
        return

    current_email = get_resp.json().get("email", "")
    if current_email == ADMIN_EMAIL:
        print(f"  [seed] Supabase admin email already in sync ({ADMIN_EMAIL}).")
        return

    print(f"  [seed] Updating Supabase admin email: {current_email} -> {ADMIN_EMAIL}")
    async with httpx.AsyncClient(timeout=15.0) as client:
        put_resp = await client.put(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "email": ADMIN_EMAIL,
                "email_confirm": True,
                "password": ADMIN_PASSWORD,
            },
        )

    if put_resp.status_code in (200, 204):
        print("  [seed] Supabase admin email/password updated.")
    else:
        print(f"  [seed] Warning: Supabase admin update failed: {put_resp.status_code} {put_resp.text}")


async def seed_admin(db: AsyncSession) -> Profile | None:
    """Create the admin user in Supabase Auth and the profiles table.

    Returns the Profile object, or None on failure.
    """
    # Check if admin profile already exists
    result = await db.execute(
        select(Profile).where(Profile.role == AppRole.admin)
    )
    existing_admin = result.scalar_one_or_none()
    if existing_admin is not None:
        print(f"  [seed] Admin profile already exists (id={existing_admin.id}).")

        # Make sure the username matches the env-driven canonical username.
        if existing_admin.username != ADMIN_USERNAME:
            print(
                f"  [seed] Updating admin username: '{existing_admin.username}' -> '{ADMIN_USERNAME}'"
            )
            existing_admin.username = ADMIN_USERNAME
            await db.flush()

        # Sync the Supabase auth email so the username-based login works.
        await _sync_supabase_admin_email(existing_admin.id)
        return existing_admin

    # Create user in Supabase Auth
    print(f"  [seed] Creating Supabase auth user: {ADMIN_EMAIL}")
    supabase_user = await _create_supabase_user(ADMIN_EMAIL, ADMIN_PASSWORD)

    if supabase_user is None:
        print("  [seed] Failed to create or find Supabase admin user. Aborting admin seed.")
        return None

    user_id = uuid.UUID(supabase_user["id"])
    print(f"  [seed] Supabase user created/found: id={user_id}")

    # Create profile row
    profile = Profile(
        id=user_id,
        username=ADMIN_USERNAME,
        full_name=ADMIN_FULL_NAME,
        role=AppRole.admin,
        is_active=True,
    )
    profile.initials = profile.compute_initials()
    db.add(profile)
    await db.flush()
    await db.refresh(profile)
    print(f"  [seed] Admin profile created: id={profile.id}, username={profile.username}, name={profile.full_name}")
    return profile


async def seed_role_permissions(db: AsyncSession) -> None:
    """Insert default role permission rows (idempotent — only fills missing pairs)."""
    result = await db.execute(select(RolePermission))
    existing: set[tuple[str, str]] = {
        (rp.role.value, rp.permission) for rp in result.scalars().all()
    }

    inserted = 0
    for role, perms in DEFAULT_ROLE_PERMISSIONS.items():
        for perm in perms:
            if (role.value, perm) in existing:
                continue
            db.add(RolePermission(role=role, permission=perm))
            inserted += 1

    await db.flush()
    if inserted:
        print(f"  [seed] {inserted} role-permission rows inserted.")
    else:
        print("  [seed] Role permissions already up-to-date.")


async def seed_documents(db: AsyncSession, admin_profile: Profile) -> list[Document]:
    """Create sample documents if they don't already exist."""
    created = []
    for doc_data in SAMPLE_DOCUMENTS:
        # Check by doc_number (unique)
        result = await db.execute(
            select(Document).where(Document.doc_number == doc_data["doc_number"])
        )
        existing = result.scalar_one_or_none()
        if existing is not None:
            print(f"  [seed] Document {doc_data['doc_number']} already exists, skipping.")
            created.append(existing)
            continue

        doc = Document(
            **doc_data,
            status=DocStatus.draft,
            version=1,
            uploaded_by=admin_profile.id,
        )
        db.add(doc)
        created.append(doc)

    await db.flush()
    for doc in created:
        await db.refresh(doc)

    print(f"  [seed] {len(created)} documents ready.")
    return created


async def seed_approvals(db: AsyncSession, admin_profile: Profile, documents: list[Document]) -> None:
    """Create sample approvals (one pending, one approved) if they don't exist."""
    # Only create approvals if we have at least 2 documents
    if len(documents) < 2:
        print("  [seed] Not enough documents for sample approvals, skipping.")
        return

    # Check if any approvals already exist
    result = await db.execute(select(Approval).limit(1))
    if result.scalar_one_or_none() is not None:
        print("  [seed] Approvals already exist, skipping.")
        return

    now = datetime.now(timezone.utc)

    # Pending approval on the first document
    pending_approval = Approval(
        document_id=documents[0].id,
        requested_by=admin_profile.id,
        assigned_to=admin_profile.id,
        action=None,
        comment=None,
        acted_at=None,
    )
    db.add(pending_approval)

    # Approved approval on the second document
    approved_approval = Approval(
        document_id=documents[1].id,
        requested_by=admin_profile.id,
        assigned_to=admin_profile.id,
        action=ApprovalAction.approve,
        comment="Approved by admin",
        acted_at=now,
    )
    db.add(approved_approval)

    # Also mark the second document as approved
    documents[1].status = DocStatus.approved
    documents[1].approved_by = admin_profile.id

    await db.flush()
    print("  [seed] Created 2 sample approvals (1 pending, 1 approved).")


async def main() -> None:
    """Run the seed script."""
    print("=" * 50)
    print("REIN Database Seed Script")
    print("=" * 50)

    async with async_session_factory() as db:
        try:
            print("\n[1/4] Seeding admin user...")
            admin_profile = await seed_admin(db)
            if admin_profile is None:
                print("\n[seed] Aborting: could not create or find admin user.")
                return

            print("\n[2/5] Seeding role permissions...")
            await seed_role_permissions(db)

            print("\n[3/5] Seeding clients and projects...")
            await seed_clients_and_projects(db)

            print("\n[4/5] Seeding sample documents...")
            documents = await seed_documents(db, admin_profile)

            print("\n[5/5] Seeding sample approvals...")
            await seed_approvals(db, admin_profile, documents)

            await db.commit()
            print("\n[seed] All data committed successfully!")
        except Exception:
            await db.rollback()
            raise


if __name__ == "__main__":
    asyncio.run(main())