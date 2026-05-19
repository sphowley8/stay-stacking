output "api_gateway_url" {
  value = "${aws_api_gateway_stage.main.invoke_url}"
}

output "api_gateway_id" {
  value = aws_api_gateway_rest_api.main.id
}

output "jwt_secret_arn" {
  value       = aws_secretsmanager_secret.jwt.arn
  description = "ARN of the JWT signing secret in Secrets Manager"
}

output "strava_secret_arn" {
  value       = aws_secretsmanager_secret.strava.arn
  description = "ARN of the Strava credentials secret in Secrets Manager"
}

output "external_api_key_secret_arn" {
  value       = aws_secretsmanager_secret.external_api_key.arn
  description = "ARN of the external API key secret in Secrets Manager"
}
