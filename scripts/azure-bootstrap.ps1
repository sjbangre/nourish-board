[CmdletBinding()]
param(
  [Parameter(Mandatory)][Guid]$SubscriptionId,
  [string]$Location = 'centralindia',
  [ValidatePattern('^[a-z][a-z0-9-]{2,23}$')][string]$ProjectName = 'nourish-board',
  [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')][string]$Repository = 'sjbangre/nourish-board',
  [string]$TerraformPath = 'terraform'
)
$ErrorActionPreference = 'Stop'

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE)." }
}

function Write-StateBackend {
  param([string]$Path, [string]$AccountName)
  $backend = @"
terraform {
  backend "azurerm" {
    storage_account_name = "$AccountName"
    container_name       = "tfstate"
    key                  = "$ProjectName/bootstrap.tfstate"
    use_azuread_auth     = true
  }
}
"@
  [System.IO.File]::WriteAllText($Path, $backend)
}

foreach ($tool in @('az', 'gh', $TerraformPath)) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "Install $tool first. See docs/azure-deployment.md."
  }
}

$root = Split-Path $PSScriptRoot -Parent
$bootstrap = Join-Path $root 'infra/azure/bootstrap'
Invoke-Checked gh @('auth', 'status')
$oidcSettings = (Invoke-Checked gh @('api', "repos/$Repository/actions/oidc/customization/sub")) | ConvertFrom-Json
if (-not $oidcSettings.use_default -or -not $oidcSettings.sub_claim_prefix) {
  throw 'This bootstrap requires GitHub default branch subjects. Review custom OIDC subject settings before proceeding.'
}
$oidcPrefix = [string]$oidcSettings.sub_claim_prefix
# Azure uses your interactive sign-in only for this first trust setup.
& az account show --output none 2>$null
if ($LASTEXITCODE -ne 0) { Invoke-Checked az @('login', '--output', 'none') }
Invoke-Checked az @('account', 'set', '--subscription', $SubscriptionId.ToString())

# Reconnect a fresh checkout to existing remote bootstrap state automatically.
$backendFile = Join-Path $bootstrap 'backend.tf'
if (-not (Test-Path -LiteralPath $backendFile)) {
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    $digest = $hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$SubscriptionId/$ProjectName"))
    $suffix = ([BitConverter]::ToString($digest).Replace('-', '').ToLowerInvariant()).Substring(0, 12)
  } finally { $hasher.Dispose() }
  $expectedAccount = "nbtf$suffix"
  & az storage account show --name $expectedAccount --resource-group "$ProjectName-control" --output none 2>$null
  if ($LASTEXITCODE -eq 0) {
    $stateExists = (Invoke-Checked az @('storage', 'blob', 'exists', '--account-name', $expectedAccount, '--container-name', 'tfstate', '--name', "$ProjectName/bootstrap.tfstate", '--auth-mode', 'login', '--query', 'exists', '--output', 'tsv')).Trim()
    if ($stateExists -eq 'true') { Write-StateBackend $backendFile $expectedAccount }
  }
}

# Registration is subscription-level, so do it as the human owner, not CI.
foreach ($namespace in @('Microsoft.ManagedIdentity', 'Microsoft.Storage', 'Microsoft.App', 'Microsoft.OperationalInsights', 'Microsoft.Sql', 'Microsoft.ContainerRegistry', 'Microsoft.Consumption', 'Microsoft.KeyVault')) {
  Invoke-Checked az @('provider', 'register', '--namespace', $namespace, '--wait', '--output', 'none')
}

Push-Location $bootstrap
try {
  Invoke-Checked $TerraformPath @('init', '-input=false')
  $tfArguments = @(
    "-var=subscription_id=$SubscriptionId", "-var=location=$Location",
    "-var=project_name=$ProjectName", "-var=github_repository=$Repository",
    "-var=github_subject_prefix=$oidcPrefix"
  )
  # No -auto-approve: Terraform displays the concrete changes before applying.
  Invoke-Checked $TerraformPath (@('apply') + $tfArguments)
  $values = (Invoke-Checked $TerraformPath @('output', '-json', 'github_variables')) | ConvertFrom-Json

  # Move initial local bootstrap state into encrypted, versioned Azure Blob state.
  if (-not (Test-Path -LiteralPath $backendFile)) {
    Write-StateBackend $backendFile $values.TF_STATE_STORAGE_ACCOUNT
    Invoke-Checked $TerraformPath @('init', '-migrate-state', '-force-copy', '-input=false')
  }

  # These are identifiers, not secrets. No Azure credential is uploaded.
  foreach ($property in $values.PSObject.Properties) {
    Invoke-Checked gh @('variable', 'set', $property.Name, '--repo', $Repository, '--body', [string]$property.Value)
  }
  $ownerIp = ([string](Invoke-RestMethod -Uri 'https://api.ipify.org')).Trim()
  $parsedIp = $null
  if (-not [Net.IPAddress]::TryParse($ownerIp, [ref]$parsedIp) -or $parsedIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
    throw 'Could not determine the owner workstation IPv4 address.'
  }
  Invoke-Checked gh @('variable', 'set', 'TF_SQL_OWNER_IPV4', '--repo', $Repository, '--body', $ownerIp)
  # Keep an existing budget's start date stable on subsequent bootstrap runs.
  & gh api "repos/$Repository/actions/variables/TF_BUDGET_START_DATE" --silent 2>$null
  if ($LASTEXITCODE -ne 0) {
    $budgetStart = [DateTime]::UtcNow.ToString('yyyy-MM-01T00:00:00Z')
    Invoke-Checked gh @('variable', 'set', 'TF_BUDGET_START_DATE', '--repo', $Repository, '--body', $budgetStart)
  }
  Write-Host 'Bootstrap complete. Azure federation and GitHub variables are configured.'
  Write-Host 'The application infrastructure has not been applied. Use the Azure deployment workflow next.'
} finally {
  Pop-Location
}
