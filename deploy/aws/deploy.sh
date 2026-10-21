#!/usr/bin/env bash
# Deploy the public "try to break in" page to Amazon ECS Express Mode.
#
#   AWS_REGION=us-east-1 BEDROCK_MODEL_ID=<model id> ALERT_EMAIL=you@example.com ./deploy/aws/deploy.sh
#
# Needs: the AWS CLI v2 (recent enough for `aws ecs create-express-gateway-service`), Docker,
# credentials allowed to manage ECR, IAM, ECS and Budgets, and Bedrock model access for
# BEDROCK_MODEL_ID in AWS_REGION. Safe to re-run: existing roles and the repository are reused.
#
# Written from the AWS CLI documentation; it has not been run from this repository's CI
# (that has no AWS account). Read each step before running it.
set -euo pipefail

: "${AWS_REGION:?set AWS_REGION}"
: "${BEDROCK_MODEL_ID:?set BEDROCK_MODEL_ID to a multimodal model with Converse tool use}"
: "${ALERT_EMAIL:?set ALERT_EMAIL for the spend alerts}"
SERVICE_NAME="${SERVICE_NAME:-homepulse-break-it}"
REPO_NAME="${REPO_NAME:-homepulse}"
DAILY_BUDGET_USD="${DAILY_BUDGET_USD:-10}"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%s)}"
HERE="$(cd "$(dirname "$0")" && pwd)"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE="${REGISTRY}/${REPO_NAME}:${TAG}"
echo "Account ${ACCOUNT_ID}, region ${AWS_REGION}, image ${IMAGE}"

# 1. Build and push the image.
aws ecr describe-repositories --repository-names "${REPO_NAME}" --region "${AWS_REGION}" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "${REPO_NAME}" --region "${AWS_REGION}" >/dev/null
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${REGISTRY}"
docker build --platform linux/amd64 -t "${IMAGE}" "${HERE}/../.."
docker push "${IMAGE}"

# 2. Roles: ECS's two service roles, and a task role that may only call Bedrock models.
ensure_role() { # name, trust-policy-file
  aws iam get-role --role-name "$1" >/dev/null 2>&1 || aws iam create-role --role-name "$1" --assume-role-policy-document "file://$2" >/dev/null
}
ensure_role ecsTaskExecutionRole "${HERE}/trust-ecs-tasks.json"
aws iam attach-role-policy --role-name ecsTaskExecutionRole --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
ensure_role ecsInfrastructureRoleForExpressServices "${HERE}/trust-ecs.json"
aws iam attach-role-policy --role-name ecsInfrastructureRoleForExpressServices --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices
ensure_role homepulseTaskRole "${HERE}/trust-ecs-tasks.json"
aws iam put-role-policy --role-name homepulseTaskRole --policy-name bedrock-invoke-only --policy-document "file://${HERE}/task-role-policy.json"
echo "Waiting 15 s for IAM to settle..."
sleep 15

# 3. The service: one public HTTPS endpoint, a load balancer and auto scaling, from one call.
#    ALLOWED_HOSTS ".ecs.<region>.on.aws" lets the server answer to the endpoint name ECS assigns.
#    Hard caps on spend live in the app: BREAK_IT_PER_HOUR attempts in total, 10 per address.
ENVIRONMENT=$(cat <<JSON
[
  {"name": "MODEL_PROVIDER", "value": "bedrock"},
  {"name": "BEDROCK_MODEL_ID", "value": "${BEDROCK_MODEL_ID}"},
  {"name": "AWS_REGION", "value": "${AWS_REGION}"},
  {"name": "ALLOWED_HOSTS", "value": ".ecs.${AWS_REGION}.on.aws"},
  {"name": "BREAK_IT_PER_HOUR", "value": "${BREAK_IT_PER_HOUR:-300}"},
  {"name": "BREAK_IT_PER_ADDRESS_PER_HOUR", "value": "10"}
]
JSON
)
aws ecs create-express-gateway-service \
  --region "${AWS_REGION}" \
  --service-name "${SERVICE_NAME}" \
  --execution-role-arn "arn:aws:iam::${ACCOUNT_ID}:role/ecsTaskExecutionRole" \
  --infrastructure-role-arn "arn:aws:iam::${ACCOUNT_ID}:role/ecsInfrastructureRoleForExpressServices" \
  --task-role-arn "arn:aws:iam::${ACCOUNT_ID}:role/homepulseTaskRole" \
  --health-check-path "/api/break-it/stats" \
  --primary-container "{\"image\": \"${IMAGE}\", \"containerPort\": 8787, \"environment\": ${ENVIRONMENT}}" \
  --scaling-target '{"minTaskCount": 1, "maxTaskCount": 2}' \
  --query 'service.serviceArn' --output text | tee "${HERE}/.service-arn"

# 4. A daily spend alarm by email: 80% and 100% of DAILY_BUDGET_USD, all services (Bedrock,
#    models billed through AWS Marketplace, ECS and the load balancer). Budgets alerts lag by
#    hours, so the in-app caps above are the real limit.
sed "s/__AMOUNT__/${DAILY_BUDGET_USD}/" "${HERE}/budget.json" > "${HERE}/.budget.json"
sed "s/__EMAIL__/${ALERT_EMAIL}/" "${HERE}/notifications.json" > "${HERE}/.notifications.json"
aws budgets create-budget --account-id "${ACCOUNT_ID}" --budget "file://${HERE}/.budget.json" \
  --notifications-with-subscribers "file://${HERE}/.notifications.json" \
  || echo "(budget not created: it may already exist)"

echo
echo "Service: $(cat "${HERE}/.service-arn")"
echo "When it is ACTIVE, the endpoint is https://<name>.ecs.${AWS_REGION}.on.aws/ :"
echo "  aws ecs describe-express-gateway-service --region ${AWS_REGION} --service-arn \$(cat ${HERE}/.service-arn)"
echo "Open it; \"/\" goes to the break-in page, and its QR code points at itself."
