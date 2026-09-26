const express = require('express');
const jwt = require('jsonwebtoken');
const Stylist = require('../models/Stylist');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const Activity = require('../models/Activity');
const Referral = require('../models/Referral');
const AdminAction = require('../models/AdminAction');
const { notify, notifyAllAdmins } = require('./notifications');
const { normalizeGhanaCard, normalizeIdNumber, cleanLegalName, checkCardPhoto } = require('../lib/identity');
const { COUNTRIES, countryOf } = require('../lib/countries');
const V = require('../lib/validate');
const Customer = require('../models/Customer');
const { ensureCode } = require('../lib/codes');
const AVAILABILITY = ['AVAILABLE', 'TAKING_REQUESTS', 'UNAVAILABLE', 'AWAY'];

const router = express.Router();

// Strips fields that must never leave the server for a given context.
// includeSensitive=true is only correct when the caller is either the
// account's own owner, or an admin acting on ID-verification/shop-review —
// both legitimate, existing uses. Every public-facing or anonymous-action
// response must pass false.
function publicStylist(s, includeSensitive = false) {
  const obj = s.toObject ? s.toObject() : s;
  delete obj.passwordHash;
  if (!includeSensitive) {
    delete obj.ghanaCardNum;
    delete obj.idNumber;
    delete obj.verifyPhoto;
    delete obj.legalFullName;
    delete obj.verificationRejectedReason;
    delete obj.mustChangePassword;
    delete obj.invitedByType;
    delete obj.invitedById;
    delete obj.passwordChangedAt;
  }
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
  const filter = isAdminRequest ? {} : { status: 'APPROVED', accountStatus: 'ACTIVE' };
  const list = await Stylist.find(filter);
  // NOTE: deliberately NOT `list.map(publicStylist)` — Array.map passes the
  // element's index as the function's second argument, which is exactly
  // publicStylist's includeSensitive parameter. That would have leaked
  // sensitive fields for every item except index 0 on any request, since a
  // truthy index (1, 2, 3...) would silently mean "include sensitive data."
  res.json(list.map(s => publicStylist(s, isAdminRequest)));
});

// Auth: get my own record
// ---------- Discover feed ----------
// A lean public feed for browsing. Deliberately small, because customers pay
// for mobile data by the megabyte: small thumbnails instead of full photos,
// and nothing private or unused (no phone numbers, no follower or like ID
// lists, no ID documents, no cover photos). Full photos load only on a shop's
// own page, when someone actually opens it.
const { discoverCard, DISCOVER_SHOPS } = require('../lib/discover');
const { accountFromRequest } = require('../lib/invites');

router.get('/discover', async (req, res) => {
  // Shops in one country at a time, so prices share a currency and "near" means near.
  const country = COUNTRIES[String(req.query.country || '').toUpperCase()] ? String(req.query.country).toUpperCase() : 'GH';
  const shops = (await Stylist.find({ status: 'APPROVED', accountStatus: 'ACTIVE' })).filter((s) => countryOf(s) === country);
  let visits = {};
  try {
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const agg = await Activity.aggregate([
      { $match: { type: 'SHOP_VISITED', createdAt: { $gt: weekAgo } } },
      { $group: { _id: '$stylistId', n: { $sum: 1 } } },
    ]);
    visits = Object.fromEntries(agg.map((a) => [String(a._id), a.n]));
  } catch (e) { /* popularity is optional; the feed still works without it */ }
  const cards = shops
    .map((s) => discoverCard(s, visits[s._id.toString()] || 0))
    .sort((a, b) => b._score - a._score)
    .slice(0, DISCOVER_SHOPS)
    .map((x) => x.card);
  res.json(cards);
});

router.get('/me', requireAuth, async (req, res) => {
  const st = await Stylist.findById(req.stylistId);
  if (!st) return res.status(404).json({ error: 'Not found.' });
  try { await ensureCode(st, Stylist, Customer); } catch (e) { /* a code can be made next time */ }
  res.json(publicStylist(st, true));
});

