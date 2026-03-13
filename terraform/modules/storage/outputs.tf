output "frontend_bucket_name" {
  value = aws_s3_bucket.frontend.id
}

output "deploy_bucket_name" {
  value = aws_s3_bucket.deploy.id
}

output "cloudfront_url" {
  value = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.frontend.domain_name
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.frontend.id
}
