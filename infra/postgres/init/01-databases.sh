#!/bin/sh
# Dijalankan sekali saat volume postgres pertama kali dibuat.
# Membuat database `rein_test` (untuk test) dan database + role `openwa`.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE DATABASE rein_test OWNER "$POSTGRES_USER";
  CREATE ROLE openwa LOGIN PASSWORD '${OPENWA_DB_PASSWORD}';
  CREATE DATABASE openwa OWNER openwa;
SQL
