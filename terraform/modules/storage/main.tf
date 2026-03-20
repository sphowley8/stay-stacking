locals {
  frontend_bucket_name = "${var.bucket_name_prefix}-frontend-${var.environment}"
  deploy_bucket_name   = "${var.bucket_name_prefix}-deploy-${var.environment}"
}

# --- S3 bucket for Lambda deployment packages ---

resource "aws_s3_bucket" "deploy" {
  bucket        = local.deploy_bucket_name
  force_destroy = true

  tags = {
    Project     = "staystacking"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_versioning" "deploy" {
  bucket = aws_s3_bucket.deploy.id
  versioning_configuration {
    status = "Disabled"
  }
}

# --- S3 bucket for frontend static files ---

resource "aws_s3_bucket" "frontend" {
  bucket        = local.frontend_bucket_name
  force_destroy = true

  tags = {
    Project     = "staystacking"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- CloudFront Origin Access Identity (OAI) ---

resource "aws_cloudfront_origin_access_identity" "frontend" {
  comment = "OAI for StayStacking frontend S3 bucket - ${var.environment}"
}

# --- CloudFront Distribution ---

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html"
  comment             = "StayStacking frontend - ${var.environment}"
  aliases             = [replace(var.frontend_url, "https://", "")]

  origin {
    domain_name = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id   = "S3FrontendOrigin"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.frontend.cloudfront_access_identity_path
    }
  }

  default_cache_behavior {
    target_origin_id       = "S3FrontendOrigin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  # SPA fallback: all 404s serve index.html so JS handles routing via hash
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = {
    Project     = "staystacking"
    Environment = var.environment
  }
}

# --- S3 bucket policy: allow CloudFront OAC only ---

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOAI"
        Effect = "Allow"
        Principal = {
          CanonicalUser = aws_cloudfront_origin_access_identity.frontend.s3_canonical_user_id
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.frontend.arn}/*"
      }
    ]
  })
}
