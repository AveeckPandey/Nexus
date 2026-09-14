const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const region = process.env.AWS_REGION || 'us-east-1';
const ses = new SESClient({ region });
const ddbRaw = new DynamoDBClient({ region });
const db = DynamoDBDocumentClient.from(ddbRaw);

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'NexusTable';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Nexus <hello@buildwithaveeck.com>';
const LOGO_URL = 'https://d1rnbchpdry1z8.cloudfront.net/branding/nexus-alien.png';
const BG_URL = 'https://d1rnbchpdry1z8.cloudfront.net/branding/doodle-bg.jpg';

exports.handler = async (event) => {
  console.log('PostConfirmation event received:', JSON.stringify(event, null, 2));

  if (event.triggerSource === 'PostConfirmation_ConfirmSignUp') {
    const { email, name, sub } = event.request.userAttributes;
    const recipientName = name || email.split('@')[0];

    // 1. Send Welcome Email via Amazon SES with Doodle Background & Alien Logo
    try {
      const emailParams = {
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: {
            Data: 'Welcome to Nexus — Zero-Knowledge Private Messaging',
            Charset: 'UTF-8',
          },
          Body: {
            Html: {
              Charset: 'UTF-8',
              Data: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0A0618; background-image: url('${BG_URL}'); background-size: cover; background-position: center; color: #E2E8F0; margin: 0; padding: 40px 20px; }
    .overlay { background: rgba(10, 6, 24, 0.88); border-radius: 20px; padding: 24px; max-width: 580px; margin: 0 auto; backdrop-filter: blur(4px); }
    .container { background: #121024; border-radius: 16px; border: 1px solid #3B336A; padding: 32px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #2A244D; padding-bottom: 16px; margin-bottom: 24px; }
    .logo-badge { width: 36px; height: 36px; background: #FFFFFF; border-radius: 50%; padding: 4px; display: inline-block; vertical-align: middle; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3); }
    .logo-text { font-size: 24px; font-weight: 800; color: #A78BFA; vertical-align: middle; margin-left: 10px; }
    h1 { font-size: 22px; color: #FFFFFF; margin-top: 0; margin-bottom: 10px; }
    p { font-size: 14px; line-height: 1.6; color: #94A3B8; margin-top: 0; }
    .card-grid { display: table; width: 100%; margin: 20px 0; }
    .card-row { display: table-row; }
    .card-cell { display: table-cell; width: 50%; padding: 6px; }
    .card { background: #181432; border: 1px solid #312B5A; border-radius: 10px; padding: 14px; height: 100%; }
    .card-title { font-size: 13px; font-weight: 700; color: #DDD6FE; margin-bottom: 4px; }
    .card-desc { font-size: 11px; color: #94A3B8; line-height: 1.4; margin: 0; }
    .btn-wrap { text-align: center; margin-top: 24px; }
    .btn { display: inline-block; background: #7C3AED; color: #FFFFFF !important; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4); }
    .footer { margin-top: 28px; font-size: 11px; color: #64748B; text-align: center; }
  </style>
</head>
<body>
  <div class="overlay">
    <div class="container">
      <div class="header">
        <div>
          <img src="${LOGO_URL}" alt="Nexus" class="logo-badge" />
          <span class="logo-text">NEXUS</span>
        </div>
      </div>
      <h1>Welcome, ${recipientName}!</h1>
      <p>Your account is confirmed. You now have access to military-grade zero-knowledge encrypted messaging, voice notes, and P2P mesh calls.</p>
      
      <div class="card-grid">
        <div class="card-row">
          <div class="card-cell">
            <div class="card">
              <div class="card-title">Zero-Knowledge E2EE</div>
              <p class="card-desc">NaCl secretbox keys stay strictly on your device.</p>
            </div>
          </div>
          <div class="card-cell">
            <div class="card">
              <div class="card-title">In-Chat Nexus AI</div>
              <p class="card-desc">Tag @nexus or @ai in any chat for real-time intelligence.</p>
            </div>
          </div>
        </div>
        <div class="card-row">
          <div class="card-cell">
            <div class="card">
              <div class="card-title">30s Ghost Chats</div>
              <p class="card-desc">Ephemeral self-destructing rooms with guest links.</p>
            </div>
          </div>
          <div class="card-cell">
            <div class="card">
              <div class="card-title">WebRTC Mesh</div>
              <p class="card-desc">Crystal-clear encrypted P2P audio and video calling.</p>
            </div>
          </div>
        </div>
      </div>

      <div class="btn-wrap">
        <a href="https://nexus.buildwithaveeck.com" class="btn">Open Nexus Web</a>
      </div>

      <div class="footer">
        Sent with care by Nexus • <a href="https://nexus.buildwithaveeck.com" style="color: #7C3AED; text-decoration: none;">nexus.buildwithaveeck.com</a>
      </div>
    </div>
  </div>
</body>
</html>`,
            },
            Text: {
              Charset: 'UTF-8',
              Data: `Welcome to Nexus, ${recipientName}!\n\nYour account has been verified. You now have access to zero-knowledge end-to-end encrypted messaging, voice notes, and P2P mesh calls.\n\nOpen Nexus now: https://nexus.buildwithaveeck.com\n\n- The Nexus Team`,
            },
          },
        },
      };

      await ses.send(new SendEmailCommand(emailParams));
      console.log(`Welcome email sent to ${email}`);
    } catch (err) {
      console.warn('Failed to send welcome email via SES:', err.message);
    }

    // 2. Insert In-App Onboarding Welcome Message from Nexus AI into DynamoDB
    try {
      const convId = `onboarding_${sub}`;
      const now = new Date().toISOString();
      const msgId = `msg_welcome_${Date.now()}`;

      // Create Onboarding Conversation Metadata with Alien Logo Avatar
      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `CONV#${convId}`,
          SK: 'METADATA',
          id: convId,
          type: 'direct',
          title: 'Nexus AI',
          participants: [sub, 'nexus-ai'],
          lastMessage: {
            content: `Hello ${recipientName}! I'm your in-app AI assistant. You can ask me questions, summarize chats, or tag @nexus anytime.`,
            senderName: 'Nexus AI',
            senderAvatar: LOGO_URL,
            createdAt: now,
          },
          updatedAt: now,
        },
      }));

      // Create Membership record for user
      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${sub}`,
          SK: `CONV#${convId}`,
          conversationId: convId,
          role: 'member',
          joinedAt: now,
          cachedTitle: 'Nexus AI',
          cachedType: 'direct',
          cachedAvatar: LOGO_URL,
          cachedLastMessage: {
            content: `Hello ${recipientName}! Welcome to Nexus.`,
            senderName: 'Nexus AI',
            senderAvatar: LOGO_URL,
            createdAt: now,
          },
          cachedUpdatedAt: now,
        },
      }));

      // Create the Welcome Message with Alien Avatar
      await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `CONV#${convId}`,
          SK: `MSG#${now}#${msgId}`,
          id: msgId,
          conversationId: convId,
          senderId: 'nexus-ai',
          senderName: 'Nexus AI',
          senderAvatar: LOGO_URL,
          content: `Hello ${recipientName}, welcome to Nexus!\n\nYour account has been set up with military-grade zero-knowledge encryption.\n\nHere is what you can do right now:\n• Claim your unique handle in Profile Settings\n• Start an encrypted chat (up to 1,024 members)\n• Launch a temporary Ghost Chat with 30s self-destruct timers\n• Mention @nexus or @ai right here whenever you need assistance!`,
          mediaType: 'text',
          isEncrypted: false,
          status: 'delivered',
          createdAt: now,
        },
      }));
      console.log(`Onboarding welcome conversation created with alien logo for user ${sub}`);
    } catch (err) {
      console.warn('Failed to insert in-app welcome message into DynamoDB:', err.message);
    }
  }

  return event;
};
