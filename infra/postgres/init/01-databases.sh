#!/bin/sh
# Dijalankan saat volume pertama dibuat; aman dijalankan ulang untuk pemulihan OpenWA.
# Membuat database + role `openwa`, dan `rein_test` hanya jika CREATE_TEST_DB=true (dev).
set -eu
: "${OPENWA_DB_PASSWORD:?OPENWA_DB_PASSWORD wajib diisi}"

psql -v ON_ERROR_STOP=1 --set=openwa_password="$OPENWA_DB_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'SQL'
  SELECT 'CREATE ROLE openwa LOGIN'
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwa') \gexec
  ALTER ROLE openwa WITH PASSWORD :'openwa_password';
  SELECT 'CREATE DATABASE openwa OWNER openwa'
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'openwa') \gexec
SQL

if [ "${CREATE_TEST_DB:-false}" = "true" ]; then
  psql -v ON_ERROR_STOP=1 --set=db_owner="$POSTGRES_USER" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'SQL'
    SELECT format('CREATE DATABASE rein_test OWNER %I', :'db_owner')
    WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'rein_test') \gexec
SQL
fi
