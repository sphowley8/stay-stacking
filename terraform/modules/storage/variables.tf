variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "bucket_name_prefix" {
  description = "Prefix for S3 bucket names"
  type        = string
  default     = "staystacking"
}
