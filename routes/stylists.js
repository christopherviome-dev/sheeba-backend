const express = require('express');
const jwt = require('jsonwebtoken');
const Stylist = require('../models/Stylist');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function publicStylist(s) {
  const obj = s.toObject ? s.toObject() : s;
  delete obj.passwordHash;
  return obj;
}
function uid(prefix) { return prefix + '_' + Math.random().toString(36).slice(2, 9); }

// Reads an optional JWT without requiring one — used only to decide whether
// this request gets the admin's full view or the public APPROVED-only view.
// Never throws; an invalid/missing token just means "treat as public."
function tryGetAdminFlag(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return false;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return !!payload.isAdmin;
  } catch (e) {
    return false;
  }
}

// Public: browse shops. Only APPROVED shops are visible to normal visitors;
// an admin's own request (valid admin JWT) sees every shop, including
// UNDER_REVIEW ones, so nothing can go silently unreviewed.
router.get('/', async (req, res) => {
  const isAdminRequest = tryGetAdminFlag(req);
  const filter = isAdminRequest ? {} : { status: 'APPROVED' };
  const list = await Stylist.find(filter);
  res.json(list.map(publicStylist));
});

// Auth: get my own record
router.get('/me', requireAuth, async (req, res) => {
  const st = await Stylist.findById(req.stylistId);
  if (!st) return res.status(404).json({ error: 'Not found.' });
  res.json(publicStylist(st));
});

const Request = require('../models/Request');

// Computes AND STORES Group Points + Star status — the single source of
// truth going forward. Called after anything that could change a shop's
// score: style added/edited/removed, follow/unfollow, like/unlike, and a
// booking transitioning to 'completed' (that last one is called from
// routes/requests.js via module.exports.recalculateGroupPoints, since the
// completion happens on a different route file).
async function recalculateGroupPoints(stylistId) {
  const st = await Stylist.findById(stylistId);
  if (!st) return null;
  const completed = await Request.countDocuments({ stylistId: st._id.toString(), status: 'completed' });
  const likes = (st.styles || []).reduce((a, s) => a + ((s.likes || []).length), 0);
  const photoBonus = (st.styles || []).filter(s => s.photo).length * 3;
  const verifiedBonus = st.verified ? 10 : 0;
  const score = (st.followers || []).length * 3 + likes + completed * 5 + photoBonus + verifiedBonus;
  st.groupPoints = score;
  st.starStatus = score >= 1000;
  await st.save();
  return st;
}

// Auth: update my page (salon name, category, area, bio, cover photo)
router.put('/me', requireAuth, async (req, res) => {
  const { salonName, name, category, area, bio, coverPhoto, profilePhoto, brandColor } = req.body;
  const st = await Stylist.findById(req.stylistId);
  if (!st) return res.status(404).json({ error: 'Not found.' });
  if (salonName !== undefined) st.salonName = salonName;
  if (name !== undefined) st.name = name;
  if (category !== undefined) st.category = category;
  if (area !== undefined) st.area = area;
  if (bio !== undefined) st.bio = bio;
  if (coverPhoto !== undefined) st.coverPhoto = coverPhoto;
  if (profilePhoto !== undefined) st.profilePhoto = profilePhoto;
  await st.save();
  const updated = await recalculateGroupPoints(st._id);
  if (brandColor !== undefined) {
    if (updated.groupPoints >= 40) {
      updated.brandColor = brandColor;
      await updated.save();
    }
    // else: silently ignored — perk not yet earned, matches the frontend's own gate
  }
  res.json(publicStylist(updated));
});

// Auth: mark myself active (for the online indicator)
router.post('/me/touch', requireAuth, async (req, res) => {
  await Stylist.findByIdAndUpdate(req.stylistId, { lastActiveAt: Date.now() });
  res.json({ ok: true });
});

