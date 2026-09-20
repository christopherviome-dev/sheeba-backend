const express = require('express');
const crypto = require('crypto');
const Payment = require('../models/Payment');
const PaymentEvent = require('../models/PaymentEvent');
const Stylist = require('../models/Stylist');
const Customer = require('../models/Customer');
const { requireCustomerAuth, requireAuth } = require('../middleware/auth');
const { identifyActor } = require('./messages');
const { notify } = require('./notifications');
const paystack = require('../services/paymentProviders/PaystackProvider');

const router = express.Router();

async function logEvent(paymentId, type, providerEventId, meta) {
  try { await PaymentEvent.create({ paymentId, type, providerEventId: providerEventId || null, meta: meta || {} }); }
  catch (e) { /* a duplicate providerEventId correctly throws here — that IS the idempotency check working, not a bug to hide */ return e; }
}

// Customer initiates a real payment. Amount and currency come from the
// service's OWN current configuration — never a client-supplied number —
// and only when that service has actually opted into requiring payment.
router.post('/initialize', requireCustomerAuth, async (req, res) => {
  const { stylistId, styleId, requestId, purpose } = req.body;
  const stylist = await Stylist.findById(stylistId);
  if (!stylist) return res.status(404).json({ error: 'Shop not found.' });
  const style = (stylist.styles || []).find(s => s.id === styleId);
  if (!style) return res.status(404).json({ error: 'Service not found.' });
  if (style.paymentRequirement === 'NO_PAYMENT_REQUIRED') {
    return res.status(400).json({ error: 'This service does not use Sheeba payments — arrange payment directly with the professional.' });
  }
  const useDeposit = purpose === 'DEPOSIT' && style.paymentRequirement === 'DEPOSIT_REQUIRED';
  const amountMinor = useDeposit ? style.depositAmount : Math.round(style.price * 100);
  if (!amountMinor || amountMinor <= 0) return res.status(400).json({ error: 'This service is not correctly configured for payment yet.' });
  const customer = await Customer.findById(req.customerId);
  const internalReference = 'sheeba_' + crypto.randomBytes(12).toString('hex');
  const payment = await Payment.create({
    customerId: req.customerId, stylistId, requestId: requestId || null, styleId,
    purpose: useDeposit ? 'DEPOSIT' : 'FULL_PAYMENT', amountMinor, currency: stylist.currency || 'GHS',
    internalReference, status: 'INITIATED',
  });
  await logEvent(payment._id.toString(), 'PAYMENT_INITIATED');
  try {
    const init = await paystack.initializePayment({
      email: (customer && customer.email) || `${req.customerId}@sheeba.online`, // Paystack requires an email; customers don't have one yet, so a placeholder tied to their real id
      amountMinor, currency: stylist.currency || 'GHS', reference: internalReference,
      callbackUrl: `${req.protocol}://${req.get('host')}/payment-complete`,
      metadata: { paymentId: payment._id.toString() },
    });
    payment.providerReference = init.reference;
    payment.status = 'PENDING';
    payment.updatedAt = Date.now();
    await payment.save();
    await logEvent(payment._id.toString(), 'PAYMENT_PENDING');
    res.json({ paymentId: payment._id, authorizationUrl: init.authorizationUrl });
  } catch (e) {
    payment.status = 'FAILED';
    await payment.save();
    await logEvent(payment._id.toString(), 'PAYMENT_FAILED', null, { reason: e.message });
    res.status(502).json({ error: e.message });
  }
});

