/**
 * Seed idempoten: role bawaan + izin default (PRD §2.4) dan 1 Admin dari env.
 * Izin role yang sudah ada TIDAK ditimpa (Admin mungkin sudah mengubahnya).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_META,
  emailSchema,
  usernameSchema,
} from '@rein/shared';
import { hashSecret } from '../auth/password';
import type { Db } from './client';
import { createDb } from './client';
import { rolePermissions, roles, userContacts, users } from './schema';

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

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const e = process.env;
  if (!e.DATABASE_URL) throw new Error('DATABASE_URL wajib diisi');
  const { db, pool } = createDb(e.DATABASE_URL);
  try {
    const roleIds = await seedRoles(db);
    console.log(`Role bawaan: ${roleIds.size}`);
    if (e.SEED_ADMIN_EMAIL && e.SEED_ADMIN_PASSWORD && e.AUTH_PEPPER) {
      const res = await seedAdmin(db, roleIds.get('admin')!, {
        name: e.SEED_ADMIN_NAME || 'Admin REIN',
        username: e.SEED_ADMIN_USERNAME || 'admin',
        email: e.SEED_ADMIN_EMAIL,
        password: e.SEED_ADMIN_PASSWORD,
        pepper: e.AUTH_PEPPER,
      });
      console.log(res === 'created' ? 'Admin dibuat.' : 'Admin sudah ada, dilewati.');
    } else {
      console.log('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / AUTH_PEPPER kosong — Admin dilewati.');
    }
  } finally {
    await pool.end();
  }
}
