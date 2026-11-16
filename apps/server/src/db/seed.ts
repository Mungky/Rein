/**
 * Seed idempoten: role bawaan + izin default (PRD §2.4) dan 1 Admin dari env.
 * Izin role yang sudah ada TIDAK ditimpa (Admin mungkin sudah mengubahnya).
 */
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_META,
  WO_TYPE_SEED,
  emailSchema,
  usernameSchema,
} from '@rein/shared';
import { hashSecret } from '../auth/password';
import type { Db } from './client';

import { rolePermissions, roles, userContacts, users, woTypes } from './schema';

/** Jenis WO bawaan (PRD §4.2, frame D/10c). Jenis yang sudah ada tidak diubah. */
export async function seedWoTypes(db: Db): Promise<number> {
  const rows = WO_TYPE_SEED.map((t, i) => ({
    name: t.name,
    code: t.code,
    category: t.category,
    isPunchList: Boolean(t.isPunchList),
    sortOrder: (i + 1) * 10,
  }));
  const inserted = await db
    .insert(woTypes)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: woTypes.id });
  return inserted.length;
}

export async function seedRoles(db: Db): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const key of SYSTEM_ROLES) {
    const meta = SYSTEM_ROLE_META[key];
    const existing = await db.query.roles.findFirst({ where: eq(roles.systemKey, key) });
    if (existing) {
      ids.set(key, existing.id);
      continue;
    }
    const [created] = await db
      .insert(roles)
      .values({ name: meta.name, divisionLabel: meta.division, isSystem: true, systemKey: key })
      .returning({ id: roles.id });
    if (!created) throw new Error(`Gagal membuat role ${key}`);
    ids.set(key, created.id);
    const perms = Object.entries(DEFAULT_ROLE_PERMISSIONS[key]).map(([permissionKey, scope]) => ({
      roleId: created.id,
      permissionKey,
      scope,
    }));
    if (perms.length) await db.insert(rolePermissions).values(perms).onConflictDoNothing();
  }
  return ids;
}

export interface SeedAdminInput {
  name: string;
  username: string;
  email: string;
  password: string;
  pepper: string;
}

/** Membuat Admin aktif dengan email terverifikasi, jika belum ada user dengan email itu. */
export async function seedAdmin(
  db: Db,
  adminRoleId: string,
  input: SeedAdminInput,
): Promise<'created' | 'exists'> {
  const email = emailSchema.parse(input.email);
  const username = usernameSchema.parse(input.username);
  const existing = await db.query.userContacts.findFirst({
    where: and(eq(userContacts.kind, 'email'), eq(userContacts.value, email)),
  });
  if (existing) return 'exists';
  if (input.password.length < 10) throw new Error('SEED_ADMIN_PASSWORD minimal 10 karakter');

  const passwordHash = await hashSecret(input.password, input.pepper);
  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        username,
        fullName: input.name,
        roleId: adminRoleId,
        status: 'active',
        passwordHash,
        passwordChangedAt: new Date(),
      })
      .returning({ id: users.id });
    if (!user) throw new Error('Gagal membuat Admin');
    await tx.insert(userContacts).values({
      userId: user.id,
      kind: 'email',
      value: email,
      verifiedAt: new Date(),
      isPrimary: true,
    });
  });
  return 'created';
}
