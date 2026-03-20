#!/bin/bash
# =============================================================
# StayStacking — Full Deploy Script
# Usage: ./scripts/deploy.sh [environment]
# Default environment: prod
#
# Required variables in .env.<environment>:
#   AWS_PROFILE           — Named AWS CLI profile (staging or prod)
#   FRONTEND_URL          — Full frontend URL (e.g. https://stay-stacking.sean-howley.com)
#   ACM_CERTIFICATE_ARN   — ACM cert ARN for CloudFront (must be in us-east-1)
#   JWT_SECRET            — JWT signing secret (min 32 chars)
#   STRAVA_CLIENT_ID      — Strava API client ID
#   STRAVA_CLIENT_SECRET  — Strava API client secret
# =============================================================

set -euo pipefail

ENVIRONMENT=${1:-prod}
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load environment-specific .env file (exports AWS_PROFILE, FRONTEND_URL, ACM_CERTIFICATE_ARN, secrets)
ENV_FILE="$REPO_ROOT/.env.$ENVIRONMENT"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found."
  echo "Create it with: AWS_PROFILE, FRONTEND_URL, ACM_CERTIFICATE_ARN, JWT_SECRET, STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET"
  exit 1
fi
echo "Loading $ENV_FILE..."
set -a
source "$ENV_FILE"
set +a

echo "=========================================="
echo " StayStacking Deploy — environment: $ENVIRONMENT"
echo "=========================================="

# --- Validate required variables ---
MISSING=0
for VAR in JWT_SECRET STRAVA_CLIENT_ID STRAVA_CLIENT_SECRET FRONTEND_URL ACM_CERTIFICATE_ARN AWS_PROFILE; do
  if [[ -z "${!VAR:-}" ]]; then
    echo "ERROR: $VAR is not set"
    MISSING=1
  fi
done
[[ $MISSING -eq 1 ]] && echo "Set missing variables in $ENV_FILE and retry." && exit 1

BACKEND_CONFIG=(
  -backend-config="bucket=staystacking-terraform-state-$ENVIRONMENT"
  -backend-config="key=terraform.tfstate"
  -backend-config="region=us-east-1"
  -backend-config="dynamodb_table=staystacking-terraform-locks-$ENVIRONMENT"
  -backend-config="encrypt=true"
)

TF_VARS=(
  -var="environment=$ENVIRONMENT"
  -var="frontend_url_override=$FRONTEND_URL"
  -var="acm_certificate_arn=$ACM_CERTIFICATE_ARN"
)

# --- Step 1: Provision storage (S3 + CloudFront) ---
echo ""
echo "[1/7] Provisioning storage (S3 + CloudFront)..."
cd "$REPO_ROOT/terraform"
terraform init -input=false -reconfigure "${BACKEND_CONFIG[@]}"

terraform apply -target=module.storage -auto-approve "${TF_VARS[@]}"
DEPLOY_BUCKET=$(terraform output -raw deploy_bucket_name)

# --- Step 2: Package Lambda functions ---
echo ""
echo "[2/7] Packaging Lambda functions..."

LAMBDAS=("auth" "user" "checkin" "activities" "training-plan")
SHARED_DIR="$REPO_ROOT/backend/lambdas/shared"
TMP_DIR=$(mktemp -d)

for lambda in "${LAMBDAS[@]}"; do
  LAMBDA_DIR="$REPO_ROOT/backend/lambdas/$lambda"
  echo "  Packaging $lambda..."

  STAGE="$TMP_DIR/$lambda"
  mkdir -p "$STAGE"

  cp -r "$LAMBDA_DIR/"* "$STAGE/"
  mkdir -p "$STAGE/shared"
  cp "$SHARED_DIR/"*.js "$STAGE/shared/"

  cd "$STAGE"
  npm install --production --silent

  ZIP_FILE="$TMP_DIR/${lambda}.zip"
  zip -r "$ZIP_FILE" . --quiet
  echo "  Created $(basename "$ZIP_FILE") ($(du -sh "$ZIP_FILE" | cut -f1))"
  cd "$REPO_ROOT"
