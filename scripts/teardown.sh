#!/bin/bash
# =============================================================
# StayStacking — Teardown Script
# Usage: ./scripts/teardown.sh [environment]
#
# WARNING: This destroys ALL infrastructure and data.
# Optional: Export DynamoDB tables before destroy by uncommenting
# the backup section below.
# =============================================================

set -euo pipefail

ENVIRONMENT=${1:-prod}
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load environment-specific .env file (exports AWS_PROFILE, FRONTEND_URL, ACM_CERTIFICATE_ARN)
ENV_FILE="$REPO_ROOT/.env.$ENVIRONMENT"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found."
  exit 1
fi
set -a
source "$ENV_FILE"
set +a

echo "=========================================="
echo " StayStacking TEARDOWN — environment: $ENVIRONMENT"
echo " WARNING: This will destroy all resources!"
echo "=========================================="
echo ""
read -p "Type 'destroy' to confirm: " CONFIRM
if [[ "$CONFIRM" != "destroy" ]]; then
  echo "Aborted."
  exit 0
fi

# --- Optional: Backup DynamoDB tables ---
# Uncomment to export data before destroying:
#
# echo "Backing up DynamoDB tables..."
# TABLES=("users" "activities" "checkins" "training-plan")
# BACKUP_DIR="$REPO_ROOT/backups/$(date +%Y%m%d_%H%M%S)"
# mkdir -p "$BACKUP_DIR"
# for table in "${TABLES[@]}"; do
#   TABLE_NAME="staystacking-${table}-${ENVIRONMENT}"
#   echo "  Exporting $TABLE_NAME..."
#   aws dynamodb scan --table-name "$TABLE_NAME" \
#     --output json > "$BACKUP_DIR/${table}.json" 2>/dev/null || echo "  (skipped — table may not exist)"
# done
# echo "Backups saved to $BACKUP_DIR"

echo ""
echo "Destroying infrastructure..."
cd "$REPO_ROOT/terraform"
terraform init -input=false -reconfigure \
  -backend-config="bucket=staystacking-terraform-state-$ENVIRONMENT" \
  -backend-config="key=terraform.tfstate" \
  -backend-config="region=us-east-1" \
  -backend-config="dynamodb_table=staystacking-terraform-locks-$ENVIRONMENT" \
  -backend-config="encrypt=true"

terraform destroy -auto-approve \
  -var="environment=$ENVIRONMENT" \
  -var="frontend_url_override=$FRONTEND_URL" \
  -var="acm_certificate_arn=$ACM_CERTIFICATE_ARN"

echo ""
echo "=========================================="
echo " Teardown complete."
echo " All AWS resources have been destroyed."
echo "=========================================="
