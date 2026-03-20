output "app_url" {
  description = "Custom domain URL for the frontend application"
  value       = var.frontend_url_override
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (needed for cache invalidation)"
  value       = module.storage.cloudfront_distribution_id
}

output "api_gateway_url" {
  description = "API Gateway invoke URL (register this domain with Strava)"
  value       = module.api.api_gateway_url
}

output "frontend_bucket_name" {
  description = "S3 bucket name for frontend static files"
  value       = module.storage.frontend_bucket_name
}

output "deploy_bucket_name" {
  description = "S3 bucket name for Lambda deployment packages"
  value       = module.storage.deploy_bucket_name
}

output "jwt_secret_arn" {
  description = "ARN of the JWT secret in Secrets Manager (used by deploy.sh)"
  value       = module.api.jwt_secret_arn
}

output "strava_secret_arn" {
  description = "ARN of the Strava credentials secret in Secrets Manager (used by deploy.sh)"
  value       = module.api.strava_secret_arn
}
