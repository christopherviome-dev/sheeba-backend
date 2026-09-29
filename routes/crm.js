const express = require('express');
const Request = require('../models/Request');
const Customer = require('../models/Customer');
const CustomerNote = require('../models/CustomerNote');
const Referral = require('../models/Referral');
const RepeatPreference = require('../models/RepeatPreference');
const Activity = require('../models/Activity');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function makeReferralCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// Create a named, shareable referral/campaign link.
router.post('/me/referrals', requireAuth, async (req, res) => {
  const label = typeof req.body.label === 'string' ? req.body.label.replace(/\s+/g, ' ').trim() : '';
  if (!label || label.length > 60) return res.status(400).json({ error: 'Give this link a name (up to 60 characters), e.g. "WhatsApp September".' });
  const CHANNELS = ['WHATSAPP', 'INSTAGRAM', 'TIKTOK', 'FACEBOOK', 'BUSINESS_CARD', 'QR_POSTER', 'DIRECT_LINK', 'OTHER'];
  const channel = CHANNELS.includes(req.body.channel) ? req.body.channel : 'OTHER';
  if ((await Referral.countDocuments({ stylistId: req.stylistId })) >= 50) return res.status(400).json({ error: 'You can have up to 50 links.' });
  let code;
  for (let i = 0; i < 5; i++) {
    code = makeReferralCode();
    if (!(await Referral.exists({ code }))) break;
  }
  const r = await Referral.create({ code, stylistId: req.stylistId, label, channel });
  res.json(r);
});

// List mine, with REAL counts computed fresh from Activity — never a
// separately-incremented counter that could drift from what actually
// happened.
router.get('/me/referrals', requireAuth, async (req, res) => {
  const referrals = await Referral.find({ stylistId: req.stylistId }).sort({ createdAt: -1 });
  const withStats = await Promise.all(referrals.map(async (r) => {
    const visits = await Activity.countDocuments({ stylistId: req.stylistId, type: 'REFERRAL_VISIT', 'meta.code': r.code });
    const requests = await Activity.countDocuments({ stylistId: req.stylistId, type: 'REFERRED_REQUEST_CREATED', 'meta.code': r.code });
    return { ...r.toObject(), visits, requests };
  }));
  res.json(withStats);
});

router.put('/me/referrals/:id', requireAuth, async (req, res) => {
  const r = await Referral.findById(req.params.id);
  if (!r || r.stylistId !== req.stylistId) return res.status(404).json({ error: 'Not found.' });
  if (req.body.active !== undefined) r.active = !!req.body.active;
  await r.save();
  res.json(r);
});

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// Groups this stylist's real requests by customerId, keeping only ones that
// resolve to a genuine logged-in Customer account — a random anonymous
// browser id is not a "customer record," it has no stable identity to build
// a business relationship around.
async function realCustomerGroups(stylistId) {
  const requests = await Request.find({ stylistId, clientId: { $ne: null } });
  const byCustomer = new Map();
  for (const r of requests) {
    if (!byCustomer.has(r.clientId)) byCustomer.set(r.clientId, []);
    byCustomer.get(r.clientId).push(r);
  }
  const result = [];
  for (const [customerId, reqs] of byCustomer) {
    const customer = await Customer.findById(customerId).catch(() => null);
    if (!customer) continue; // anonymous booker — not a real customer record
    result.push({ customerId, name: customer.name, requests: reqs });
  }
  return result;
}

// Real business dashboard — every number here is a live count against
// actual documents, computed fresh on each request. Nothing cached, nothing
// invented, nothing shown if there's genuinely nothing to show.
router.get('/me/dashboard', requireAuth, async (req, res) => {
  const stylistId = req.stylistId;
  const all = await Request.find({ stylistId });
  const now = Date.now();
  const pending = all.filter(r => r.status === 'pending');
  const completedThisWeek = all.filter(r => r.status === 'completed' && (now - r.updatedAt) < WEEK_MS);
  const groups = await realCustomerGroups(stylistId);
  const repeatCustomers = groups.filter(g => g.requests.filter(r => r.status === 'completed').length >= 2);
  const newCustomersThisMonth = groups.filter(g => {
    const completed = g.requests.filter(r => r.status === 'completed').sort((a, b) => a.updatedAt - b.updatedAt);
    return completed.length > 0 && (now - completed[0].updatedAt) < MONTH_MS;
  });
  res.json({
    pendingCount: pending.length,
    completedThisWeekCount: completedThisWeek.length,
    totalCustomers: groups.length,
    repeatCustomerCount: repeatCustomers.length,
    newCustomersThisMonthCount: newCustomersThisMonth.length,
  });
});

