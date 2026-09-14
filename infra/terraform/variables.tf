# Nexus infrastructure inputs. Copy terraform.tfvars.example-style values via
# `-var` flags or a local `terraform.tfvars` (gitignored, never committed).

variable "project" {
  description = "Resource name prefix (lowercase, no spaces)."
  type        = string
  default     = "nexus"
}

variable "environment" {
  description = "Deployment environment label."
  type        = string
  default     = "prod"
}

variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the EKS VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones to span (one public + one private subnet per AZ)."
  type        = number
  default     = 3
}

variable "single_nat_gateway" {
  description = "Use one shared NAT gateway (cheap) instead of one per AZ. false for 10k+/50k (per-AZ egress)."
  type        = bool
  default     = false
}

variable "eks_version" {
  description = "EKS control-plane Kubernetes version."
  type        = string
  default     = "1.29"
}

variable "node_instance_types" {
  description = "EC2 instance types for the managed node group (hardened for 50k-100k scale)."
  type        = list(string)
  default     = ["c6g.xlarge", "m7i-flex.large"]
}

variable "node_min_size" {
  description = "Minimum EKS worker nodes (3 to fit 3x6Gi server pods)."
  type        = number
  default     = 3
}

variable "node_desired_size" {
  description = "Desired EKS worker nodes."
  type        = number
  default     = 4
}

variable "node_max_size" {
  description = "Maximum EKS worker nodes (cluster autoscaler ceiling)."
  type        = number
  default     = 6
}

variable "admin_iam_arn" {
  description = "REQUIRED: IAM user/role ARN granted EKS cluster-admin via access entry."
  type        = string
  default     = ""
}

variable "app_domain" {
  description = "Public hostname served by the ALB ingress (also CORS origin and Cognito callback host)."
  type        = string
  default     = "nexus.yourdomain.com"
}

variable "cognito_domain_prefix" {
  description = "Globally-unique prefix for the Cognito hosted domain (<prefix>.auth.<region>.amazoncognito.com)."
  type        = string
  default     = "nexus-auth"
}

variable "s3_media_bucket_name" {
  description = "Media bucket name. Empty = '<project>-media-<account-id>'."
  type        = string
  default     = ""
}

variable "cloudfront_price_class" {
  description = "CloudFront price class (100 = NA/EU cheapest)."
  type        = string
  default     = "PriceClass_100"
}

variable "cors_origins" {
  description = "Browser origins allowed to PUT directly to S3 via presigned URLs. Tighten for prod."
  type        = list(string)
  default     = ["*"]
}

variable "redis_node_type" {
  description = "ElastiCache node type for the Socket.IO adapter replication group (m6g.large hardened for 50k-100k scale)."
  type        = string
  default     = "cache.m6g.large"
}

variable "redis_num_cache_clusters" {
  description = "Redis replicas (primary + secondaries) for multi-AZ failover. 3+ for 50k fan-out; 100k needs sharded SPUBLISH/Kafka (see elasticache.tf)."
  type        = number
  default     = 3
}
