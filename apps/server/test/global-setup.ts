import pg from 'pg';
import { createDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { seedRoles } from '../src/db/seed';

/**
 * Siapkan database test yang bersih: HANYA DATABASE_URL_TEST (mis. db `rein_test`).
 * Tanpa DATABASE_URL_TEST, test integrasi dilewati (unit test tetap jalan).
 */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) return;
  if (url === process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL_TEST tidak boleh sama dengan DATABASE_URL');
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.end();

  await runMigrations(url);
  const { db, pool } = createDb(url);
  await seedRoles(db);
  await pool.end();
}
