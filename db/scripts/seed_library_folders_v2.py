"""Seed new department folder structure (v2) into library_folders.

Replaces old slugs (engineering, purchasing, management, hr, finance, accounting)
with the 10 canonical department slugs.

Run from project root:
    python db/scripts/seed_library_folders_v2.py

Fill in the DEPT_MAP Drive IDs before running.
Drive IDs that are already known are pre-filled from the previous seed.
Mark any new folders with None — they can be linked to Drive later.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "backend"))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

from sqlalchemy import select
from db.session import async_session_factory
from db.models.library_folder import LibraryFolder, FolderType

# ── Fill in Drive folder IDs ─────────────────────────────────────────────────
# Format: dept_slug -> (gdrive_folder_id_or_None, display_name)
#
# Known IDs reused from previous seed where the folder is the same.
# Set gdrive_folder_id to None if the Drive folder doesn't exist yet —
# the system will still work (files land in TEMP until folder is linked).

DEPT_MAP: dict[str, tuple[str | None, str]] = {
    "purchasing_procurement": ("1FtfXmIzyoXBttONMhaPvmgehoSvNzX-k", "Purchasing & Procurement"),
    "engineering":            ("1kcvok7dCcDlruEw5p015ZYxmLYvf52Hz", "Engineering"),
    "management":             ("1u_00e7qGZycy7Dhpvb9R6hgJQiqIFl_o", "Management"),
    "hse":                    ("1ZWA6tuw-dXMwiKwtokGNEx1Zex__mcXp",  "HSE"),
    "field_operational":      ("1u_00e7qGZycy7Dhpvb9R6hgJQiqIFl_o",  "Field Operational"),
    "warehouse":              ("1t8InwRbHrPm9-oCRv0SDgxasuxeyEZea",   "Warehouse"),
    "finance":                ("1JVO2En77QZ3BgTdqXa42HYsNy_wyjKtY", "Finance"),
    "human_resources":        ("1u_00e7qGZycy7Dhpvb9R6hgJQiqIFl_o", "Human Resources"),
    "accounting":             ("1W9N_sIt7zZW3CgjgM6Bbnggh23EJA8Z1", "Accounting"),
    "directorate":            ("14d6eaZIi_shXlUdigaHRq4jTetMaSiCI",  "Directorate"),
}

# Old dept slugs that should be deactivated after migration
OLD_SLUGS = {"hr", "purchasing"}


async def main():
    async with async_session_factory() as db:
        print("=== Library Folders v2 Seed ===\n")

        # 1. Deactivate folders using obsolete slugs
        for old_slug in OLD_SLUGS:
            result = await db.execute(
                select(LibraryFolder).where(
                    LibraryFolder.department == old_slug,
                    LibraryFolder.parent_id.is_(None),
                )
            )
            old_folders = result.scalars().all()
            for f in old_folders:
                f.is_active = False
                print(f"  Deactivated old folder: {f.name} ({old_slug})")

        # 2. Upsert new department root folders
        created = 0
        updated = 0
        for dept_slug, (drive_id, label) in DEPT_MAP.items():
            result = await db.execute(
                select(LibraryFolder).where(
                    LibraryFolder.department == dept_slug,
                    LibraryFolder.parent_id.is_(None),
                )
            )
            existing = result.scalar_one_or_none()

            if existing:
                existing.name = label
                existing.path = label
                existing.is_active = True
                if drive_id:
                    existing.gdrive_folder_id = drive_id
                status = f"{'linked to ' + drive_id if drive_id else 'no Drive ID yet'}"
                print(f"  Updated : {label} ({dept_slug}) — {status}")
                updated += 1
            else:
                folder = LibraryFolder(
                    department=dept_slug,
                    name=label,
                    folder_type=FolderType.department,
                    path=label,
                    gdrive_folder_id=drive_id,
                    is_active=True,
                )
                db.add(folder)
                status = f"{'linked to ' + drive_id if drive_id else 'no Drive ID yet'}"
                print(f"  Created : {label} ({dept_slug}) — {status}")
                created += 1

        await db.commit()
        print(f"\nDone. {created} created, {updated} updated, {len(OLD_SLUGS)} old slugs deactivated.")
        print("\nFolders without Drive ID (marked above) need to be linked manually.")
        print("Update DEPT_MAP with the correct Drive IDs and re-run to link them.")


if __name__ == "__main__":
    asyncio.run(main())
