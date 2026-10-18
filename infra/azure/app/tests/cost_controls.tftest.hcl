mock_provider "azurerm" {
  mock_data "azurerm_resource_group" {
    defaults = {
      id       = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/nourish-board-prod"
      name     = "nourish-board-prod"
      location = "centralindia"
    }
  }
  mock_data "azurerm_client_config" {
    defaults = { tenant_id = "22222222-2222-2222-2222-222222222222", object_id = "11111111-1111-1111-1111-111111111111" }
  }
  mock_resource "azurerm_container_app_environment" {
    defaults = { id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/nourish-board-prod/providers/Microsoft.App/managedEnvironments/test" }
  }
  mock_resource "azurerm_user_assigned_identity" {
    defaults = { id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/nourish-board-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/runtime" }
  }
  mock_resource "azurerm_mssql_server" {
    defaults = { id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/nourish-board-prod/providers/Microsoft.Sql/servers/test" }
  }
}
mock_provider "azapi" {}

variables {
  subscription_id     = "33333333-3333-3333-3333-333333333333"
  resource_group_name = "nourish-board-prod"
  sql_admin_object_id = "11111111-1111-1111-1111-111111111111"
  budget_start_date   = "2026-10-01T00:00:00Z"
}

run "sleep_and_free_database" {
  command = plan
  assert {
    condition     = azurerm_container_app.app.template[0].min_replicas == 0 && azurerm_container_app.app.template[0].max_replicas == 1
    error_message = "The app must scale to zero and cap at one replica."
  }
  assert {
    condition     = azapi_resource.database.body.properties.useFreeLimit && azapi_resource.database.body.properties.freeLimitExhaustionBehavior == "AutoPause"
    error_message = "Database must request free limits and pause instead of billing overages."
  }
  assert {
    condition     = azapi_resource.database.body.properties.autoPauseDelay == 60
    error_message = "Free-limit AutoPause requires Azure's default 60-minute idle delay."
  }
  assert {
    condition     = length(azurerm_container_registry.app) == 1 && azurerm_container_registry.app[0].sku == "Standard" && !azurerm_container_registry.app[0].admin_enabled
    error_message = "Use the eligible Standard registry with password authentication disabled."
  }
  assert {
    condition     = azurerm_mssql_server.app.azuread_administrator[0].azuread_authentication_only
    error_message = "SQL must use Entra authentication without passwords."
  }
  assert {
    condition     = azurerm_key_vault.app.rbac_authorization_enabled && azurerm_role_assignment.secret_read.role_definition_name == "Key Vault Secrets User"
    error_message = "Runtime must read OAuth secrets through its managed identity."
  }
}

run "real_application" {
  command = plan
  variables {
    application_image = "example.azurecr.io/nourish-board:0123456789abcdef"
    revision_suffix   = "r12345-1"
  }
  assert {
    condition     = azurerm_container_app.app.ingress[0].target_port == 4318
    error_message = "Real deployment must serve the app with Key Vault references."
  }
  assert {
    condition     = azurerm_container_app.app.template[0].revision_suffix == "r12345-1"
    error_message = "Deployment must create the requested revision after database migrations."
  }
  assert {
    condition     = length([for e in azurerm_container_app.app.template[0].container[0].env : e if e.name == "DATABASE_PROVIDER" && e.value == "azure-sql"]) == 1
    error_message = "Cloud deployment must persist to Azure SQL, never ephemeral SQLite."
  }
}

run "owner_workstation_access" {
  command = plan
  variables {
    sql_owner_ipv4 = "203.0.113.10"
  }
  assert {
    condition     = length(azurerm_mssql_firewall_rule.owner) == 1 && azurerm_mssql_firewall_rule.owner[0].start_ip_address == "203.0.113.10" && azurerm_mssql_firewall_rule.owner[0].end_ip_address == "203.0.113.10"
    error_message = "Owner access must allow only the configured workstation IPv4."
  }
}