// Deterministic aliases only, per the spec's explicit instruction not to
// build an AI synonym engine — a small, maintainable, real dictionary.
const SEARCH_ALIASES = {
  'box braids': ['box braid', 'boxbraids'],
  'knotless': ['knotless braids', 'boho knotless'],
  'low fade': ['fade', 'low fade haircut'],
  'retwist': ['loc retwist', 'locs retwist'],
  'gel nails': ['gel', 'gelnails'],
  'soft glam': ['glam makeup', 'glam'],
  'french tips': ['french manicure', 'frenchtips'],
};
function expandQuery(q) {
  const terms = new Set([q]);
  for (const [key, aliases] of Object.entries(SEARCH_ALIASES)) {
    if (q === key || aliases.includes(q)) { terms.add(key); aliases.forEach(a => terms.add(a)); }
  }
  return [...terms];
}

// Real server-side search — queries the database directly rather than
// shipping every shop to the client for JS filtering. Only ever searches
// APPROVED shops (or everyone, for an admin request), matching the exact
// same visibility rule enforced everywhere else in this file.
// Real haversine great-circle distance in km — plain math, no external
// service, no API key. Returns null if either point is missing, so callers
// never fabricate a distance for a shop that hasn't opted into sharing one.
function distanceKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => typeof v !== 'number')) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

router.get('/search', async (req, res) => {
  const isAdminRequest = tryGetAdminFlag(req);
  const q = (req.query.q || '').trim().toLowerCase();
  const category = req.query.category;
  const area = req.query.area;
  const myLat = req.query.lat ? parseFloat(req.query.lat) : null;
  const myLng = req.query.lng ? parseFloat(req.query.lng) : null;
  const filter = isAdminRequest ? {} : { status: 'APPROVED', accountStatus: 'ACTIVE' };
  if (category) filter.category = category;
  if (area) filter.area = new RegExp(area, 'i');
  let candidates = await Stylist.find(filter);
  if (q) {
    const terms = expandQuery(q);
    candidates = candidates.filter(st => {
      const haystack = [st.salonName, st.name, st.category, st.area, st.bio, ...(st.styles || []).map(s => s.name)]
        .filter(Boolean).join(' ').toLowerCase();
      return terms.some(t => haystack.includes(t));
    });
  }
  if (q) { try { await Activity.create({ type: 'SEARCH_PERFORMED', meta: { q, resultCount: candidates.length } }); } catch (e) { /* non-fatal */ } }
  let results = candidates.map(s => publicStylist(s, isAdminRequest));
  // Real distance, only when the searcher shared their own real location AND
  // the shop has one on file. A shop with no location just gets distance:
  // null — never a guessed or zero distance standing in for "unknown."
  if (myLat !== null && myLng !== null) {
    results = results.map(s => ({ ...s, distanceKm: (s.location && s.location.lat != null) ? distanceKm(myLat, myLng, s.location.lat, s.location.lng) : null }));
    results.sort((a, b) => {
      if (a.distanceKm === null && b.distanceKm === null) return 0;
      if (a.distanceKm === null) return 1; // unknown-distance shops sort last, never fabricated to the front
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });
  }
  res.json(results);
});

// For a staff account: which real shops have they actually been granted
// access to — never guessed, always a genuine staffAccess entry.
router.get('/managed-by-me', requireAuth, async (req, res) => {
  const shops = await Stylist.find({ 'staffAccess.stylistId': req.stylistId });
  res.json(shops.map(s => publicStylist(s, false)));
});

// Public: single work item lookup, for a direct/shared link to one style —
// only ever from an approved (or, for the owner/admin, any) shop.
router.get('/styles/:styleId', async (req, res) => {
  const isAdminRequest = tryGetAdminFlag(req);
  const filter = isAdminRequest ? {} : { status: 'APPROVED', accountStatus: 'ACTIVE' };
  const st = await Stylist.findOne({ ...filter, 'styles.id': req.params.styleId });
  if (!st) return res.status(404).json({ error: 'Style not found.' });
  const style = st.styles.find(s => s.id === req.params.styleId);
  res.json({ style, shop: publicStylist(st, isAdminRequest) });
});

