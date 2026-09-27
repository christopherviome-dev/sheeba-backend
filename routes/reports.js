const express = require('express');
const Report = require('../models/Report');
const Stylist = require('../models/Stylist');
const Customer = require('../models/Customer');
const Request = require('../models/Request');
const AdminAction = require('../models/AdminAction');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { notifyAllAdmins } = require('./notifications');
const { accountFromRequest } = require('../lib/invites');
const attempts = require('../lib/attempts');

const router = express.Router();
const CATEGORIES = ['NO_SHOW', 'UNSAFE', 'HARASSMENT', 'FRAUD', 'POOR_SERVICE', 'FAKE_PROFILE', 'OTHER'];
const findSafe = async (M, id) => { try { return await M.findById(id); } catch (e) { return null; } };

// File a report. Stays easy (no login needed to report a professional), but
// checked: real text, a real target, and at most 5 reports per 15 minutes
// from one address. A professional can report a CUSTOMER only if they have
// had a booking with them, so reporting can't be used to harass strangers.
router.post('/', async (req, res) => {
  const ipKey = `report-ip:${req.ip || 'unknown'}`;
  const blocked = attempts.status([ipKey]);
  if (blocked.blocked) return res.status(429).json({ error: `Too many reports from here. Please wait ${blocked.retryMinutes} minutes.` });

  const detail = typeof req.body.detail === 'string' ? req.body.detail.trim() : '';
  if (detail.length < 10) return res.status(400).json({ error: 'Please describe what happened (at least a sentence).' });
  if (detail.length > 2000) return res.status(400).json({ error: 'Please keep it under 2,000 characters.' });
  const contact = typeof req.body.contact === 'string' ? req.body.contact.trim().slice(0, 100) : null;
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : null;
  const who = accountFromRequest(req);

  let targetType = req.body.targetType === 'customer' ? 'customer' : 'stylist';
  let targetId = null, requestId = null;
  if (targetType === 'customer') {
    if (!who || who.type !== 'stylist') return res.status(401).json({ error: 'Log in to your shop to report a customer.' });
    const booking = req.body.requestId ? await findSafe(Request, req.body.requestId) : null;
    if (!booking || String(booking.stylistId) !== who.id || !booking.clientId) return res.status(403).json({ error: 'You can only report customers you have had a booking with.' });
    const customer = await findSafe(Customer, booking.clientId);
    if (!customer) return res.status(404).json({ error: 'That customer no longer has an account.' });
    targetId = customer._id.toString(); requestId = booking._id.toString();
  } else if (req.body.stylistId) {
    const shop = await findSafe(Stylist, req.body.stylistId);
    if (!shop) return res.status(404).json({ error: 'That shop was not found.' });
    targetId = shop._id.toString();
    if (req.body.requestId) {
      const booking = await findSafe(Request, req.body.requestId);
      if (booking && String(booking.stylistId) === targetId) requestId = booking._id.toString();
    }
  } else {
    targetType = null; // a general report about Sheeba
  }

  attempts.fail([[ipKey, 5]]); // counts every report filed from this address
  const r = await Report.create({
    stylistId: targetType === 'stylist' ? targetId : null, targetType, targetId, requestId, category,
    detail, contact, urgent: req.body.urgent === true,
    reporterType: who ? who.type : null, reporterId: who ? who.id : null,
  });
  await notifyAllAdmins({ type: 'REPORT_FILED', title: r.urgent ? 'Urgent report filed' : 'New report filed', message: detail.slice(0, 80), entityType: 'admin', entityId: r._id.toString(), priority: r.urgent ? 'time_sensitive' : 'important' });
  res.json({ ok: true, id: r._id });
});

// Admin: all reports, with the names behind the IDs so they can be acted on.
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const list = await Report.find({}).sort({ createdAt: -1 });
  const out = [];
  for (const r of list) {
    const tType = r.targetType || (r.stylistId ? 'stylist' : null);
    const tId = r.targetId || r.stylistId;
    const T = tType === 'customer' ? await findSafe(Customer, tId) : tType === 'stylist' ? await findSafe(Stylist, tId) : null;
    const rep = r.reporterId ? await findSafe(r.reporterType === 'customer' ? Customer : Stylist, r.reporterId) : null;
    const booking = r.requestId ? await findSafe(Request, r.requestId) : null;
    out.push({
      ...(r.toObject ? r.toObject() : r),
      target: T ? { type: tType, id: tId, name: T.salonName || T.name, phone: T.phone, accountStatus: T.accountStatus || 'ACTIVE', restrictionReason: T.restrictionReason || null } : null,
      reporter: rep ? { type: r.reporterType, name: rep.salonName || rep.name, phone: rep.phone } : null,
      booking: booking ? { service: booking.serviceNameSnapshot || 'Service', status: booking.status, when: booking.preferredAt || booking.date || null } : null,
    });
  }
  res.json(out);
});

// Kept exactly as-is for the older site.
router.put('/:id/resolve', requireAuth, requireAdmin, async (req, res) => {
  const r = await Report.findByIdAndUpdate(req.params.id, { resolved: true, state: 'RESOLVED' }, { new: true });
  try { await AdminAction.create({ adminId: req.stylistId, action: 'REPORT_RESOLVED', targetType: 'report', targetId: req.params.id }); } catch (e) { /* non-fatal */ }
  res.json(r);
});

// The case workflow: move a report through its states, with a private note.
router.put('/:id/state', requireAuth, requireAdmin, async (req, res) => {
  const { state } = req.body;
  const valid = ['OPEN', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'ESCALATED', 'RESOLVED', 'DISMISSED'];
  if (!valid.includes(state)) return res.status(400).json({ error: 'Invalid state.' });
  const update = { state, resolved: ['RESOLVED', 'DISMISSED'].includes(state) };
  if (typeof req.body.adminNotes === 'string') update.adminNotes = req.body.adminNotes.slice(0, 2000);
  let r = null;
  try { r = await Report.findByIdAndUpdate(req.params.id, update, { new: true }); } catch (e) { /* bad id */ }
  if (!r) return res.status(404).json({ error: 'Not found.' });
  try { await AdminAction.create({ adminId: req.stylistId, action: 'REPORT_STATE_CHANGED', targetType: 'report', targetId: req.params.id, meta: { state } }); } catch (e) { /* non-fatal */ }
  res.json(r);
});

module.exports = router;
