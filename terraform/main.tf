terraform {
  required_version = ">= 1.3"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region = var.region
}

# Route 53 is always in the prod account regardless of environment
provider "aws" {
  alias   = "dns"
  region  = "us-east-1"
  profile = "prod"
}

locals {
  frontend_url = var.frontend_url_override
}

module "database" {
  source      = "./modules/database"
  environment = var.environment
}

module "storage" {
  source              = "./modules/storage"
  environment         = var.environment
  bucket_name_prefix  = "staystacking"
  frontend_url        = local.frontend_url
  acm_certificate_arn = var.acm_certificate_arn
}

data "aws_route53_zone" "main" {
  provider = aws.dns
  name     = "sean-howley.com."
}

# Create DNS alias for staging subdomain (prod record already exists)
resource "aws_route53_record" "staging_frontend" {
  count    = var.environment == "staging" ? 1 : 0
  provider = aws.dns
  zone_id  = data.aws_route53_zone.main.zone_id
  name     = "staging.stay-stacking.sean-howley.com"
  type     = "A"

  alias {
    name                   = module.storage.cloudfront_domain_name
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}

module "api" {
  source                   = "./modules/api"
  environment              = var.environment
  frontend_url             = local.frontend_url
  users_table_name         = module.database.users_table_name
  users_table_arn          = module.database.users_table_arn
  activities_table_name    = module.database.activities_table_name
  activities_table_arn     = module.database.activities_table_arn
  checkins_table_name      = module.database.checkins_table_name
  checkins_table_arn       = module.database.checkins_table_arn
  training_plan_table_name = module.database.training_plan_table_name
  training_plan_table_arn  = module.database.training_plan_table_arn
  deploy_bucket_name       = module.storage.deploy_bucket_name
}
