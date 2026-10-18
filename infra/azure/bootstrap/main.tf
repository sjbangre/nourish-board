variable "subscription_id" {
  type = string
}
variable "location" {
  type    = string
  default = "centralindia"
}
variable "project_name" {
  type    = string
  default = "nourish-board"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,23}$", var.project_name))
    error_message = "Use 3–24 lowercase letters, numbers or hyphens, starting with a letter."
  }
}
variable "github_repository" {
  type    = string
  default = "sjbangre/nourish-board"
}
variable "github_subject_prefix" {
  type        = string
  default     = "repo:sjbangre@32705567/nourish-board@1424214833"
  description = "Exact sub_claim_prefix from GitHub's repository OIDC customization API. Bootstrap fetches this automatically."
  validation {
    condition     = can(regex("^repo:[A-Za-z0-9_.-]+(@[0-9]+)?/[A-Za-z0-9_.-]+(@[0-9]+)?$", var.github_subject_prefix)) && replace(var.github_subject_prefix, "/@[0-9]+/", "") == "repo:${var.github_repository}"
    error_message = "The exact OIDC repository prefix must match github_repository; wildcards and extra subject contexts are not allowed."
  }
}

data "azurerm_client_config" "current" {}

locals {
  suffix = substr(sha256("${var.subscription_id}/${var.project_name}"), 0, 12)
  tags   = { project = var.project_name, managed_by = "terraform" }
}

resource "azurerm_resource_group" "control" {
  name     = "${var.project_name}-control"
  location = var.location
  tags     = local.tags
}

# This empty boundary survives application destroy/recreate operations.
resource "azurerm_resource_group" "app" {
  name     = "${var.project_name}-prod"
  location = var.location
  tags     = local.tags
}

resource "azurerm_storage_account" "state" {
  name                            = "nbtf${local.suffix}"
  resource_group_name             = azurerm_resource_group.control.name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  shared_access_key_enabled       = false
  allow_nested_items_to_be_public = false
  tags                            = local.tags
  blob_properties {
    versioning_enabled = true
    delete_retention_policy { days = 7 }
    container_delete_retention_policy { days = 7 }
  }
}

resource "azurerm_role_assignment" "bootstrap_state" {
  scope                = azurerm_storage_account.state.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_storage_container" "state" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.state.id
  container_access_type = "private"
  depends_on            = [azurerm_role_assignment.bootstrap_state]
}

resource "azurerm_user_assigned_identity" "github" {
  name                = "${var.project_name}-github"
  resource_group_name = azurerm_resource_group.control.name
  location            = var.location
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "github" {
  name                      = "github-main"
  user_assigned_identity_id = azurerm_user_assigned_identity.github.id
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = "${var.github_subject_prefix}:ref:refs/heads/main"
  audience                  = ["api://AzureADTokenExchange"]
}

resource "azurerm_role_assignment" "deploy" {
  scope                = azurerm_resource_group.app.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.github.principal_id
}

# Needed to create managed-identity permissions on the app's registry/vault.
# Scoped to this app resource group, never subscription Owner.
resource "azurerm_role_assignment" "deploy_rbac" {
  scope                = azurerm_resource_group.app.id
  role_definition_name = "Role Based Access Control Administrator"
  principal_id         = azurerm_user_assigned_identity.github.principal_id
}

resource "azurerm_role_assignment" "github_state" {
  scope                = azurerm_storage_container.state.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.github.principal_id
}

output "github_variables" {
  value = {
    AZURE_CLIENT_ID          = azurerm_user_assigned_identity.github.client_id
    AZURE_TENANT_ID          = data.azurerm_client_config.current.tenant_id
    AZURE_SUBSCRIPTION_ID    = var.subscription_id
    AZURE_RESOURCE_GROUP     = azurerm_resource_group.app.name
    AZURE_LOCATION           = var.location
    TF_STATE_STORAGE_ACCOUNT = azurerm_storage_account.state.name
    TF_PROJECT_NAME          = var.project_name
    TF_SQL_ADMIN_OBJECT_ID   = azurerm_user_assigned_identity.github.principal_id
  }
}
