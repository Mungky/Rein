/** CLI: `pnpm db:migrate` — jalankan migrasi Drizzle ke DATABASE_URL. */
import { runMigrations } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL wajib diisi');
await runMigrations(url);
console.log('Migrasi selesai.');
