import type { UserStatus } from './enums';
import type { PermissionKey, PermissionMap, Scope } from './permissions';

/** User yang sedang dievaluasi. `permissions` dimuat server dari role_permissions. */
export interface PolicySubject {
  id: string;
  status: UserStatus;
  permissions: PermissionMap;
}

/**
 * Konteks objek yang diakses. Server mengisi relasi user ↔ project dari project_members,
 * dan pemilik objek dari kolom created_by / assignee_id / author_id.
 */
export interface PolicyResource {
  project?: { isMember: boolean; isManager: boolean };
  /** id user yang dianggap "pemilik" objek (pembuat, PIC, penulis). */
  ownerIds?: ReadonlyArray<string | null | undefined>;
}

export function scopeOf(subject: PolicySubject, permission: PermissionKey): Scope {
  return subject.permissions[permission] ?? 'none';
}

/**
 * Satu-satunya titik keputusan izin (PRD §2.2, §9.3). Selalu dipanggil di server.
 * Tanpa `resource`, hanya scope `all` yang lolos (dipakai untuk izin global seperti admin.*).
 */
export function can(
  subject: PolicySubject | null | undefined,
  permission: PermissionKey,
  resource?: PolicyResource,
): boolean {
  if (!subject || subject.status !== 'active') return false;
  const scope = scopeOf(subject, permission);
  switch (scope) {
    case 'all':
      return true;
    case 'managed':
      return resource?.project?.isManager === true;
    case 'member':
      return resource?.project?.isMember === true || resource?.project?.isManager === true;
    case 'own':
      return (resource?.ownerIds ?? []).some((id) => id != null && id === subject.id);
    case 'none':
      return false;
  }
}