// Real customer list — name, real completed count, real last-activity time.
router.get('/me/customers', requireAuth, async (req, res) => {
  const groups = await realCustomerGroups(req.stylistId);
  const DAY = 24 * 3600 * 1000, now = Date.now();
  const doneAt = (r) => r.completedAt || r.updatedAt;
  const list = groups.map(g => {
    const completed = g.requests.filter(r => r.status === 'completed').map(doneAt).filter(Boolean).sort((a, b) => a - b);
    const last = g.requests.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
    // Return pattern from REAL visits: needs at least two completed visits to predict anything.
    let usualEveryDays = null, nextDueAt = null, returnStatus = null;
    if (completed.length >= 2) {
      const gaps = completed.slice(1).map((t, i) => t - completed[i]);
      usualEveryDays = Math.max(1, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length / DAY));
      nextDueAt = completed[completed.length - 1] + usualEveryDays * DAY;
      returnStatus = now > nextDueAt + 3 * DAY ? 'OVERDUE' : nextDueAt - now <= 7 * DAY ? 'DUE_SOON' : 'ON_TRACK';
    }
    return {
      customerId: g.customerId,
      name: g.name,
      totalCompleted: completed.length,
      isRepeat: completed.length >= 2,
      lastActivityAt: last ? last.updatedAt : null,
      lastVisitAt: completed.length ? completed[completed.length - 1] : null,
      usualEveryDays, nextDueAt, returnStatus,
    };
  }).sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  res.json(list);
});

// One customer's real history with this stylist, plus this stylist's own
// private notes about them — never anything from another professional's
// records, and never exposed to the customer themselves.
router.get('/me/customers/:customerId', requireAuth, async (req, res) => {
  const customer = await Customer.findById(req.params.customerId).catch(() => null);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  const requests = await Request.find({ stylistId: req.stylistId, clientId: req.params.customerId }).sort({ createdAt: -1 });
  if (requests.length === 0) return res.status(403).json({ error: 'No relationship with this customer.' });
  const notes = await CustomerNote.find({ stylistId: req.stylistId, customerId: req.params.customerId }).sort({ createdAt: -1 });
  res.json({ customerId: customer._id.toString(), name: customer.name, requests, notes });
});

// Add a private note — only the authoring stylist can ever write or read it.
router.post('/me/customers/:customerId/notes', requireAuth, async (req, res) => {
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  if (!note) return res.status(400).json({ error: 'Note text is required.' });
  if (note.length > 1000) return res.status(400).json({ error: 'Please keep notes under 1,000 characters.' });
  const hasRelationship = await Request.exists({ stylistId: req.stylistId, clientId: req.params.customerId });
  if (!hasRelationship) return res.status(403).json({ error: 'No relationship with this customer.' });
  const n = await CustomerNote.create({ stylistId: req.stylistId, customerId: req.params.customerId, note });
  res.json(n);
});

// Real completed-services list — every field here already exists on the
// real Request record, including the historical price/duration snapshot.
// Delete one of your own private notes.
router.delete('/me/customers/:customerId/notes/:noteId', requireAuth, async (req, res) => {
  let n = null;
  try { n = await CustomerNote.findOne({ _id: req.params.noteId, stylistId: req.stylistId, customerId: req.params.customerId }); } catch (e) { /* bad id */ }
  if (!n) return res.status(404).json({ error: 'Note not found.' });
  await CustomerNote.deleteOne({ _id: n._id });
  res.json({ ok: true });
});

