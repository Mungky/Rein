import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

/** Folder migrasi: `apps/server/drizzle` (dev) atau `<dist>/../drizzle` (build). */
export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, here.endsWith(path.join('src', 'db')) ? '../../drizzle' : '../drizzle');
}

export async function runMigrations(url: string): Promise<void> {
  const { db, pool } = createDb(url);
  try {
    await migrate(db, { migrationsFolder: migrationsFolder() });
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL wajib diisi');
  await runMigrations(url);
  console.log('Migrasi selesai.');
}
