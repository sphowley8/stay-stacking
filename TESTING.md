# StayStacking — Testing Documentation

## TODO: Tests to Implement

### Unit Tests

#### Backend — Lambda Handlers
- [ ] `shared/weekStart.js` — `getWeekStart()`: verify Monday calculation for all 7 weekdays, including Sunday edge case
- [ ] `shared/weekStart.js` — `getWeekStartNWeeksAgo()`: verify N weeks ago returns correct Monday
- [ ] `shared/auth.js` — `verifyToken()`: valid token returns userId; expired token throws 401; missing header throws 401; tampered token throws 401
- [ ] `shared/auth.js` — `signToken()`: signed token decodes correctly with correct secret; fails with wrong secret
- [ ] `checkin/index.js` — POST: verify partial update (morning fields only doesn't wipe evening fields, and vice versa)
- [ ] `activities/index.js` — GET: verify weekly grouping/summation logic with multi-activity weeks
- [ ] `activities/index.js` — POST /sync: verify TTL set to 56 days from current time
- [ ] `activities/index.js` — cycling HR bias: verify +13 BPM applied to cycling activities before zone assignment
- [ ] `activities/index.js` — HR exclusion: verify samples ≤ 80 BPM are excluded from zone calculations
- [ ] `training-plan/index.js` — date validation regex rejects invalid formats

#### Frontend — app.js
- [ ] `computeLoadIndex()`: aerobic load = sum of zone-weighted HR hours; muscular = pace+power Z3–Z7 weighted + grade G3/G4; structural = run/cycling time + grade G3/G4
- [ ] `computeLoadIndex()`: current partial week uses day-accurate α (`1 - e^(-daysElapsed/window)`) not fixed weekly α
- [ ] `computeLoadIndex()`: ACWR = ATL / CTL; returns null when CTL = 0
- [ ] `getDaysElapsedInWeek()`: returns 1 on Monday, 7 on Sunday, clamps to 1–7
- [ ] `computeRecoveryScore()`: 3-day upward trend → yellow; 5-day upward trend → red; flat/declining → green; <2 data points → unknown
- [ ] `getMondayStr()`: all 7 days of week return same Monday
- [ ] `formatDuration()`: 3600s → "1h 0m"; 90s → "1m"; 0s → "0m"
- [ ] JWT cleared from localStorage on 401 response
- [ ] `costsCacheKey(env)`: returns `costs_cache_v3_prod` / `costs_cache_v3_staging` per env

### Integration Tests

- [ ] Full Strava OAuth flow: `/auth/strava` redirect URL contains correct `client_id`, `redirect_uri`, `scope`
- [ ] `/auth/callback` with valid code: creates user in DynamoDB, returns 302 to frontend with token in hash
- [ ] `/auth/callback` with error param: redirects to `#error=access_denied`
- [ ] POST `/checkin` morning + POST `/checkin` evening on same date → single DynamoDB item with both sets of fields
- [ ] POST `/activities/sync` stores activities with correct `weekStart` and `ttl` attributes
- [ ] POST `/activities/sync` writes `lastSynced` timestamp to users table
- [ ] GET `/activities` returns exactly 8 weeks including weeks with zero activity
- [ ] GET `/costs?env=staging` from prod Lambda: successfully assumes cross-account role and returns staging data
- [ ] GET `/training-plan` returns only entries within the requested date range
- [ ] DELETE `/training-plan/{date}` removes the item; subsequent GET returns no entry for that date
- [ ] JWT authorization: all protected endpoints return 401 with missing/invalid/expired token

### Performance Tests

- [ ] POST `/activities/sync` with 200+ activities (multi-page Strava response): completes within Lambda 30s timeout
- [ ] GET `/activities` with full 8 weeks of data: DynamoDB GSI query response time < 500ms
- [ ] Frontend initial load: page interactive within 3s on slow 3G (Chart.js CDN is the main risk)
- [ ] `computeLoadIndex()` with 8 weeks of data: runs synchronously without blocking UI thread

### Security Tests

- [ ] JWT secret not exposed in any Lambda response or CloudWatch log
- [ ] Strava `accessToken` and `refreshToken` never returned to frontend (GET /user response excludes them)
- [ ] userId from JWT only — verify that sending a different `userId` in request body is ignored
- [ ] CORS: verify requests from non-frontend origin are rejected by API Gateway OPTIONS response
- [ ] DynamoDB: verify user A cannot read user B's data (all queries are keyed by JWT-derived userId)
- [ ] Strava token refresh: rotated refresh token is saved (not discarded) to prevent lock-out
- [ ] Input validation: training-plan date parameter rejects injection attempts (e.g., `../../etc`)
- [ ] Costs endpoint: verify non-admin users cannot access `/costs` (password gate + JWT)
- [ ] Cross-account role: verify staging role cannot be assumed by any principal other than prod Lambda execution role (and vice versa)

### Infrastructure Tests

- [ ] `terraform plan` produces no errors from a clean state
- [ ] S3 frontend bucket: direct S3 URL access is blocked (403); CloudFront access works
- [ ] CloudFront 404 → 200 index.html: navigating to a non-existent path returns the SPA shell
- [ ] DynamoDB TTL: activities older than 56 days are eventually deleted (verify TTL attribute is set correctly)
- [ ] CloudWatch log groups exist with 7-day retention for all Lambda functions
- [ ] Cross-account IAM: `staystacking-costs-cross-account-{env}` role exists in both accounts with correct trust policy

---

## Testing Infrastructure In Place

*None yet — tests to be implemented in a future session.*

When tests are added, document them here:

### Unit Test Setup
*(To be filled in when tests are written)*

### How to Run Tests
*(To be filled in when tests are written)*

---

## Known Testing Gaps / Risks

1. **Strava pagination** — the multi-page fetch in `strava.js` is untested. Athletes with high activity volume could hit Lambda timeout.
2. **Token expiry edge case** — the 5-minute buffer before Strava token refresh is unverified. Could cause a brief window where API calls fail if the buffer is too small.
3. **DynamoDB UpdateCommand with no fields** — the checkin handler validates that at least one field is provided, but edge cases with malformed JSON body are not tested.
4. **Partial week load index accuracy** — day-accurate α values are computed client-side using `Date.now()`; timezone mismatches between client and `weekStart` (stored as UTC Monday) could cause off-by-one errors.
5. **Chart.js CDN dependency** — if the CDN is unavailable, the Progressive Load tab will silently fail. No fallback is implemented.
6. **ACWR cold start** — with only 1–2 weeks of data, ATL/CTL/TSB are unreliable. No minimum data warning is shown to the user.
7. **Cycling HR bias** — the +13 BPM correction is a fixed heuristic. Athletes with unusual HR response to cycling (e.g., due to position, heat, or medication) may see inaccurate zone assignments.
