resource "aws_dynamodb_table" "users" {
  name         = "staystacking-users-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "stravaId"
    type = "N"
  }

  global_secondary_index {
    name            = "stravaId-index"
    hash_key        = "stravaId"
    projection_type = "ALL"
  }

  tags = {
    Project     = "staystacking"
    Environment = var.environment
  }
}

resource "aws_dynamodb_table" "activities" {
  name         = "staystacking-activities-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "activityId"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "activityId"
    type = "S"
  }

  attribute {
    name = "weekStart"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  global_secondary_index {
    name            = "userId-weekStart-index"
    hash_key        = "userId"
    range_key       = "weekStart"
    projection_type = "ALL"
  }

  tags = {
    Project     = "staystacking"
    Environment = var.environment
  }
}

resource "aws_dynamodb_table" "checkins" {
  name         = "staystacking-checkins-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "date"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "date"
    type = "S"
  }

  tags = {
    Project     = "staystacking"
    Environment = var.environment
  }
}

resource "aws_dynamodb_table" "training_plan" {
  name         = "staystacking-training-plan-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "date"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "date"
    type = "S"
  }

  tags = {
    Project     = "staystacking"
    Environment = var.environment
  }
}
