variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "staging"], var.environment)
    error_message = "environment must be 'prod' or 'staging'."
  }
}

variable "frontend_url_override" {
  description = "Custom frontend URL (e.g. https://stay-stacking.sean-howley.com). Passed via .env.<environment>."
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for CloudFront custom domain alias (must be in us-east-1)."
  type        = string
}