// Public: fetch a single shop by id — this is what powers a shop's clean,
// shareable public URL (see Priority 2). Same security rule as the list
// route above: an UNDER_REVIEW shop is invisible to everyone except an
// admin or the shop's own owner, so a direct link can never be used to
// bypass the review gate.
router.get('/:id', async (req, res) => {
  let st;
  try {
    st = await Stylist.findById(req.params.id);
  } catch (e) {
    // Mongoose throws (not rejects-gracefully) on a malformed id — e.g. a
    // request to a route we didn't expect, like /search, landing here
    // before it was reordered below. Any non-ObjectId string must return a
    // clean 404, never crash the whole process.
    return res.status(404).json({ error: 'Shop not found.' });
  }
  if (!st) return res.status(404).json({ error: 'Shop not found.' });
  const isAdminRequest = tryGetAdminFlag(req);
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  let isOwner = false;
  if (token) {
    try { isOwner = jwt.verify(token, process.env.JWT_SECRET).id === st._id.toString(); } catch (e) { /* not the owner */ }
  }
  const isPubliclyVisible = st.status === 'APPROVED' && st.accountStatus === 'ACTIVE';
  if (!isPubliclyVisible && !isAdminRequest && !isOwner) return res.status(404).json({ error: 'Shop not found.' });
  res.json(publicStylist(st, isAdminRequest || isOwner));
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
  const b = req.body || {};
  const st = await Stylist.findById(req.stylistId);
  if (!st) return res.status(404).json({ error: 'Not found.' });
  // Every field is optional (only what's sent changes), but anything sent is checked.
  const checks = {
    salonName: () => V.text(b.salonName, { label: 'Shop name', max: 60 }),
    name: () => V.text(b.name, { label: 'Your name', min: 2, max: 60 }),
    category: () => V.text(b.category, { label: 'Category', max: 40 }),
    area: () => V.text(b.area, { label: 'Area', max: 60 }),
    bio: () => V.longText(b.bio, { label: 'Description', max: 600 }),
    profilePhoto: () => V.photo(b.profilePhoto, 'profile'),
    coverPhoto: () => V.photo(b.coverPhoto, 'profile'),
    workModes: () => V.workModes(b.workModes),
  };
  const changes = {};
  for (const [field, check] of Object.entries(checks)) {
    if (b[field] === undefined) continue;
    const r = check();
    if (!r.ok) return res.status(400).json({ error: r.error });
    changes[field] = r.value;
  }
  if (b.availability !== undefined) {
    if (!AVAILABILITY.includes(b.availability)) return res.status(400).json({ error: 'Unknown availability.' });
    changes.availability = b.availability;
  }
  // Check the storage total BEFORE changing anything.
  let total = V.totalPhotoChars(st);
  for (const f of ['profilePhoto', 'coverPhoto']) {
    if (f in changes) total += V.photoLen(changes[f]) - V.photoLen(st[f]);
  }
  if (total > V.MAX_TOTAL_PHOTO_CHARS) return res.status(400).json({ error: V.STORAGE_FULL });
  Object.assign(st, changes);
  const { lat, lng } = b;
  if (lat !== undefined && lng !== undefined && typeof lat === 'number' && typeof lng === 'number' && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
    st.location = { lat, lng };
  }
  await st.save();
  const updated = await recalculateGroupPoints(st._id);
  if (b.brandColor !== undefined) {
    if (updated.groupPoints >= 40) {
      updated.brandColor = b.brandColor;
      await updated.save();
    }
    // else: silently ignored — perk not yet earned, matches the frontend's own gate
  }
  res.json(publicStylist(updated, true));
});

// Auth: mark myself active (for the online indicator)
router.post('/me/touch', requireAuth, async (req, res) => {
  await Stylist.findByIdAndUpdate(req.stylistId, { lastActiveAt: Date.now() });
  res.json({ ok: true });
});

