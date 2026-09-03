#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

REQUIRED_ENV_VARS=(
  SUBSCRIPTION_ID
  ADMIN_PASSWORD
  OPENAI_API_KEY
)

for var in "${REQUIRED_ENV_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "Error: set $var before running deploy_azure.sh"
    exit 1
  fi
done

SUBSCRIPTION_ID="${SUBSCRIPTION_ID}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-medextract-prod}"
LOCATION="${LOCATION:-westus3}"
SERVER_NAME="${SERVER_NAME:-medextract-pg}"
DB_NAME="${DB_NAME:-medextract}"
ADMIN_USER="${ADMIN_USER:-medextractadmin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD}"
KV_NAME="${KV_NAME:-medextract-kv}"
APP_NAME="${APP_NAME:-medextract-api}"
ACR_NAME="${ACR_NAME:-medextractacr}"
APP_SERVICE_PLAN="${APP_SERVICE_PLAN:-medextract-plan}"
WEBAPP_NAME="${WEBAPP_NAME:-medextract-app-$(date +%s)}"
MODEL_NAME="${MODEL_NAME:-gpt-4o}"
PORT="${PORT:-8000}"
OPENAI_API_KEY="${OPENAI_API_KEY}"

az account set --subscription "$SUBSCRIPTION_ID" >/dev/null

# 1) Resource group
if ! az group exists --name "$RESOURCE_GROUP" | grep -q true; then
  echo "==> Creating resource group $RESOURCE_GROUP"
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none
else
  echo "==> Resource group already exists: $RESOURCE_GROUP"
fi

# 2) PostgreSQL flexible server
if ! az postgres flexible-server show --resource-group "$RESOURCE_GROUP" --name "$SERVER_NAME" >/dev/null 2>&1; then
  echo "==> Creating Azure PostgreSQL Flexible Server"
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
  echo "==> PostgreSQL server already exists: $SERVER_NAME"
fi

# 3) Database
if ! az postgres flexible-server db show --resource-group "$RESOURCE_GROUP" --server-name "$SERVER_NAME" --database-name "$DB_NAME" >/dev/null 2>&1; then
  echo "==> Creating database $DB_NAME"
  az postgres flexible-server db create \
    --resource-group "$RESOURCE_GROUP" \
    --server-name "$SERVER_NAME" \
    --database-name "$DB_NAME" \
    --output none
else
  echo "==> Database already exists: $DB_NAME"
fi

# 4) Firewall rule for current machine
MY_IP="$(curl -fsSL https://api.ipify.org || echo '127.0.0.1')"
RULE_NAME="AllowCurrentIP"
if ! az postgres flexible-server firewall-rule show --resource-group "$RESOURCE_GROUP" --server-name "$SERVER_NAME" --name "$RULE_NAME" >/dev/null 2>&1; then
  echo "==> Creating firewall rule for current IP"
  az postgres flexible-server firewall-rule create \
    --resource-group "$RESOURCE_GROUP" \
    --server-name "$SERVER_NAME" \
    --name "$RULE_NAME" \
    --start-ip-address "$MY_IP" \
    --end-ip-address "$MY_IP" \
    --output none
else
  echo "==> Updating firewall rule for current IP"
  az postgres flexible-server firewall-rule update \
    --resource-group "$RESOURCE_GROUP" \
    --server-name "$SERVER_NAME" \
    --name "$RULE_NAME" \
    --start-ip-address "$MY_IP" \
    --end-ip-address "$MY_IP" \
    --output none
fi

# 5) Storage account for documents
STORAGE_ACCOUNT_NAME="${STORAGE_ACCOUNT_NAME:-medextractblob2026}"
STORAGE_CONTAINER_NAME="${STORAGE_CONTAINER_NAME:-medical-records}"
if ! az storage account show --name "$STORAGE_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "==> Creating Blob Storage account"
  az storage account create \
    --name "$STORAGE_ACCOUNT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --https-only true \
    --allow-blob-public-access false \
    --output none
else
  echo "==> Storage account already exists: $STORAGE_ACCOUNT_NAME"
fi

if ! az storage container exists --name "$STORAGE_CONTAINER_NAME" --account-name "$STORAGE_ACCOUNT_NAME" --auth-mode login >/dev/null 2>&1; then
  echo "==> Creating blob container $STORAGE_CONTAINER_NAME"
  az storage container create \
    --account-name "$STORAGE_ACCOUNT_NAME" \
    --name "$STORAGE_CONTAINER_NAME" \
    --auth-mode login \
    --public-access off \
    --output none
else
  echo "==> Blob container already exists: $STORAGE_CONTAINER_NAME"
fi

# 6) Key Vault
if ! az keyvault show --name "$KV_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "==> Creating Key Vault $KV_NAME"
  az keyvault create --name "$KV_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" --output none
else
  echo "==> Key Vault already exists: $KV_NAME"
fi

HOST="$(az postgres flexible-server show --resource-group "$RESOURCE_GROUP" --name "$SERVER_NAME" --query 'fullyQualifiedDomainName' -o tsv)"
DATABASE_URL="postgresql://${ADMIN_USER}:${ADMIN_PASSWORD}@${HOST}:5432/${DB_NAME}?sslmode=require"
STORAGE_CONNECTION_STRING="$(az storage account show-connection-string --name "$STORAGE_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" --query connectionString -o tsv)"

