# Azure infrastructure with Terraform

Azure resources and GitHub federation are defined as code. The earlier manual
portal identity-creation steps are replaced by `scripts/azure-bootstrap.ps1`.

## Stacks

| Stack | Resources | Lifecycle |
| --- | --- | --- |
| `infra/azure/bootstrap` | Control resource group, private versioned Blob state, app resource-group boundary, GitHub managed identity, main-branch federation, scoped RBAC | One-time interactive Azure sign-in; survives app destroy |
| `infra/azure/app` | Consumption Container Apps environment, scale-to-zero placeholder, runtime identity, Entra-only SQL server, SQL free-offer database, budget alerts, optional registry | Actions plan/apply/destroy |

**The real app is not cloud-ready yet.** SQLite/WAL needs persistent local
storage. The Container App deliberately uses Microsoft's hello-world image
instead of running our SQLite image on ephemeral storage. The Azure SQL adapter,
data import, runtime SQL permissions/firewall rules, runtime Google secrets, and
image build/push remain application integration work. There is no automatic app
deployment on push yet; pushes validate Terraform only.

## Federation and state

No Azure client secret, publish profile, certificate, storage key or
`AZURE_CREDENTIALS` is used. Azure client/tenant/subscription IDs remain necessary
identifiers; bootstrap writes these as repository variables, with no rotation.

The trust subject is `repo:sjbangre/nourish-board:ref:refs/heads/main`. This
replaces the earlier environment-scoped template and avoids requiring environment
protections on the private repository's GitHub plan. Pull request branches
cannot obtain this Azure identity. Protect main and restrict workflow editing.

CI has Contributor and Role Based Access Control Administrator on the app
resource group only, plus Blob Data Contributor on the state container. It is
not subscription Owner. RBAC Administrator is needed to manage app identity role
assignments and can grant permissions inside that group: workflow maintainers
must be trusted. The state container holds both app and bootstrap state blobs;
CI can read/write those blobs but cannot delete the control resource group.

Bootstrap initially uses local state, then migrates it to Azure Blob. App state
is remote from its first CI apply. Blob leases lock state; versioning and
seven-day soft deletion support recovery. Shared keys and public blob access
are disabled. State/plan/local variable files are Git-ignored. Keep initial
bootstrap state/backup private until remote migration succeeds.

## First setup

Install missing tools once, then open a new PowerShell in the repository:

```powershell
winget install --id Hashicorp.Terraform --exact
winget install --id Microsoft.AzureCLI --exact
winget install --id GitHub.cli --exact
```

Use Terraform 1.16.x. GitHub CLI is already signed in on this workstation;
otherwise use `gh auth login`. Then:

```powershell
./scripts/azure-bootstrap.ps1 -SubscriptionId '<your subscription ID>'
```

The script uses an existing Azure login or opens `az login`, selects the
subscription, registers providers, creates the Terraform bootstrap resources,
migrates state, and sets GitHub repository variables. Terraform shows the actual
changes before its initial apply confirmation. No individual Azure resources
need manual creation. Initial trust cannot be established by GitHub before an
authenticated Azure owner grants that trust.

Run as the same human Owner each time. That user becomes the initial Entra SQL
administrator. The script expects a normal interactive user with access to its
own Graph user record. Role propagation can briefly cause Storage 403s; rerun
after propagation. Do not switch identities during bootstrap.

The generated, ignored `infra/azure/bootstrap/backend.tf` contains the state
location, not a password. Commit/push source files and provider lock files to
main after setup so GitHub Actions can see them.

## Plan, apply and destroy

Open **Actions → Azure infrastructure → Run workflow** on main. Choose `plan`
first, then `apply` to create the app infrastructure. Each apply generates and
applies its own fresh saved plan. CI uses OIDC for Azure and Blob state, with
state locking and serialized runs; no private plan/state artifacts are uploaded.

Bootstrap sets repository variables:

- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP`, `AZURE_LOCATION`, `TF_PROJECT_NAME`
- `TF_STATE_STORAGE_ACCOUNT`, `TF_SQL_ADMIN_OBJECT_ID`, `TF_BUDGET_START_DATE`

Optional `TF_ENABLE_REGISTRY` defaults to false. Keep the budget start date fixed
after creation. `Check Terraform` runs format/schema/mocked checks without Azure
access. `Verify Azure federated login` is a manual read-only authentication test.

For application teardown, choose `destroy` and type `destroy-nourish-board`.
**This deletes the SQL database and cloud data. Export it first.** Terraform
recreates infrastructure, not profiles, accounts, runtime secrets or data.
Local `data/` is not uploaded or changed. Control resources, GitHub federation,
remote state and the app resource-group boundary survive. Run apply again to
recreate app infrastructure; restore data and runtime credentials separately.
A rebuilt environment may have a different hostname: update Google redirects
and `APP_URL` when needed.

## Cost controls

- Consumption only, zero minimum replicas and maximum one; no VM, NAT gateway,
  private endpoint, dedicated profile or paid analytics workspace. Logs stream.
- SQL explicitly requests `useFreeLimit=true`, 32 GiB, local backups and
  `freeLimitExhaustionBehavior=AutoPause`. It pauses when free compute is used
  up. Free-offer rejection fails provisioning; no paid fallback. AzAPI is used
  because the AzureRM SQL database resource lacks free-offer properties.
- SQL has no app firewall allowance yet. Runtime identity permissions and narrow
  network access are part of app integration. No SQL password is generated.
- Registry disabled by default. Standard ACR can use the eligible 12-month offer
  shown in your portal (expiry displayed: 18 November 2027). Verify eligibility
  before setting `TF_ENABLE_REGISTRY=true`. It becomes paid after expiry, and
  setting it back to false destroys the registry and its images.
- Budget: 100 per month in the subscription's billing currency (INR for an INR
  subscription), alerts at 50% and 100%. **Alerts do not stop spending.** Control
  state storage is outside this app budget and costs storage/transactions outside
  allowances. No unconditional zero-cost guarantee is possible.
- Service allowances may be shared across apps/subscription. Actual region,
  quota and free-offer eligibility require a real Azure plan/apply. These files
  have not been deployed against Azure yet.

## Complete teardown, including trust and state

First destroy the app stack. As the original Azure Owner, open
`infra/azure/bootstrap` and select the same subscription with `az account set`.
Change its ignored `backend.tf` to `terraform { backend "local" {} }` (formatted
as valid multiline HCL), then run `terraform init -migrate-state` and confirm
copying bootstrap state locally. This preserves the resource inventory before
deleting its remote storage account.

Run `terraform destroy` supplying the original subscription_id, location,
project_name and github_repository variables; inspect the destruction plan.
This removes the state account, identity, federation and both groups. Remove
stale GitHub variables afterward and keep any retained state backups private.

After complete teardown, a fresh checkout can run the bootstrap script again.
For a new checkout with surviving control resources, the script detects the
deterministically named state account and reconnects to its bootstrap state
automatically (using the same subscription/project and authorized human login).
Never delete state to force recreation of resources that still exist. A partially
failed initial bootstrap with no remote state still needs its original local
state or explicit Terraform import; do not discard that local state.

## References

- [Azure OIDC](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect)
- [Terraform Blob backend](https://developer.hashicorp.com/terraform/language/backend/azurerm)
- [SQL free offer](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer)
- [SQL free-limit API properties](https://learn.microsoft.com/en-us/azure/templates/microsoft.sql/2023-08-01-preview/servers/databases)