// Auth: add a style/service
router.post('/me/styles', requireAuth, async (req, res) => {
  const { name, price, duration, desc, photo } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price are required.' });
  const st = await Stylist.findById(req.stylistId);
  st.styles.push({ id: uid('sty'), name, price, duration, desc, photo, likes: [] });
  await st.save();
  const updated = await recalculateGroupPoints(st._id);
  res.json(publicStylist(updated));
});

// Auth: update a style's price
router.put('/me/styles/:styleId', requireAuth, async (req, res) => {
  const st = await Stylist.findById(req.stylistId);
  const style = st.styles.find(s => s.id === req.params.styleId);
  if (!style) return res.status(404).json({ error: 'Style not found.' });
  if (req.body.price !== undefined) style.price = req.body.price;
  await st.save();
  const updated = await recalculateGroupPoints(st._id);
  res.json(publicStylist(updated));
});

// Auth: remove a style
router.delete('/me/styles/:styleId', requireAuth, async (req, res) => {
  const st = await Stylist.findById(req.stylistId);
  st.styles = st.styles.filter(s => s.id !== req.params.styleId);
  await st.save();
  const updated = await recalculateGroupPoints(st._id);
  res.json(publicStylist(updated));
});

// Auth: submit ID verification (Ghana Card number and/or photo)
router.post('/me/verify', requireAuth, async (req, res) => {
  const { ghanaCardNum, verifyPhoto } = req.body;
  if (!ghanaCardNum && !verifyPhoto) return res.status(400).json({ error: 'Add a Ghana Card number, a photo, or both.' });
  const st = await Stylist.findById(req.stylistId);
  if (ghanaCardNum) st.ghanaCardNum = ghanaCardNum;
  if (verifyPhoto) st.verifyPhoto = verifyPhoto;
  st.pendingReview = true;
  await st.save();
  res.json(publicStylist(st));
});

// Admin: approve a stylist's ID verification (Ghana Card / photo review).
// NOTE: this is a DIFFERENT concept from shop-listing approval below —
// a stylist can be ID-verified without their shop being publicly approved,
// and vice versa. Do not merge these two routes.
router.post('/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  const st = await Stylist.findByIdAndUpdate(req.params.id, { verified: true, pendingReview: false }, { new: true });
  res.json(publicStylist(st));
});

// Admin: approve a shop for public Discovery listing (the UNDER_REVIEW gate).
router.post('/:id/approve-review', requireAuth, requireAdmin, async (req, res) => {
  const st = await Stylist.findByIdAndUpdate(req.params.id, { status: 'APPROVED' }, { new: true });
  if (!st) return res.status(404).json({ error: 'Not found.' });
  res.json(publicStylist(st));
});

// Public: follow/unfollow (by clientId, no login needed for browsing clients)
router.post('/:id/follow', async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: 'Missing clientId.' });
  const st = await Stylist.findById(req.params.id);
  if (!st) return res.status(404).json({ error: 'Not found.' });
  const i = st.followers.indexOf(clientId);
  if (i >= 0) st.followers.splice(i, 1); else st.followers.push(clientId);
  await st.save();
  const updated = await recalculateGroupPoints(st._id);
  res.json(publicStylist(updated));
});

// Public: like/unlike a style
router.post('/:id/styles/:styleId/like', async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: 'Missing clientId.' });
  const st = await Stylist.findById(req.params.id);
  if (!st) return res.status(404).json({ error: 'Not found.' });
  const style = st.styles.find(s => s.id === req.params.styleId);
  if (!style) return res.status(404).json({ error: 'Style not found.' });
  const i = style.likes.indexOf(clientId);
  if (i >= 0) style.likes.splice(i, 1); else style.likes.push(clientId);
  await st.save();
  const updated = await recalculateGroupPoints(st._id);
  res.json(publicStylist(updated));
});

// Exposed so routes/requests.js can trigger a recalculation when a booking
// transitions to 'completed' — that event happens on a different route file.
module.exports = router;
module.exports.recalculateGroupPoints = recalculateGroupPoints;
