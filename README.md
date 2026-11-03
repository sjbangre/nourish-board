# Nourish Board

A dark-themed, family nutrition and fitness dashboard built with **Next.js 16 + React 19 + TypeScript**, **NestJS 12**, and **SQLite locally / Azure SQL in production**. Families can have any number of adult profiles, organized into optional two-person couples or individuals.

## Run locally

Requires **Node.js 24+** and npm.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open **http://localhost:4318**. Next.js proxies `/api/*` to NestJS on loopback port 4319. Both processes stop with Ctrl+C.

Google sign-in requires credentials (setup below). For an explicitly local development preview only, set `LOCAL_DEV_AUTH=true` in `.env`. A visible banner identifies this mode; it impersonates the configured administrator. Development binds to loopback, and production refuses to start with this flag enabled. Leave it **false** when using Google authentication.

```powershell
npm run typecheck
npm test
npm run build
npm start
```

`npm start` runs production and therefore requires Google credentials and an HTTPS `APP_URL`. Both launch scripts automatically load the root `.env` file. Environment changes require a full restart. The launcher uses the operating system's trusted certificate authorities for HTTPS requests; it never disables TLS verification.

## Google OAuth and administrator approval

**Administrator:** Only the verified Google account matching `ADMIN_EMAIL` receives the admin role. Email addresses typed into a form do not authenticate a user or confer admin access.

1. Create/select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Configure Google Auth Platform branding/audience. While the project is in Testing, add your family members as test users there as well. Google test-user access and this app's invitation approvals are separate checks.
3. Create an OAuth client of type **Web application**.
4. Add the exact redirect URI:
   - Local: `http://localhost:4318/api/auth/google/callback`
   - Hosted: `https://YOUR-HOST/api/auth/google/callback`
5. Set the following in `.env` locally, or as hosting environment secrets:

```dotenv
APP_URL=http://localhost:4318
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
ADMIN_EMAIL=suhas.bangre@gmail.com
LOCAL_DEV_AUTH=false
```

Use **localhost**, not 127.0.0.1, when testing OAuth with the localhost redirect URI. Cookie state and Google's registered redirect must match. Use HTTPS for hosting. Do not commit `.env` or place credentials in any `NEXT_PUBLIC_*` variable.

6. Sign in as the administrator and open **Invites & access**.
7. Enter a relative's exact Google email, choose a family, and click **Approve invitation**. You can do this before or after their first Google sign-in.

New Google accounts remain **pending** with no family-data access until approved. Approval is restricted by backend authorization, not just by hidden UI. Approved users see only their assigned families in API responses and exports. They cannot approve invitations, create families, or edit the global nutrition catalog. Within an approved family they can manage couples, profiles, preferences, food plans, and progress.

Invitations do **not** send email automatically. Share the app URL yourself. An approved email must match the user's verified Google email. The admin can cancel individual family approvals or revoke an account entirely. Revocation invalidates its active sessions and invitations. Role and membership checks read current database state on each request.

Authentication uses Google's official `google-auth-library`, authorization-code flow with PKCE, single-use state, and a nonce checked against the verified ID token. Server-side session tokens are random, stored as hashes in the database, and delivered in HttpOnly, SameSite cookies (Secure in production). Google access/refresh tokens are not retained. The app requests only `openid email profile`, not Drive/Gmail permissions. Sign out invalidates the server-side session.

