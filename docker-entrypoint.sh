#!/bin/sh
set -e

mkdir -p /data/uploads

# Apply pending migrations against the mounted SQLite db
node ./node_modules/prisma/build/index.js migrate deploy

exec node server.js
