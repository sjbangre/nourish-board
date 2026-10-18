# Azure deployment and bootstrap

Terraform defines Azure resources and GitHub federation. SQLite remains the
local default; Azure SQL stores hosted data independently of container restarts.
Pushes run validation. Deployment requires a manual Actions run on main.

| Stack | Resources | Lifecycle |
| --- | --- | --- |
| `infra/azure/bootstrap` | Control group, private versioned Blob state, app group, GitHub managed identity, branch federation and scoped permissions | Initial interactive Azure Owner login; survives app destroy |
| `infra/azure/app` | Consumption Container Apps, runtime identity, Entra-only SQL with free-offer database, private registry, Key Vault and budget alerts | Actions plan/apply/destroy |

## Bootstrap from a fresh checkout

Install Terraform 1.16.x, Azure CLI and GitHub CLI, then open a new PowerShell:

```powershell
winget install --id Hashicorp.Terraform --exact
winget install --id Microsoft.AzureCLI --exact
winget install --id GitHub.cli --exact
gh auth login
./scripts/azure-bootstrap.ps1 -SubscriptionId '<your subscription ID>'
```

The script reuses Azure sign-in or opens `az login`, selects the subscription,
registers providers, applies bootstrap resources, migrates initial local state
to Blob and sets GitHub repository variables. Terraform displays changes before
its initial apply confirmation. GitHub cannot establish its own initial Azure
trust before an authenticated Azure owner grants that trust.

Use the same human Owner for subsequent bootstrap runs. A fresh checkout detects
the deterministic state account and reconnects to existing bootstrap state.
Role propagation can briefly cause authorization failures; rerun afterward.
The generated, ignored `infra/azure/bootstrap/backend.tf` records the state
location, not a password. Never delete state to recreate resources that exist.
A partially failed initial bootstrap still needs its original local state or
explicit Terraform import if remote migration has not succeeded.

## Secretless Azure authentication

There is no Azure client secret, publish profile, certificate, storage key or
`AZURE_CREDENTIALS`. Client, tenant and subscription IDs are necessary identifiers
stored as repository variables; they require no credential rotation.

The federated trust subject is
`repo:sjbangre@32705567/nourish-board@1424214833:ref:refs/heads/main`.
Bootstrap obtains the exact subject prefix from GitHub's API, including immutable
repository/owner IDs. Only main-branch jobs can use the identity. Protect main
and restrict workflow changes.

CI has Contributor and Role Based Access Control Administrator on the app group,
plus Blob Data Contributor on the state container. It is not subscription Owner.
RBAC Administrator can grant permissions inside the group, so workflow
maintainers must be trusted. CI can read both bootstrap and app state blobs.

The GitHub deployment identity is the Entra SQL administrator and runs migrations.
The application's separate managed identity receives database data-reader and
data-writer roles; application startup verifies schema rather than managing it.
Google OAuth still requires its own client secret: Azure federation does not
replace Google's credentials.

## Prepare encrypted deployment inputs

Using the existing private local `.env` and pilot SQLite database:

```powershell
npm run build -w @nourish/api
node scripts/configure-azure-deployment.mjs --include-local-data
```

The helper writes `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and optional
`INITIAL_SQLITE_SNAPSHOT` to encrypted GitHub Actions secrets through standard
input. It does not print values, commit personal data, deploy infrastructure or
change Azure SQL. Omit `--include-local-data` for an empty cloud installation.
The compressed snapshot is intended for the small pilot dataset; larger data
needs a separate private transfer.

The deployment workflow copies Google credentials into Key Vault. Terraform owns
the vault and secret references, but never receives secret values.

The initial import preserves families, profiles, relationships, edited foods,
approvals, plans and progress in one transaction. Sessions and OAuth attempts
are excluded, so users sign in again. The destination must be empty apart from
catalog seeds. An import hash makes later deployments skip the same snapshot
and preserve cloud edits. A different snapshot after import fails explicitly.
This is a one-time migration, not ongoing synchronization or a cloud backup.

## Plan, deploy and destroy

Open **Actions → Azure deployment → Run workflow** on main. Choose `plan`
to inspect changes, then `apply` to provision resources and deploy. The workflow
uses OIDC for Azure and Blob state, with state locking and serialized runs.
No private plan/state artifacts are uploaded.

Bootstrap sets repository variables:

- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP`, `AZURE_LOCATION`, `TF_PROJECT_NAME`
- `TF_STATE_STORAGE_ACCOUNT`, `TF_SQL_ADMIN_OBJECT_ID`, `TF_BUDGET_START_DATE`

`TF_ENABLE_REGISTRY` defaults to true because deployment needs the private registry.
Keep an existing budget's start date fixed. The workflow builds and pushes a
private image, configures secrets, migrates the database and updates the
Container App. CI uses a temporary runner-IP SQL firewall rule and removes it
afterward. Runtime uses managed identity without a SQL password.

