data "azurerm_resource_group" "app" { name = var.resource_group_name }
data "azurerm_client_config" "current" {}

locals {
  suffix = substr(sha256("${var.subscription_id}/${var.project_name}"), 0, 12)
  tags   = { project = var.project_name, managed_by = "terraform" }
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
      autoPauseDelay                   = 15
      minCapacity                      = 0.5
      maxSizeBytes                     = 34359738368
      requestedBackupStorageRedundancy = "Local"
      useFreeLimit                     = true
      freeLimitExhaustionBehavior      = "AutoPause"
    }
  }
}

# Placeholder only: do not run the current SQLite image on ephemeral storage.
# The real app replaces this shell after the Azure SQL adapter is implemented.
resource "azurerm_container_app" "shell" {
  name                         = "${var.project_name}-prod"
  resource_group_name          = data.azurerm_resource_group.app.name
  container_app_environment_id = azurerm_container_app_environment.app.id
  revision_mode                = "Single"
  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }
  template {
    min_replicas = 0
    max_replicas = 1
    container {
      name   = "placeholder"
      image  = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
      cpu    = 0.25
      memory = "0.5Gi"
    }
    http_scale_rule {
      name                = "http"
      concurrent_requests = "20"
    }
  }
  ingress {
    external_enabled           = true
    allow_insecure_connections = false
    target_port                = 80
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
  tags = merge(local.tags, { application_status = "placeholder-awaiting-sql-adapter" })
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

output "placeholder_url" { value = "https://${azurerm_container_app.shell.ingress[0].fqdn}" }
output "sql_server" { value = azurerm_mssql_server.app.fully_qualified_domain_name }
output "database_name" { value = azapi_resource.database.name }
output "runtime_principal_id" { value = azurerm_user_assigned_identity.app.principal_id }
output "registry_name" { value = var.enable_registry ? azurerm_container_registry.app[0].name : null }
