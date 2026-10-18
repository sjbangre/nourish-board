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
  description = "Entra object ID of the human administrator or admin group, not the app identity."
  validation {
    condition     = can(regex("^[0-9a-fA-F-]{36}$", var.sql_admin_object_id))
    error_message = "Supply the Entra object ID of the SQL administrator."
  }
}
variable "sql_admin_name" {
  type    = string
  default = "nourish-sql-admin"
}
variable "enable_registry" {
  type        = bool
  default     = false
  description = "Optional Standard ACR. Enable only after checking the subscription's 12-month free allowance and expiry."
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