// Server-side re-verification — this, not anything the browser claims on
// returning from Paystack, is what actually marks a payment successful.
router.post('/:id/verify', requireCustomerAuth, async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment || payment.customerId !== req.customerId) return res.status(404).json({ error: 'Not found.' });
  if (payment.status === 'SUCCESSFUL') return res.json(payment); // already verified — idempotent
  try {
    const result = await paystack.verifyPayment(payment.providerReference);
    if (result.successful) {
      payment.status = 'SUCCESSFUL';
      payment.paidAt = result.paidAt || Date.now();
      payment.paymentMethod = result.channel || null;
      await logEvent(payment._id.toString(), 'PAYMENT_SUCCESSFUL', `verify:${payment.internalReference}`);
      await notify({ recipientId: payment.stylistId, recipientType: 'stylist', type: 'PAYMENT_SUCCESSFUL', title: 'Payment received', message: `${payment.currency} ${(payment.amountMinor/100).toFixed(2)}`, entityType: 'request', entityId: payment.requestId, priority: 'important' }).catch(()=>{});
    } else {
      payment.status = 'FAILED';
      await logEvent(payment._id.toString(), 'PAYMENT_FAILED');
    }
    payment.updatedAt = Date.now();
    await payment.save();
    res.json(payment);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Real webhook — signature-verified against the raw body, idempotent via
// a unique providerEventId so a Paystack retry can never double-process.
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  if (!paystack.verifyWebhookSignature(req.rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature.' });
  }
  res.json({ received: true }); // ack fast; Paystack retries on non-2xx
  const event = req.body;
  const reference = event.data && event.data.reference;
  if (!reference) return;
  const payment = await Payment.findOne({ internalReference: reference });
  if (!payment) return;
  const providerEventId = `${event.event}:${reference}`;
  const dup = await logEvent(payment._id.toString(), 'PAYMENT_PENDING', providerEventId);
  if (dup) return; // duplicate delivery of the same event — already processed
  if (event.event === 'charge.success' && payment.status !== 'SUCCESSFUL') {
    payment.status = 'SUCCESSFUL';
    payment.paidAt = Date.now();
    payment.updatedAt = Date.now();
    await payment.save();
    await logEvent(payment._id.toString(), 'PAYMENT_SUCCESSFUL', `webhook:${providerEventId}`);
    await notify({ recipientId: payment.stylistId, recipientType: 'stylist', type: 'PAYMENT_SUCCESSFUL', title: 'Payment received', message: `${payment.currency} ${(payment.amountMinor/100).toFixed(2)}`, entityType: 'request', entityId: payment.requestId, priority: 'important' }).catch(()=>{});
  }
});

router.get('/:id', async (req, res) => {
  const actor = identifyActor(req);
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Not found.' });
  const authorized = actor && ((actor.type === 'customer' && payment.customerId === actor.id) || (actor.type === 'stylist' && (payment.stylistId === actor.id || actor.isAdmin)));
  if (!authorized) return res.status(403).json({ error: 'Not authorized.' });
  res.json(payment);
});

router.get('/', async (req, res) => {
  const actor = identifyActor(req);
  if (!actor) return res.status(401).json({ error: 'Not logged in.' });
  const filter = actor.type === 'customer' ? { customerId: actor.id } : { stylistId: actor.id };
  const list = await Payment.find(filter).sort({ createdAt: -1 });
  res.json(list);
});

router.post('/:id/refund', requireAuth, async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Not found.' });
  if (payment.stylistId !== req.stylistId && !req.isAdmin) return res.status(403).json({ error: 'Not authorized.' });
  if (payment.status !== 'SUCCESSFUL' && payment.status !== 'PARTIALLY_REFUNDED') return res.status(400).json({ error: 'Only a successful payment can be refunded.' });
  const { amountMinor } = req.body; // omit for full refund
  try {
    await paystack.refundPayment(payment.providerReference, amountMinor);
    payment.refundAmountMinor = (payment.refundAmountMinor || 0) + (amountMinor || payment.amountMinor);
    payment.status = payment.refundAmountMinor >= payment.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    payment.refundedAt = Date.now();
    payment.updatedAt = Date.now();
    await payment.save();
    await logEvent(payment._id.toString(), amountMinor ? 'PARTIAL_REFUND' : 'REFUND_SUCCESSFUL');
    res.json(payment);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