Actual Google sign-in must be tested with your real OAuth project; credentials are not included in the repository. See [Google's web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) and [OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect).

## Family and nutrition workflow

1. In **Family & members**, rename the initial family/couple, add relatives, create optional couples, or create another family as admin. Couples have at most two members; individuals need no couple. Moving a member preserves their profile, plans, and weight history and requires access to both families.
   Expand a family accordion, then a couple or the Individuals group. Add people within the group, or expand Move member beneath a person to reorganize them. Admins can rename or delete a family from its toolbar. Delete requires typing the exact family name and hides all its data and access. The admin-only Deleted families accordion can restore it, including profiles, history, and previous approvals. Deletion is recoverable; it is not permanent data erasure.
2. In **Your profile**, enter actual measurements, overall activity, deficit, protein level, optional whey, and training preferences. No body measurements are prefilled.
3. In **Food library**, choose preferred ingredients separately for each person. The 120-food starter catalog includes ragi and other millets, toor/urad/chana/moong/horse gram, avarekalu, South Indian gourds and greens, regional fish, nuts/seeds, and 25 fruits including papaya, mosambi, sapota, guava, pomegranate, mango, jackfruit, and melons. Local names are searchable.
4. Generate a **Daily food plan**, inspect target gaps, and try another combination for alternative protein/legume/grain selections.
5. Use **Training plan** for strength, cardio, swimming, and recovery suggestions. Record weigh-ins in **Progress**.
6. In **Shopping list**, combine a family, couple, or individual for 1, 3, or 7 days. Only complete saved combinations are included. Print or export scoped family data.

All portions use raw edible weights, with grains and pulses weighed **dry**. Exclude shells, bones, and inedible peel. Whey quantities mean powder grams, not grams of protein. Cook legumes thoroughly.

## Add a food by name

As admin, select **Add a food**, enter its name, and choose **Find nutrition**. The dialog shows existing library matches and fetches candidate nutritional matches from **USDA FoodData Central**. It pre-fills calories, protein, carbs, fat, and fiber per 100 g with the source URL, FDC identifier, and CC0 attribution. Regional name aliases assist lookup.

Choose the exact raw/dry ingredient, confirm its preparation basis, choose a category and portion limit, and review before saving. Prepared/cooked matches cannot be imported into this raw-weight planner. Missing nutrients remain blank and must be supplied; they are never treated as zero or invented. This is structured food-database lookup, not scraping search snippets or using paid AI inference. Not every Indian ingredient/variety is present, so manual label entry remains available.

No paid service is required. Without configuration, USDA's `DEMO_KEY` allows **30 requests/hour and 50/day per server IP**. For regular family use, get a [free USDA API key](https://fdc.nal.usda.gov/api-key-signup/) and set `USDA_API_KEY`. Results are cached for 24 hours in server memory; network requests are throttled and time out. The existing food library works offline if lookup fails. Only food search terms are sent to USDA, never personal or family data.

[USDA API documentation, limits, and CC0 licensing](https://fdc.nal.usda.gov/api-guide/).

## Calculation assumptions

Resting energy: `10 × weight_kg + 6.25 × height_cm − 5 × age + sex_coefficient` (Mifflin–St Jeor; male +5, female −161). Maintenance uses the selected overall activity multiplier, already including workouts. Target calories subtract a selected 0–20% deficit with conservative app floors of 1,200 / 1,500 kcal for female / male coefficients. Actual deficit is shown, and may be smaller than requested. These are planning guardrails, not individualized minimum intakes.

Protein: selectable **1.4–2.0 g/kg current weight**. Fat: 28% of target calories. Carbs: remaining energy using 4/4/9 kcal per gram. Fiber: 14 g per 1,000 kcal. Activity multipliers, fat allocation, portion caps, and tolerances are product assumptions. Goal weight is a progress reference, not a promised timeline.

The solver uses bounded coordinate descent over preferred ingredients and daily limits. Whey is counted once; grams are rounded and totals recomputed. Alternatives rotate preferred protein, legume, and grain choices. Combinations are marked incomplete if energy/macros differ by over 12%, fiber differs by over 25%, or calories fall below the app floor. It is a heuristic, not a guarantee of exact target matching, micronutrient adequacy, or optimal outcomes.

**Starter nutrition values are approximate, editable seed data**, not a verified Indian food-composition database. Replace them with actual labels/trusted data before relying on exact totals. Label calories may differ from macro-derived energy because of fiber/rounding. Daily ingredient totals are not recipes: divide them between meals and include extra sauces, drinks, snacks, and cooking oil.

Plans are for adults 18–80. Pregnancy, breastfeeding, or relevant medical conditions pause automatic plans. Deficits are blocked for BMI below 18.5 and goal weights above current weight. Weigh-ins do not silently overwrite profile weight or calorie targets. Suggested training is not a personalized coaching program or exercise log. Review energy, hunger, recovery, and trends over time.

References: [Mifflin–St Jeor](https://pubmed.ncbi.nlm.nih.gov/2305711/), [ISSN protein and exercise](https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/), [fiber reference](https://www.dietaryguidelines.gov/sites/default/files/2019-05/2005%20DG%20for%20Americans.pdf), [NIDDK weight planning](https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner), [CDC adult activity](https://www.cdc.gov/physical-activity-basics/guidelines/adults.html).

## Architecture

```text
apps/web/                  Next.js App Router, React, TypeScript
  src/app/                 Routed pages, dark global styles, error boundaries
  src/components/          Dashboard, family, profile, food, planning, progress, admin
  src/lib/                 Typed API client
apps/api/                  NestJS API, TypeScript
  src/auth/                Google OAuth, sessions, global authentication guard
  src/admin/               Admin-only invitation approvals and revocation
  src/common/              Family/profile authorization
  src/database/            Async SQLite/Azure SQL adapters, schema and data migration
  src/families/            Families, couples, membership
  src/profiles/            Profile validation, preferences, weigh-ins
  src/foods/               Catalog, structured online lookup
  src/nutrition/           Energy/macros, optimizer, training templates
packages/contracts/        Shared TypeScript API contracts
scripts/run.mjs            Cross-platform development/production launcher
```

Nest dependency injection, controllers/modules, DTO validation, centralized errors, authentication guards, and authorization services own the backend. React components own rendering/state; there is no HTML-string injection or legacy vanilla server. Families, couples, users, memberships, sessions, and invitations use relational tables; profiles/foods/plans retain JSON payloads for compatibility with the pilot database. Both database adapters share the same API and transaction boundaries. Local SQLite initializes on startup; the deployment workflow migrates Azure SQL before starting the application, whose managed identity has only data read/write permissions.

## Persistence and hosting

[Azure deployment and bootstrap walkthrough](docs/azure-deployment.md) covers the Terraform stacks, secretless GitHub Actions authentication, deployment, data import and teardown. Pushes run checks. Hosting starts only when you manually run the Azure workflow with `apply`.

Local development defaults to `DATABASE_PROVIDER=sqlite` and stores `data/nourish.sqlite` plus WAL files. `DATA_DIR` changes the directory. Data and secrets are ignored by Git. For a filesystem backup, stop both servers and copy the entire data directory privately; restore it while stopped. Do not copy only the main SQLite file during writes.

Azure runs one container containing Next.js and NestJS on scale-to-zero Container Apps, with a separate Azure SQL free-offer database. Only Next.js is public. The API uses its managed identity for SQL; Google OAuth credentials come from Key Vault references. SQL data survives container replacements. No persistent container volume is needed.

To configure encrypted deployment inputs from your private local `.env` and include the current local pilot data:

```powershell
npm run build -w @nourish/api
node scripts/configure-azure-deployment.mjs --include-local-data
```

This writes encrypted GitHub secrets; it does not deploy or change Azure SQL. The first deployment imports families, profiles, approvals, foods, plans and logs in one transaction. Sessions and OAuth attempts are excluded, so everyone signs in again. Later deployments recognize the same import and preserve cloud edits. A different snapshot is rejected after import; this is an initial migration mechanism, not ongoing synchronization or cloud backup.

| Variable | Local / Azure behavior |
| --- | --- |
| `DATABASE_PROVIDER` | `sqlite` by default; `azure-sql` in Azure |
| `DATA_DIR` | SQLite directory; unused for Azure SQL |
| `SQL_SERVER` / `SQL_DATABASE` | Azure SQL server hostname and database name |
| `SQL_AUTH` | `managed-identity` in Azure; `azure-cli` for authorized development/migration |
| `AZURE_CLIENT_ID` | Runtime managed identity identifier; no Azure client secret |
| `DATABASE_MIGRATIONS` | Workflow sets `on` for migration; application runtime keeps it off |
| `APP_URL` | Local HTTP origin or canonical hosted HTTPS origin |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Local `.env` or server-side Key Vault references |
| `ADMIN_EMAIL` | `suhas.bangre@gmail.com` |
| `LOCAL_DEV_AUTH` | `false` when using Google; production rejects `true` |
| `PORT` / `API_PORT` | Public Next.js 4318 / internal NestJS 4319 |
| `USDA_API_KEY` | Optional free key; limited demo key is the fallback |

The Dockerfile also supports local SQLite hosting when you explicitly mount a writable `/data` directory. Register the hosted Google callback before testing sign-in. There is no email-delivery service, billing or password-account system.

## Validation

`npm test` checks nutrition math, guardrails, optimizer caps and whey, incomplete pantries, catalog coverage, real SQLite migration/persistence, Nest API validation, pending accounts, admin-only approval/revocation, family isolation, scoped exports, CSRF rejection, session logout, forged OAuth state, expired attempts, and production fail-closed behavior. `npm run typecheck` checks both TypeScript apps; `npm run build` builds both for production.

Live Google login requires configured credentials. Automated tests do not substitute for a real-browser visual/interaction review.
