terraform {
  required_version = "~> 1.16.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.10.0"
    }
  }
}

provider "azurerm" {
  subscription_id                 = var.subscription_id
  storage_use_azuread             = true
  resource_provider_registrations = "none"
  features {}
}
