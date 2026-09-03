#!/usr/bin/env bash
set -euo pipefail

# Required env vars:
#   SUBSCRIPTION_ID
#   ADMIN_PASSWORD
#   OPENAI_API_KEY
# Optional env vars:
#   RESOURCE_GROUP=rg-medextract-prod
#   LOCATION=eastus
#   SERVER_NAME=medextract-pg
#   DB_NAME=medextract
#   ADMIN_USER=medextractadmin
#   KV_NAME=medextract-kv
#   APP_NAME=medextract-api
#   CONTAINER_REGISTRY=medextractacr
#   MODEL_NAME=gpt-4o
#   PORT=8000

SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-medextract-prod}"
LOCATION="${LOCATION:-eastus}"
SERVER_NAME="${SERVER_NAME:-medextract-pg}"
DB_NAME="${DB_NAME:-medextract}"
ADMIN_USER="${ADMIN_USER:-medextractadmin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
KV_NAME="${KV_NAME:-medextract-kv}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
MODEL_NAME="${MODEL_NAME:-gpt-4o}"
APP_NAME="${APP_NAME:-medextract-api}"
ACR_NAME="${ACR_NAME:-medextractacr}"
PORT="${PORT:-8000}"

if [[ -z "$SUBSCRIPTION_ID" ]]; then
  echo "Set SUBSCRIPTION_ID before running this script."
  exit 1
fi

if [[ -z "$ADMIN_PASSWORD" ]]; then
  echo "Set ADMIN_PASSWORD before running this script."
  exit 1
fi

if [[ -z "$OPENAI_API_KEY" ]]; then
  echo "Set OPENAI_API_KEY before running this script."
  exit 1
fi

az account set --subscription "$SUBSCRIPTION_ID" >/dev/null

# 1) Resource group
if ! az group exists --name "$RESOURCE_GROUP" | grep -q true; then
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none
else
  echo "Resource group already exists: $RESOURCE_GROUP"
fi

# 2) PostgreSQL Flexible Server
if ! az postgres flexible-server show --resource-group "$RESOURCE_GROUP" --name "$SERVER_NAME" >/dev/null 2>&1; then
  az postgres flexible-server create \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --name "$SERVER_NAME" \
    --admin-user "$ADMIN_USER" \
    --admin-password "$ADMIN_PASSWORD" \
    --sku-name Standard_B1ms \
    --tier Burstable \
    --storage-size 32 \
    --version 16 \
    --public-access 0.0.0.0 \
    --output none
else
  echo "PostgreSQL server already exists: $SERVER_NAME"
fi

if ! az postgres flexible-server db show --resource-group "$RESOURCE_GROUP" --server-name "$SERVER_NAME" --database-name "$DB_NAME" >/dev/null 2>&1; then
  az postgres flexible-server db create \
    --resource-group "$RESOURCE_GROUP" \
    --server-name "$SERVER_NAME" \
    --database-name "$DB_NAME" \
    --output none
else
  echo "Database already exists: $DB_NAME"
fi

# 3) Allow current public IP
MY_IP="$(curl -fsSL https://api.ipify.org || echo "127.0.0.1")"
RULE_NAME="AllowCurrentIP"
if ! az postgres flexible-server firewall-rule show --resource-group "$RESOURCE_GROUP" --server-name "$SERVER_NAME" --name "$RULE_NAME" >/dev/null 2>&1; then
  az postgres flexible-server firewall-rule create \
    --resource-group "$RESOURCE_GROUP" \
    --server-name "$SERVER_NAME" \
    --name "$RULE_NAME" \
    --start-ip-address "$MY_IP" \
    --end-ip-address "$MY_IP" \
    --output none
else
  az postgres flexible-server firewall-rule update \
    --resource-group "$RESOURCE_GROUP" \
    --server-name "$SERVER_NAME" \
    --name "$RULE_NAME" \
    --start-ip-address "$MY_IP" \
    --end-ip-address "$MY_IP" \
    --output none
fi

# 4) Key Vault
if ! az keyvault show --name "$KV_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az keyvault create --name "$KV_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" --output none
else
  echo "Key Vault already exists: $KV_NAME"
fi

# 5) Build DB URL
HOST="$(az postgres flexible-server show --resource-group "$RESOURCE_GROUP" --name "$SERVER_NAME" --query "fullyQualifiedDomainName" -o tsv)"
DATABASE_URL="postgresql://$ADMIN_USER:$ADMIN_PASSWORD@$HOST:5432/$DB_NAME?sslmode=require"

# 6) Store env variables in Key Vault
az keyvault secret set --vault-name "$KV_NAME" --name "database-url" --value "$DATABASE_URL" --output none
az keyvault secret set --vault-name "$KV_NAME" --name "openai-api-key" --value "$OPENAI_API_KEY" --output none
az keyvault secret set --vault-name "$KV_NAME" --name "model-name" --value "$MODEL_NAME" --output none
az keyvault secret set --vault-name "$KV_NAME" --name "port" --value "$PORT" --output none

# 7) Container Registry
if ! az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az acr create \
    --name "$ACR_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --sku Basic \
    --admin-enabled true \
    --output none
else
  echo "Container registry already exists: $ACR_NAME"
fi

# 8) Create a local env file in the project root
cat > .env <<EOF
DATABASE_URL=${DATABASE_URL}
OPENAI_API_KEY=${OPENAI_API_KEY}
MODEL_NAME=${MODEL_NAME}
PORT=${PORT}
EOF

printf '\nDeployment and configuration complete.\n'
printf 'Resource group: %s\n' "$RESOURCE_GROUP"
printf 'PostgreSQL server: %s\n' "$SERVER_NAME"
printf 'Database: %s\n' "$DB_NAME"
printf 'Key Vault: %s\n' "$KV_NAME"
printf 'Container Registry: %s\n' "$ACR_NAME"
printf '\n.env file created with the required environment values.\n'
