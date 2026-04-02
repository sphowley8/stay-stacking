# -------------------------------------------------------
# IAM Role for all Lambda functions
# -------------------------------------------------------

resource "aws_iam_role" "lambda_exec" {
  name = "staystacking-lambda-exec-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "dynamodb_access" {
  name = "staystacking-dynamodb-${var.environment}"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ]
      Resource = [
        var.users_table_arn,
        "${var.users_table_arn}/index/*",
        var.activities_table_arn,
        "${var.activities_table_arn}/index/*",
        var.checkins_table_arn,
        "${var.checkins_table_arn}/index/*",
        var.training_plan_table_arn,
        "${var.training_plan_table_arn}/index/*"
      ]
    }]
  })
}

# -------------------------------------------------------
# Secrets Manager — secret containers
# Values are pushed by deploy.sh, not managed by Terraform
# -------------------------------------------------------

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "staystacking/jwt-secret-${var.environment}"
  description             = "JWT signing secret for StayStacking"
  recovery_window_in_days = 0 # Allow immediate deletion on terraform destroy

  tags = {
    Project     = "staystacking"
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret" "strava" {
  name                    = "staystacking/strava-credentials-${var.environment}"
  description             = "Strava API client_id and client_secret for StayStacking"
  recovery_window_in_days = 0

  tags = {
    Project     = "staystacking"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy" "secrets_access" {
  name = "staystacking-secrets-${var.environment}"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.jwt.arn,
        aws_secretsmanager_secret.strava.arn,
      ]
    }]
  })
}

resource "aws_iam_role_policy" "cost_explorer_access" {
  name = "staystacking-cost-explorer-${var.environment}"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ce:GetCostAndUsage"]
      Resource = "*"
    }]
  })
}

# -------------------------------------------------------
# Cross-account role — allows the PEER Lambda to query
# this account's Cost Explorer + users table
# -------------------------------------------------------

resource "aws_iam_role" "costs_cross_account" {
  name = "staystacking-costs-cross-account-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::${var.peer_account_id}:root" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "costs_cross_account_policy" {
  name = "staystacking-costs-cross-account-policy-${var.environment}"
  role = aws_iam_role.costs_cross_account.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ce:GetCostAndUsage"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:Scan"]
        Resource = [var.users_table_arn]
      }
    ]
  })
}

# Allow THIS Lambda execution role to assume the cross-account role in the peer account
resource "aws_iam_role_policy" "sts_assume_peer" {
  name = "staystacking-sts-assume-peer-${var.environment}"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sts:AssumeRole"]
      Resource = "arn:aws:iam::${var.peer_account_id}:role/staystacking-costs-cross-account-${var.peer_environment}"
    }]
  })
}

# -------------------------------------------------------
# CloudWatch Log Groups (7-day retention)
# -------------------------------------------------------

