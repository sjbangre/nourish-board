mock_provider "azurerm" {
  mock_data "azurerm_client_config" {
    defaults = {
      object_id       = "11111111-1111-1111-1111-111111111111"
      tenant_id       = "22222222-2222-2222-2222-222222222222"
      subscription_id = "33333333-3333-3333-3333-333333333333"
    }
  }
  mock_resource "azurerm_resource_group" {
    defaults = { id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/test" }
  }
  mock_resource "azurerm_storage_account" {
    defaults = { id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/test/providers/Microsoft.Storage/storageAccounts/teststate" }
  }
  mock_resource "azurerm_storage_container" {
    defaults = { id = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/test/providers/Microsoft.Storage/storageAccounts/teststate/blobServices/default/containers/tfstate" }
  }
  mock_resource "azurerm_user_assigned_identity" {
    defaults = {
      id           = "/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/test/providers/Microsoft.ManagedIdentity/userAssignedIdentities/github"
      principal_id = "44444444-4444-4444-4444-444444444444"
      client_id    = "55555555-5555-5555-5555-555555555555"
    }
  }
}

variables { subscription_id = "33333333-3333-3333-3333-333333333333" }

run "branch_trust_and_scoped_permissions" {
  command = apply
  assert {
    condition     = azurerm_federated_identity_credential.github.subject == "repo:sjbangre/nourish-board:ref:refs/heads/main"
    error_message = "Only main may obtain Azure deployment access."
  }
  assert {
    condition     = !azurerm_storage_account.state.shared_access_key_enabled && !azurerm_storage_account.state.allow_nested_items_to_be_public
    error_message = "State must use Entra authentication and private containers."
  }
  assert {
    condition     = azurerm_role_assignment.deploy.scope == azurerm_resource_group.app.id && azurerm_role_assignment.deploy.role_definition_name == "Contributor"
    error_message = "Deployment permissions must stay inside the app resource group."
  }
}
