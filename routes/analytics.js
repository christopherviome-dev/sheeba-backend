const express = require('express');
const Stylist = require('../models/Stylist');
const Customer = require('../models/Customer');
const Request = require('../models/Request');
const Report = require('../models/Report');
const InviteReward = require('../models/InviteReward');
const TrainingPlan = require('../models/TrainingPlan');
const TrainingWork = require('../models/TrainingWork');
const Conversation = require('../models/Conversation');
const PasswordResetRequest = require('../models/PasswordResetRequest');
const ServiceType = require('../models/ServiceType');
const DailyCount = require('../models/DailyCount');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getCatalog, servicesOf } = require('../lib/catalog');
const { countryOf, getCountry } = require('../lib/countries');
const { cityKey } = require('../lib/prices');
const attempts = require('../lib/attempts');

const router = express.Router();
const DAY = 24 * 3600 * 1000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const tally = (list, keyFn) => { const m = {}; for (const x of list) { const k = keyFn(x); if (k) m[k] = (m[k] || 0) + 1; } return m; };
const top = (obj, n = 10) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count }));
const ms = (d) => (d ? new Date(d).getTime() : 0);

// ---- Anonymous trend signals (public): a style searched for or opened. ----
router.post('/event', async (req, res) => {
  const k = `analytics:${req.ip || 'unknown'}`;
  if (attempts.status([k]).blocked) return res.status(429).json({ ok: false });
  attempts.fail([[k, 120]]); // generous: many phones share one address
  const kind = ['search', 'inspiration'].includes(req.body.kind) ? req.body.kind : null;
  const key = typeof req.body.key === 'string' ? req.body.key.slice(0, 60) : '';
  if (!kind || !key) return res.status(400).json({ ok: false });
  const known = new Set((await getCatalog()).flatMap((s) => (s.styles || []).map((st) => st.key)));
  if (!known.has(key)) return res.status(400).json({ ok: false }); // only real styles are counted
  await DailyCount.findOneAndUpdate({ day: dayKey(Date.now()), kind, key }, { $inc: { count: 1 } }, { upsert: true });
  res.json({ ok: true });
});

