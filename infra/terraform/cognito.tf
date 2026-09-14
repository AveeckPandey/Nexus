# Cognito User Pool for email/password (SRP) auth. The server uses
# USER_PASSWORD_AUTH + an app-client secret (SECRET_HASH), and Google
# sign-in is verified separately against GOOGLE_CLIENT_ID.
# NOTE: default Cognito email is fine for testing; wire SES via an
# aws_cognito_user_pool `email_configuration` block before production.
resource "aws_cognito_user_pool" "nexus" {
  name = "${local.name}-users"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 8
    require_uppercase                = true
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  lambda_config {
    post_confirmation = "arn:aws:lambda:us-east-1:758388043025:function:nexus-post-confirmation-welcome"
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
  }

  schema {
    name                = "name"
    attribute_data_type = "String"
    required            = false
    mutable             = true
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name            = "${local.name}-web"
  user_pool_id    = aws_cognito_user_pool.nexus.id
  generate_secret = true

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  prevent_user_existence_errors = "ENABLED"
  supported_identity_providers  = ["COGNITO"]

  callback_urls = ["https://${var.app_domain}/"]
  logout_urls   = ["https://${var.app_domain}/"]
}

resource "aws_cognito_user_pool_domain" "nexus" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.nexus.id
}
