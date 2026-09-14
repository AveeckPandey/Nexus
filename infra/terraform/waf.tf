# WAFv2 for the ALB (10k/50k): rate-based IP throttle + AWS managed rules.
# Attach: aws_wafv2_web_acl_association with the ALB ARN created by the
# AWS Load Balancer Controller (see infra/k8s/30-ingress.yaml).
resource "aws_wafv2_web_acl" "nexus_alb" {
  name  = "${local.name}-alb-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "ip-rate-limit"
    priority = 1
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-ip-rate"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-common"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-common"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-alb"
    sampled_requests_enabled   = true
  }
}

output "waf_acl_arn" {
  description = "Associate with ALB: aws_wafv2_web_acl_association (alb_arn from ingress)."
  value       = aws_wafv2_web_acl.nexus_alb.arn
}
