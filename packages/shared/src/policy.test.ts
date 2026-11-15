import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_KEYS,
  SYSTEM_ROLES,
  type PermissionKey,
  type Scope,
  type SystemRole,
} from './permissions';
import { can, type PolicyResource, type PolicySubject } from './policy';

/**
 * Matriks PRD §2.4, ditulis ulang secara literal (bukan diimpor) agar perubahan tak sengaja
 * pada DEFAULT_ROLE_PERMISSIONS langsung gagal di test.
 * Urutan kolom: Manager, Engineering/Drafting, Produksi, Purchasing, QC, Admin.
 * ✓ tanpa scope di PRD → scope tunggal permission itu (view.scurve mengikuti scope project.view).
 */
const PRD_MATRIX: Record<PermissionKey, [Scope, Scope, Scope, Scope, Scope, Scope]> = {
  'project.view': ['all', 'member', 'member', 'member', 'member', 'all'],
  'project.create': ['all', 'none', 'none', 'none', 'none', 'none'],
  'project.edit': ['managed', 'none', 'none', 'none', 'none', 'all'],
  'project.members.manage': ['managed', 'none', 'none', 'none', 'none', 'all'],
  'project.close': ['managed', 'none', 'none', 'none', 'none', 'none'],
  'wo.create': ['member', 'member', 'member', 'member', 'member', 'none'],
  'wo.edit.any': ['managed', 'none', 'none', 'none', 'none', 'none'],
  'wo.edit.own': ['own', 'own', 'own', 'own', 'own', 'none'],
  'wo.delete': ['none', 'none', 'none', 'none', 'none', 'none'],
  'wo.weight.edit': ['managed', 'none', 'none', 'none', 'none', 'none'],
  'logbook.create': ['member', 'member', 'member', 'member', 'member', 'none'],
  'logbook.edit.own': ['own', 'own', 'own', 'own', 'own', 'none'],
  'logbook.delete.any': ['none', 'none', 'none', 'none', 'none', 'all'],
  'attachment.upload': ['member', 'member', 'member', 'member', 'member', 'none'],
  'attachment.delete.any': ['none', 'none', 'none', 'none', 'none', 'all'],
  'view.scurve': ['all', 'member', 'member', 'member', 'member', 'all'],
  'admin.users': ['none', 'none', 'none', 'none', 'none', 'all'],
  'admin.roles': ['none', 'none', 'none', 'none', 'none', 'all'],
  'admin.wo_types': ['all', 'none', 'none', 'none', 'none', 'all'],
  'admin.audit': ['none', 'none', 'none', 'none', 'none', 'all'],
};

const ME = '018f0000-0000-7000-8000-000000000001';
const OTHER = '018f0000-0000-7000-8000-000000000002';

type ContextName = 'tanpaResource' | 'bukanAnggota' | 'anggota' | 'pengelola' | 'pemilik';

/** Konteks uji: setiap scope memberi pola hasil berbeda pada kombinasi ini. */
const CONTEXTS: Record<ContextName, PolicyResource | undefined> = {
  tanpaResource: undefined,
  bukanAnggota: { project: { isMember: false, isManager: false }, ownerIds: [OTHER] },
  anggota: { project: { isMember: true, isManager: false }, ownerIds: [OTHER] },
  pengelola: { project: { isMember: true, isManager: true }, ownerIds: [OTHER] },
  pemilik: { ownerIds: [ME] },
};

const EXPECTED: Record<Scope, Record<ContextName, boolean>> = {
  all: { tanpaResource: true, bukanAnggota: true, anggota: true, pengelola: true, pemilik: true },
  managed: {
    tanpaResource: false,
    bukanAnggota: false,
    anggota: false,
    pengelola: true,
    pemilik: false,
  },
  member: {
    tanpaResource: false,
    bukanAnggota: false,
    anggota: true,
    pengelola: true,
    pemilik: false,
  },
  own: {
    tanpaResource: false,
    bukanAnggota: false,
    anggota: false,
    pengelola: false,
    pemilik: true,
  },
  none: {
    tanpaResource: false,
    bukanAnggota: false,
    anggota: false,
    pengelola: false,
    pemilik: false,
  },
};

function subjectFor(role: SystemRole): PolicySubject {
  return { id: ME, status: 'active', permissions: DEFAULT_ROLE_PERMISSIONS[role] };
}

const ROWS = PERMISSION_KEYS.flatMap((permission) =>
  SYSTEM_ROLES.map((role, i) => ({
    permission,
    role,
    scope: PRD_MATRIX[permission][i] as Scope,
  })),
);

describe('matriks izin PRD §2.4', () => {
  it('mencakup semua permission dan 6 role', () => {
    expect(Object.keys(PRD_MATRIX).sort()).toEqual([...PERMISSION_KEYS].sort());
    expect(ROWS).toHaveLength(PERMISSION_KEYS.length * 6);
  });

  it.each(ROWS)('$permission × $role = $scope', ({ permission, role, scope }) => {
    const subject = subjectFor(role);
    for (const name of Object.keys(CONTEXTS) as ContextName[]) {
      expect(can(subject, permission, CONTEXTS[name]), `${permission} ${role} ${name}`).toBe(
        EXPECTED[scope][name],
      );
    }
  });

  it('scope default hanya memakai scope yang didukung permission', () => {
    for (const role of SYSTEM_ROLES) {
      for (const [key, scope] of Object.entries(DEFAULT_ROLE_PERMISSIONS[role])) {
        const supported: readonly string[] = PERMISSIONS[key as PermissionKey].scopes;
        expect(supported, `${role}.${key}`).toContain(scope);
      }
    }
  });
});

describe('can() — aturan umum', () => {
  it('user nonaktif atau undangan ditolak walau scope all', () => {
    for (const status of ['disabled', 'invited'] as const) {
      const s: PolicySubject = { ...subjectFor('admin'), status };
      expect(can(s, 'admin.users')).toBe(false);
    }
  });

  it('subject null ditolak', () => {
    expect(can(null, 'project.view')).toBe(false);
    expect(can(undefined, 'project.view')).toBe(false);
  });

  it('permission yang tidak ada di peta = none', () => {
    const s: PolicySubject = { id: ME, status: 'active', permissions: {} };
    expect(can(s, 'project.view', CONTEXTS.pengelola)).toBe(false);
  });

  it('own mengabaikan ownerIds null/undefined', () => {
    const s = subjectFor('engineering');
    expect(can(s, 'wo.edit.own', { ownerIds: [null, undefined] })).toBe(false);
  });
});
