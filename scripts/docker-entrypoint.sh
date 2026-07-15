#!/bin/sh
set -eu

data_dir="${DATA_DIR:-/data}"
pepper_file="$data_dir/.session-pepper"

mkdir -p "$data_dir/blobs"

# Generate the server-side authentication pepper once and keep it with the
# persistent encrypted blob data. An explicitly configured value takes
# precedence, which is useful when restoring or running behind an orchestrator.
if [ -z "${SESSION_PEPPER:-}" ]; then
  if [ ! -s "$pepper_file" ]; then
    umask 077
    node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))" > "$pepper_file.tmp"
    mv "$pepper_file.tmp" "$pepper_file"
  fi
  SESSION_PEPPER="$(cat "$pepper_file")"
  export SESSION_PEPPER
fi

echo "Applying database migrations..."
node apps/api/node_modules/prisma/build/index.js migrate deploy --schema apps/api/prisma/schema.prisma

exec "$@"
