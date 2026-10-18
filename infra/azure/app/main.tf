data "azurerm_resource_group" "app" { name = var.resource_group_name }
data "azurerm_client_config" "current" {}

locals {
  suffix   = substr(sha256("${var.subscription_id}/${var.project_name}"), 0, 12)
  tags     = { project = var.project_name, managed_by = "terraform" }
  deployed = var.application_image != ""
  app_url  = "https://${var.project_name}-prod.${azurerm_container_app_environment.app.default_domain}"
}

resource "azurerm_user_assigned_identity" "app" {
  name                = "${var.project_name}-runtime"
  resource_group_name = data.azurerm_resource_group.app.name
  location            = data.azurerm_resource_group.app.location
  tags                = local.tags
}

# No dedicated workload profiles, VNet, NAT gateway or Log Analytics workspace.
resource "azurerm_container_app_environment" "app" {
  name                = "${var.project_name}-env"
  resource_group_name = data.azurerm_resource_group.app.name
  location            = data.azurerm_resource_group.app.location
  tags                = local.tags
}

resource "azurerm_container_registry" "app" {
  count               = var.enable_registry ? 1 : 0
  name                = "nbacr${local.suffix}"
  resource_group_name = data.azurerm_resource_group.app.name
  location            = data.azurerm_resource_group.app.location
  sku                 = "Standard"
  admin_enabled       = false
  tags                = local.tags
}

resource "azurerm_role_assignment" "image_pull" {
  count                = var.enable_registry ? 1 : 0
  scope                = azurerm_container_registry.app[0].id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

resource "azurerm_mssql_server" "app" {
  name                          = "nb-sql-${local.suffix}"
  resource_group_name           = data.azurerm_resource_group.app.name
  location                      = data.azurerm_resource_group.app.location
  version                       = "12.0"
  minimum_tls_version           = "1.2"
  public_network_access_enabled = true
  azuread_administrator {
    login_username              = var.sql_admin_name
    object_id                   = var.sql_admin_object_id
    tenant_id                   = data.azurerm_client_config.current.tenant_id
    azuread_authentication_only = true
  }
  tags = local.tags
}

# The AzureRM database resource does not expose free-offer flags. AzAPI does.
# Never fall back silently to a paid database if free-offer creation is rejected.
resource "azapi_resource" "database" {
  type      = "Microsoft.Sql/servers/databases@2023-08-01-preview"
  name      = "nourish"
  parent_id = azurerm_mssql_server.app.id
  location  = data.azurerm_resource_group.app.location
  tags      = local.tags
  body = {
    sku = { name = "GP_S_Gen5", tier = "GeneralPurpose", family = "Gen5", capacity = 2 }
    properties = {
      # Free-limit AutoPause databases only accept Azure's 60-minute default.
      autoPauseDelay                   = 60
      minCapacity                      = 0.5
      maxSizeBytes                     = 34359738368
      requestedBackupStorageRedundancy = "Local"
      useFreeLimit                     = true
      freeLimitExhaustionBehavior      = "AutoPause"
    }
  }
}

# First apply prepares infrastructure; CI then initializes SQL and secrets.
# The second apply uses the private SHA-tagged image.
resource "azurerm_container_app" "app" {
  name                         = "${var.project_name}-prod"
  resource_group_name          = data.azurerm_resource_group.app.name
  container_app_environment_id = azurerm_container_app_environment.app.id
  revision_mode                = "Single"
  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }
  dynamic "registry" {
    for_each = var.enable_registry ? [1] : []
    content {
      server   = azurerm_container_registry.app[0].login_server
      identity = azurerm_user_assigned_identity.app.id
    }
  }
  dynamic "secret" {
    for_each = local.deployed ? toset(["google-client-id", "google-client-secret"]) : toset([])
    content {
      name                = secret.value
      key_vault_secret_id = "${azurerm_key_vault.app.vault_uri}secrets/${secret.value}"
      identity            = azurerm_user_assigned_identity.app.id
    }
  }
  template {
    min_replicas = 0
    max_replicas = 1
    container {
      name   = "nourish"
      image  = local.deployed ? var.application_image : "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
      cpu    = 0.5
      memory = "1Gi"
      dynamic "env" {
        for_each = local.deployed ? {
          NODE_ENV          = "production", PORT = "4318", API_PORT = "4319",
          DATABASE_PROVIDER = "azure-sql", DATABASE_MIGRATIONS = "off",
          SQL_AUTH          = "managed-identity", SQL_SERVER = azurerm_mssql_server.app.fully_qualified_domain_name,
          SQL_DATABASE      = azapi_resource.database.name, AZURE_CLIENT_ID = azurerm_user_assigned_identity.app.client_id,
          APP_URL           = local.app_url, ADMIN_EMAIL = var.admin_email, LOCAL_DEV_AUTH = "false"
        } : {}
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.deployed ? { GOOGLE_CLIENT_ID = "google-client-id", GOOGLE_CLIENT_SECRET = "google-client-secret" } : {}
        content {
          name        = env.key
          secret_name = env.value
        }
      }
      dynamic "startup_probe" {
        for_each = local.deployed ? [1] : []
        content {
          transport               = "HTTP"
          port                    = 4318
          path                    = "/api/health"
          interval_seconds        = 10
          failure_count_threshold = 30
        }
      }
      dynamic "readiness_probe" {
        for_each = local.deployed ? [1] : []
        content {
          transport        = "HTTP"
          port             = 4318
          path             = "/api/health"
          interval_seconds = 10
        }
      }
    }
    http_scale_rule {
      name                = "http"
      concurrent_requests = "20"
    }
  }
  ingress {
    external_enabled           = true
    allow_insecure_connections = false
    target_port                = local.deployed ? 4318 : 80
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
  tags       = local.tags
  depends_on = [azurerm_role_assignment.image_pull, azurerm_role_assignment.secret_read]
}

resource "azurerm_consumption_budget_resource_group" "app" {
  name              = "${var.project_name}-monthly"
  resource_group_id = data.azurerm_resource_group.app.id
  amount            = var.budget_amount
  time_grain        = "Monthly"
  time_period { start_date = var.budget_start_date }
  notification {
    enabled        = true
    threshold      = 50
    operator       = "GreaterThanOrEqualTo"
    contact_emails = [var.budget_email]
  }
  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThanOrEqualTo"
    contact_emails = [var.budget_email]
  }
}