resource "aws_cloudwatch_log_group" "auth" {
  name              = "/aws/lambda/staystacking-auth-${var.environment}"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "user" {
  name              = "/aws/lambda/staystacking-user-${var.environment}"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "checkin" {
  name              = "/aws/lambda/staystacking-checkin-${var.environment}"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "activities" {
  name              = "/aws/lambda/staystacking-activities-${var.environment}"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "training_plan" {
  name              = "/aws/lambda/staystacking-training-plan-${var.environment}"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "costs" {
  name              = "/aws/lambda/staystacking-costs-${var.environment}"
  retention_in_days = 7
}

# -------------------------------------------------------
# Lambda Functions
# -------------------------------------------------------

locals {
  common_env = {
    SECRET_JWT_ARN           = aws_secretsmanager_secret.jwt.arn
    SECRET_STRAVA_ARN        = aws_secretsmanager_secret.strava.arn
    USERS_TABLE              = var.users_table_name
    ACTIVITIES_TABLE         = var.activities_table_name
    CHECKINS_TABLE           = var.checkins_table_name
    TRAINING_PLAN_TABLE      = var.training_plan_table_name
    FRONTEND_URL             = var.frontend_url
  }
}

resource "aws_lambda_function" "auth" {
  function_name = "staystacking-auth-${var.environment}"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.lambda_exec.arn
  timeout       = 30
  s3_bucket     = var.deploy_bucket_name
  s3_key        = "auth.zip"
  environment { variables = local.common_env }
  depends_on    = [aws_cloudwatch_log_group.auth]
}

resource "aws_lambda_function" "user" {
  function_name = "staystacking-user-${var.environment}"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.lambda_exec.arn
  timeout       = 30
  s3_bucket     = var.deploy_bucket_name
  s3_key        = "user.zip"
  environment { variables = local.common_env }
  depends_on    = [aws_cloudwatch_log_group.user]
}

resource "aws_lambda_function" "checkin" {
  function_name = "staystacking-checkin-${var.environment}"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.lambda_exec.arn
  timeout       = 30
  s3_bucket     = var.deploy_bucket_name
  s3_key        = "checkin.zip"
  environment { variables = local.common_env }
  depends_on    = [aws_cloudwatch_log_group.checkin]
}

resource "aws_lambda_function" "activities" {
  function_name = "staystacking-activities-${var.environment}"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.lambda_exec.arn
  timeout       = 30
  s3_bucket     = var.deploy_bucket_name
  s3_key        = "activities.zip"
  environment { variables = local.common_env }
  depends_on    = [aws_cloudwatch_log_group.activities]
}

resource "aws_lambda_function" "training_plan" {
  function_name = "staystacking-training-plan-${var.environment}"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.lambda_exec.arn
  timeout       = 30
  s3_bucket     = var.deploy_bucket_name
  s3_key        = "training-plan.zip"
  environment { variables = local.common_env }
  depends_on    = [aws_cloudwatch_log_group.training_plan]
}

resource "aws_lambda_function" "costs" {
  function_name = "staystacking-costs-${var.environment}"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.lambda_exec.arn
  timeout       = 30
  s3_bucket     = var.deploy_bucket_name
  s3_key        = "costs.zip"
  environment {
    variables = {
      SECRET_JWT_ARN   = aws_secretsmanager_secret.jwt.arn
      FRONTEND_URL     = var.frontend_url
      USERS_TABLE      = var.users_table_name
      ENVIRONMENT      = var.environment
      PEER_ROLE_ARN    = "arn:aws:iam::${var.peer_account_id}:role/staystacking-costs-cross-account-${var.peer_environment}"
      PEER_USERS_TABLE = "staystacking-users-${var.peer_environment}"
    }
  }
  depends_on = [aws_cloudwatch_log_group.costs]
}

# -------------------------------------------------------
# API Gateway REST API
# -------------------------------------------------------

resource "aws_api_gateway_rest_api" "main" {
  name        = "staystacking-api-${var.environment}"
  description = "StayStacking API"
}

# -------------------------------------------------------
# Helper: reusable CORS response headers
# -------------------------------------------------------

locals {
  cors_response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
  cors_integration_response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Authorization,Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.frontend_url}'"
  }
}

# -------------------------------------------------------
# /auth resource
# -------------------------------------------------------

resource "aws_api_gateway_resource" "auth" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "auth"
}

resource "aws_api_gateway_resource" "auth_strava" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.auth.id
  path_part   = "strava"
}

resource "aws_api_gateway_resource" "auth_callback" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.auth.id
  path_part   = "callback"
}

module "auth_strava_get" {
  source      = "./route"
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.auth_strava.id
  http_method = "GET"
  lambda_arn  = aws_lambda_function.auth.invoke_arn
  frontend_url = var.frontend_url
}

module "auth_callback_get" {
  source      = "./route"
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.auth_callback.id
  http_method = "GET"
  lambda_arn  = aws_lambda_function.auth.invoke_arn
  frontend_url = var.frontend_url
}

# -------------------------------------------------------
# /user resource
# -------------------------------------------------------

resource "aws_api_gateway_resource" "user" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "user"
}

module "user_get" {
  source      = "./route"
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.user.id
  http_method = "GET"
  lambda_arn  = aws_lambda_function.user.invoke_arn
  frontend_url = var.frontend_url
}

module "user_post" {
  source         = "./route"
  rest_api_id    = aws_api_gateway_rest_api.main.id
  resource_id    = aws_api_gateway_resource.user.id
  http_method    = "POST"
  lambda_arn     = aws_lambda_function.user.invoke_arn
  frontend_url   = var.frontend_url
  create_options = false
}

# -------------------------------------------------------
# /checkin resource
# -------------------------------------------------------

resource "aws_api_gateway_resource" "checkin" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "checkin"
}

module "checkin_get" {
  source      = "./route"
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.checkin.id
  http_method = "GET"
  lambda_arn  = aws_lambda_function.checkin.invoke_arn
  frontend_url = var.frontend_url
}

module "checkin_post" {
  source         = "./route"
  rest_api_id    = aws_api_gateway_rest_api.main.id
  resource_id    = aws_api_gateway_resource.checkin.id
  http_method    = "POST"
  lambda_arn     = aws_lambda_function.checkin.invoke_arn
  frontend_url   = var.frontend_url
  create_options = false
}

