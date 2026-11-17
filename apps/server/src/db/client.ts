import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;
let db: Db | undefined;

export function createDb(url: string): { db: Db; pool: pg.Pool } {
  const p = new pg.Pool({ connectionString: url, max: 10 });
  return { db: drizzle(p, { schema }), pool: p };
}

export function getDb(): Db {
  if (!db) {
    const created = createDb(env().DATABASE_URL);
    pool = created.pool;
    db = created.db;
  }
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}

export { schema };