// Auth: add a style/service
// Services (each can carry a photo of the work). Checked the same way as the profile.
function checkService(b, { partial }) {
  const out = {};
  const checks = {
    name: () => V.text(b.name, { label: 'Service name', min: 2, max: 60 }),
    price: () => V.price(b.price),
    duration: () => V.text(b.duration, { label: 'Duration', max: 30 }),
    desc: () => V.longText(b.desc, { label: 'Description', max: 300 }),
    photo: () => V.photo(b.photo, 'service'),
    photoThumb: () => V.photo(b.photoThumb, 'thumb'),
  };
  for (const [field, check] of Object.entries(checks)) {
    if (b[field] === undefined) {
      if (!partial && (field === 'name' || field === 'price')) return { error: field === 'name' ? 'Service name is required.' : 'Price is required.' };
      continue;
    }
    const r = check();
    if (!r.ok) return { error: r.error };
    out[field] = r.value;
  }
  // A thumbnail always belongs to the current photo: removing or replacing
  // the photo without a new thumbnail clears the old one.
  if ('photo' in out && !('photoThumb' in out)) out.photoThumb = null;
  if (out.photo === null) out.photoThumb = null;
  return { value: out };
}

router.post('/me/styles', requireAuth, async (req, res) => {
  const st = await Stylist.findById(req.stylistId);
  if (!st) return res.status(404).json({ error: 'Not found.' });
  if ((st.styles || []).length >= V.MAX_SERVICES) return res.status(400).json({ error: `You can list up to ${V.MAX_SERVICES} services. Remove one to add another.` });
  const c = checkService(req.body || {}, { partial: false });
  if (c.error) return res.status(400).json({ error: c.error });
  if (V.totalPhotoChars(st) + V.photoLen(c.value.photo) + V.photoLen(c.value.photoThumb) > V.MAX_TOTAL_PHOTO_CHARS) return res.status(400).json({ error: V.STORAGE_FULL });
  st.styles.push({ id: uid('sty'), ...c.value, likes: [], addedAt: Date.now() });
  await st.save();
  try { await Activity.create({ stylistId: st._id.toString(), type: c.value.photo ? 'WORK_UPLOADED' : 'SERVICE_ADDED' }); } catch (e) { /* non-fatal */ }
  const updated = await recalculateGroupPoints(st._id);
  res.json(publicStylist(updated, true));
});

// Auth: update a style's price
router.put('/me/styles/:styleId', requireAuth, async (req, res) => {
  const st = await Stylist.findById(req.stylistId);
  if (!st) return res.status(404).json({ error: 'Not found.' });
  const style = st.styles.find(s => s.id === req.params.styleId);
  if (!style) return res.status(404).json({ error: 'Service not found.' });
  const c = checkService(req.body || {}, { partial: true });
  if (c.error) return res.status(400).json({ error: c.error });
  if ('photo' in c.value && V.totalPhotoChars(st) + V.photoLen(c.value.photo) + V.photoLen(c.value.photoThumb)
      - V.photoLen(style.photo) - V.photoLen(style.photoThumb) > V.MAX_TOTAL_PHOTO_CHARS) {
    return res.status(400).json({ error: V.STORAGE_FULL });
  }
  const addedPhoto = c.value.photo && c.value.photo !== style.photo;
  Object.assign(style, c.value);
  if (req.body.active !== undefined) style.active = !!req.body.active;
  st.markModified('styles');
  await st.save();
  if (addedPhoto) { try { await Activity.create({ stylistId: st._id.toString(), type: 'WORK_UPLOADED' }); } catch (e) { /* non-fatal */ } }
  const updated = await recalculateGroupPoints(st._id);
  res.json(publicStylist(updated, true));
});

