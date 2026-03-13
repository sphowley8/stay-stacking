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
terraform init -input=false
terraform destroy -auto-approve -var="environment=$ENVIRONMENT"

echo ""
echo "=========================================="
echo " Teardown complete."
echo " All AWS resources have been destroyed."
echo "=========================================="
