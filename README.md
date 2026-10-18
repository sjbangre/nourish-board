# Nourish Board

A dark-themed, family nutrition and fitness dashboard built with **Next.js 16 + React 19 + TypeScript**, **NestJS 12**, and **SQLite**. Families can have any number of adult profiles, organized into optional two-person couples or individuals.

## Run locally

Requires **Node.js 24+** and npm.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open **http://localhost:4318**. Next.js proxies `/api/*` to NestJS on loopback port 4319. `start.cmd` starts development mode after installation. Both processes stop with Ctrl+C.

Google sign-in requires credentials (setup below). For an explicitly local development preview only, set `LOCAL_DEV_AUTH=true` in `.env`. A visible banner identifies this mode; it impersonates the configured administrator. Development binds to loopback, and production refuses to start with this flag enabled. Leave it **false** when using Google authentication.

```powershell
npm run typecheck
npm test
npm run build
npm start
```

`npm start` runs production and therefore requires Google credentials and an HTTPS `APP_URL`. Both launch scripts automatically load the root `.env` file. Environment changes require a full restart. The launcher uses the operating system's trusted certificate authorities for HTTPS requests; it never disables TLS verification.

## Google OAuth and administrator approval

**Administrator: `suhas.bangre@gmail.com`.** Only the verified Google account matching `ADMIN_EMAIL` receives the admin role. Email addresses typed into a form do not authenticate a user or confer admin access.

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

Authentication uses Google's official `google-auth-library`, authorization-code flow with PKCE, single-use state, and a nonce checked against the verified ID token. Server-side session tokens are random, stored as hashes in SQLite, and delivered in HttpOnly, SameSite cookies (Secure in production). Google access/refresh tokens are not retained. The app requests only `openid email profile`, not Drive/Gmail permissions. Sign out invalidates the server-side session.

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
  src/database/            SQLite repository and startup migration
  src/families/            Families, couples, membership
  src/profiles/            Profile validation, preferences, weigh-ins
  src/foods/               Catalog, structured online lookup
  src/nutrition/           Energy/macros, optimizer, training templates
packages/contracts/        Shared TypeScript API contracts
scripts/run.mjs            Cross-platform development/production launcher
```

Nest dependency injection, controllers/modules, DTO validation, centralized errors, authentication guards, and authorization services own the backend. React components own rendering/state; there is no HTML-string injection or legacy vanilla server. Families, couples, users, memberships, sessions, and invitations are relational SQLite tables; profiles/foods/plans retain JSON payloads for compatibility with the pilot database. Existing data migrates on startup without replacing edited food values.

## Persistence and hosting

For Azure, see [Terraform infrastructure and GitHub Actions setup](docs/azure-deployment.md).
The bootstrap script creates secretless GitHub federation and private remote state.
Actions can plan/apply/destroy the serverless infrastructure. The Container App
currently uses a placeholder until the SQLite backend is migrated to Azure SQL;
these files do not yet deploy the actual application.

Data defaults to `data/nourish.sqlite` plus SQLite WAL files. Set `DATA_DIR` to a writable persistent mount. Data and secrets are ignored by Git. For a restorable backup, stop both servers and copy the entire data directory privately; restore it while stopped. Do not copy only the main SQLite file during writes. JSON export has no import UI yet.

Deploy **one container** running Next.js and NestJS, with **one persistent volume**. Only the Next.js port is public; Nest binds to loopback. SQLite is free and avoids a separate managed database subscription. Compute/storage hosting charges still apply. A free host with an ephemeral filesystem will lose local database changes on restart/redeploy.

The multi-stage `Dockerfile` builds both apps. `render.yaml` is an optional **paid** Render blueprint with a 1 GB disk, not an active deployment. Review [current Render prices](https://render.com/pricing) and [persistent disk requirements](https://render.com/docs/disks) before creating it. A small VPS is another option if you maintain HTTPS, updates, and backups.

Production environment:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | Canonical public HTTPS origin, without trailing slash |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Server-side OAuth secrets |
| `ADMIN_EMAIL` | `suhas.bangre@gmail.com` |
| `LOCAL_DEV_AUTH` | `false` |
| `PORT` | Host-provided frontend port, default 4318 |
| `API_PORT` | Internal Nest port, default 4319 |
| `DATA_DIR` | Persistent mount, e.g. `/data` |
| `USDA_API_KEY` | Optional free key; limited demo key is the fallback |

Run a single instance, with a writable disk for the image's `node` user and HTTPS supplied by your host/reverse proxy. Register the matching hosted Google callback before deployment. There is no public signup or self-approved invitation endpoint. This version has no email-delivery service, billing, password accounts, or multi-instance database replication.

## Validation

`npm test` checks nutrition math, guardrails, optimizer caps and whey, incomplete pantries, catalog coverage, real SQLite migration/persistence, Nest API validation, pending accounts, admin-only approval/revocation, family isolation, scoped exports, CSRF rejection, session logout, forged OAuth state, expired attempts, and production fail-closed behavior. `npm run typecheck` checks both TypeScript apps; `npm run build` builds both for production.

Live Google login requires configured credentials. Automated tests do not substitute for a real-browser visual/interaction review.