# -------------------------------------------------------
# /activities resource
# -------------------------------------------------------

resource "aws_api_gateway_resource" "activities" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "activities"
}

module "activities_get" {
  source      = "./route"
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.activities.id
  http_method = "GET"
  lambda_arn  = aws_lambda_function.activities.invoke_arn
  frontend_url = var.frontend_url
}

resource "aws_api_gateway_resource" "activities_sync" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.activities.id
  path_part   = "sync"
}

module "activities_sync_post" {
  source      = "./route"
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.activities_sync.id
  http_method = "POST"
  lambda_arn  = aws_lambda_function.activities.invoke_arn
  frontend_url = var.frontend_url
}

resource "aws_api_gateway_resource" "activities_manual" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.activities.id
  path_part   = "manual"
}

module "activities_manual_post" {
  source       = "./route"
  rest_api_id  = aws_api_gateway_rest_api.main.id
  resource_id  = aws_api_gateway_resource.activities_manual.id
  http_method  = "POST"
  lambda_arn   = aws_lambda_function.activities.invoke_arn
  frontend_url = var.frontend_url
}

module "activities_manual_get" {
  source         = "./route"
  rest_api_id    = aws_api_gateway_rest_api.main.id
  resource_id    = aws_api_gateway_resource.activities_manual.id
  http_method    = "GET"
  lambda_arn     = aws_lambda_function.activities.invoke_arn
  frontend_url   = var.frontend_url
  create_options = false
}

resource "aws_api_gateway_resource" "activities_manual_id" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.activities_manual.id
  path_part   = "{activityId}"
}

module "activities_manual_delete" {
  source         = "./route"
  rest_api_id    = aws_api_gateway_rest_api.main.id
  resource_id    = aws_api_gateway_resource.activities_manual_id.id
  http_method    = "DELETE"
  lambda_arn     = aws_lambda_function.activities.invoke_arn
  frontend_url   = var.frontend_url
  create_options = true
}

# -------------------------------------------------------
# /training-plan resource
# -------------------------------------------------------

resource "aws_api_gateway_resource" "training_plan" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "training-plan"
}

module "training_plan_get" {
  source      = "./route"
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.training_plan.id
  http_method = "GET"
  lambda_arn  = aws_lambda_function.training_plan.invoke_arn
  frontend_url = var.frontend_url
}

resource "aws_api_gateway_resource" "training_plan_date" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.training_plan.id
  path_part   = "{date}"
}

module "training_plan_date_post" {
  source      = "./route"
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.training_plan_date.id
  http_method = "POST"
  lambda_arn  = aws_lambda_function.training_plan.invoke_arn
  frontend_url = var.frontend_url
}

module "training_plan_date_delete" {
  source         = "./route"
  rest_api_id    = aws_api_gateway_rest_api.main.id
  resource_id    = aws_api_gateway_resource.training_plan_date.id
  http_method    = "DELETE"
  lambda_arn     = aws_lambda_function.training_plan.invoke_arn
  frontend_url   = var.frontend_url
  create_options = false
}

# /costs
resource "aws_api_gateway_resource" "costs" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "costs"
}

module "costs_get" {
  source       = "./route"
  rest_api_id  = aws_api_gateway_rest_api.main.id
  resource_id  = aws_api_gateway_resource.costs.id
  http_method  = "GET"
  lambda_arn   = aws_lambda_function.costs.invoke_arn
  frontend_url = var.frontend_url
}

# -------------------------------------------------------
# Lambda Permissions (allow API Gateway to invoke)
# -------------------------------------------------------

resource "aws_lambda_permission" "auth" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "user" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.user.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "checkin" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.checkin.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "activities" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.activities.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "training_plan" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.training_plan.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "costs" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.costs.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

# -------------------------------------------------------
# API Gateway Deployment
# -------------------------------------------------------

resource "aws_api_gateway_deployment" "main" {
  rest_api_id = aws_api_gateway_rest_api.main.id

  # Force redeploy when any route changes
  triggers = {
    redeployment = sha1(jsonencode([
      var.frontend_url,
      module.auth_strava_get,
      module.auth_callback_get,
      module.user_get,
      module.user_post,
      module.checkin_get,
      module.checkin_post,
      module.activities_get,
      module.activities_sync_post,
      module.activities_manual_post,
      module.activities_manual_get,
      module.activities_manual_delete,
      module.training_plan_get,
      module.training_plan_date_post,
      module.training_plan_date_delete,
      module.costs_get,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "main" {
  deployment_id = aws_api_gateway_deployment.main.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  stage_name    = var.environment
}
