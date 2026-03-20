variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "bucket_name_prefix" {
  description = "Prefix for S3 bucket names"
  type        = string
  default     = "staystacking"
}

variable "frontend_url" {
  description = "Full frontend URL — used to derive the CloudFront domain alias (e.g. https://stay-stacking.sean-howley.com)"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for the CloudFront custom domain alias (must be in us-east-1)"
  type        = string
}
