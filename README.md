# StayStacking

> Fitness compounds when consistency compounds. Keep stacking healthy training blocks.

StayStacking is a serverless web application for endurance athletes that tracks training load across three physiological systems — aerobic, muscular, and structural — to prevent overuse injuries and enable long-term progressive fitness.

---

## Purpose

Endurance athletes often track volume (mileage, vert, time) but not **load density** — the compounding stress across cardiovascular, muscular, and tendon systems. StayStacking answers one question: *Is my body adapting or becoming more reactive?*

The app connects to Strava to pull activity data and computes ATL (fatigue), CTL (fitness), TSB (form), and ACWR (injury risk) across three load categories: Aerobic, Muscular, and Structural. Manual daily Injury Check-Ins (stiffness, pain, recovery tools) overlay the training data for a holistic view.

---

## Repo Structure

```
stay-stacking/
│
├── frontend/
│   ├── index.html          Single-page app shell with all tab panels and modals
│   ├── styles.css          All styles using the earthy color palette
│   └── app.js              All app logic: state, API calls, Chart.js, load index
│
├── backend/
│   └── lambdas/
│       ├── shared/
│       │   ├── auth.js     JWT sign/verify + response helpers + withAuth() wrapper
│       │   ├── dynamo.js   DynamoDB DocumentClient singleton (AWS SDK v3)
│       │   ├── strava.js   Strava API client + token refresh logic
│       │   └── weekStart.js  Pure fn: date → Monday of that week (UTC-safe)
│       ├── auth/           GET /auth/strava + GET /auth/callback
│       ├── user/           GET/POST /user (profile + injury toggle)
│       ├── checkin/        GET/POST /checkin (daily morning/evening log)
│       ├── activities/     GET /activities + POST /activities/sync
│       ├── costs/          GET /costs (AWS cost explorer + user list, admin only)
│       └── training-plan/  GET/POST/DELETE /training-plan/{date}
│
├── terraform/
│   ├── main.tf             Root config — instantiates all modules
│   ├── variables.tf        Input variables (region, environment, secrets)
│   ├── outputs.tf          App URL, API URL, bucket names
│   └── modules/
│       ├── database/       DynamoDB tables (4 tables + GSIs + TTL)
│       ├── storage/        S3 buckets + CloudFront distribution (OAC)
│       └── api/
│           ├── main.tf     Lambda functions + API Gateway + IAM + cross-account roles
│           └── route/      Reusable submodule: HTTP method + OPTIONS CORS
│
├── scripts/
│   ├── deploy.sh               Full deploy: package lambdas → terraform → upload frontend
│   ├── seed-staging-user.sh    Seeds prod user into staging DynamoDB for testing
│   └── teardown.sh             terraform destroy with confirmation
│
├── CLAUDE.md               Agent session notes + architecture summary
├── README.md               This file
└── TESTING.md              Testing TODO list + test documentation
```

---

## Architecture

```
Browser
  │
  ├── HTTPS → CloudFront (CDN) → S3 (index.html, styles.css, app.js)
  │
  └── HTTPS → API Gateway (REST)
                ├── /auth/*          → Lambda: auth
                ├── /user            → Lambda: user
                ├── /checkin         → Lambda: checkin
                ├── /activities/*    → Lambda: activities
                ├── /costs           → Lambda: costs (STS cross-account)
                └── /training-plan/* → Lambda: training-plan
                        │
                        ├── DynamoDB (4 tables)
                        └── Strava API (external)
```

**Cost profile:** Entirely serverless. For personal use, monthly cost is near $0 (Lambda + API Gateway + DynamoDB all have generous free tiers; CloudFront + S3 very cheap for low traffic).

### DynamoDB Tables

| Table | PK | SK | Notes |
|---|---|---|---|
| `staystacking-users-{env}` | userId (S) | — | GSI on stravaId; stores tokens + lastSynced |
| `staystacking-activities-{env}` | userId (S) | activityId (S) | GSI on weekStart; TTL = 56 days |
| `staystacking-checkins-{env}` | userId (S) | date (YYYY-MM-DD) | Morning + evening in one item |
| `staystacking-training-plan-{env}` | userId (S) | date (YYYY-MM-DD) | Planned distance/elevation/time |

### Auth Flow

1. User clicks "Connect with Strava" → `GET /auth/strava` → redirect to Strava OAuth
2. Strava redirects to `GET /auth/callback?code=...`
3. Lambda exchanges code for tokens, creates/updates user in DynamoDB
4. Lambda issues a 30-day JWT → redirects to `FRONTEND_URL/#token={jwt}`
5. Frontend stores JWT in `localStorage`; all subsequent calls include `Authorization: Bearer {jwt}`
6. On first login, onboarding modal is shown explaining app features

### Training Load Index

Three load categories computed from weekly Strava zone data, each producing ATL, CTL, TSB, and ACWR:

| Category | Metrics |
|---|---|
| **Aerobic** | HR Z1–Z5 weighted ×1/×2/×3/×5/×8 |
| **Muscular** | Pace Z3–Z7 (×1–×8) + Power Z3–Z7 (×1–×8) + Grade G3 (×1) + G4 (×2) |
| **Structural** | Run time hrs (×3) + Cycling time hrs (×1) + Grade G3 hrs (×10) + G4 hrs (×5) |

- **CTL** (Fitness) = 42-day EMA, α = `1 - e^(-d/42)` where d = days elapsed
- **ATL** (Fatigue) = 7-day EMA, α = `1 - e^(-d/7)`
- **TSB** (Form) = CTL_yesterday − ATL_yesterday
- **ACWR** (Injury Risk) = ATL ÷ CTL — danger threshold > 1.5

