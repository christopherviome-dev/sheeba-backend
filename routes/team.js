const express = require('express');
const Stylist = require('../models/Stylist');
const Customer = require('../models/Customer');
const Request = require('../models/Request');
const CustomerNote = require('../models/CustomerNote');
const StyleRecord = require('../models/StyleRecord');
const TeamAccessLog = require('../models/TeamAccessLog');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const find = async (M, id, fields) => { try { return await M.findById(id, fields); } catch (e) { return null; } };
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'Customer';
const TODAY = () => [Date.now() - 12 * 3600 * 1000, Date.now() + 36 * 3600 * 1000];

// Who is asking about this booking: the shop owner, or one of its helpers
// (with what the owner allows them). Anyone else gets nothing.
async function chairAccess(req, res) {
  const r = await find(Request, req.params.requestId);
  if (!r || !r.stylistId || !r.clientId) { res.status(404).json({ error: 'Booking not found.' }); return null; }
  const me = String(req.stylistId);
  if (r.stylistId === me) return { r, owner: true, phones: true };
  const shop = await find(Stylist, r.stylistId, 'staffAccess');
  const entry = shop && (shop.staffAccess || []).find((x) => x.stylistId === me);
  if (!entry) { res.status(403).json({ error: 'Not your shop.' }); return null; }
  // Helpers see a customer's card only around the visit: booked today, or checked in.
  const [from, to] = TODAY();
  const now = ['accepted', 'completed'].includes(r.status) && ((r.preferredAt >= from && r.preferredAt <= to) || (r.checkedInAt && r.checkedInAt >= from));
  if (!now) { res.status(403).json({ error: 'You can open a customer\u2019s card on the day of their visit.' }); return null; }
  return { r, owner: false, phones: entry.canSeePhones === true };
}

// The chair card: what's needed to serve the customer in the chair well.
router.get('/chair/:requestId', requireAuth, async (req, res) => {
  const a = await chairAccess(req, res); if (!a) return;
  const { r } = a, shopId = r.stylistId, customerId = r.clientId;
  const [customer, visits, notes, styles] = await Promise.all([
    find(Customer, customerId, 'name phone'),
    Request.find({ stylistId: shopId, clientId: customerId, status: 'completed' }),
    CustomerNote.find({ stylistId: shopId, customerId }),
    StyleRecord.find({ customerId, stylistId: shopId }),
  ]);
  if (!a.owner) await TeamAccessLog.create({ shopId, staffId: String(req.stylistId), customerId, requestId: r._id.toString() });
  const digits = String((customer && customer.phone) || r.clientPhone || '').replace(/\D/g, '');
  res.json({
    name: a.owner ? (customer ? customer.name : r.clientName) : firstName(customer ? customer.name : r.clientName),
    phone: a.phones ? ((customer && customer.phone) || r.clientPhone || null) : (digits ? `•••• ••${digits.slice(-2)}` : null),
    phoneHidden: !a.phones,
    today: { service: r.serviceNameSnapshot || 'Service', at: r.preferredAt || null, checkedIn: !!r.checkedInAt, note: r.note || null },
    visits: visits.sort((x, y) => (y.completedAt || y.updatedAt) - (x.completedAt || x.updatedAt)).slice(0, 20)
      .map((v) => ({ service: v.serviceNameSnapshot || 'Service', at: v.completedAt || v.updatedAt, servedBy: v.servedByName || null })),
    notes: notes.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0)).map((n) => ({ note: n.note, by: n.authorName || null, at: n.createdAt || null })),
    styles: styles.filter((s) => s.finishedPhoto || s.proPhoto || s.notes).map((s) => ({ photo: s.finishedPhoto || s.proThumb || s.proPhoto || null, notes: s.notes || null, at: s.completedAt || s.createdAt || null })),
  });
});

// A note from the chair: saved to the SHOP (not the helper), marked with who wrote it.
router.post('/chair/:requestId/notes', requireAuth, async (req, res) => {
  const a = await chairAccess(req, res); if (!a) return;
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  if (!note || note.length > 1000) return res.status(400).json({ error: 'Notes should be 1 to 1,000 characters.' });
  const author = await find(Stylist, req.stylistId, 'name');
  await CustomerNote.create({ stylistId: a.r.stylistId, customerId: a.r.clientId, note, authorId: String(req.stylistId), authorName: author ? author.name : null });
  res.json({ ok: true });
});

// ---------- The owner's view of their team ----------
router.get('/me', requireAuth, async (req, res) => {
  const shop = await find(Stylist, req.stylistId, 'staffAccess');
  if (!shop) return res.status(404).json({ error: 'Not found.' });
  const out = [];
  for (const e of shop.staffAccess || []) {
    const person = await find(Stylist, e.stylistId, 'name profilePhoto role supervisorId supervisorStatus');
    if (!person) continue;
    const [jobs, last] = await Promise.all([
      Request.countDocuments({ stylistId: String(req.stylistId), servedBy: e.stylistId, status: 'completed' }),
      TeamAccessLog.findOne({ shopId: String(req.stylistId), staffId: e.stylistId }, null, { sort: { at: -1 } }),
    ]);
    out.push({
      id: e.stylistId, name: person.name, photo: person.profilePhoto || null,
      apprentice: person.role === 'APPRENTICE' && person.supervisorId === String(req.stylistId),
      canManageBookings: e.canManageBookings !== false, canSeePhones: e.canSeePhones === true,
      jobsServed: jobs, lastOpenedCard: last ? last.at : null, since: e.addedAt || null,
    });
  }
  res.json(out);
});

router.put('/me/:staffId', requireAuth, async (req, res) => {
  const shop = await find(Stylist, req.stylistId);
  const entry = shop && (shop.staffAccess || []).find((x) => x.stylistId === req.params.staffId);
  if (!entry) return res.status(404).json({ error: 'Not on your team.' });
  if (typeof req.body.canManageBookings === 'boolean') entry.canManageBookings = req.body.canManageBookings;
  if (typeof req.body.canSeePhones === 'boolean') entry.canSeePhones = req.body.canSeePhones;
  shop.markModified && shop.markModified('staffAccess');
  await shop.save();
  res.json({ ok: true, canManageBookings: entry.canManageBookings !== false, canSeePhones: entry.canSeePhones === true });
});

// Which helper opened which customer's card, and when.
router.get('/me/activity', requireAuth, async (req, res) => {
  const logs = await TeamAccessLog.find({ shopId: String(req.stylistId) }, null, { sort: { at: -1 }, limit: 100 });
  const names = {};
  const nameOf = async (M, id) => { const k = `${M.modelName}:${id}`; if (!(k in names)) { const d = await find(M, id, 'name'); names[k] = d ? d.name : 'Someone'; } return names[k]; };
  const out = [];
  for (const l of logs) out.push({ staff: await nameOf(Stylist, l.staffId), customer: firstName(await nameOf(Customer, l.customerId)), at: l.at });
  res.json(out);
});

module.exports = router;
