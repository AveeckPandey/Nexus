/**
 * scripts/aws-deploy-cognito.js
 * Automated idempotent deployment for AWS Cognito User Pool & App Client.
 */
const path = require('path');
const fs = require('fs');
const {
  CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  ListUserPoolsCommand,
  CreateUserPoolClientCommand,
  ListUserPoolClientsCommand,
  DescribeUserPoolClientCommand,
} = require('../server/node_modules/@aws-sdk/client-cognito-identity-provider');
require('dotenv').config({ path: path.join(__dirname, '../server/.env') });

const client = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const POOL_NAME = 'nexus-prod-users';
const CLIENT_NAME = 'nexus-prod-web';

async function deployCognito() {
  console.log(`\n🔐 [2/4] Deploying AWS Cognito in ${process.env.AWS_REGION || 'us-east-1'}...`);

  // 1. Check if user pool already exists
  let userPoolId = null;
  const pools = await client.send(new ListUserPoolsCommand({ MaxResults: 60 }));
  const existingPool = pools.UserPools?.find((p) => p.Name === POOL_NAME);

  if (existingPool) {
    userPoolId = existingPool.Id;
    console.log(`   ✓ Found existing Cognito User Pool: "${POOL_NAME}" (${userPoolId})`);
  } else {
    console.log(`   Creating Cognito User Pool: "${POOL_NAME}"...`);
    const createPoolRes = await client.send(
      new CreateUserPoolCommand({
        PoolName: POOL_NAME,
        UsernameAttributes: ['email'],
        AutoVerifiedAttributes: ['email'],
        Policies: {
          PasswordPolicy: {
            MinimumLength: 8,
            RequireUppercase: true,
            RequireLowercase: true,
            RequireNumbers: true,
            RequireSymbols: true,
            TemporaryPasswordValidityDays: 7,
          },
        },
        AccountRecoverySetting: {
          RecoveryMechanisms: [
            {
              Name: 'verified_email',
              Priority: 1,
            },
          ],
        },
        AdminCreateUserConfig: {
          AllowAdminCreateUserOnly: false,
        },
        Schema: [
          {
            Name: 'email',
            AttributeDataType: 'String',
            Required: true,
            Mutable: true,
          },
          {
            Name: 'name',
            AttributeDataType: 'String',
            Required: false,
            Mutable: true,
          },
        ],
        UserPoolTags: {
          Project: 'Nexus',
          Environment: 'Production',
        },
      }),
    );
    userPoolId = createPoolRes.UserPool?.Id;
    console.log(`   ✓ User Pool created successfully: ${userPoolId}`);
  }

  // 2. Check / Create App Client
  let clientId = null;
  let clientSecret = null;
  const clients = await client.send(
    new ListUserPoolClientsCommand({ UserPoolId: userPoolId, MaxResults: 60 }),
  );
  const existingClient = clients.UserPoolClients?.find((c) => c.ClientName === CLIENT_NAME);

  if (existingClient) {
    clientId = existingClient.ClientId;
    console.log(`   ✓ Found existing App Client: "${CLIENT_NAME}" (${clientId})`);
    const desc = await client.send(
      new DescribeUserPoolClientCommand({ UserPoolId: userPoolId, ClientId: clientId }),
    );
    clientSecret = desc.UserPoolClient?.ClientSecret;
  } else {
    console.log(`   Creating App Client: "${CLIENT_NAME}" with client secret...`);
    const createClientRes = await client.send(
      new CreateUserPoolClientCommand({
        UserPoolId: userPoolId,
        ClientName: CLIENT_NAME,
        GenerateSecret: true,
        ExplicitAuthFlows: [
          'ALLOW_USER_PASSWORD_AUTH',
          'ALLOW_USER_SRP_AUTH',
          'ALLOW_REFRESH_TOKEN_AUTH',
        ],
        PreventUserExistenceErrors: 'ENABLED',
        SupportedIdentityProviders: ['COGNITO'],
      }),
    );
    clientId = createClientRes.UserPoolClient?.ClientId;
    clientSecret = createClientRes.UserPoolClient?.ClientSecret;
    console.log(`   ✓ App Client created successfully: ${clientId}`);
  }

  // 3. Inject into server/.env
  console.log(`   Updating server/.env with Cognito configuration...`);
  const envPath = path.join(__dirname, '../server/.env');
  let envContent = fs.readFileSync(envPath, 'utf8');

  envContent = envContent.replace(/COGNITO_USER_POOL_ID=.*/, `COGNITO_USER_POOL_ID=${userPoolId}`);
  envContent = envContent.replace(/COGNITO_CLIENT_ID=.*/, `COGNITO_CLIENT_ID=${clientId}`);
  envContent = envContent.replace(
    /COGNITO_CLIENT_SECRET=.*/,
    `COGNITO_CLIENT_SECRET=${clientSecret || ''}`,
  );

  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log(`   ✓ Injected COGNITO_USER_POOL_ID=${userPoolId}`);
  console.log(`   ✓ Injected COGNITO_CLIENT_ID=${clientId}`);
  console.log(`   ✓ Injected COGNITO_CLIENT_SECRET=${clientSecret ? '***' + clientSecret.slice(-4) : 'none'}`);

  console.log(`\n🎉 AWS Cognito deployment completed successfully!`);
}

deployCognito().catch((err) => {
  console.error('\n❌ Cognito deployment failed:', err);
  process.exit(1);
});
