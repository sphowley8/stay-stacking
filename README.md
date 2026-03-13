# StayStacking

> Fitness compounds when consistency compounds. Keep stacking healthy training blocks.

StayStacking is a serverless web application for endurance athletes that tracks training load across three physiological systems — aerobic, muscular, and injury — to prevent overuse injuries and enable long-term progressive fitness.

---

## Purpose

Endurance athletes often track volume (mileage, vert, time) but not **load density** — the compounding stress across cardiovascular, muscular, and tendon systems. StayStacking answers one question: *Is my body adapting or becoming more reactive?*

The app connects to Strava to pull activity data and overlays manual daily check-ins (stiffness, pain, recovery tools) to give a holistic view of training load over rolling 8-week windows.

---

## Repo Structure

```
stay-stacking/
│
├── frontend/
│   ├── index.html          Single-page app shell with all tab panels and modal
│   ├── styles.css          All styles using the earthy color palette
│   └── app.js              All app logic: state, API calls, Chart.js, calendar
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
│           ├── main.tf     Lambda functions + API Gateway + IAM
│           └── route/      Reusable submodule: HTTP method + OPTIONS CORS
│
├── scripts/
│   ├── deploy.sh           Full deploy: package lambdas → terraform → upload frontend
│   └── teardown.sh         terraform destroy with confirmation (optional DynamoDB backup)
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
  ├── HTTPS → CloudFront (CDN)
  │             └── S3 (static files: index.html, styles.css, app.js)
  │
  └── HTTPS → API Gateway (REST)
                ├── /auth/*          → Lambda: auth
                ├── /user            → Lambda: user
                ├── /checkin         → Lambda: checkin
                ├── /activities/*    → Lambda: activities
                └── /training-plan/* → Lambda: training-plan
                        │
                        ├── DynamoDB (4 tables)
                        └── Strava API (external)
```

**Cost profile:** Entirely serverless. For personal use, monthly cost is near $0 (Lambda + API Gateway + DynamoDB all have generous free tiers; CloudFront + S3 very cheap for low traffic).

### DynamoDB Tables

| Table | PK | SK | Notes |
|---|---|---|---|
| `staystacking-users-{env}` | userId (S) | — | GSI on stravaId; stores tokens |
| `staystacking-activities-{env}` | userId (S) | activityId (S) | GSI on weekStart; TTL = 56 days |
| `staystacking-checkins-{env}` | userId (S) | date (YYYY-MM-DD) | Morning + evening in one item |
| `staystacking-training-plan-{env}` | userId (S) | date (YYYY-MM-DD) | Planned distance/elevation/time |

### Auth Flow

1. User clicks "Connect with Strava" → `GET /auth/strava` → redirect to Strava OAuth
2. Strava redirects to `GET /auth/callback?code=...`
3. Lambda exchanges code for tokens, creates/updates user in DynamoDB
4. Lambda issues a 30-day JWT → redirects to `FRONTEND_URL/#token={jwt}`
5. Frontend stores JWT in `localStorage`; all subsequent calls include `Authorization: Bearer {jwt}`

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
./scripts/deploy.sh

# 3. The script outputs:
#    App URL:  https://xxxx.cloudfront.net
#    API URL:  https://xxxx.execute-api.us-east-1.amazonaws.com/prod
```

After first deploy, register the API Gateway domain as the **Authorization Callback Domain** in your Strava app settings, then open the App URL.

### Re-deploy (after code changes)

```bash
# Re-run the full deploy script — it re-packages lambdas and re-syncs frontend
./scripts/deploy.sh
```

### Teardown

```bash
# Destroys all AWS resources. Uncomment backup section in teardown.sh first if needed.
./scripts/teardown.sh
```

### Strava App Registration

1. Go to https://www.strava.com/settings/api
2. Create a new application
3. Set **Authorization Callback Domain** = the domain from `terraform output api_gateway_url` (no `https://`, no path)
4. Note the **Client ID** and **Client Secret** → these are `TF_VAR_strava_client_id` and `TF_VAR_strava_client_secret`
5. Required OAuth scope: `activity:read_all`

### Environment Variables (Terraform)

| Variable | Description | Sensitive |
|---|---|---|
| `TF_VAR_region` | AWS region (default: us-east-1) | No |
| `TF_VAR_environment` | Environment name (default: prod) | No |
| `TF_VAR_jwt_secret` | JWT signing secret (min 32 chars) | Yes |
| `TF_VAR_strava_client_id` | Strava API client ID | Yes |
| `TF_VAR_strava_client_secret` | Strava API client secret | Yes |
