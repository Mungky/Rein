"""Invariants of the permission matrix definitions.

`db/models/role_permission.py` is the single source of truth for permission
keys. These tests make it impossible to add a permission halfway — every key
must have a label, defaults must reference real keys, and the key format
stays machine-parseable.
"""

import re

from db.models.profile import AppRole
from db.models.role_permission import (
    ALL_PERMISSIONS,
    DEFAULT_ROLE_PERMISSIONS,
    PERMISSION_LABELS,
)

KEY_FORMAT = re.compile(r"^[a-z_]+:[a-z_]+$")


def test_no_duplicate_permissions():
    assert len(ALL_PERMISSIONS) == len(set(ALL_PERMISSIONS))


def test_permission_key_format():
    for perm in ALL_PERMISSIONS:
        assert KEY_FORMAT.match(perm), (
            f"Permission '{perm}' harus berformat 'modul:aksi' (huruf kecil + underscore)"
        )


def test_every_permission_has_label():
    missing = set(ALL_PERMISSIONS) - set(PERMISSION_LABELS)
    assert not missing, f"Permission tanpa label Indonesia: {sorted(missing)}"


def test_no_orphan_labels():
    orphans = set(PERMISSION_LABELS) - set(ALL_PERMISSIONS)
    assert not orphans, f"Label untuk permission yang tidak ada: {sorted(orphans)}"


def test_defaults_reference_real_permissions():
    for role, perms in DEFAULT_ROLE_PERMISSIONS.items():
        unknown = set(perms) - set(ALL_PERMISSIONS)
        assert not unknown, f"Default role {role} memakai permission tak dikenal: {sorted(unknown)}"


def test_defaults_have_no_duplicates():
    for role, perms in DEFAULT_ROLE_PERMISSIONS.items():
        assert len(perms) == len(set(perms)), f"Default role {role} punya duplikat"


def test_admin_default_is_everything():
    assert set(DEFAULT_ROLE_PERMISSIONS[AppRole.admin]) == set(ALL_PERMISSIONS)