Current week uses day-accurate decay (α computed from days elapsed today) so values update with every sync, not just at week end.

Cycling HR samples receive a +13 BPM bias before zone assignment to normalize cycling vs running HR zones. Samples ≤ 80 BPM are excluded.

---

## Environments

StayStacking runs two fully isolated environments — **prod** and **staging** — each in its own AWS account.

| | Prod | Staging |
|---|---|---|
| AWS Account | `527658263602` | `350105844643` |
| URL | `https://stay-stacking.sean-howley.com` | `https://staging.stay-stacking.sean-howley.com` |
| AWS CLI Profile | `prod` | `staging` |
| Terraform state bucket | `staystacking-terraform-state-prod` | `staystacking-terraform-state-staging` |
| Terraform state lock table | `staystacking-terraform-locks-prod` | `staystacking-terraform-locks-staging` |
| DynamoDB tables | `staystacking-*-prod` | `staystacking-*-staging` |
| Lambda functions | `staystacking-*-prod` | `staystacking-*-staging` |

**Route 53 DNS lives in the prod account** for both environments. The staging CloudFront distribution is pointed at `staging.stay-stacking.sean-howley.com` via a Route 53 alias record that Terraform creates in the prod account when deploying staging.

**Staging banner:** staging deployments show a yellow banner at the top of the UI (`staging-banner` CSS class active). It is hidden in prod. This is handled by `deploy.sh` replacing the `__STAGING_BANNER__` placeholder in `index.html` at deploy time.

**Cross-account costs:** the costs Lambda in each account can query Cost Explorer and DynamoDB in the *peer* account via STS `AssumeRole` into `staystacking-costs-cross-account-{env}`. Terraform provisions these IAM roles in both accounts automatically.

---

## Usage

### Prerequisites

- AWS CLI installed and configured with two named profiles: `prod` and `staging`
- Terraform ≥ 1.3 installed
- Node.js ≥ 18 installed (for Lambda packaging)
- A Strava API app created at https://www.strava.com/settings/api

### Environment Files

Each environment reads its config from a `.env.<environment>` file at the repo root (gitignored). Create one for each environment:

**.env.prod**
```bash
AWS_PROFILE=prod
FRONTEND_URL=https://stay-stacking.sean-howley.com
ACM_CERTIFICATE_ARN=arn:aws:acm:us-east-1:<prod-account-id>:certificate/<cert-id>
JWT_SECRET=<random 32+ char string>
STRAVA_CLIENT_ID=<Strava client ID>
STRAVA_CLIENT_SECRET=<Strava client secret>
```

**.env.staging**
```bash
AWS_PROFILE=staging
FRONTEND_URL=https://staging.stay-stacking.sean-howley.com
ACM_CERTIFICATE_ARN=arn:aws:acm:us-east-1:<staging-account-id>:certificate/<cert-id>
JWT_SECRET=<different random 32+ char string>
STRAVA_CLIENT_ID=<Strava client ID>
STRAVA_CLIENT_SECRET=<Strava client secret>
```

Secrets (JWT_SECRET, STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET) are pushed to **AWS Secrets Manager** by `deploy.sh` on every run — they are never stored in Terraform state or Lambda environment variables.

### First Deploy

```bash
# Deploy prod
./scripts/deploy.sh prod

# Deploy staging (separate AWS account)
./scripts/deploy.sh staging
```

Each deploy runs 7 steps: Terraform init → package Lambdas → upload to S3 → `terraform apply` → force-update Lambda code → push secrets → upload frontend + invalidate CloudFront.

The script outputs the App URL and API URL when complete.

After the first deploy, register the API Gateway domain as the **Authorization Callback Domain** in your Strava app settings (see [Strava App Registration](#strava-app-registration) below), then open the App URL.

### Re-deploy (after code changes)

```bash
./scripts/deploy.sh prod
# or
./scripts/deploy.sh staging
```

The two environments are completely independent — deploying one does not affect the other.

### Seeding Staging with a Prod User

To log into staging without going through Strava OAuth, copy your prod user record to staging and generate a staging JWT:

```bash
./scripts/seed-staging-user.sh
```

This reads `staystacking-users-prod`, copies the user item to `staystacking-users-staging`, and prints a `localStorage.setItem(...)` one-liner to paste into the browser console on the staging URL.

### Teardown

```bash
# Teardown a specific environment
./scripts/teardown.sh [staging|prod]
```

### Strava App Registration

1. Go to https://www.strava.com/settings/api
2. Set **Authorization Callback Domain** = domain from `terraform output api_gateway_url` (no `https://`, no path)
3. Note **Client ID** and **Client Secret** → set as `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` in your `.env.*` files
4. Required OAuth scope: `activity:read_all,activity:write`

### .env File Reference

| Variable | Description | Sensitive |
|---|---|---|
| `AWS_PROFILE` | Named AWS CLI profile for this environment | No |
| `FRONTEND_URL` | Full HTTPS URL of the frontend (CloudFront custom domain) | No |
| `ACM_CERTIFICATE_ARN` | ACM cert ARN in us-east-1 for CloudFront (must be in the same account as the environment) | No |
| `JWT_SECRET` | JWT signing secret (min 32 chars) — different per environment | Yes |
| `STRAVA_CLIENT_ID` | Strava API client ID | Yes |
| `STRAVA_CLIENT_SECRET` | Strava API client secret | Yes |
