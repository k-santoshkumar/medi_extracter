#!/usr/bin/env bash
set -euo pipefail

# Create Azure resource group + PostgreSQL Flexible Server + database.
# This script is idempotent: it creates only if missing, and updates existing resources.
#
# Required environment variables:
#   SUBSCRIPTION_ID
#   ADMIN_PASSWORD
#
# Optional environment variables:
#   RESOURCE_GROUP=rg-medextract-prod
#   LOCATION=eastus
#   SERVER_NAME=medextract-pg
#   DB_NAME=medextract
#   ADMIN_USER=medextractadmin
#   KV_NAME=medextract-kv
#   ENV_FILE=.env

SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-medextract-prod}"
LOCATION="${LOCATION:-eastus}"
SERVER_NAME="${SERVER_NAME:-medextract-pg}"
DB_NAME="${DB_NAME:-medextract}"
ADMIN_USER="${ADMIN_USER:-medextractadmin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
KV_NAME="${KV_NAME:-medextract-kv}"
ENV_FILE="${ENV_FILE:-.env}"

if [[ -z "$SUBSCRIPTION_ID" ]]; then
  echo "Set SUBSCRIPTION_ID before running this script."
  exit 1
fi

if [[ -z "$ADMIN_PASSWORD" ]]; then
  echo "Set ADMIN_PASSWORD before running this script."
  exit 1
fi

az account set --subscription "$SUBSCRIPTION_ID" >/dev/null

if ! az group exists --name "$RESOURCE_GROUP" | grep -q true; then
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none
else
  echo "Resource group exists: $RESOURCE_GROUP"
fi

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
  echo "PostgreSQL server exists: $SERVER_NAME"
fi

if ! az postgres flexible-server db show --resource-group "$RESOURCE_GROUP" --server-name "$SERVER_NAME" --database-name "$DB_NAME" >/dev/null 2>&1; then
  az postgres flexible-server db create \
    --resource-group "$RESOURCE_GROUP" \
    --server-name "$SERVER_NAME" \
    --database-name "$DB_NAME" \
    --output none
else
  echo "Database exists: $DB_NAME"
fi

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

HOST="$(az postgres flexible-server show --resource-group "$RESOURCE_GROUP" --name "$SERVER_NAME" --query "fullyQualifiedDomainName" -o tsv)"
DATABASE_URL="postgresql://$ADMIN_USER:$ADMIN_PASSWORD@$HOST:5432/$DB_NAME?sslmode=require"

# Update .env if file exists, or create it
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^DATABASE_URL=' "$ENV_FILE"; then
    sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" "$ENV_FILE"
  else
    printf '\nDATABASE_URL=%s\n' "$DATABASE_URL" >> "$ENV_FILE"
  fi
else
  printf 'DATABASE_URL=%s\n' "$DATABASE_URL" > "$ENV_FILE"
fi

if ! az keyvault show --name "$KV_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az keyvault create --name "$KV_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" --output none
else
  echo "Key Vault exists: $KV_NAME"
fi

az keyvault secret set --vault-name "$KV_NAME" --name "database-url" --value "$DATABASE_URL" --output none

printf '\nPostgreSQL database setup complete.\n'
printf 'Database URL: %s\n' "$DATABASE_URL"
printf 'Resource group: %s\n' "$RESOURCE_GROUP"
printf 'Server: %s\n' "$SERVER_NAME"
printf 'Database: %s\n' "$DB_NAME"
printf 'Env file updated: %s\n' "$ENV_FILE"
