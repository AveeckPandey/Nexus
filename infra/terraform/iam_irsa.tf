# IRSA: nexus-server pods assume this role via OIDC — no static
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in the cluster. The AWS SDK
# picks up the web-identity token automatically.
resource "aws_iam_policy" "nexus_dynamo_access" {
  name        = "${local.name}-dynamo-access"
  description = "Single-table NexusTable access (table + GSI1)"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:ConditionCheckItem",
          "dynamodb:DescribeTable",
        ]
        Resource = [
          aws_dynamodb_table.nexus_table.arn,
          "${aws_dynamodb_table.nexus_table.arn}/index/*",
        ]
      }
    ]
  })
}

resource "aws_iam_policy" "nexus_s3_access" {
  name        = "${local.name}-s3-access"
  description = "Presigned media upload/read on the Nexus media bucket"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [aws_s3_bucket.media.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["${aws_s3_bucket.media.arn}/*"]
      }
    ]
  })
}

resource "aws_iam_policy" "nexus_translate_access" {
  name        = "${local.name}-translate-access"
  description = "Inline chat translation via AWS Translate"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["translate:TranslateText"]
        Resource = ["*"]
      }
    ]
  })
}

module "nexus_server_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.30"

  role_name = "${local.name}-server-irsa"
  role_policy_arns = {
    dynamodb  = aws_iam_policy.nexus_dynamo_access.arn
    s3        = aws_iam_policy.nexus_s3_access.arn
    translate = aws_iam_policy.nexus_translate_access.arn
  }

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["nexus:nexus-server-sa"]
    }
  }
}