output "application_url" { value = local.app_url }
output "application_name" { value = azurerm_container_app.app.name }
output "sql_server" { value = azurerm_mssql_server.app.fully_qualified_domain_name }
output "database_name" { value = azapi_resource.database.name }
output "runtime_principal_id" { value = azurerm_user_assigned_identity.app.principal_id }
output "runtime_client_id" { value = azurerm_user_assigned_identity.app.client_id }
output "registry_name" { value = var.enable_registry ? azurerm_container_registry.app[0].name : null }

resource "azurerm_role_assignment" "image_push" {
  count                = var.enable_registry ? 1 : 0
  scope                = azurerm_container_registry.app[0].id
  role_definition_name = "AcrPush"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_key_vault" "app" {
  name                       = "nbkv${local.suffix}"
  resource_group_name        = data.azurerm_resource_group.app.name
  location                   = data.azurerm_resource_group.app.location
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  soft_delete_retention_days = 7
  tags                       = local.tags
}

resource "azurerm_role_assignment" "secret_write" {
  scope                = azurerm_key_vault.app.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_role_assignment" "secret_read" {
  scope                = azurerm_key_vault.app.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# Consumption replicas have dynamic outbound IPs. Entra-only authentication
# remains mandatory: this network rule alone never grants database access.
resource "azurerm_mssql_firewall_rule" "azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_mssql_server.app.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

output "registry_server" { value = var.enable_registry ? azurerm_container_registry.app[0].login_server : null }
output "vault_name" { value = azurerm_key_vault.app.name }
output "sql_server_name" { value = azurerm_mssql_server.app.name }
