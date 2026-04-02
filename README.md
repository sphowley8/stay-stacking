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

## Usage

### Prerequisites

- AWS CLI installed and configured (`aws configure`)
- Terraform ≥ 1.3 installed
- Node.js ≥ 18 installed (for Lambda packaging)
- A Strava API app created at https://www.strava.com/settings/api

### First Deploy

```bash
# 1. Set required secrets (never commit these)
export TF_VAR_jwt_secret="$(openssl rand -base64 32)"
export TF_VAR_strava_client_id="YOUR_STRAVA_CLIENT_ID"
export TF_VAR_strava_client_secret="YOUR_STRAVA_CLIENT_SECRET"

# 2. Deploy everything
./scripts/deploy.sh [staging|prod]

# 3. The script outputs:
#    App URL:  https://stay-stacking.sean-howley.com
#    API URL:  https://xxxx.execute-api.us-east-1.amazonaws.com/prod
```

After first deploy, register the API Gateway domain as the **Authorization Callback Domain** in your Strava app settings, then open the App URL.

### Re-deploy (after code changes)

```bash
./scripts/deploy.sh [staging|prod]
```

### Teardown

```bash
./scripts/teardown.sh
```

### Strava App Registration

1. Go to https://www.strava.com/settings/api
2. Set **Authorization Callback Domain** = domain from `terraform output api_gateway_url` (no `https://`, no path)
3. Note **Client ID** and **Client Secret** → used as `TF_VAR_strava_client_id` / `TF_VAR_strava_client_secret`
4. Required OAuth scope: `activity:read_all`

### Environment Variables (Terraform)

| Variable | Description | Sensitive |
|---|---|---|
| `TF_VAR_region` | AWS region (default: us-east-1) | No |
| `TF_VAR_environment` | Environment name (staging or prod) | No |
| `TF_VAR_jwt_secret` | JWT signing secret (min 32 chars) | Yes |
| `TF_VAR_strava_client_id` | Strava API client ID | Yes |
| `TF_VAR_strava_client_secret` | Strava API client secret | Yes |
