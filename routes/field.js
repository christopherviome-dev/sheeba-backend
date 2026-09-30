const express = require('express');
const FieldTrip = require('../models/FieldTrip');
const FieldVisit = require('../models/FieldVisit');
const Stylist = require('../models/Stylist');
const V = require('../lib/validate');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { phoneCandidates } = require('../lib/passwords');

// Field work: trips out signing shops up in person, the stops made, and what
// came of them. Super admins and field agents only (checked live).
const router = express.Router();
router.use(requireAuth, requirePermission('field'));

const OUTCOMES = ['SIGNED_UP', 'INTERESTED', 'FOLLOW_UP', 'NOT_INTERESTED'];
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);
const find = async (M, id) => { try { return await M.findById(id); } catch (e) { return null; } };
function km(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// A trip's results: stops, sign-ups, conversion, distance driven between stops, time out.
function stats(visits) {
  const v = [...visits].sort((x, y) => x.at - y.at);
  const pts = v.filter((x) => typeof x.lat === 'number' && typeof x.lng === 'number');
  let dist = 0; for (let i = 1; i < pts.length; i++) dist += km(pts[i - 1], pts[i]);
  const signed = v.filter((x) => x.outcome === 'SIGNED_UP').length;
  return {
    stops: v.length, signedUp: signed, conversion: v.length ? Math.round((signed / v.length) * 100) : null,
    interested: v.filter((x) => x.outcome === 'INTERESTED' || x.outcome === 'FOLLOW_UP').length,
    km: Math.round(dist * 10) / 10, hours: v.length > 1 ? Math.round(((v[v.length - 1].at - v[0].at) / 3600000) * 10) / 10 : 0,
    areas: [...new Set(v.map((x) => x.area).filter(Boolean))].length,
  };
}
const lean = (x) => ({ _id: x._id, tripId: x.tripId, lat: x.lat, lng: x.lng, placeName: x.placeName, area: x.area, services: x.services, outcome: x.outcome, at: x.at, linked: !!x.signedUpStylistId });

router.post('/trips', async (req, res) => {
  const name = text(req.body.name, 80);
  if (!name || name.length < 2) return res.status(400).json({ error: 'Give the trip a name, e.g. "Kasoa, Saturday".' });
  const me = await Stylist.findById(req.stylistId, 'name');
  const t = await FieldTrip.create({ name, area: text(req.body.area, 60), region: text(req.body.region, 60), country: text(req.body.country, 2) || 'GH', createdBy: String(req.stylistId), createdByName: me ? me.name : null });
  res.json(t);
});

router.get('/trips', async (req, res) => {
  const trips = await FieldTrip.find({}).sort({ startedAt: -1 }).limit(100);
  const visits = await FieldVisit.find({ tripId: { $in: trips.map((t) => t._id.toString()) } }, 'tripId lat lng outcome area at');
  res.json(trips.map((t) => ({ ...(t.toObject ? t.toObject() : t), stats: stats(visits.filter((v) => v.tripId === t._id.toString())) })));
});

router.get('/trips/:id', async (req, res) => {
  const t = await find(FieldTrip, req.params.id);
  if (!t) return res.status(404).json({ error: 'Trip not found.' });
  const visits = (await FieldVisit.find({ tripId: t._id.toString() })).sort((a, b) => a.at - b.at);
  res.json({ trip: t, visits, stats: stats(visits) });
});

router.put('/trips/:id', async (req, res) => {
  const t = await find(FieldTrip, req.params.id);
  if (!t) return res.status(404).json({ error: 'Trip not found.' });
  if (req.body.end === true && !t.endedAt) t.endedAt = Date.now();
  if (req.body.notes !== undefined) t.notes = text(req.body.notes, 2000);
  await t.save();
  res.json(t);
});

// Log a stop. Safe to send twice (e.g. after being offline): the phone's key makes it count once.
router.post('/trips/:id/visits', async (req, res) => {
  const t = await find(FieldTrip, req.params.id);
  if (!t) return res.status(404).json({ error: 'Trip not found.' });
  const clientKey = text(req.body.clientKey, 80);
  if (!clientKey || clientKey.length < 8) return res.status(400).json({ error: 'Missing stop key.' });
  const existing = await FieldVisit.findOne({ clientKey });
  if (existing) return res.json({ visit: existing, duplicate: true });
  const placeName = text(req.body.placeName, 80);
  if (!placeName) return res.status(400).json({ error: 'Enter the shop\u2019s name.' });
  if (!OUTCOMES.includes(req.body.outcome)) return res.status(400).json({ error: 'Choose how it went.' });
  const num = (v, lo, hi) => (typeof v === 'number' && v >= lo && v <= hi ? v : null);
  const lat = num(req.body.lat, -90, 90), lng = num(req.body.lng, -180, 180);
  const photosIn = Array.isArray(req.body.photos) ? req.body.photos : [];
  if (photosIn.length > 4) return res.status(400).json({ error: 'Up to 4 photos per stop.' });
  if (photosIn.length && req.body.photoConsent !== true) return res.status(400).json({ error: 'Photos need the person\u2019s agreement first.' });
  const photos = [];
  for (const p of photosIn) { const c = V.photo(p, 'reel'); if (!c.ok || !c.value) return res.status(400).json({ error: c.error || 'Invalid photo.' }); photos.push(c.value); }
  const at = typeof req.body.at === 'number' && req.body.at > Date.now() - 14 * 24 * 3600 * 1000 && req.body.at < Date.now() + 3600000 ? req.body.at : Date.now();
  const services = (Array.isArray(req.body.services) ? req.body.services : []).map((s) => text(s, 30)).filter(Boolean).slice(0, 8);
  const visit = await FieldVisit.create({
    tripId: t._id.toString(), clientKey, lat, lng, placeName, area: text(req.body.area, 60), services, outcome: req.body.outcome,
    note: text(req.body.note, 1000), contactPhone: text(req.body.contactPhone, 30), photos, photoConsent: photos.length > 0, loggedBy: String(req.stylistId), at,
  });
  res.json({ visit });
});

// Update a stop later: a new outcome, a note, or link the shop's Mepluge account (by phone) once they sign up.
router.put('/visits/:id', async (req, res) => {
  const v = await find(FieldVisit, req.params.id);
  if (!v) return res.status(404).json({ error: 'Stop not found.' });
  if (req.body.outcome !== undefined) { if (!OUTCOMES.includes(req.body.outcome)) return res.status(400).json({ error: 'Unknown outcome.' }); v.outcome = req.body.outcome; }
  if (req.body.note !== undefined) v.note = text(req.body.note, 1000);
  if (req.body.linkPhone) {
    const shop = await Stylist.findOne({ phone: { $in: phoneCandidates(req.body.linkPhone) } }, '_id name salonName');
    if (!shop) return res.status(404).json({ error: 'No Mepluge professional account uses that number yet.' });
    v.signedUpStylistId = shop._id.toString(); v.outcome = 'SIGNED_UP';
  }
  await v.save();
  res.json({ visit: v });
});

router.delete('/visits/:id', async (req, res) => {
  const v = await find(FieldVisit, req.params.id);
  if (!v) return res.status(404).json({ error: 'Stop not found.' });
  await FieldVisit.deleteOne({ _id: v._id });
  res.json({ ok: true });
});

// Coverage across all trips: every stop (no photos), results by area and region.
router.get('/overview', async (req, res) => {
  const [trips, visits] = await Promise.all([FieldTrip.find({}, 'name region area startedAt'), FieldVisit.find({}, 'tripId lat lng placeName area services outcome at signedUpStylistId')]);
  const regionOf = Object.fromEntries(trips.map((t) => [t._id.toString(), t.region || 'Unspecified']));
  const group = (keyFn) => {
    const m = {};
    for (const v of visits) { const k = keyFn(v) || 'Unspecified'; m[k] = m[k] || []; m[k].push(v); }
    return Object.entries(m).map(([key, list]) => ({ key, ...stats(list) })).sort((a, b) => b.stops - a.stops);
  };
  res.json({ trips: trips.length, totals: stats(visits), linkedAccounts: visits.filter((v) => v.signedUpStylistId).length,
    byArea: group((v) => v.area), byRegion: group((v) => regionOf[v.tripId]), stops: visits.map(lean) });
});

module.exports = router;
