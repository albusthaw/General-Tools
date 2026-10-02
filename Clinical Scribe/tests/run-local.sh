#!/usr/bin/env bash
# Runs the automated tests against a local Supabase stack with stand-in AI services.
#
#   tests/run-local.sh          server tests, then browser tests
#   tests/run-local.sh api      server tests only
#   tests/run-local.sh e2e      browser tests only
#
# Needs Docker, the Supabase CLI, Node.js 20+ and psql. The database is reset first,
# so never point this at a project with real data.
set -euo pipefail

TOOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$TOOL_DIR"
WHAT="${1:-all}"
LOG_DIR="${TMPDIR:-/tmp}/clinical-scribe-tests"
mkdir -p "$LOG_DIR"
STARTED=()

cleanup() {
  for pid in "${STARTED[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

echo "Checking the local Supabase stack..."
supabase status >/dev/null 2>&1 || supabase start

echo "Resetting the local database..."
supabase db reset --local >/dev/null

# Local function settings: send AI calls to the stand-in services.
cat > supabase/functions/.env <<'EOF'
CS_TEST_GEMINI_BASE_URL=http://host.docker.internal:54399
CS_TEST_ELEVENLABS_BASE_URL=http://host.docker.internal:54399
CS_TEST_DEEPSEEK_BASE_URL=http://host.docker.internal:54399
CS_TEST_SUPABASE_API_BASE_URL=http://host.docker.internal:54399
CS_PROJECT_REF=abcdefghijklmnopqrst
EOF

if ! curl -fs http://127.0.0.1:54399/__log >/dev/null 2>&1; then
  echo "Starting the stand-in AI services..."
  node tests/mock-ai/server.mjs 54399 >"$LOG_DIR/mock-ai.log" 2>&1 &
  STARTED+=("$!")
  sleep 1
fi
curl -fs -X POST http://127.0.0.1:54399/__reset >/dev/null

echo "Starting the functions server..."
pkill -f "^supabase functions serve" 2>/dev/null || true
supabase functions serve --env-file supabase/functions/.env >"$LOG_DIR/functions.log" 2>&1 &
STARTED+=("$!")
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:54321/functions/v1/worker || true)"
  [ "$code" = "401" ] && break
  sleep 1
done

cd tests
[ -d node_modules ] || npm install --no-audit --no-fund

if [ "$WHAT" = "all" ] || [ "$WHAT" = "api" ]; then
  echo "Running the server tests..."
  node --test --test-concurrency=1 api/*.test.mjs
fi

if [ "$WHAT" = "all" ] || [ "$WHAT" = "e2e" ]; then
  if [ "$WHAT" = "all" ]; then
    (cd "$TOOL_DIR" && supabase db reset --local >/dev/null)
    curl -fs -X POST http://127.0.0.1:54399/__reset >/dev/null
  fi
  echo "Running the browser tests..."
  npx playwright test --config e2e/playwright.config.mjs
fi
