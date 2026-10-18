terraform {
  required_version = "~> 1.16.0"
  backend "azurerm" {
    container_name   = "tfstate"
    key              = "nourish-board/app.tfstate"
    use_azuread_auth = true
  }
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.10.0"
    }
    azapi = {
      source  = "Azure/azapi"
      version = "~> 2.13.0"
    }
  }
}

provider "azurerm" {
  subscription_id                 = var.subscription_id
  resource_provider_registrations = "none"
  features {}
}
provider "azapi" {
  subscription_id = var.subscription_id
}