// ---- Admin: the whole picture ----
router.get('/overview', requireAuth, requirePermission('analytics'), async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 365);
  const now = Date.now(), since = now - days * DAY, before = since - days * DAY;
  const [shops, customers, requests, reports, invites, plans, worksPosted, conversations, passwordHelp, proposals, counts, catalog, communityFeedback] = await Promise.all([
    Stylist.find({}, 'createdAt status accountStatus role supervisorStatus verified pendingReview memberNumber country city area category services styles followers'),
    Customer.find({}, 'createdAt memberNumber country accountStatus'),
    Request.find({}, 'status createdAt completedAt updatedAt priceSnapshot currencySnapshot serviceNameSnapshot'),
    Report.find({}, 'state urgent createdAt'),
    InviteReward.find({}, 'status'),
    TrainingPlan.find({}, 'skills graduatedAt'),
    TrainingWork.countDocuments({}),
    Conversation.countDocuments({}),
    PasswordResetRequest.countDocuments({ status: 'OPEN' }), // password requests are OPEN until handled
    ServiceType.countDocuments({ status: 'PENDING' }),
    DailyCount.find({ day: { $gte: dayKey(since) } }),
    getCatalog(),
    require('../models/CommunityFeedback').countDocuments({ handled: { $ne: true } }).catch(() => 0), // Telegram messages not yet handled
  ]);
  const styleName = {}; const styleService = {};
  for (const s of catalog) for (const st of s.styles || []) { styleName[st.key] = st.name; styleService[st.key] = s.name; }
  const serviceName = Object.fromEntries(catalog.map((s) => [s.key, s.name]));
  const live = shops.filter((s) => s.status === 'APPROVED' && (s.accountStatus || 'ACTIVE') === 'ACTIVE' && s.role !== 'APPRENTICE');
  const created = (x) => ms(x.createdAt);
  const inWindow = (t) => t >= since && t < now;
  const inPrev = (t) => t >= before && t < since;

  // Members and growth
  const everyone = [...shops.map((s) => ({ t: created(s), type: 'pro', n: s.memberNumber })), ...customers.map((c) => ({ t: created(c), type: 'customer', n: c.memberNumber }))];
  const growth = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = dayKey(now - i * DAY);
    growth.push({ day: d, professionals: everyone.filter((m) => m.type === 'pro' && dayKey(m.t) === d).length, customers: everyone.filter((m) => m.type === 'customer' && dayKey(m.t) === d).length });
  }
  const newNow = everyone.filter((m) => inWindow(m.t)).length, newPrev = everyone.filter((m) => inPrev(m.t)).length;

  // Bookings
  const byStatus = tally(requests, (r) => r.status);
  const doneAt = (r) => r.completedAt || ms(r.updatedAt);
  const completed = requests.filter((r) => r.status === 'completed');
  const finished = (list) => list.filter((r) => ['completed', 'declined'].includes(r.status));
  const rate = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const valueBy = (list) => { const m = {}; for (const r of list) if (typeof r.priceSnapshot === 'number') m[r.currencySnapshot || 'GHS'] = (m[r.currencySnapshot || 'GHS'] || 0) + r.priceSnapshot; return m; };
  const windowReqs = requests.filter((r) => inWindow(created(r)));
  const answered = requests.filter((r) => !['pending', 'open'].includes(r.status));

  // Supply and demand
  const likesByStyle = {}, itemsByStyle = {}, shopsByStyle = {};
  for (const s of live) {
    const seen = new Set();
    for (const it of s.styles || []) {
      if (it.active === false || !it.styleKey) continue;
      itemsByStyle[it.styleKey] = (itemsByStyle[it.styleKey] || 0) + 1;
      likesByStyle[it.styleKey] = (likesByStyle[it.styleKey] || 0) + (it.likes || []).length;
      seen.add(it.styleKey);
    }
    for (const k of seen) shopsByStyle[k] = (shopsByStyle[k] || 0) + 1;
  }
  const searches = {}, opens = {};
  for (const c of counts) (c.kind === 'search' ? searches : opens)[c.key] = ((c.kind === 'search' ? searches : opens)[c.key] || 0) + c.count;
  const interest = {}; for (const k of new Set([...Object.keys(searches), ...Object.keys(opens)])) interest[k] = (searches[k] || 0) + (opens[k] || 0);
  const named = (list) => list.map((x) => ({ ...x, name: styleName[x.key] || serviceName[x.key] || x.key, service: styleService[x.key] || null }));
  // Wanted but scarce: lots of interest, few shops offering it
  const unmet = Object.entries(interest).map(([key, count]) => ({ key, count, shops: shopsByStyle[key] || 0 }))
    .filter((x) => x.count > 0).sort((a, b) => (b.count / (b.shops + 1)) - (a.count / (a.shops + 1))).slice(0, 8);

  // Places
  const byCountry = tally(live, (s) => countryOf(s));
  const byCity = tally(live, (s) => (s.city ? `${cityKey(s.city)}|${countryOf(s)}` : null));
  // Each city's label: its most common spelling, neatly capitalised.
  const spellings = {};
  for (const s of live) if (s.city) { const k = `${cityKey(s.city)}|${countryOf(s)}`, sp = s.city.trim().replace(/\s+/g, ' '); (spellings[k] = spellings[k] || {})[sp] = (spellings[k][sp] || 0) + 1; }
  const titleCase = (t) => (t === t.toLowerCase() ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : t);
  const cityLabel = Object.fromEntries(Object.entries(spellings).map(([k, v]) => [k, titleCase(Object.entries(v).sort((a, b) => b[1] - a[1])[0][0])]));
  const byArea = tally(live, (s) => (s.area ? s.area.trim() : null));

  res.json({
    days,
    members: {
      total: everyone.length, professionals: shops.filter((s) => s.role !== 'APPRENTICE').length, customers: customers.length,
      withEmail: [...shops, ...customers].filter((x) => x.emailVerified && x.email).length, // confirmed emails (Continue with Google)
      newsOptIn: [...shops, ...customers].filter((x) => x.marketingOptIn && x.email).length, // said yes to news by email
      liveShops: live.length, awaitingApproval: shops.filter((s) => s.status === 'UNDER_REVIEW' && s.role !== 'APPRENTICE').length,
      verified: live.filter((s) => s.verified).length,
      restricted: shops.filter((s) => (s.accountStatus || 'ACTIVE') !== 'ACTIVE').length + customers.filter((c) => (c.accountStatus || 'ACTIVE') !== 'ACTIVE').length,
      apprentices: shops.filter((s) => s.role === 'APPRENTICE' && s.supervisorStatus === 'APPROVED').length,
      graduates: shops.filter((s) => s.supervisorStatus === 'GRADUATED').length,
      newInWindow: newNow, newInPrevious: newPrev, changePercent: newPrev ? Math.round(((newNow - newPrev) / newPrev) * 100) : null,
      founding: { count: everyone.filter((m) => m.n && m.n <= 1000).length, limit: 1000, latestNumber: Math.max(0, ...everyone.map((m) => m.n || 0)) },
    },
    growth,
    bookings: {
      total: requests.length, byStatus, inWindow: windowReqs.length,
      completionRate: rate(completed.length, finished(requests).length),
      completionRateWindow: rate(windowReqs.filter((r) => r.status === 'completed').length, finished(windowReqs).length),
      acceptanceRate: rate(answered.filter((r) => ['accepted', 'completed'].includes(r.status)).length, answered.length),
      valueAllTime: valueBy(completed), valueInWindow: valueBy(completed.filter((r) => inWindow(doneAt(r)))),
      topServices: top(tally(windowReqs, (r) => r.serviceNameSnapshot), 8),
    },
    places: {
      shopsByCountry: top(byCountry, 20).map((x) => ({ ...x, name: (getCountry(x.key) || {}).name || x.key })),
      shopsByCity: top(byCity, 15).map((x) => ({ key: x.key, count: x.count, name: cityLabel[x.key] || x.key.split('|')[0], country: x.key.split('|')[1] })),
      shopsByArea: top(byArea, 15),
      customersByCountry: top(tally(customers, (c) => countryOf(c)), 20).map((x) => ({ ...x, name: (getCountry(x.key) || {}).name || x.key })),
      shopsWithoutCity: live.filter((s) => !s.city).length,
    },
    demand: {
      topSearched: named(top(searches, 10)), topOpened: named(top(opens, 10)), topLoved: named(top(likesByStyle, 10)),
      offeredByService: top(tally(live.flatMap((s) => servicesOf(s)), (k) => k), 20).map((x) => ({ ...x, name: serviceName[x.key] || x.key })),
      mostOfferedStyles: named(top(itemsByStyle, 10)),
      wantedButScarce: named(unmet),
    },
    engagement: {
      likes: live.reduce((t, s) => t + (s.styles || []).reduce((u, it) => u + (it.likes || []).length, 0), 0),
      follows: live.reduce((t, s) => t + (s.followers || []).length, 0),
      conversations,
    },
    trust: {
      openReports: reports.filter((r) => !['RESOLVED', 'DISMISSED'].includes(r.state || 'OPEN')).length,
      urgentOpen: reports.filter((r) => r.urgent && !['RESOLVED', 'DISMISSED'].includes(r.state || 'OPEN')).length,
      pendingVerifications: shops.filter((s) => s.pendingReview && !s.verified).length,
      passwordHelp, serviceProposals: proposals, communityFeedback,
    },
    invites: tally(invites, (i) => i.status),
    training: {
      activePlans: plans.filter((p) => !p.graduatedAt).length, graduated: plans.filter((p) => p.graduatedAt).length,
      skillsSignedOff: plans.reduce((t, p) => t + (p.skills || []).filter((s) => s.status === 'SIGNED_OFF').length, 0), worksPosted,
    },
  });
});

