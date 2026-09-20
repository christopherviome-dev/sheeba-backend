const crypto = require('crypto');

// IMPORTANT, STATED HONESTLY: this is built correctly against Paystack's
// real, publicly documented REST API (transaction/initialize,
// transaction/verify/:reference, /refund, and the x-paystack-signature
// webhook header). It has NOT been tested against a live Paystack account,
// because no PAYSTACK_SECRET_KEY exists yet for this project. Once a real
// key is added to the environment, this should work as documented — but
// that live verification genuinely has not happened yet.

const BASE_URL = 'https://api.paystack.co';

function secretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('Payments are not configured yet — PAYSTACK_SECRET_KEY is not set.');
  return key;
}

async function initializePayment({ email, amountMinor, currency, reference, callbackUrl, metadata }) {
  const resp = await fetch(`${BASE_URL}/transaction/initialize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, amount: amountMinor, currency, reference, callback_url: callbackUrl, metadata }),
  });
  const body = await resp.json();
  if (!resp.ok || !body.status) throw new Error(body.message || 'Could not start payment.');
  return { authorizationUrl: body.data.authorization_url, accessCode: body.data.access_code, reference: body.data.reference };
}

async function verifyPayment(reference) {
  const resp = await fetch(`${BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey()}` },
  });
  const body = await resp.json();
  if (!resp.ok || !body.status) throw new Error(body.message || 'Could not verify payment.');
  return {
    successful: body.data.status === 'success',
    status: body.data.status,
    amountMinor: body.data.amount,
    currency: body.data.currency,
    paidAt: body.data.paid_at ? new Date(body.data.paid_at).getTime() : null,
    channel: body.data.channel,
    raw: body.data,
  };
}

// Real HMAC-SHA512 verification against Paystack's documented scheme —
// rejects anything not signed with the real secret key, so a forged
// "payment successful" callback can never be trusted.
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!rawBody || !signatureHeader) return false;
  const expected = crypto.createHmac('sha512', secretKey()).update(rawBody).digest('hex');
  // Constant-time comparison — a plain === would leak timing information
  // about how much of the signature matched.
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function refundPayment(reference, amountMinor) {
  const body = { transaction: reference };
  if (amountMinor) body.amount = amountMinor; // omit for a full refund
  const resp = await fetch(`${BASE_URL}/refund`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const respBody = await resp.json();
  if (!resp.ok || !respBody.status) throw new Error(respBody.message || 'Refund failed.');
  return { successful: true, raw: respBody.data };
}

module.exports = { initializePayment, verifyPayment, verifyWebhookSignature, refundPayment };