# 7) Save secrets in Key Vault
az keyvault secret set --vault-name "$KV_NAME" --name "database-url" --value "$DATABASE_URL" --output none
az keyvault secret set --vault-name "$KV_NAME" --name "openai-api-key" --value "$OPENAI_API_KEY" --output none
az keyvault secret set --vault-name "$KV_NAME" --name "model-name" --value "$MODEL_NAME" --output none
az keyvault secret set --vault-name "$KV_NAME" --name "port" --value "$PORT" --output none
az keyvault secret set --vault-name "$KV_NAME" --name "azure-storage-connection-string" --value "$STORAGE_CONNECTION_STRING" --output none
az keyvault secret set --vault-name "$KV_NAME" --name "azure-storage-container-name" --value "$STORAGE_CONTAINER_NAME" --output none

# 8) Write .env for local/application runtime
cat > .env <<EOF
DATABASE_URL=${DATABASE_URL}
OPENAI_API_KEY=${OPENAI_API_KEY}
MODEL_NAME=${MODEL_NAME}
PORT=${PORT}
AZURE_STORAGE_CONNECTION_STRING=${STORAGE_CONNECTION_STRING}
AZURE_STORAGE_CONTAINER_NAME=${STORAGE_CONTAINER_NAME}
ALLOW_SQLITE_FALLBACK=false
EOF

# 9) Container registry for deployment image
if ! az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "==> Creating Azure Container Registry"
  az acr create \
    --name "$ACR_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --sku Basic \
    --admin-enabled true \
    --output none
else
  echo "==> Container registry already exists: $ACR_NAME"
fi

# 10) Build and push the Docker image to ACR
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE_NAME="${ACR_NAME}.azurecr.io/medextract:${IMAGE_TAG}"

echo "==> Building Docker image"
docker build -t "medextract:${IMAGE_TAG}" .

echo "==> Logging in to ACR"
az acr login --name "$ACR_NAME"
docker tag "medextract:${IMAGE_TAG}" "$IMAGE_NAME"
docker push "$IMAGE_NAME"

# 11) Deploy to the cheapest managed Linux web host: Azure App Service
if ! az appservice plan show --name "$APP_SERVICE_PLAN" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "==> Creating Linux App Service plan"
  az appservice plan create \
    --name "$APP_SERVICE_PLAN" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --sku B1 \
    --is-linux \
    --output none
else
  echo "==> App Service plan already exists: $APP_SERVICE_PLAN"
fi

if ! az webapp show --name "$WEBAPP_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "==> Creating Azure Web App"
  az webapp create \
    --resource-group "$RESOURCE_GROUP" \
    --plan "$APP_SERVICE_PLAN" \
    --name "$WEBAPP_NAME" \
    --deployment-container-image-name "$IMAGE_NAME" \
    --output none
else
  echo "==> Azure Web App already exists: $WEBAPP_NAME"
fi

ACR_USERNAME="$(az acr credential show --name "$ACR_NAME" --query username -o tsv)"
ACR_PASSWORD="$(az acr credential show --name "$ACR_NAME" --query passwords[0].value -o tsv)"

az webapp config container set \
  --name "$WEBAPP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --docker-custom-image-name "$IMAGE_NAME" \
  --docker-registry-server-url "https://${ACR_NAME}.azurecr.io" \
  --docker-registry-server-user "$ACR_USERNAME" \
  --docker-registry-server-password "$ACR_PASSWORD" \
  --output none

az webapp config appsettings set \
  --name "$WEBAPP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    DATABASE_URL="$DATABASE_URL" \
    OPENAI_API_KEY="$OPENAI_API_KEY" \
    MODEL_NAME="$MODEL_NAME" \
    PORT="$PORT" \
    AZURE_STORAGE_CONNECTION_STRING="$STORAGE_CONNECTION_STRING" \
    AZURE_STORAGE_CONTAINER_NAME="$STORAGE_CONTAINER_NAME" \
    ALLOW_SQLITE_FALLBACK=false \
    WEBSITES_PORT=8000 \
    SCM_DO_BUILD_DURING_DEPLOYMENT=false \
    ENABLE_ORYX_BUILD=false \
    --output none

echo "==> Azure production configuration complete"
echo "Resource Group: $RESOURCE_GROUP"
echo "PostgreSQL: $SERVER_NAME / $DB_NAME"
echo "Storage: $STORAGE_ACCOUNT_NAME / $STORAGE_CONTAINER_NAME"
echo "Key Vault: $KV_NAME"
echo "Container Registry: $ACR_NAME"
echo "Database URL: $DATABASE_URL"

printf '\nDeployment summary:\n'
printf 'App URL: https://%s.azurewebsites.net\n' "$WEBAPP_NAME"
printf 'App Service plan: %s\n' "$APP_SERVICE_PLAN"
printf 'Container image: %s\n' "$IMAGE_NAME"
printf 'Health check: https://%s.azurewebsites.net/health\n' "$WEBAPP_NAME"
printf '\nTo redeploy later:\n'
printf '1) docker build -t medextract:latest .\n'
printf '2) az acr login --name %s\n' "$ACR_NAME"
printf '3) docker tag medextract:latest %s.azurecr.io/medextract:latest\n' "$ACR_NAME"
printf '4) docker push %s.azurecr.io/medextract:latest\n' "$ACR_NAME"
printf '5) az webapp config container set --name %s --resource-group %s --docker-custom-image-name %s.azurecr.io/medextract:latest --docker-registry-server-url https://%s.azurecr.io --docker-registry-server-user $(az acr credential show --name %s --query username -o tsv) --docker-registry-server-password $(az acr credential show --name %s --query passwords[0].value -o tsv)\n' "$WEBAPP_NAME" "$RESOURCE_GROUP" "$ACR_NAME" "$ACR_NAME" "$ACR_NAME" "$ACR_NAME"
