#!/bin/sh
set -e

echo "==> Running Prisma migrations..."
npx prisma migrate deploy

if [ "${SKIP_DB_SEED}" = "true" ]; then
  echo "==> Skipping database seed (SKIP_DB_SEED=true)"
else
  echo "==> Seeding database..."
  npx prisma db seed
fi

echo "==> Starting API..."
exec node dist/src/main.js
