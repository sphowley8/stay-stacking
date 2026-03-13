terraform {
  required_version = ">= 1.3"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

module "database" {
  source      = "./modules/database"
  environment = var.environment
}

module "storage" {
  source             = "./modules/storage"
  environment        = var.environment
  bucket_name_prefix = "staystacking"
}

module "api" {
  source                   = "./modules/api"
  environment              = var.environment
  frontend_url             = "https://stay-stacking.sean-howley.com"
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