// ---- Admin: where sign-ups and bookings come from ----
router.get('/sources', requireAuth, requirePermission('analytics'), async (req, res) => {
  const Activity = require('../models/Activity');
  const Referral = require('../models/Referral');
  const FieldVisit = require('../models/FieldVisit');
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 365);
  const since = Date.now() - days * DAY;
  const [shops, customers, requests, acts, field] = await Promise.all([
    Stylist.find({ createdAt: { $gte: new Date(since) } }, 'signupSource createdAt'),
    Customer.find({ createdAt: { $gte: new Date(since) } }, 'signupSource createdAt'),
    Request.find({ createdAt: { $gte: since } }, 'source stylistId createdAt'), // bookings store a NUMBER, accounts a Date
    Activity.find({ type: { $in: ['REFERRAL_VISIT', 'REFERRED_REQUEST_CREATED'] }, createdAt: { $gte: since } }, 'type meta'),
    FieldVisit.find({ signedUpStylistId: { $ne: null }, at: { $gte: since } }, 'signedUpStylistId'),
  ]);
  const typeOf = (x) => (x && x.type) || 'unknown'; // "unknown" = before sources were recorded
  const byType = (list, f) => top(tally(list, (x) => typeOf(f(x))), 10);
  const linkChannels = (list, f) => top(tally(list.filter((x) => typeOf(f(x)) === 'link'), (x) => f(x).channel), 10);
  const hosts = top(tally([...shops, ...customers].map((x) => x.signupSource).filter(Boolean), (x) => x.referrerHost), 8);

  // Marketing links: visits and bookings per link, with its label, channel and shop.
  const perCode = {};
  for (const a of acts) { const c = a.meta && a.meta.code; if (!c) continue; perCode[c] = perCode[c] || { visits: 0, bookings: 0 }; perCode[c][a.type === 'REFERRAL_VISIT' ? 'visits' : 'bookings'] += 1; }
  const refs = Object.keys(perCode).length ? await Referral.find({ code: { $in: Object.keys(perCode) } }, 'code label channel stylistId') : [];
  const shopIds = [...new Set([...refs.map((r) => r.stylistId), ...requests.filter((r) => ['shop', 'look'].includes(typeOf(r.source))).map((r) => r.stylistId)].filter(Boolean))];
  const shopNames = Object.fromEntries((shopIds.length ? await Stylist.find({ _id: { $in: shopIds } }, 'name salonName') : []).map((x) => [x._id.toString(), x.salonName || x.name]));
  const links = refs.map((r) => ({ key: r.code, label: r.label, channel: r.channel, shop: shopNames[r.stylistId] || null, ...perCode[r.code] }))
    .sort((a, b) => b.bookings - a.bookings || b.visits - a.visits).slice(0, 10);
  // Shops whose own shared links (and shared looks) bring bookings.
  const sharers = top(tally(requests.filter((r) => ['shop', 'look'].includes(typeOf(r.source))), (r) => r.stylistId), 8).map((x) => ({ ...x, name: shopNames[x.key] || 'A shop' }));

  res.json({
    days,
    signups: {
      professionals: { total: shops.length, byType: byType(shops, (x) => x.signupSource), linkChannels: linkChannels(shops, (x) => x.signupSource) },
      customers: { total: customers.length, byType: byType(customers, (x) => x.signupSource), linkChannels: linkChannels(customers, (x) => x.signupSource) },
      inPersonFieldWork: new Set(field.map((f) => f.signedUpStylistId)).size,
      referrerSites: hosts,
    },
    bookings: { total: requests.length, byType: byType(requests, (x) => x.source), linkChannels: linkChannels(requests, (x) => x.source) },
    marketingLinks: links,
    shopsBringingBookings: sharers,
  });
});

// ---- Admin: every shop on the map (exact pins, admin only) ----
router.get('/map', requireAuth, requirePermission('analytics'), async (req, res) => {
  const shops = await Stylist.find({ role: { $ne: 'APPRENTICE' } }, 'name salonName status accountStatus verified location city area country services category');
  const pins = shops.filter((s) => s.location && typeof s.location.lat === 'number' && typeof s.location.lng === 'number').map((s) => ({
    id: s._id, name: s.salonName || s.name, lat: s.location.lat, lng: s.location.lng, city: s.city || null, area: s.area || null, country: countryOf(s),
    status: (s.accountStatus || 'ACTIVE') !== 'ACTIVE' ? 'RESTRICTED' : s.status === 'APPROVED' ? 'LIVE' : 'WAITING', verified: !!s.verified, services: servicesOf(s),
  }));
  res.json({ pins, withoutLocation: shops.length - pins.length });
});

module.exports = router;
