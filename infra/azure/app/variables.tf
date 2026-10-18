variable "subscription_id" { type = string }
variable "resource_group_name" { type = string }
variable "project_name" {
  type    = string
  default = "nourish-board"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,23}$", var.project_name))
    error_message = "Use a lowercase 3–24 character project name."
  }
}
variable "sql_admin_object_id" {
  type        = string
  description = "Entra principal object ID of the GitHub deployment identity, which runs schema migrations."
  validation {
    condition     = can(regex("^[0-9a-fA-F-]{36}$", var.sql_admin_object_id))
    error_message = "Supply the Entra object ID of the SQL administrator."
  }
}
variable "sql_admin_name" {
  type    = string
  default = "nourish-sql-admin"
}
variable "sql_owner_ipv4" {
  type        = string
  default     = ""
  description = "Optional owner workstation public IPv4 for direct SQL access. Update when the ISP changes it."
  validation {
    condition     = var.sql_owner_ipv4 == "" || (can(regex("^([0-9]{1,3}\\.){3}[0-9]{1,3}$", var.sql_owner_ipv4)) && can(cidrhost("${var.sql_owner_ipv4}/32", 0)))
    error_message = "Supply a valid IPv4 address or leave empty to disable the owner firewall rule."
  }
}
variable "enable_registry" {
  type        = bool
  default     = true
  description = "Optional Standard ACR. Enable only after checking the subscription's 12-month free allowance and expiry."
}
variable "application_image" {
  type        = string
  default     = ""
  description = "Private ACR image including immutable Git commit tag; empty creates the initial bootstrap placeholder."
}
variable "revision_suffix" {
  type        = string
  default     = null
  description = "Deployment-specific revision suffix; preserve the current value until migrations finish."
  validation {
    condition     = var.revision_suffix == null || can(regex("^[a-z][a-z0-9-]{0,62}$", var.revision_suffix))
    error_message = "Use a lowercase revision suffix beginning with a letter, up to 63 characters."
  }
}
variable "budget_amount" {
  type        = number
  default     = 100
  description = "Monthly budget alert in subscription billing currency; alerts do not stop spending."
}
variable "budget_start_date" {
  type        = string
  description = "First day of the current month in UTC, e.g. 2026-10-01T00:00:00Z. Keep fixed after creation."
}
variable "budget_email" {
  type    = string
  default = "suhas.bangre@gmail.com"
}
variable "admin_email" {
  type        = string
  default     = "suhas.bangre@gmail.com"
  description = "Application administrator, independent of the billing alert recipient."
}
