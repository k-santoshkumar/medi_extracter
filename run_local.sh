#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  for candidate in python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$PYTHON_BIN" ]]; then
  echo "Error: Python 3.11 is required but not found on PATH. Install Python 3.11 and retry."
  exit 1
fi

PY_VERSION="$($PYTHON_BIN -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if [[ "$PY_VERSION" != "3.11" ]]; then
  echo "Warning: recommended runtime is Python 3.11, but found $PY_VERSION"
  echo "If the project fails, create a 3.11 venv and rerun this script."
fi

VENV_DIR="${VENV_DIR:-.venv}"
if [[ ! -d "$VENV_DIR" ]]; then
  echo "==> Creating Python virtual environment: $VENV_DIR"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1090
source "$VENV_DIR/bin/activate"

python -m pip install --upgrade pip >/dev/null
python -m pip install -r backend/requirements.txt >/dev/null

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    echo "==> Creating .env from .env.example"
    cp .env.example .env
  else
    echo "==> Creating empty .env"
    touch .env
  fi
fi

# Ensure required local runtime keys exist without overriding explicit values.
if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  if grep -q '^OPENAI_API_KEY=' .env 2>/dev/null; then
    sed -i.bak "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=${OPENAI_API_KEY}|" .env
  else
    echo "OPENAI_API_KEY=${OPENAI_API_KEY}" >> .env
  fi
fi

if [[ -n "${MODEL_NAME:-}" ]]; then
  if grep -q '^MODEL_NAME=' .env 2>/dev/null; then
    sed -i.bak "s|^MODEL_NAME=.*|MODEL_NAME=${MODEL_NAME}|" .env
  else
    echo "MODEL_NAME=${MODEL_NAME}" >> .env
  fi
fi

PORT="${PORT:-8000}"
if grep -q '^PORT=' .env 2>/dev/null; then
  sed -i.bak "s|^PORT=.*|PORT=${PORT}|" .env
else
  echo "PORT=${PORT}" >> .env
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  if grep -q '^DATABASE_URL=' .env 2>/dev/null; then
    sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" .env
  else
    echo "DATABASE_URL=${DATABASE_URL}" >> .env
  fi
fi

if [[ -n "${ALLOW_SQLITE_FALLBACK:-}" ]]; then
  if grep -q '^ALLOW_SQLITE_FALLBACK=' .env 2>/dev/null; then
    sed -i.bak "s|^ALLOW_SQLITE_FALLBACK=.*|ALLOW_SQLITE_FALLBACK=${ALLOW_SQLITE_FALLBACK}|" .env
  else
    echo "ALLOW_SQLITE_FALLBACK=${ALLOW_SQLITE_FALLBACK}" >> .env
  fi
fi

# I/O hygiene: keep backend and frontend logs in /tmp so the terminal remains clean.
BACKEND_LOG="/tmp/medextract_backend.log"
FRONTEND_LOG="/tmp/medextract_frontend.log"
rm -f "$BACKEND_LOG" "$FRONTEND_LOG"

cd "$ROOT_DIR/frontend"
if [[ ! -d node_modules ]]; then
  echo "==> Installing frontend dependencies"
  npm install --legacy-peer-deps >/dev/null
fi

if [[ ! -d dist ]]; then
  echo "==> Building frontend bundle"
  npm run build >/dev/null
fi

cd "$ROOT_DIR"

# Ensure a local SQLite fallback is explicitly allowed only for development, not in production mode.
export ALLOW_SQLITE_FALLBACK="${ALLOW_SQLITE_FALLBACK:-true}"
export PORT="${PORT:-8000}"

START_CMD=(uvicorn backend.main:app --host 0.0.0.0 --port "$PORT")
FRONTEND_CMD=(npx vite --host 0.0.0.0 --port 5173)

echo "==> Starting backend on http://localhost:${PORT}"
("${START_CMD[@]}" > "$BACKEND_LOG" 2>&1) &
BACKEND_PID=$!

sleep 2

echo "==> Starting frontend on http://localhost:5173"
("${FRONTEND_CMD[@]}" > "$FRONTEND_LOG" 2>&1) &
FRONTEND_PID=$!

cleanup() {
  echo "\n==> Shutting down local services"
  if kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
  if kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi
  exit 0
}
trap cleanup INT TERM

echo "==> Local app is running"
echo "Backend: http://localhost:${PORT}"
echo "Frontend: http://localhost:5173"
echo "Logs: ${BACKEND_LOG}, ${FRONTEND_LOG}"

# Give the app a short chance to initialize and report any startup errors.
for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    echo "Health check passed: http://localhost:${PORT}/health"
    break
  fi
  sleep 1
done

wait "$BACKEND_PID" "$FRONTEND_PID"
