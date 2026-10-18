#!/usr/bin/env bash
set -euo pipefail
# Run from infra/azure/app. No secret values enter Terraform variables/state.
retry() {
  local attempt
  for attempt in {1..12}; do
    if "$@"; then return 0; fi
    if [[ "$attempt" == 12 ]]; then return 1; fi
    sleep 10
  done
}
registry=$(terraform output -raw registry_name)
registry_server=$(terraform output -raw registry_server)
vault=$(terraform output -raw vault_name)
server=$(terraform output -raw sql_server_name)
export SQL_SERVER=$(terraform output -raw sql_server)
export SQL_DATABASE=$(terraform output -raw database_name)
export SQL_RUNTIME_PRINCIPAL_ID=$(terraform output -raw runtime_principal_id)
export DATABASE_PROVIDER=azure-sql SQL_AUTH=azure-cli DATABASE_MIGRATIONS=on
# Cache the SQL token while GitHub's newly issued federation assertion is fresh.
# AzureCliCredential uses this cached token after the image build completes.
az account get-access-token --resource https://database.windows.net --output none
[[ -n "$registry" && "$registry" != null ]] || { echo '::error::Application deployment requires the private registry.'; exit 1; }
for name in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  [[ -n "${!name:-}" ]] || { echo "::error::Missing GitHub secret $name"; exit 1; }
done
secret_dir=$(mktemp -d)
firewall="github-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
cleanup() {
  rm -rf "$secret_dir"
  if ! az sql server firewall-rule delete --resource-group "$TF_VAR_resource_group_name" --server "$server" --name "$firewall" --output none >/dev/null 2>&1; then
    echo "::warning::Could not remove temporary SQL firewall rule $firewall; inspect the SQL server firewall."
  fi
}
trap cleanup EXIT
chmod 700 "$secret_dir"
printf '%s' "$GOOGLE_CLIENT_ID" > "$secret_dir/client-id"
printf '%s' "$GOOGLE_CLIENT_SECRET" > "$secret_dir/client-secret"
retry az keyvault secret set --vault-name "$vault" --name google-client-id --file "$secret_dir/client-id" --output none
retry az keyvault secret set --vault-name "$vault" --name google-client-secret --file "$secret_dir/client-secret" --output none
retry az acr login --name "$registry" --output none
image="$registry_server/nourish-board:$GITHUB_SHA"
docker build -t "$image" ../../..
docker push "$image"
# Hosted runners use changing addresses; this rule exists only during migration.
runner_ip=$(curl --fail --silent --show-error --retry 3 https://api.ipify.org)
[[ "$runner_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo 'Invalid runner IPv4 address'; exit 1; }
az sql server firewall-rule create --resource-group "$TF_VAR_resource_group_name" --server "$server" --name "$firewall" --start-ip-address "$runner_ip" --end-ip-address "$runner_ip" --output none
(
  cd ../../..
  npm ci
  npm run build -w @nourish/api
  node scripts/migrate-database.mjs
)
export TF_VAR_application_image="$image"
terraform plan -lock-timeout=5m -out=application.tfplan
terraform apply -lock-timeout=5m application.tfplan
url=$(terraform output -raw application_url)
printf 'Application deployed: %s\n' "$url" >> "$GITHUB_STEP_SUMMARY"
printf 'Google OAuth redirect URI: `%s/api/auth/google/callback`\n' "$url" >> "$GITHUB_STEP_SUMMARY"
