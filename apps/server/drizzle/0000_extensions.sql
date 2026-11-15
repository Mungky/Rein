-- Ekstensi yang dibutuhkan schema (citext untuk username, pg_trgm untuk pencarian M1).
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