// Auth: remove a style
router.delete('/me/styles/:styleId', requireAuth, async (req, res) => {
  const st = await Stylist.findById(req.stylistId);
  if (!st) return res.status(404).json({ error: 'Not found.' });
  const before = st.styles.length;
  st.styles = st.styles.filter(s => s.id !== req.params.styleId);
  if (st.styles.length === before) return res.status(404).json({ error: 'Service not found.' });
  await st.save();
  const updated = await recalculateGroupPoints(st._id);
  res.json(publicStylist(updated, true));
});

// Auth: submit ID verification (Ghana Card number and/or photo)
// Stylist submits (or resubmits) their Ghana Card for review. All three
// pieces are required in the final state: legal name, card number, card
// photo. A resubmission may omit the photo to keep the one already on file
// (e.g. when only the name needed correcting).
router.post('/me/verify', requireAuth, async (req, res) => {
  try {
    const st = await Stylist.findById(req.stylistId);
    if (!st) return res.status(404).json({ error: 'Account not found.' });
    // A verified badge must always describe the details that were actually
    // reviewed. Silently swapping name/card after approval would defeat it.
    if (st.verified) return res.status(400).json({ error: 'Your identity is already verified. Contact Sheeba support if your details changed.' });

    const nameCheck = cleanLegalName(req.body.legalFullName);
    if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.error });
    // Which documents count depends on the professional's country.
    const country = COUNTRIES[countryOf(st)];
    const allowed = country.idDocuments.map(([k]) => k);
    const idType = req.body.idType || (allowed.length === 1 ? allowed[0] : null);
    if (!allowed.includes(idType)) return res.status(400).json({ error: `Choose an ID document accepted in ${country.name}.` });
    let cardNum = null, idNumber = null;
    if (idType === 'GHANA_CARD') {
      cardNum = normalizeGhanaCard(req.body.ghanaCardNum !== undefined ? req.body.ghanaCardNum : req.body.idNumber);
      if (!cardNum) return res.status(400).json({ error: 'That doesn\u2019t look like a Ghana Card number. It should look like GHA-123456789-0.' });
    } else {
      idNumber = normalizeIdNumber(req.body.idNumber);
      if (!idNumber) return res.status(400).json({ error: 'Enter the document number exactly as printed (5 to 20 letters and numbers).' });
    }

    const photo = req.body.verifyPhoto || st.verifyPhoto;
    const photoProblem = checkCardPhoto(photo);
    if (photoProblem) return res.status(400).json({ error: photoProblem });

    st.legalFullName = nameCheck.name;
    st.idType = idType;
    st.ghanaCardNum = cardNum;
    st.idNumber = idNumber;
    st.verifyPhoto = photo;
    st.pendingReview = true;
    st.verificationSubmittedAt = Date.now();
    st.verificationRejectedReason = null; // a fresh submission clears the old rejection
    await st.save();
    await notifyAllAdmins({ type: 'VERIFICATION_SUBMITTED', title: `ID verification submitted: ${st.salonName || st.name}`, entityType: 'admin', entityId: st._id.toString(), priority: 'action_required' });
    res.json(publicStylist(st, true));
  } catch (e) {
    res.status(500).json({ error: 'Could not submit verification. Please try again.' });
  }
});

// Admin: approve a stylist's ID verification (Ghana Card / photo review).
// NOTE: this is a DIFFERENT concept from shop-listing approval below —
// a stylist can be ID-verified without their shop being publicly approved,
// and vice versa. Do not merge these two routes.
router.post('/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    let st;
    try { st = await Stylist.findById(req.params.id); } catch (e) { return res.status(404).json({ error: 'Account not found.' }); }
    if (!st) return res.status(404).json({ error: 'Account not found.' });
    if (!st.pendingReview) return res.status(400).json({ error: 'There is no pending verification for this account.' });
    // Tight by design: approval is impossible without all three pieces the
    // admin is supposed to compare. Older submissions made before the legal
    // name existed must be rejected and resubmitted, not waved through.
    if (!st.legalFullName || !(st.ghanaCardNum || st.idNumber) || !st.verifyPhoto) {
      return res.status(400).json({ error: 'This submission is missing the legal name, document number or document photo. Reject it and ask them to resubmit.' });
    }
    st.verified = true;
    st.pendingReview = false;
    st.verificationReviewedAt = Date.now();
    st.verificationRejectedReason = null;
    await st.save();
    try { await AdminAction.create({ adminId: req.stylistId, action: 'VERIFICATION_APPROVED', targetType: 'stylist', targetId: st._id.toString() }); } catch (e) { /* non-fatal */ }
    await notify({ recipientId: st._id.toString(), recipientType: 'stylist', type: 'VERIFICATION_APPROVED', title: 'Your identity is verified', message: 'Customers will now see the Verified badge on your shop.', entityType: 'shop', entityId: st._id.toString(), priority: 'important' });
    res.json(publicStylist(st, true));
  } catch (e) {
    res.status(500).json({ error: 'Could not approve verification.' });
  }
});

