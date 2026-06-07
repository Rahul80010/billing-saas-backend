const crypto = require('crypto');

/**
 * Helper to verify Meta HMAC SHA256 signature
 */
const verifySignature = (req) => {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    // In test environment, skip signature check if no header is present
    if (process.env.NODE_ENV === 'test') return true;
    return false;
  }

  const APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
  if (!APP_SECRET) {
    // If APP_SECRET is not configured in development, bypass validation.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Webhook] Warning: FACEBOOK_APP_SECRET is not set. Signature check bypassed in development.');
      return true;
    }
    return false;
  }

  const parts = signature.split('=');
  const signatureHash = parts[1];

  const bodyData = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body));
  const expectedHash = crypto
    .createHmac('sha256', APP_SECRET)
    .update(bodyData)
    .digest('hex');

  return signatureHash === expectedHash;
};

/**
 * @desc    Verify webhook subscription (handshake challenge)
 * @route   GET /api/webhooks/whatsapp
 * @access  Public
 */
const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'mohuri-webhook-verify-token-default';

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[Webhook] Handshake verified successfully!');
      return res.status(200).send(challenge);
    } else {
      console.warn('[Webhook] Handshake failed: verification token mismatch.');
      return res.status(403).send('Forbidden: Token mismatch');
    }
  }
  res.status(400).send('Bad Request');
};

/**
 * @desc    Process incoming WhatsApp webhook payloads (messages, status updates)
 * @route   POST /api/webhooks/whatsapp
 * @access  Public
 */
const handleWebhookPayload = (req, res) => {
  // 1. Verify Meta Signature
  if (!verifySignature(req)) {
    console.warn('[Webhook] Rejected: Webhook signature mismatch.');
    return res.status(403).send('Forbidden: Invalid signature signature verification failed');
  }

  const payload = req.body;

  // 2. Parse event categories
  if (payload.object === 'whatsapp_business_account') {
    const entries = payload.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value || {};

        // Parse status updates (sent, delivered, read, failed)
        if (value.statuses) {
          for (const statusObj of value.statuses) {
            const msgId = statusObj.id;
            const status = statusObj.status;
            const to = statusObj.recipient_id;
            console.log(`[Webhook] Status update: Message ${msgId} to ${to} is now "${status}"`);
          }
        }

        // Parse incoming messages from customers
        if (value.messages) {
          for (const msg of value.messages) {
            const from = msg.from;
            const msgId = msg.id;
            const type = msg.type;
            const text = msg.text?.body || '';
            console.log(`[Webhook] Incoming message from ${from} (Type: ${type}, ID: ${msgId}): "${text}"`);
          }
        }
      }
    }
    return res.status(200).send('EVENT_RECEIVED');
  }

  res.status(404).send('Not Found');
};

module.exports = {
  verifyWebhook,
  handleWebhookPayload,
};
