# StayStacking — Claude Session Notes

## Agent Instructions
- Update this file after each session when there are significant design changes or architectural decisions.
- Keep this file under 200 lines.
- After editing code: update README.md (Purpose/Repo Structure/Usage/Architecture) and TESTING.md (new testable features).

## Project Summary
StayStacking is a serverless web app for endurance athletes to track training load (aerobic, muscular, structural) and prevent overuse injuries by stacking healthy training blocks.

## Current Build State (2026-04-01)
Deployed and live at **https://stay-stacking.sean-howley.com**. Custom domain via Route 53 alias → StayStacking CloudFront (E12XYON91KGED8) with `*.sean-howley.com` wildcard cert (ACM).

## Tech Stack
- **Frontend:** Vanilla HTML/CSS/JS + Chart.js (CDN). Single file app.js with global state object.
- **Backend:** AWS Lambda (Node.js 20.x) + API Gateway REST
- **Database:** DynamoDB (4 tables, PAY_PER_REQUEST, TTL on activities table)
- **Hosting:** S3 + CloudFront (OAC)
- **IaC:** Terraform ~> 5.0 provider, modular layout
- **Auth:** Strava OAuth → JWT (30-day, HS256, stored in localStorage)

## Key Architectural Decisions
1. **No Cognito** — custom JWT via `jsonwebtoken` to keep costs near-zero.
2. **Secrets in AWS Secrets Manager** — JWT secret and Strava credentials are never in Lambda env vars or Terraform state. Terraform creates the secret containers; `deploy.sh` pushes the values via AWS CLI. Lambdas fetch + cache secrets on cold start via `shared/secrets.js`.
3. **API URL injected by deploy.sh** — `__API_URL__` placeholder in app.js replaced with `sed` during deploy.
4. **Activities TTL = 56 days** — DynamoDB auto-deletes old activity records; query always filters by `weekStart >= 8-weeks-ago` (don't rely on TTL for reads).
5. **Strava token refresh** — done in-band in the activities Lambda before every Strava API call; both access+refresh tokens updated (Strava rotates them).
6. **Cycling HR bias** — +13 BPM added to all HR samples during cycling activities before zone assignment, to normalize cycling vs running HR zones. Samples ≤ 80 BPM excluded entirely.
7. **CORS** — Lambda responses include `Access-Control-Allow-Origin: {FRONTEND_URL}`. API Gateway has OPTIONS mock integrations via the `route` submodule.
8. **Cross-account costs** — costs Lambda uses STS AssumeRole to query Cost Explorer and DynamoDB in the peer account (prod↔staging). Each account has a `staystacking-costs-cross-account-{env}` IAM role.

## Active Tabs
- **Injury Check-In** — daily morning/evening check-in for stiffness, pain, recovery tools
- **Progressive Load** — 8-week chart + Training Load Index (ATL/CTL/TSB/ACWR per category)
- **Activity Log** — manually log activities to Strava; registry with delete; feeds load charts

## Training Load Index
Three load categories, each with ATL (7-day EMA), CTL (42-day EMA), TSB, and ACWR:
- **Aerobic:** HR zones Z1–Z5, weights ×1/×2/×3/×5/×8
- **Muscular:** Pace Z3–Z7 (×1/×2/×3/×5/×8) + Power Z3–Z7 (×1/×2/×3/×5/×8) + Grade G3 (×1) + Grade G4 (×2)
- **Structural:** Run time hrs (×3) + Cycling time hrs (×1) + Grade G3 hrs (×10) + Grade G4 hrs (×5)

EMA decay uses day-accurate α for the current partial week: `α = 1 - e^(-daysElapsed/window)`.

ACWR thresholds: < 0.8 low, 0.8–1.3 sweet spot, 1.3–1.5 caution, > 1.5 danger (badge override).

## Repo Structure
```
frontend/           Vanilla SPA (index.html, styles.css, app.js)
backend/lambdas/
  shared/           Shared utilities (auth.js, dynamo.js, strava.js, weekStart.js)
  auth/             Strava OAuth + JWT issuance
  user/             User profile + injury toggle
  checkin/          Daily morning/evening check-in
  activities/       Strava sync + weekly aggregation
  costs/            AWS Cost Explorer + user count (prod/staging toggle via STS)
  training-plan/    6-week plan CRUD (backend complete; UI disabled)
terraform/
  modules/database/ DynamoDB tables
  modules/storage/  S3 + CloudFront
  modules/api/      API Gateway + Lambdas + IAM + cross-account roles
    route/          Reusable submodule: HTTP method + OPTIONS CORS
scripts/
  deploy.sh         Full deploy pipeline
  seed-staging-user.sh  Seeds a prod user into staging DynamoDB
  teardown.sh       terraform destroy with confirmation
```

## DynamoDB Tables
| Table | PK | SK | TTL |
|---|---|---|---|
| staystacking-users-{env} | userId | — | No |
| staystacking-activities-{env} | userId | activityId | ttl (56d) |
| staystacking-checkins-{env} | userId | date | No |
| staystacking-training-plan-{env} | userId | date | No |

## API Routes
```
GET  /auth/strava            Public — redirect to Strava OAuth
GET  /auth/callback          Public — exchange code, issue JWT
GET  /user                   Protected
POST /user                   Protected — update injuryActive
GET  /checkin?days=N         Protected
POST /checkin                Protected — partial update (morning or evening)
GET  /activities             Protected — 8-week weekly aggregates
POST /activities/sync        Protected — fetch from Strava + store
POST /activities/manual      Protected — create manual activity (posts to Strava, stores in DDB)
GET  /activities/manual      Protected — list manually logged activities (isManual=true)
DELETE /activities/manual/{activityId}  Protected — delete from Strava + DDB
GET  /costs?env=prod|staging Protected — AWS costs + user list (admin only)
GET  /training-plan          Protected — 6-week window (backend only; UI replaced by Activity Log)
POST /training-plan/{date}   Protected
DELETE /training-plan/{date} Protected
```

## Deploy Prerequisites
1. AWS CLI configured (`aws configure`)
2. Terraform installed (`terraform -v`)
3. Node.js installed (for Lambda packaging)
4. Strava API app at https://www.strava.com/settings/api
5. Set env vars in `.env` (gitignored):
   ```
   JWT_SECRET="<random 32+ char string>"
   STRAVA_CLIENT_ID="<Strava client ID>"
   STRAVA_CLIENT_SECRET="<Strava client secret>"
   ```
6. Run: `./scripts/deploy.sh [staging|prod]`

## Strava App Registration
- Authorization Callback Domain = API Gateway domain from `terraform output api_gateway_url`
- Required scope: `activity:read_all,activity:write` (write scope added for manual activity creation)
- Users without write scope get an inline re-auth prompt inside the Log Activity modal