// Admin: reject a verification submission. A reason is mandatory: it is
// shown to the stylist so they know exactly what to fix, and it is kept in
// the audit log so every decision can be explained later.
router.post('/:id/reject-verification', requireAuth, requireAdmin, async (req, res) => {
  try {
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 5) return res.status(400).json({ error: 'Give a clear reason so the stylist knows what to fix.' });
    let st;
    try { st = await Stylist.findById(req.params.id); } catch (e) { return res.status(404).json({ error: 'Account not found.' }); }
    if (!st) return res.status(404).json({ error: 'Account not found.' });
    if (!st.pendingReview) return res.status(400).json({ error: 'There is no pending verification for this account.' });
    st.verified = false;
    st.pendingReview = false;
    st.verificationReviewedAt = Date.now();
    st.verificationRejectedReason = reason.slice(0, 300);
    await st.save();
    try { await AdminAction.create({ adminId: req.stylistId, action: 'VERIFICATION_REJECTED', targetType: 'stylist', targetId: st._id.toString(), reason }); } catch (e) { /* non-fatal */ }
    await notify({ recipientId: st._id.toString(), recipientType: 'stylist', type: 'VERIFICATION_REJECTED', title: 'Your ID verification needs another look', message: reason.slice(0, 120), entityType: 'shop', entityId: st._id.toString(), priority: 'important' });
    res.json(publicStylist(st, true));
  } catch (e) {
    res.status(500).json({ error: 'Could not reject verification.' });
  }
});

// Admin: approve a shop for public Discovery listing (the UNDER_REVIEW gate).
router.post('/:id/approve-review', requireAuth, requireAdmin, async (req, res) => {
  const st = await Stylist.findByIdAndUpdate(req.params.id, { status: 'APPROVED' }, { new: true });
  if (!st) return res.status(404).json({ error: 'Not found.' });
  try { await Activity.create({ stylistId: st._id.toString(), type: 'SHOP_APPROVED' }); } catch (e) { /* non-fatal */ }
  try { await AdminAction.create({ adminId: req.stylistId, action: 'SHOP_APPROVED', targetType: 'stylist', targetId: st._id.toString() }); } catch (e) { /* non-fatal */ }
  await notify({ recipientId: st._id.toString(), recipientType: 'stylist', type: 'SHOP_APPROVED', title: 'Your shop is now live!', message: 'Your shop is now visible in Discovery.', entityType: 'shop', entityId: st._id.toString(), priority: 'important' });
  res.json(publicStylist(st, true));
});

// Admin: restrict an account. Never a silent action — reason is required,
// and it's both stored on the account AND recorded permanently in the
// audit log, so a restriction can always be explained later.
router.post('/:id/restrict', requireAuth, requireAdmin, async (req, res) => {
  const { accountStatus, reason } = req.body;
  if (!['RESTRICTED', 'SUSPENDED', 'BANNED', 'DEACTIVATED'].includes(accountStatus)) return res.status(400).json({ error: 'Invalid account status.' });
  if (!reason) return res.status(400).json({ error: 'A reason is required for any account restriction.' });
  const st = await Stylist.findByIdAndUpdate(req.params.id, {
    accountStatus, restrictionReason: reason, restrictedAt: Date.now(), restrictedBy: req.stylistId, restoredAt: null,
  }, { new: true });
  if (!st) return res.status(404).json({ error: 'Not found.' });
  try { await AdminAction.create({ adminId: req.stylistId, action: 'ACCOUNT_RESTRICTED', targetType: 'stylist', targetId: st._id.toString(), reason, meta: { accountStatus } }); } catch (e) { /* non-fatal */ }
  res.json(publicStylist(st, true));
});

