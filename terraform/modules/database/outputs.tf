output "users_table_name" {
  value = aws_dynamodb_table.users.name
}

output "users_table_arn" {
  value = aws_dynamodb_table.users.arn
}

output "activities_table_name" {
  value = aws_dynamodb_table.activities.name
}

output "activities_table_arn" {
  value = aws_dynamodb_table.activities.arn
}

output "checkins_table_name" {
  value = aws_dynamodb_table.checkins.name
}

output "checkins_table_arn" {
  value = aws_dynamodb_table.checkins.arn
}

output "training_plan_table_name" {
  value = aws_dynamodb_table.training_plan.name
}

output "training_plan_table_arn" {
  value = aws_dynamodb_table.training_plan.arn
}
