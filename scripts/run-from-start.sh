#!/usr/bin/env bash
set -euo pipefail

# Run the project from the beginning:
# 1) create Azure PostgreSQL database if needed
# 2) install Python dependencies
# 3) build the frontend
# 4) run the backend locally
#
# Required env vars for Azure DB creation:
#   SUBSCRIPTION_ID
#   ADMIN_PASSWORD
# Optional env vars:
#   RESOURCE_GROUP=rg-medextract-prod
#   LOCATION=eastus
#   SERVER_NAME=medextract-pg
#   DB_NAME=medextract
#   ADMIN_USER=medextractadmin
#   KV_NAME=medextract-kv
#   OPENAI_API_KEY
#   MODEL_NAME=gpt-4o
#   PORT=8000
#   CREATE_AZURE_DB=1
#
# Example:
#   export SUBSCRIPTION_ID="df5042d0-ac3b-4f93-85ad-32aec07790c8"
#   export ADMIN_PASSWORD="StrongPassword!123"
#   export OPENAI_API_KEY="your-openai-key"
#   bash scripts/run-from-start.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-medextract-prod}"
LOCATION="${LOCATION:-eastus}"
SERVER_NAME="${SERVER_NAME:-medextract-pg}"
DB_NAME="${DB_NAME:-medextract}"
ADMIN_USER="${ADMIN_USER:-medextractadmin}"
KV_NAME="${KV_NAME:-medextract-kv}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
MODEL_NAME="${MODEL_NAME:-gpt-4o}"
PORT="${PORT:-8000}"
CREATE_AZURE_DB="${CREATE_AZURE_DB:-1}"

if [[ "$CREATE_AZURE_DB" == "1" ]]; then
  if [[ -z "$SUBSCRIPTION_ID" ]]; then
    echo "Set SUBSCRIPTION_ID before running this script."
    exit 1
  fi

  if [[ -z "$ADMIN_PASSWORD" ]]; then
    echo "Set ADMIN_PASSWORD before running this script."
    exit 1
  fi

  echo "==> Creating Azure PostgreSQL database..."
  SUBSCRIPTION_ID="$SUBSCRIPTION_ID" \
  RESOURCE_GROUP="$RESOURCE_GROUP" \
  LOCATION="$LOCATION" \
  SERVER_NAME="$SERVER_NAME" \
  DB_NAME="$DB_NAME" \
  ADMIN_USER="$ADMIN_USER" \
  ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  KV_NAME="$KV_NAME" \
  bash scripts/create-postgres-db.sh
fi

if [[ ! -f .env ]]; then
  cp .env.example .env 2>/dev/null || true
fi

if [[ -n "$OPENAI_API_KEY" ]]; then
  grep -q '^OPENAI_API_KEY=' .env 2>/dev/null || echo "OPENAI_API_KEY=${OPENAI_API_KEY}" >> .env
  sed -i.bak "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=${OPENAI_API_KEY}|" .env 2>/dev/null || true
fi

if [[ -n "$MODEL_NAME" ]]; then
  grep -q '^MODEL_NAME=' .env 2>/dev/null || echo "MODEL_NAME=${MODEL_NAME}" >> .env
  sed -i.bak "s|^MODEL_NAME=.*|MODEL_NAME=${MODEL_NAME}|" .env 2>/dev/null || true
fi

if [[ -n "$PORT" ]]; then
  grep -q '^PORT=' .env 2>/dev/null || echo "PORT=${PORT}" >> .env
  sed -i.bak "s|^PORT=.*|PORT=${PORT}|" .env 2>/dev/null || true
fi

if [[ ! -d .venv311 ]]; then
  echo "==> Creating Python 3.11 virtual environment..."
  python3.11 -m venv .venv311
fi

source .venv311/bin/activate
python -m pip install --upgrade pip >/dev/null
python -m pip install -r backend/requirements.txt >/dev/null

cd frontend
if [[ ! -d node_modules ]]; then
  echo "==> Installing frontend dependencies..."
  npm install --legacy-peer-deps
fi

echo "==> Building frontend..."
npm run build
npx cap sync android

cd "$ROOT_DIR"

printf '\n==> All setup is complete. To run the backend locally:\n'
printf 'source .venv311/bin/activate && PORT=%s uvicorn backend.main:app --host 0.0.0.0 --port %s\n' "$PORT" "$PORT"
printf '\n==> Frontend is ready in frontend/dist\n'
printf '==> Android project is synced in frontend/android\n'
