# Reusable submodule: wires a single HTTP method + OPTIONS to a Lambda

variable "rest_api_id" { type = string }
variable "resource_id" { type = string }
variable "http_method" { type = string }
variable "lambda_arn"  { type = string }
variable "frontend_url" { type = string }

variable "create_options" {
  type    = bool
  default = true
  description = "Set to false when another route module already created OPTIONS on this resource."
}

# --- Main method ---

resource "aws_api_gateway_method" "main" {
  rest_api_id   = var.rest_api_id
  resource_id   = var.resource_id
  http_method   = var.http_method
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "main" {
  rest_api_id             = var.rest_api_id
  resource_id             = var.resource_id
  http_method             = aws_api_gateway_method.main.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_arn
}

# --- OPTIONS method for CORS preflight ---

resource "aws_api_gateway_method" "options" {
  count         = var.create_options ? 1 : 0
  rest_api_id   = var.rest_api_id
  resource_id   = var.resource_id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options" {
  count       = var.create_options ? 1 : 0
  rest_api_id = var.rest_api_id
  resource_id = var.resource_id
  http_method = aws_api_gateway_method.options[0].http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "options" {
  count       = var.create_options ? 1 : 0
  rest_api_id = var.rest_api_id
  resource_id = var.resource_id
  http_method = aws_api_gateway_method.options[0].http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = {
    "application/json" = "Empty"
  }
}

resource "aws_api_gateway_integration_response" "options" {
  count       = var.create_options ? 1 : 0
  rest_api_id = var.rest_api_id
  resource_id = var.resource_id
  http_method = aws_api_gateway_method.options[0].http_method
  status_code = aws_api_gateway_method_response.options[0].status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Authorization,Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.frontend_url}'"
  }
}
