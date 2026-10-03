#!/usr/bin/env bash
# Runs the automated tests. Most of them use a local Supabase stack with
# stand-in AI services.
#
#   tests/run-local.sh          everything below, in this order
#   tests/run-local.sh unit     unit tests and server function checks (no Docker needed)
#   tests/run-local.sh api      server tests
#   tests/run-local.sh deploy   the deploy script, against the local stack
#   tests/run-local.sh e2e      browser tests
#   tests/run-local.sh android  the Android app's own tests and checks (not part of
#                               "everything"; needs JDK 21 and the Android SDK)
#
# Needs Docker, the Supabase CLI, Node.js 20.19+ and psql; Deno 2 for the server
# function checks. The local database is reset first, so never point this at a
# project with real data.
set -euo pipefail

TOOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$TOOL_DIR"
WHAT="${1:-all}"
case "$WHAT" in
  all | unit | api | deploy | e2e | android) ;;
  *) echo "Use: tests/run-local.sh [all | unit | api | deploy | e2e | android]"; exit 2 ;;
esac

if [ "$WHAT" = "android" ]; then
  echo "Building the app pages for Android..."
  (cd web && npm run build:app >/dev/null && npx cap sync android >/dev/null)
  echo "Running the Android tests and checks..."
  (cd android && ./gradlew --no-daemon --console=plain :app:testReleaseUnitTest :app:lintRelease)
  exit 0
fi
LOG_DIR="${TMPDIR:-/tmp}/clinical-scribe-tests"
mkdir -p "$LOG_DIR"
STARTED=()

cleanup() {
  for pid in "${STARTED[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

wants() { [ "$WHAT" = "all" ] || [ "$WHAT" = "$1" ]; }

(cd tests && { [ -d node_modules ] || npm install --no-audit --no-fund; })

if wants unit; then
  echo "Running the unit tests..."
  (cd tests && node --test unit/*.test.mjs)
  if command -v deno >/dev/null 2>&1; then
    echo "Checking the server functions..."
    deno check supabase/functions/worker/index.ts supabase/functions/templates-ai/index.ts supabase/functions/admin/index.ts supabase/functions/connect/index.ts
    deno lint supabase/functions tests/functions
    deno test --allow-read=tests/functions/fixtures tests/functions/
  else
    echo "Deno is not installed, so the server function checks were skipped."
  fi
fi
[ "$WHAT" = "unit" ] && exit 0

echo "Checking the local Supabase stack..."
supabase status >/dev/null 2>&1 || supabase start

reset_stack() {
  (cd "$TOOL_DIR" && supabase db reset --local >/dev/null)
  curl -fs -X POST http://127.0.0.1:54399/__reset >/dev/null
}

# Local function settings: send AI calls to the stand-in services, and tell the
# connect function the addresses and public key the apps use on this computer.
PUBLISHABLE_KEY="$(supabase status -o json 2>/dev/null | node -e '
  let text = "";
  process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
    const stack = JSON.parse(text.slice(text.indexOf("{")));
    process.stdout.write(stack.PUBLISHABLE_KEY ?? stack.ANON_KEY ?? "");
  });')"
cat > supabase/functions/.env <<ENV
CS_TEST_GEMINI_BASE_URL=http://host.docker.internal:54399
CS_TEST_ELEVENLABS_BASE_URL=http://host.docker.internal:54399
CS_TEST_DEEPSEEK_BASE_URL=http://host.docker.internal:54399
CS_TEST_SUPABASE_API_BASE_URL=http://host.docker.internal:54399
CS_PROJECT_REF=abcdefghijklmnopqrst
CS_PUBLIC_URL=http://127.0.0.1:54321
CS_SITE_URL=http://127.0.0.1:4173/
CS_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}
ENV

echo "Starting the stand-in AI services..."
pkill -f "^node tests/mock-ai/server.mjs" 2>/dev/null || true
node tests/mock-ai/server.mjs 54399 >"$LOG_DIR/mock-ai.log" 2>&1 &
STARTED+=("$!")
for _ in $(seq 1 20); do
  curl -fs http://127.0.0.1:54399/__log >/dev/null 2>&1 && break
  sleep 0.5
done

echo "Resetting the local database..."
reset_stack

echo "Starting the functions server..."
pkill -f "^supabase functions serve" 2>/dev/null || true
supabase functions serve --env-file supabase/functions/.env >"$LOG_DIR/functions.log" 2>&1 &
STARTED+=("$!")
# The first start can take a while, as the functions' packages are downloaded.
for _ in $(seq 1 120); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:54321/functions/v1/worker || true)"
  [ "$code" = "401" ] && break
  sleep 1
done

cd tests
FIRST=1
fresh() {
  # Each group after the first starts from a clean database.
  [ "$FIRST" = 1 ] || reset_stack
  FIRST=0
}

if wants api; then
  fresh
  echo "Running the server tests..."
  node --test --test-concurrency=1 api/*.test.mjs
fi

if wants deploy; then
  fresh
  echo "Running the deploy tests..."
  node --test --test-concurrency=1 deploy/*.test.mjs
fi

if wants e2e; then
  fresh
  # The browser tests build the web app for the local stack. Settings made by
  # hand are kept; a fresh copy gets them from the stack.
  if [ ! -f "$TOOL_DIR/web/.env.local" ]; then
    supabase status -o json 2>/dev/null | node -e '
      let text = "";
      process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
        const stack = JSON.parse(text.slice(text.indexOf("{")));
        process.stdout.write(`VITE_SUPABASE_URL=${stack.API_URL}\nVITE_SUPABASE_PUBLISHABLE_KEY=${stack.PUBLISHABLE_KEY ?? stack.ANON_KEY}\n`);
      });' > "$TOOL_DIR/web/.env.local"
  fi
  # Always test the current code, never an older preview that is still running.
  pkill -f "vite preview$" 2>/dev/null || true
  echo "Running the browser tests..."
  npx playwright test --config e2e/playwright.config.mjs
fi
