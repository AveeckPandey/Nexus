# Feed these into infra/k8s/02-configmap.yaml (non-secrets) and
# infra/k8s/03-secrets.yaml (secrets) after `terraform apply`.
output "aws_region" {
  description = "Deployed AWS region."
  value       = var.aws_region
}

output "eks_cluster_name" {
  description = "EKS cluster name (aws eks update-kubeconfig target)."
  value       = module.eks.cluster_name
}

output "ecr_web_url" {
  description = "Web image repo (infra/k8s/20-web-deployment.yaml image field)."
  value       = aws_ecr_repository.web.repository_url
}

output "ecr_server_url" {
  description = "Server image repo (infra/k8s/10-server-deployment.yaml image field)."
  value       = aws_ecr_repository.server.repository_url
}

output "dynamodb_table_name" {
  description = "DYNAMODB_TABLE_NAME for nexus-server-config."
  value       = aws_dynamodb_table.nexus_table.name
}

output "s3_media_bucket" {
  description = "S3_BUCKET_NAME for nexus-server-config."
  value       = aws_s3_bucket.media.bucket
}

output "cloudfront_domain" {
  description = "CLOUDFRONT_DOMAIN for nexus-server-config (https://<this>)."
  value       = "https://${aws_cloudfront_distribution.media.domain_name}"
}

output "cognito_user_pool_id" {
  description = "COGNITO_USER_POOL_ID (server secret + NEXT_PUBLIC_COGNITO_USER_POOL_ID build-arg)."
  value       = aws_cognito_user_pool.nexus.id
}

output "cognito_client_id" {
  description = "COGNITO_CLIENT_ID (server secret + NEXT_PUBLIC_COGNITO_CLIENT_ID build-arg)."
  value       = aws_cognito_user_pool_client.web.id
}

output "cognito_client_secret" {
  description = "COGNITO_CLIENT_SECRET for nexus-server-secret. NEVER commit."
  value       = aws_cognito_user_pool_client.web.client_secret
  sensitive   = true
}

output "cognito_hosted_domain" {
  description = "Cognito hosted UI base URL."
  value       = "https://${aws_cognito_user_pool_domain.nexus.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "redis_primary_endpoint" {
  description = "ElastiCache primary endpoint (TLS). REDIS_URL is rediss://:<token>@<this>:6379."
  value       = aws_elasticache_replication_group.nexus.primary_endpoint_address
}

output "redis_secret_arn" {
  description = "Secrets Manager ARN holding the full REDIS_URL for nexus-server-secret."
  value       = aws_secretsmanager_secret.redis.arn
}

output "nexus_server_irsa_role_arn" {
  description = "IRSA role ARN for infra/k8s/01-serviceaccount.yaml annotation."
  value       = module.nexus_server_irsa.iam_role_arn
}
