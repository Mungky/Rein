import { DEFAULT_ROLE_PERMISSIONS, type SystemRole } from '@rein/shared';
import { audit } from '../audit';
import type { Db } from './client';
import { rolePermissions, roles } from './schema';

/** Role tambahan yang disepakati; hanya ditambahkan saat db:seed, izin lama tetap utuh. */
export const ORGANIZATION_ROLES: { name: string; division: string; template: SystemRole }[] = [
  { name: 'Direktur', division: 'Direksi', template: 'manager' },
  { name: 'Engineering Manager', division: 'Engineering', template: 'manager' },
  { name: 'Finance', division: 'Finance', template: 'engineering' },
  { name: 'Accounting', division: 'Accounting', template: 'engineering' },
  { name: 'Human Resources', division: 'Human Resources', template: 'engineering' },
  { name: 'Mechanical Engineer', division: 'Engineering', template: 'engineering' },
  { name: 'Process Engineer', division: 'Engineering', template: 'engineering' },
  { name: 'Electrical Engineer', division: 'Engineering', template: 'engineering' },
  { name: 'Civil Engineer', division: 'Engineering', template: 'engineering' },
  { name: 'Purchasing Procurement', division: 'Purchasing', template: 'purchasing' },
  { name: 'Safety Man', division: 'Safety', template: 'engineering' },
  { name: 'Warehouse Manager', division: 'Warehouse', template: 'manager' },
  { name: 'Production Manager', division: 'Produksi', template: 'manager' },
];

export async function seedOrganizationRoles(db: Db): Promise<number> {
  let created = 0;
  for (const preset of ORGANIZATION_ROLES) {
    created += await db.transaction(async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({ name: preset.name, divisionLabel: preset.division })
        .onConflictDoNothing({ target: roles.name })
        .returning({ id: roles.id });
      if (!role) return 0;
      const permissions = DEFAULT_ROLE_PERMISSIONS[preset.template];
      await tx.insert(rolePermissions).values(
        Object.entries(permissions).map(([permissionKey, scope]) => ({
          roleId: role.id,
          permissionKey,
          scope,
        })),
      );
      await audit(tx, {
        action: 'role.created',
        entityType: 'role',
        entityId: role.id,
        diff: { name: preset.name, template: preset.template, source: 'db:seed', permissions },
      });
      return 1;
    });
  }
  return created;
}
