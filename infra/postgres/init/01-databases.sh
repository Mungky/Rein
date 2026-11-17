#!/bin/sh
# Dijalankan sekali saat volume postgres pertama kali dibuat.
# Membuat database + role `openwa`, dan `rein_test` hanya jika CREATE_TEST_DB=true (dev).
set -eu

psql -v ON_ERROR_STOP=1 --set=openwa_password="$OPENWA_DB_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'SQL'
  CREATE ROLE openwa LOGIN PASSWORD :'openwa_password';
  CREATE DATABASE openwa OWNER openwa;
SQL

if [ "${CREATE_TEST_DB:-false}" = "true" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -c "CREATE DATABASE rein_test OWNER \"$POSTGRES_USER\";"
fi