router.get('/me/completed', requireAuth, async (req, res) => {
  const list = await Request.find({ stylistId: req.stylistId, status: 'completed' }).sort({ updatedAt: -1 });
  res.json(list);
});

// Real Service Value Tracker — every number here comes directly from real
// completed Request records for this stylist. Grouped by currency rather
// than summed blindly, since a shop's currency could in principle differ
// across historical records (a past currency change, for example).
router.get('/me/service-value', requireAuth, async (req, res) => {
  const period = req.query.period || 'month';
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  let since;
  const nowDate = new Date();
  if (period === 'today') since = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  else if (period === 'week') since = now - 7 * DAY;
  else if (period === 'month') since = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
  else if (period === 'lastMonth') since = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1).getTime();
  else if (period === 'year') since = new Date(nowDate.getFullYear(), 0, 1).getTime();
  else since = 0; // 'all'
  let until = now;
  if (period === 'lastMonth') until = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();

  // Dated by WHEN THE SERVICE WAS COMPLETED (completedAt), so a later change
  // such as a rating can't move a job into another month. Older bookings
  // without completedAt fall back to their last update.
  const doneAt = (r) => r.completedAt || r.updatedAt;
  const completed = (await Request.find({ stylistId: req.stylistId, status: 'completed' })).filter((r) => doneAt(r) >= since && doneAt(r) < until);
  const byCurrency = {};
  const byService = {};
  for (const r of completed) {
    const cur = r.currencySnapshot || 'GHS';
    if (!byCurrency[cur]) byCurrency[cur] = { count: 0, total: 0 };
    byCurrency[cur].count += 1;
    if (typeof r.priceSnapshot === 'number') byCurrency[cur].total += r.priceSnapshot;
    // Real per-service breakdown, from the exact same historical snapshot
    // already stored on the request — nothing invented, nothing looked up
    // from the (possibly since-changed) current style configuration.
    const name = r.serviceNameSnapshot || 'Other';
    if (!byService[name]) byService[name] = { count: 0, total: 0, currency: cur };
    byService[name].count += 1;
    if (typeof r.priceSnapshot === 'number') byService[name].total += r.priceSnapshot;
  }
  const groups = await realCustomerGroups(req.stylistId);
  const repeatInWindow = groups.filter(g => g.requests.filter(r => r.status === 'completed' && doneAt(r) >= since && doneAt(r) < until).length >= 2).length;
  const newInWindow = groups.filter(g => {
    const c = g.requests.filter(r => r.status === 'completed').sort((a, b) => doneAt(a) - doneAt(b));
    return c.length > 0 && doneAt(c[0]) >= since && doneAt(c[0]) < until;
  }).length;

  res.json({
    period,
    completedCount: completed.length,
    // Real per-currency totals — this is "Recorded Service Value," never
    // labeled as revenue or payment received (that's the separate, real
    // Payment model below). This IS the reconciliation statement: cash the
    // professional received directly, tallied by Sheeba, never held by it.
    recordedServiceValueByCurrency: byCurrency,
    byService: Object.entries(byService).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total),
    repeatCustomers: repeatInWindow,
    newCustomers: newInWindow,
  });
});

// Finally real: "Customers Due Soon" — every earlier spec tonight that
// wanted this was correctly told it didn't exist yet. It's built on the
// customer's own real, chosen interval — never inferred, never shown for a
// customer who hasn't opted into a repeat preference with this shop.
router.get('/me/customers-due-soon', requireAuth, async (req, res) => {
  const prefs = await RepeatPreference.find({ stylistId: req.stylistId, remindersEnabled: true });
  const withStatus = await Promise.all(prefs.map(async p => {
    const computed = RepeatPreference.computeStatus(p);
    const customer = await Customer.findById(p.customerId).catch(() => null);
    return { ...computed, serviceName: p.serviceName, customerId: p.customerId, customerName: customer ? customer.name : 'Unknown' };
  }));
  const dueSoon = withStatus.filter(p => ['APPROACHING', 'DUE', 'OVERDUE'].includes(p.status));
  res.json(dueSoon);
});

module.exports = router;