router.post('/:id/restore', requireAuth, requireAdmin, async (req, res) => {
  const st = await Stylist.findByIdAndUpdate(req.params.id, { accountStatus: 'ACTIVE', restoredAt: Date.now() }, { new: true });
  if (!st) return res.status(404).json({ error: 'Not found.' });
  try { await AdminAction.create({ adminId: req.stylistId, action: 'ACCOUNT_RESTORED', targetType: 'stylist', targetId: st._id.toString() }); } catch (e) { /* non-fatal */ }
  res.json(publicStylist(st, true));
});

// Public: follow/unfollow (by clientId, no login needed for browsing clients)
// Public: record a real shop visit (someone opened this shop's page, whether
// or not they go on to follow/register/request anything). Deduped per
// visitor per shop over a 30-minute window, so refreshing the page or
// clicking around repeatedly does not inflate the count — this stays a
// genuine "how many distinct visits" signal, not a click counter.
router.post('/:id/visit', async (req, res) => {
  const { clientId, ref } = req.body;
  if (!clientId) return res.status(400).json({ error: 'Missing clientId.' });
  const st = await Stylist.findById(req.params.id);
  if (!st) return res.status(404).json({ error: 'Not found.' });
  const THIRTY_MIN = 30 * 60 * 1000;
  const recent = await Activity.findOne({
    stylistId: st._id.toString(), clientId, type: 'SHOP_VISITED',
    createdAt: { $gt: Date.now() - THIRTY_MIN },
  });
  if (!recent) {
    try { await Activity.create({ stylistId: st._id.toString(), clientId, type: 'SHOP_VISITED' }); } catch (e) { /* non-fatal */ }
  }
  // Referral attribution is a real, separate event — only logged when `ref`
  // resolves to a genuine, active code that actually belongs to THIS shop.
  // A code for a different shop, or an inactive/unknown one, is silently
  // ignored rather than attributed to the wrong professional.
  if (ref) {
    try {
      const referral = await Referral.findOne({ code: ref, stylistId: st._id.toString(), active: true });
      if (referral) {
        const recentRef = await Activity.findOne({
          stylistId: st._id.toString(), clientId, type: 'REFERRAL_VISIT', 'meta.code': ref,
          createdAt: { $gt: Date.now() - THIRTY_MIN },
        });
        if (!recentRef) await Activity.create({ stylistId: st._id.toString(), clientId, type: 'REFERRAL_VISIT', meta: { code: ref } });
      }
    } catch (e) { /* non-fatal */ }
  }
  res.json({ ok: true });
});

// Admin (or the shop's own owner) — real visit and conversion stats for one
// shop. "visitedNotFollowed" is a genuine set-difference: distinct visitors
// minus the shop's actual followers list, not an estimate.
router.get('/:id/stats', requireAuth, async (req, res) => {
  if (!req.isAdmin && req.stylistId !== req.params.id) return res.status(403).json({ error: 'Not authorized.' });
  const st = await Stylist.findById(req.params.id);
  if (!st) return res.status(404).json({ error: 'Not found.' });
  const visits = await Activity.find({ stylistId: st._id.toString(), type: 'SHOP_VISITED' });
  const distinctVisitorIds = [...new Set(visits.map(v => v.clientId).filter(Boolean))];
  const followerSet = new Set(st.followers || []);
  const visitedNotFollowed = distinctVisitorIds.filter(id => !followerSet.has(id));
  res.json({
    totalVisits: visits.length,
    distinctVisitors: distinctVisitorIds.length,
    followers: st.followers.length,
    visitedNotFollowed: visitedNotFollowed.length,
  });
});