Register the deployment's exact callback URL in Google Auth Platform → Clients:
`https://YOUR-HOST/api/auth/google/callback`. Sign in as the administrator and
verify an approved family account. A scaled-to-zero container or paused database
can make the first request slower. Health probes do not query SQL.

To destroy the application, choose `destroy` and type `destroy-nourish-board`.
**This deletes the SQL database and cloud data. Back up cloud data first.**
Terraform recreates infrastructure, not subsequent family edits. An initial
pilot snapshot is not a backup of later cloud changes. Control resources,
federation, remote state and the app group boundary survive app destruction.
After recreation, check the hostname and update Google's registered redirect.

## What bootstrap did, and where to inspect it

Read [`scripts/azure-bootstrap.ps1`](../scripts/azure-bootstrap.ps1) for the
sequence and [`infra/azure/bootstrap/main.tf`](../infra/azure/bootstrap/main.tf)
for the resources and permissions.

1. **Selected the subscription and registered providers.** Azure Portal →
   Subscriptions → Azure subscription 1 → Resource providers shows enabled
   resource types. Registration does not create a running application.
2. **Created two resource groups.** Resource groups → `nourish-board-control`
   holds trust/state; `nourish-board-prod` holds the application. App teardown
   leaves control resources intact.
3. **Created private Terraform state storage.** Control group → storage account
   `nbtf3f302be4dac9` → Containers → `tfstate`. The bootstrap blob is
   `nourish-board/bootstrap.tfstate`; `nourish-board/app.tfstate` appears after
   app apply. State records resource IDs so Terraform updates the same resources.
   Blob leases lock state; versioning and seven-day soft deletion support recovery.
   Shared keys and public blob access are disabled. Treat state as private.
4. **Created GitHub's managed identity and federation.** Control group →
   `nourish-board-github` → Federated credentials → `github-main`. Review GitHub's
   issuer, Azure token-exchange audience and main-branch subject. Each job
   exchanges its short-lived GitHub token for Azure access.
5. **Granted scoped access.** Production group → Access control (IAM) → Role
   assignments shows the deployment identity's Contributor and RBAC Administrator
   roles. Inspect storage IAM for state access. App deployment adds narrowly
   scoped registry and Key Vault roles.
6. **Configured GitHub identifiers.** Repository → Settings → Secrets and
   variables → Actions → Variables contains identifiers and deployment settings.
   Secrets contains Google credentials and the optional initial data snapshot.
7. **Verified login and planned resources.** Repository → Actions contains
   federated-login and Terraform plan logs. Expand the plan step to inspect
   proposed changes. A successful plan does not deploy resources.

After deployment inspect Container App revisions/images, SQL's Microsoft Entra
administrator and firewall rules, Key Vault access roles, and Cost Management's
actual charges. Make permanent changes in Terraform so rebuilds reproduce them.

## Cost controls

- Consumption compute uses zero minimum replicas and maximum one. There is no
  VM, NAT gateway, private endpoint, dedicated profile or analytics workspace.
- SQL requests `useFreeLimit=true`, 32 GiB, local backups and
  `freeLimitExhaustionBehavior=AutoPause`. It pauses when free compute is used
  up; free-offer rejection fails provisioning without a paid fallback. AzAPI
  exposes the free-offer properties missing from AzureRM's database resource.
- The low-cost SQL public endpoint permits Azure service traffic, including
  other Azure tenants. That network allowance grants no database credentials;
  Entra identity permissions still control database access.
- Standard ACR may use the eligible 12-month offer shown in your portal, whose
  displayed expiry is 18 November 2027. Verify eligibility before applying. It
  becomes paid after expiry. Key Vault and state-storage operations can also
  incur small charges; the application is not guaranteed free forever.
- The app budget is 100/month in the subscription's billing currency, with
  alerts at 50% and 100%. **Alerts do not stop spending.** Control-group state
  storage falls outside this app budget. Allowances can be shared across apps.

## Complete teardown, including federation and state

Destroy the app stack first. As the original Azure Owner, select the same
subscription. In `infra/azure/bootstrap`, change the ignored `backend.tf` to a
valid multiline `terraform { backend "local" {} }` block, then run
`terraform init -migrate-state` and confirm copying bootstrap state locally.
This preserves the inventory before destroying its remote storage.

Run `terraform destroy` with the original subscription_id, location, project_name,
github_repository and github_subject_prefix variables; inspect the plan. This
removes the state account, identity, federation and groups. Remove stale GitHub
variables/secrets and retain any required data backups privately. A fresh
checkout can then run bootstrap to recreate the environment.

## References

- [Azure OIDC](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect)
- [Terraform Blob backend](https://developer.hashicorp.com/terraform/language/backend/azurerm)
- [SQL free offer](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer)
- [SQL free-limit API properties](https://learn.microsoft.com/en-us/azure/templates/microsoft.sql/2023-08-01-preview/servers/databases)
