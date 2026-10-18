locals {
  domain_names = {
    apex = { hostname = var.custom_domain, validation = "HTTP" }
    www  = { hostname = "www.${var.custom_domain}", validation = "CNAME" }
  }
}

# Register hostnames first: Azure requires these before issuing managed certificates.
resource "azurerm_container_app_custom_domain" "app" {
  for_each         = var.custom_domain_ready ? local.domain_names : {}
  name             = each.value.hostname
  container_app_id = azurerm_container_app.app.id

  lifecycle {
    # The explicit AzAPI binding below owns these fields for managed certificates.
    ignore_changes = [certificate_binding_type, container_app_environment_certificate_id]
  }
}

resource "azurerm_container_app_environment_managed_certificate" "app" {
  for_each                     = var.custom_domain_ready ? local.domain_names : {}
  name                         = "${var.project_name}-${each.key}"
  container_app_environment_id = azurerm_container_app_environment.app.id
  subject_name                 = each.value.hostname
  domain_control_validation    = each.value.validation
  tags                         = local.tags

  depends_on = [azurerm_container_app_custom_domain.app]
}

# Certificate issuance and binding are separate ARM operations. Both belong to IaC.
resource "azapi_update_resource" "domain_tls" {
  count       = var.custom_domain_ready ? 1 : 0
  type        = "Microsoft.App/containerApps@2025-07-01"
  resource_id = azurerm_container_app.app.id
  body = {
    properties = {
      configuration = {
        ingress = {
          customDomains = [for key, domain in local.domain_names : {
            name          = domain.hostname
            bindingType   = "SniEnabled"
            certificateId = azurerm_container_app_environment_managed_certificate.app[key].id
          }]
        }
      }
    }
  }
}

# Azure will not delete an attached certificate. Detach first on Terraform destroy.
resource "azapi_resource_action" "detach_domain_tls" {
  count       = var.custom_domain_ready ? 1 : 0
  type        = "Microsoft.App/containerApps@2025-07-01"
  resource_id = azurerm_container_app.app.id
  method      = "PATCH"
  when        = "destroy"
  body = {
    properties = {
      configuration = {
        ingress = {
          customDomains = [for domain in local.domain_names : {
            name          = domain.hostname
            bindingType   = "Disabled"
            certificateId = null
          }]
        }
      }
    }
  }
  depends_on = [azapi_update_resource.domain_tls]
}

output "azure_application_url" {
  value = local.azure_url
}

output "custom_domain_dns_records" {
  description = "Copy these records into GoDaddy DNS; leave nameservers and mail records unchanged."
  value = [
    { type = "A", name = "@", value = azurerm_container_app_environment.app.static_ip_address },
    # This verification value is intentionally published in public DNS, not a credential.
    { type = "TXT", name = "asuid", value = nonsensitive(azurerm_container_app.app.custom_domain_verification_id) },
    { type = "CNAME", name = "www", value = trimprefix(local.azure_url, "https://") },
    { type = "TXT", name = "asuid.www", value = nonsensitive(azurerm_container_app.app.custom_domain_verification_id) }
  ]
}

output "custom_domain_google_callback" {
  value = "https://${var.custom_domain}/api/auth/google/callback"
}
