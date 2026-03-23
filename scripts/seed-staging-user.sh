#!/bin/bash
# =============================================================
# StayStacking — Seed Staging User
# Usage: ./scripts/seed-staging-user.sh
#
# Copies your prod user record to the staging DynamoDB table
# and generates a staging JWT so you can log into staging
# without going through Strava OAuth.
#
# Prerequisites:
#   - .env.prod and .env.staging must exist and be filled in
#   - At least one user record must exist in staystacking-users-prod
#   - Staging must already be deployed (DynamoDB table must exist)
# =============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load prod profile
set -a; source "$REPO_ROOT/.env.prod"; set +a
PROD_PROFILE="$AWS_PROFILE"

# Load staging profile + JWT secret (overwrites AWS_PROFILE)
set -a; source "$REPO_ROOT/.env.staging"; set +a
STAGING_PROFILE="$AWS_PROFILE"
STAGING_JWT_SECRET="$JWT_SECRET"
STAGING_FRONTEND_URL="$FRONTEND_URL"

echo "=========================================="
echo " StayStacking — Seed Staging User"
echo "=========================================="

# --- Find Sean Howley's prod user record (Strava ID 17231934) ---
SEAN_STRAVA_ID="17231934"
echo ""
echo "Finding Sean Howley's record (stravaId=$SEAN_STRAVA_ID) in staystacking-users-prod..."
USER_ITEM=$(aws dynamodb scan \
  --table-name staystacking-users-prod \
  --profile "$PROD_PROFILE" \
  --region us-east-1 \
  --filter-expression "stravaId = :sid" \
  --expression-attribute-values "{\":sid\":{\"N\":\"$SEAN_STRAVA_ID\"}}" \
  --query 'Items[0]' \
  --output json)

if [[ "$USER_ITEM" == "null" || -z "$USER_ITEM" ]]; then
  echo "ERROR: Sean Howley (stravaId=$SEAN_STRAVA_ID) not found in staystacking-users-prod."
  echo "Complete the Strava OAuth flow in prod first."
  exit 1
fi

USER_ID=$(echo "$USER_ITEM" | python3 -c "import sys,json; print(json.load(sys.stdin)['userId']['S'])")
STRAVA_ID=$(echo "$USER_ITEM" | python3 -c "import sys,json; print(json.load(sys.stdin)['stravaId']['N'])")

echo "  userId:   $USER_ID"
echo "  stravaId: $STRAVA_ID"

# --- Seed into staging ---
echo ""
echo "Copying user record to staystacking-users-staging..."
echo "$USER_ITEM" | aws dynamodb put-item \
  --table-name staystacking-users-staging \
  --item file:///dev/stdin \
  --profile "$STAGING_PROFILE" \
  --region us-east-1
echo "  Done."

# --- Generate staging JWT ---
echo ""
echo "Generating staging JWT (30-day expiry)..."
TOKEN=$(JWT_SECRET="$STAGING_JWT_SECRET" node -e "
const crypto = require('crypto');
const secret = process.env.JWT_SECRET;
const userId = '$USER_ID';
const stravaId = $STRAVA_ID;
const now = Math.floor(Date.now() / 1000);
const payload = { userId, stravaId, iat: now, exp: now + 2592000 };
const header = { alg: 'HS256', typ: 'JWT' };
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
const msg = b64url(header) + '.' + b64url(payload);
const sig = crypto.createHmac('sha256', secret).update(msg).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
console.log(msg + '.' + sig);
")

echo ""
echo "=========================================="
echo " Staging user seeded!"
echo ""
echo " Open $STAGING_FRONTEND_URL in your browser,"
echo " open the browser console (Cmd+Option+J),"
echo " and run:"
echo ""
echo "   localStorage.setItem('jwt', '$TOKEN'); location.reload();"
echo "=========================================="
