const express = require('express');
const jwt = require('jsonwebtoken');
const Stylist = require('../models/Stylist');
const Request = require('../models/Request');
const StyleRecord = require('../models/StyleRecord');
const LookReel = require('../models/LookReel');
const V = require('../lib/validate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const MIN = 3, MAX = 8;
const find = async (M, id, f) => { try { return await M.findById(id, f); } catch (e) { return null; } };
function checkFrames(raw) {
  if (!Array.isArray(raw) || raw.length < MIN || raw.length > MAX) return { ok: false, error: `A reel needs ${MIN} to ${MAX} photos.` };
  const out = [];
  for (const f of raw) {
    const p = V.photo(f, 'reel');
    if (!p.ok || !p.value) return { ok: false, error: p.error || 'Each angle needs a photo.' };
    out.push(p.value);
  }
  return { ok: true, value: out };
}
const upsert = (key, fields) => LookReel.findOneAndUpdate({ key }, { ...fields, key, updatedAt: Date.now() }, { upsert: true, new: true });
function viewer(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  try { const p = jwt.verify(h.slice(7), process.env.JWT_SECRET); return p.role === 'customer' ? { type: 'customer', id: p.id } : { type: 'stylist', id: p.id }; } catch (e) { return null; }
}

// ---- A professional's work: angles for one of their services ----
router.post('/service/:serviceId', requireAuth, async (req, res) => {
  const shop = await find(Stylist, req.stylistId);
  const item = shop && (shop.styles || []).find((s) => s.id === req.params.serviceId);
  if (!item) return res.status(404).json({ error: 'Service not found.' });
  const f = checkFrames(req.body.frames);
  if (!f.ok) return res.status(400).json({ error: f.error });
  await upsert(`service:${shop._id}:${item.id}`, { kind: 'service', shopId: shop._id.toString(), serviceId: item.id, frames: f.value, createdBy: String(req.stylistId) });
  item.reelCount = f.value.length;
  shop.markModified && shop.markModified('styles');
  await shop.save();
  res.json({ ok: true, reelCount: item.reelCount });
});
router.delete('/service/:serviceId', requireAuth, async (req, res) => {
  const shop = await find(Stylist, req.stylistId);
  const item = shop && (shop.styles || []).find((s) => s.id === req.params.serviceId);
  if (!item) return res.status(404).json({ error: 'Service not found.' });
  await LookReel.deleteOne({ key: `service:${shop._id}:${item.id}` });
  item.reelCount = 0;
  shop.markModified && shop.markModified('styles');
  await shop.save();
  res.json({ ok: true });
});
// Anyone can watch a live shop's service reel (it's their public work).
router.get('/service/:shopId/:serviceId', async (req, res) => {
  const shop = await find(Stylist, req.params.shopId, 'status accountStatus styles');
  const item = shop && (shop.styles || []).find((s) => s.id === req.params.serviceId);
  const me = viewer(req);
  const live = shop && shop.status === 'APPROVED' && (shop.accountStatus || 'ACTIVE') === 'ACTIVE' && item && item.active !== false;
  const owner = shop && me && me.type === 'stylist' && me.id === shop._id.toString();
  if (!item || (!live && !owner)) return res.status(404).json({ error: 'Not found.' });
  const reel = await LookReel.findOne({ key: `service:${shop._id}:${item.id}` });
  if (!reel) return res.status(404).json({ error: 'No reel yet.' });
  res.json({ frames: reel.frames });
});

// ---- A customer's finished look: angles added by the shop after the job ----
router.post('/look/:requestId', requireAuth, async (req, res) => {
  const r = await find(Request, req.params.requestId);
  if (!r || !r.stylistId) return res.status(404).json({ error: 'Booking not found.' });
  const me = String(req.stylistId);
  const helper = r.stylistId !== me && await Stylist.findOne({ _id: r.stylistId, 'staffAccess.stylistId': me }, '_id');
  if (r.stylistId !== me && !helper) return res.status(403).json({ error: 'Not your booking.' });
  if (r.status !== 'completed') return res.status(400).json({ error: 'Add angles once the service is completed.' });
  if (Date.now() - (r.completedAt || new Date(r.updatedAt).getTime()) > 14 * 24 * 3600 * 1000) return res.status(400).json({ error: 'Angles can be added within 14 days of the service.' });
  const rec = await StyleRecord.findOne({ requestId: r._id.toString() });
  if (!rec) return res.status(400).json({ error: 'This customer booked without an account, so there is no gallery to add it to.' });
  const f = checkFrames(req.body.frames);
  if (!f.ok) return res.status(400).json({ error: f.error });
  await upsert(`look:${r._id}`, { kind: 'look', shopId: r.stylistId, requestId: r._id.toString(), customerId: rec.customerId, frames: f.value, createdBy: me });
  rec.reelCount = f.value.length;
  await rec.save();
  res.json({ ok: true, reelCount: rec.reelCount });
});
// A look reel is private: the customer it belongs to, and the shop (owner or helpers).
router.get('/look/:requestId', async (req, res) => {
  const me = viewer(req);
  const reel = await LookReel.findOne({ key: `look:${req.params.requestId}` });
  if (!reel || !me) return res.status(404).json({ error: 'Not found.' });
  let ok = me.type === 'customer' ? reel.customerId === me.id : reel.shopId === me.id;
  if (!ok && me.type === 'stylist') ok = !!(await Stylist.findOne({ _id: reel.shopId, 'staffAccess.stylistId': me.id }, '_id'));
  if (!ok) return res.status(404).json({ error: 'Not found.' });
  res.json({ frames: reel.frames });
});

module.exports = router;
