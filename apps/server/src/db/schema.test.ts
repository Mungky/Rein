import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema';

/** PRD §1.3 & §4.1: tidak ada kolom uang di skema data. */
const FORBIDDEN = /(price|amount|nominal|invoice|payment)/i;

const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));

describe('lint skema', () => {
  it('menemukan tabel', () => {
    expect(tables.length).toBeGreaterThanOrEqual(9);
  });

  it.each(tables.map((t) => [getTableConfig(t).name, t] as const))(
    '%s tidak punya kolom uang',
    (_name, table) => {
      const cfg = getTableConfig(table);
      expect(FORBIDDEN.test(cfg.name)).toBe(false);
      for (const col of cfg.columns) expect(col.name).not.toMatch(FORBIDDEN);
    },
  );

  it('setiap tabel punya created_at & updated_at', () => {
    for (const t of tables) {
      const names = getTableConfig(t).columns.map((c) => c.name);
      expect(names, getTableConfig(t).name).toEqual(
        expect.arrayContaining(['created_at', 'updated_at']),
      );
    }
  });
});
