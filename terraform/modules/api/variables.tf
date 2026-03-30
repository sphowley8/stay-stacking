variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "frontend_url" {
  description = "CloudFront URL for the frontend (used in CORS and OAuth redirect)"
  type        = string
}

variable "users_table_name" {
  description = "DynamoDB users table name"
  type        = string
}

variable "users_table_arn" {
  description = "DynamoDB users table ARN"
  type        = string
}

variable "activities_table_name" {
  description = "DynamoDB activities table name"
  type        = string
}

variable "activities_table_arn" {
  description = "DynamoDB activities table ARN"
  type        = string
}

variable "checkins_table_name" {
  description = "DynamoDB checkins table name"
  type        = string
}

variable "checkins_table_arn" {
  description = "DynamoDB checkins table ARN"
  type        = string
}

variable "training_plan_table_name" {
  description = "DynamoDB training plan table name"
  type        = string
}

variable "training_plan_table_arn" {
  description = "DynamoDB training plan table ARN"
  type        = string
}

variable "deploy_bucket_name" {
  description = "S3 bucket name for Lambda deployment packages"
  type        = string
}

variable "peer_account_id" {
  description = "AWS account ID of the peer environment (for cross-account costs)"
  type        = string
}

variable "peer_environment" {
  description = "Name of the peer environment (staging or prod)"
  type        = string
}
