mock_provider "azurerm" {
  mock_data "azurerm_resource_group" {
    defaults = {
      id       = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/nourish-board-prod"
      name     = "nourish-board-prod"
      location = "centralindia"
    }
  }
  mock_data "azurerm_client_config" {
    defaults = { tenant_id = "22222222-2222-2222-2222-222222222222" }
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
    condition     = azurerm_container_app.shell.template[0].min_replicas == 0 && azurerm_container_app.shell.template[0].max_replicas == 1
    error_message = "The app must scale to zero and cap at one replica."
  }
  assert {
    condition     = azapi_resource.database.body.properties.useFreeLimit && azapi_resource.database.body.properties.freeLimitExhaustionBehavior == "AutoPause"
    error_message = "Database must request free limits and pause instead of billing overages."
  }
  assert {
    condition     = length(azurerm_container_registry.app) == 0
    error_message = "Do not create a recurring-cost container registry by default."
  }
  assert {
    condition     = azurerm_mssql_server.app.azuread_administrator[0].azuread_authentication_only
    error_message = "SQL must use Entra authentication without passwords."
  }
}
