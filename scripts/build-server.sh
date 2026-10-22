#!/usr/bin/env bash

# Build and verify the optional API server; this script never deploys it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

case "${1:-}" in
  --clean|-c)
    pnpm --filter @ai-ssh/server clean
    pnpm --filter @ai-ssh/shared clean
    pnpm --filter @ai-ssh/database clean
    ;;
  '') ;;
  *)
    echo "Usage: $0 [--clean]" >&2
    echo "Docker Compose only supplies PostgreSQL and Redis; no API image is provided." >&2
    exit 1
    ;;
esac

pnpm install --frozen-lockfile

# Database build generates both explicitly configured Prisma clients.
pnpm build:shared
pnpm build:database
pnpm --filter @ai-ssh/shared type-check
pnpm --filter @ai-ssh/database type-check
pnpm --filter @ai-ssh/server type-check
pnpm --filter @ai-ssh/server lint
pnpm --filter @ai-ssh/database test
pnpm --filter @ai-ssh/server test
pnpm build:server
pnpm --filter @ai-ssh/server build:bundle
node --check packages/server/dist-bundle/index.js

echo "Server build completed: packages/server/dist and packages/server/dist-bundle"
echo "Start the API from packages/server so it reads packages/server/.env."
