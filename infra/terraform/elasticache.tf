# ElastiCache Redis replication group backing the Socket.IO redis adapter
# for multi-pod / multi-node broadcast. Transit + at-rest encryption on;
# the auth token lives in Secrets Manager (never in plain outputs).
# SCALE NOTE (50k/100k): standard pub/sub replicates every broadcast to all
# nodes (single-threaded). 50k needs 3+ clusters (default); 100k needs Redis 7+
# sharded SPUBLISH or Kafka/NATS JetStream + SQS/Kinesis write buffer for
# DynamoDB hot CONV# partitions. Push DLQ key `push:dlq:*` is the SQS seam.
resource "random_password" "redis_auth" {
  length  = 32
  special = false
}

resource "aws_elasticache_subnet_group" "nexus" {
  name       = "${local.name}-redis-subnets"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "redis" {
  name        = "${local.name}-redis-sg"
  description = "Redis ingress from EKS worker nodes only"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Redis from EKS nodes"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_elasticache_replication_group" "nexus" {
  replication_group_id = "${var.project}-${var.environment}-redis"
  description          = "Nexus Socket.IO adapter"

  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  num_cache_clusters   = var.redis_num_cache_clusters
  parameter_group_name = "default.redis7"
  port                 = 6379

  automatic_failover_enabled = true
  multi_az_enabled           = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth.result

  subnet_group_name  = aws_elasticache_subnet_group.nexus.name
  security_group_ids = [aws_security_group.redis.id]
}

resource "aws_secretsmanager_secret" "redis" {
  name        = "${local.name}-redis-url"
  description = "REDIS_URL (rediss://) for the Nexus server Socket.IO adapter"
}

resource "aws_secretsmanager_secret_version" "redis" {
  secret_id = aws_secretsmanager_secret.redis.id
  secret_string = jsonencode({
    host      = aws_elasticache_replication_group.nexus.primary_endpoint_address
    port      = 6379
    auth      = random_password.redis_auth.result
    redis_url = "rediss://:${random_password.redis_auth.result}@${aws_elasticache_replication_group.nexus.primary_endpoint_address}:6379"
  })
}
