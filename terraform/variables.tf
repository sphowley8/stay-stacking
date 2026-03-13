variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (prod, dev)"
  type        = string
  default     = "prod"
}
