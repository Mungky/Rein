"""Seed Google Drive folder IDs into library_folders for each department.

Run from project root:
    python db/scripts/seed_library_folders.py
"""

import asyncio
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "backend"))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

from sqlalchemy import select, update
from db.session import async_session_factory
from db.models.library_folder import LibraryFolder

# Drive folder IDs extracted from shared links
# Format: department_slug -> (gdrive_folder_id, display_name)
DEPT_DRIVE_MAP = {
    "engineering": ("1kcvok7dCcDlruEw5p015ZYxmLYvf52Hz", "Teknik"),       # Process + Mechanical + Electrical
    "purchasing":  ("1FtfXmIzyoXBttONMhaPvmgehoSvNzX-k", "Pengadaan"),
    "management":  ("1u_00e7qGZycy7Dhpvb9R6hgJQiqIFl_o", "Manajemen"),    # Operational + Management + HR share folder
    "hr":          ("1u_00e7qGZycy7Dhpvb9R6hgJQiqIFl_o", "SDM"),
    "finance":     ("1JVO2En77QZ3BgTdqXa42HYsNy_wyjKtY", "Keuangan"),
    # Accounting has its own Drive folder — insert as sub-dept of finance
}

# Accounting gets its own root-level library folder (separate from finance)
ACCOUNTING_DRIVE_ID = "1W9N_sIt7zZW3CgjgM6Bbnggh23EJA8Z1"


async def main():
    async with async_session_factory() as db:
        # Update existing seeded department folders
        updated = 0
        for dept_slug, (drive_id, label) in DEPT_DRIVE_MAP.items():
            result = await db.execute(
                select(LibraryFolder).where(
                    LibraryFolder.department == dept_slug,
                    LibraryFolder.parent_id.is_(None),
                )
            )
            folders = result.scalars().all()
            for folder in folders:
                folder.gdrive_folder_id = drive_id
                print(f"  Updated: {label} ({dept_slug}) -> {drive_id}")
                updated += 1

        # Check if Accounting folder already exists
        acc_result = await db.execute(
            select(LibraryFolder).where(LibraryFolder.department == "accounting")
        )
        existing_acc = acc_result.scalar_one_or_none()
        if not existing_acc:
            acc_folder = LibraryFolder(
                department="accounting",
                name="Akuntansi",
                folder_type="department",
                path="Akuntansi",
                gdrive_folder_id=ACCOUNTING_DRIVE_ID,
                is_active=True,
            )
            db.add(acc_folder)
            print(f"  Created: Akuntansi (accounting) -> {ACCOUNTING_DRIVE_ID}")
        else:
            existing_acc.gdrive_folder_id = ACCOUNTING_DRIVE_ID
            print(f"  Updated: Akuntansi (accounting) -> {ACCOUNTING_DRIVE_ID}")

        await db.commit()
        print(f"\nDone. {updated} departments updated, 1 accounting folder set.")


if __name__ == "__main__":
    asyncio.run(main())
