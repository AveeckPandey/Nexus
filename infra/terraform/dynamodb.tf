# Nexus single-table design (IMPLEMENTATION.md §4): PK/SK with GSI1 for
# email lookup, membership reverse lookups and sender queries. TTL on
# `expire_at` backs ghost-invite expiry and message burn purge.
resource "aws_dynamodb_table" "nexus_table" {
  name         = "NexusTable"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }
  attribute {
    name = "GSI2PK"
    type = "S"
  }
  attribute {
    name = "GSI2SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  # GSI2: username-prefix directory (GSI2PK=USER, GSI2SK=<lower>#<userId>).
  # Eliminates full-table Scan for 10k+ user search; prefix query only.
  global_secondary_index {
    name            = "GSI2"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expire_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }
}
