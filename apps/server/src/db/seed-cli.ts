/** CLI: `pnpm db:seed` — role bawaan + izin default (PRD §2.4) dan 1 Admin dari env. */
import { createDb } from './client';
import { seedAdmin, seedRoles } from './seed';

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