router.post('/:id/follow', async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: 'Missing clientId.' });
  // Following as a real customer account needs that customer's own login;
  // otherwise anyone could add or remove shops from someone's Saved list.
  let isCustomerId = false;
  try { isCustomerId = !!(await Customer.exists({ _id: clientId })); } catch (e) { /* not an account id: an anonymous browser id */ }
  if (isCustomerId) {
    const who = accountFromRequest(req);
    if (!who || who.type !== 'customer' || who.id !== String(clientId)) return res.status(401).json({ error: 'Please log in to save shops to your account.' });
  }
  const st = await Stylist.findById(req.params.id);
  if (!st) return res.status(404).json({ error: 'Not found.' });
  const i = st.followers.indexOf(clientId);
  const wasNewFollow = i < 0;
  if (i >= 0) st.followers.splice(i, 1); else st.followers.push(clientId);
  await st.save();
  if (wasNewFollow) { try { await Activity.create({ stylistId: st._id.toString(), clientId, type: 'FOLLOW_RECEIVED' }); } catch (e) { /* non-fatal */ } }
  const updated = await recalculateGroupPoints(st._id);
  // ?lean=1 (the new site): just the result. The old reply stays for the older site.
  if (req.query.lean) return res.json({ following: wasNewFollow, followerCount: updated.followers.length });
  res.json(publicStylist(updated, false)); // public/anonymous action on someone else's record — never their private ID data
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
  // ?lean=1 (the new site): just the result, not the whole shop and its photos.
  // Without it, the old reply is kept so the older site's like button still works.
  if (req.query.lean) return res.json({ liked: i < 0, likeCount: style.likes.length });
  res.json(publicStylist(updated, false)); // public/anonymous action on someone else's record
});

// ---------- Staff / apprentice access ----------
// Owner-only: grant scoped access to a REAL existing account, found by
// phone — never a fake invite to someone who hasn't registered.
router.post('/me/staff', requireAuth, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Enter the phone number of their own Sheeba account.' });
  const staffAccount = await Stylist.findOne({ phone });
  if (!staffAccount) return res.status(404).json({ error: 'No Sheeba account found with that phone number — they need to register their own account first.' });
  if (staffAccount._id.toString() === req.stylistId) return res.status(400).json({ error: 'You can\'t add yourself as staff.' });
  const owner = await Stylist.findById(req.stylistId);
  if (owner.staffAccess.some(s => s.stylistId === staffAccount._id.toString())) return res.status(400).json({ error: 'They already have access.' });
  owner.staffAccess.push({ stylistId: staffAccount._id.toString() });
  await owner.save();
  await notify({ recipientId: staffAccount._id.toString(), recipientType: 'stylist', type: 'SHOP_APPROVED', title: `${owner.salonName || owner.name} gave you shop access`, message: 'You can now help manage their requests.', entityType: 'shop', entityId: owner._id.toString(), priority: 'important' });
  res.json({ ok: true, staffName: staffAccount.name });
});

router.get('/me/staff', requireAuth, async (req, res) => {
  const owner = await Stylist.findById(req.stylistId);
  const withNames = await Promise.all((owner.staffAccess || []).map(async s => {
    const acc = await Stylist.findById(s.stylistId);
    return { stylistId: s.stylistId, name: acc ? acc.name : 'Unknown', addedAt: s.addedAt };
  }));
  res.json(withNames);
});

router.delete('/me/staff/:stylistId', requireAuth, async (req, res) => {
  const owner = await Stylist.findById(req.stylistId);
  owner.staffAccess = owner.staffAccess.filter(s => s.stylistId !== req.params.stylistId);
  await owner.save();
  res.json({ ok: true });
});

// Exposed so routes/requests.js can trigger a recalculation when a booking
// transitions to 'completed' — that event happens on a different route file.
module.exports = router;
module.exports.recalculateGroupPoints = recalculateGroupPoints;
