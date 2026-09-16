#!/usr/bin/env bash
# Load data/d1/*.sql (from `npm run data`) into the D1 database named in wrangler.jsonc.
# Usage: scripts/d1-import.sh [--local]   (default: --remote; needs CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID)
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:---remote}"
[ -d data/d1 ] || { echo "data/d1 missing: run 'npm run data' first" >&2; exit 1; }
for f in data/d1/*.sql; do
  echo "== $f"
  npx wrangler d1 execute dynasty "$MODE" --yes --file "$f" > /dev/null
done
echo "done"
