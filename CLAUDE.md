# StayStacking — Claude Session Notes

## Agent Instructions
- Update this file after each session when there are significant design changes or architectural decisions.
- Keep this file under 200 lines.
- After editing code: update README.md (Purpose/Repo Structure/Usage/Architecture) and TESTING.md (new testable features).

## Project Summary
StayStacking is a serverless web app for endurance athletes to track training load (aerobic, muscular, injury) and prevent overuse injuries by stacking healthy training blocks.

## Current Build State (2026-03-09)
Deployed and live at **https://stay-stacking.sean-howley.com**. Custom domain via Route 53 alias → StayStacking CloudFront (E12XYON91KGED8) with `*.sean-howley.com` wildcard cert (ACM). FRONTEND_URL on all Lambdas updated to custom domain.

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
3. **Activities TTL = 56 days** — DynamoDB auto-deletes old activity records; query always filters by `weekStart >= 8-weeks-ago` (don't rely on TTL for reads).
4. **Strava token refresh** — done in-band in the activities Lambda before every Strava API call; both access+refresh tokens updated (Strava rotates them).
5. **Calendar ACTUAL tab** — currently shows weekly aggregates on Monday; to show per-day data, activities endpoint would need a day-level endpoint.
6. **CORS** — Lambda responses include `Access-Control-Allow-Origin: {FRONTEND_URL}`. API Gateway has OPTIONS mock integrations via the `route` submodule.

## Repo Structure
```
frontend/           Vanilla SPA (index.html, styles.css, app.js)
backend/lambdas/
  shared/           Shared utilities (auth.js, dynamo.js, strava.js, weekStart.js)
  auth/             Strava OAuth + JWT issuance
  user/             User profile + injury toggle
  checkin/          Daily morning/evening check-in
  activities/       Strava sync + weekly aggregation
  training-plan/    6-week plan CRUD
terraform/
  modules/database/ DynamoDB tables
  modules/storage/  S3 + CloudFront
  modules/api/      API Gateway + Lambdas + IAM
    route/          Reusable submodule: HTTP method + OPTIONS CORS
scripts/
  deploy.sh         Full deploy pipeline
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
GET  /training-plan          Protected — 6-week window
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
6. Run: `./scripts/deploy.sh`

## Strava App Registration
- Authorization Callback Domain = API Gateway domain from `terraform output api_gateway_url`
- Required scope: `activity:read_all`