done

# --- Step 3: Upload Lambda zips to S3 ---
echo ""
echo "[3/7] Uploading Lambda packages to S3..."
for lambda in "${LAMBDAS[@]}"; do
  aws s3 cp "$TMP_DIR/${lambda}.zip" "s3://$DEPLOY_BUCKET/${lambda}.zip" --quiet --profile "$AWS_PROFILE"
  echo "  Uploaded ${lambda}.zip"
done

# --- Step 4: Apply full infrastructure ---
echo ""
echo "[4/7] Applying full infrastructure..."
cd "$REPO_ROOT/terraform"
terraform apply -auto-approve "${TF_VARS[@]}"

FRONTEND_BUCKET=$(terraform output -raw frontend_bucket_name)
CLOUDFRONT_ID=$(terraform output -raw cloudfront_distribution_id)
API_URL=$(terraform output -raw api_gateway_url)
APP_URL=$(terraform output -raw app_url)
JWT_SECRET_ARN=$(terraform output -raw jwt_secret_arn)
STRAVA_SECRET_ARN=$(terraform output -raw strava_secret_arn)

# --- Step 5: Push secrets to AWS Secrets Manager ---
echo ""
echo "[5/7] Pushing secrets to AWS Secrets Manager..."

aws secretsmanager put-secret-value \
  --secret-id "$JWT_SECRET_ARN" \
  --secret-string "$JWT_SECRET" \
  --region us-east-1 --profile "$AWS_PROFILE" \
  --output text --query 'Name' | xargs -I{} echo "  Updated: {}"

STRAVA_JSON="{\"client_id\":\"$STRAVA_CLIENT_ID\",\"client_secret\":\"$STRAVA_CLIENT_SECRET\"}"
aws secretsmanager put-secret-value \
  --secret-id "$STRAVA_SECRET_ARN" \
  --secret-string "$STRAVA_JSON" \
  --region us-east-1 --profile "$AWS_PROFILE" \
  --output text --query 'Name' | xargs -I{} echo "  Updated: {}"

echo "  Secrets stored in Secrets Manager (not in Lambda env vars)"

# --- Step 6: Build and upload frontend ---
echo ""
echo "[6/7] Deploying frontend..."

FRONTEND_TMP="$TMP_DIR/frontend"
cp -r "$REPO_ROOT/frontend/." "$FRONTEND_TMP/"
sed "s|__API_URL__|$API_URL|g" "$REPO_ROOT/frontend/app.js" > "$FRONTEND_TMP/app.js"
# Staging banner: show in staging, hide in prod
if [[ "$ENVIRONMENT" == "staging" ]]; then
  sed -i '' "s|__STAGING_BANNER__|staging-banner|g" "$FRONTEND_TMP/index.html"
else
  sed -i '' "s|__STAGING_BANNER__|staging-banner hidden|g" "$FRONTEND_TMP/index.html"
fi

aws s3 sync "$FRONTEND_TMP/" "s3://$FRONTEND_BUCKET/" \
  --delete \
  --cache-control "max-age=300" \
  --quiet --profile "$AWS_PROFILE"

echo "  Frontend uploaded to s3://$FRONTEND_BUCKET/"

# --- Step 7: Invalidate CloudFront cache ---
echo ""
echo "[7/7] Invalidating CloudFront cache..."
aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_ID" \
  --paths "/*" \
  --profile "$AWS_PROFILE" \
  --output text --query 'Invalidation.Id' | xargs -I{} echo "  Invalidation ID: {}"

# --- Cleanup ---
rm -rf "$TMP_DIR"

# --- Summary ---
echo ""
echo "=========================================="
echo " Deploy complete!"
echo ""
echo " App URL:     $APP_URL"
echo " API URL:     $API_URL"
echo ""
echo " Next steps:"
echo "  1. Register Strava app at https://www.strava.com/settings/api"
echo "     Authorization Callback Domain: $(echo "$API_URL" | sed 's|https://||' | cut -d'/' -f1)"
echo "  2. Open $APP_URL and click 'Connect with Strava'"
echo "=========================================="
