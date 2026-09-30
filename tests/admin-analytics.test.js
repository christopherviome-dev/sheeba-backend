// Admin analytics and map: the numbers, anonymous demand signals, admin-only (28 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
// Admin switches: a stand-in returning nothing, so every switch uses its safe default (instant, no database).
{ const Setting = require(path.join(B, 'models/Setting')); Setting.findById = async () => null; }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const M = (n) => R('models/' + n);
const Stylist = M('Stylist'), Customer = M('Customer'), Request = M('Request'), Report = M('Report'), InviteReward = M('InviteReward');
const TrainingPlan = M('TrainingPlan'), TrainingWork = M('TrainingWork'), Conversation = M('Conversation'), PasswordResetRequest = M('PasswordResetRequest'), ServiceType = M('ServiceType'), DailyCount = M('DailyCount');
const attempts = R('lib/attempts'); attempts._setNowForTests(() => 1e12);
const DAY = 86400000, now = Date.now(), ago = (d) => new Date(now - d * DAY);
const shops = [
  { _id: 's1', name: 'Etornam', salonName: 'Etornam Braids', status: 'APPROVED', accountStatus: 'ACTIVE', role: 'PROFESSIONAL', verified: true, memberNumber: 3, country: 'GH', city: 'Kasoa', area: 'Old Barrier', services: ['hair'], createdAt: ago(5), location: { lat: 5.534, lng: -0.419 },
    styles: [{ styleKey: 'knotless-braids', serviceKey: 'hair', likes: ['a', 'b', 'c'] }, { styleKey: 'cornrows', serviceKey: 'hair', likes: ['d'] }], followers: ['x', 'y'] },
  { _id: 's2', name: 'Kofi', status: 'APPROVED', accountStatus: 'ACTIVE', role: 'PROFESSIONAL', verified: false, memberNumber: 7, country: 'GH', city: ' kasoa ', services: ['barbering'], createdAt: ago(2), location: { lat: 5.54, lng: -0.42 },
    styles: [{ styleKey: 'fade', serviceKey: 'barbering', likes: [] }], followers: [] },
  { _id: 's3', name: 'New', status: 'UNDER_REVIEW', accountStatus: 'ACTIVE', role: 'PROFESSIONAL', pendingReview: true, memberNumber: 9, country: 'GB', createdAt: ago(40), styles: [], followers: [] },
  { _id: 's4', name: 'Abena', status: 'UNDER_REVIEW', role: 'APPRENTICE', supervisorStatus: 'APPROVED', memberNumber: 12, createdAt: ago(1), styles: [], location: { lat: 5.5, lng: -0.4 } },
  { _id: 's5', name: 'Bad', status: 'APPROVED', accountStatus: 'RESTRICTED', role: 'PROFESSIONAL', memberNumber: 1200, createdAt: ago(3), styles: [], location: { lat: 6, lng: -1 } },
];
const customers = [{ memberNumber: 4, country: 'GH', createdAt: ago(10), email: 'a@gmail.com', emailVerified: true, marketingOptIn: true }, { memberNumber: 5, country: 'GB', createdAt: ago(1) }, { memberNumber: 1300, country: 'GH', createdAt: ago(60), accountStatus: 'SUSPENDED' }];
const requests = [
  { status: 'completed', createdAt: ago(3), completedAt: now - 2 * DAY, priceSnapshot: 300, currencySnapshot: 'GHS', serviceNameSnapshot: 'Knotless' },
  { status: 'completed', createdAt: ago(50), completedAt: now - 49 * DAY, priceSnapshot: 20, currencySnapshot: 'GBP', serviceNameSnapshot: 'Fade' },
  { status: 'declined', createdAt: ago(4), serviceNameSnapshot: 'Knotless' },
  { status: 'accepted', createdAt: ago(1), serviceNameSnapshot: 'Cornrows' },
  { status: 'pending', createdAt: ago(1), serviceNameSnapshot: 'Knotless' },
];
const counts = [{ day: 'x', kind: 'search', key: 'knotless-braids', count: 30 }, { day: 'x', kind: 'search', key: 'locs', count: 25 }, { day: 'x', kind: 'inspiration', key: 'knotless-braids', count: 10 }];
Stylist.find = async () => shops; Stylist.findById = async (id) => (id === 'adm' ? { _id: 'adm', isAdmin: true, accountStatus: 'ACTIVE' } : shops.find((s) => s._id === id) || null);
Customer.find = async () => customers; Request.find = async () => requests;
Report.find = async () => [{ state: 'OPEN', urgent: true }, { state: 'RESOLVED' }, { state: 'UNDER_REVIEW' }];
InviteReward.find = async () => [{ status: 'CHECKING' }, { status: 'VALIDATED' }, { status: 'VALIDATED' }];
TrainingPlan.find = async () => [{ skills: [{ status: 'SIGNED_OFF' }, { status: 'PRACTISING' }] }, { skills: [{ status: 'SIGNED_OFF' }], graduatedAt: 1 }];
TrainingWork.countDocuments = async () => 6; Conversation.countDocuments = async () => 4;
let pwFilter = null; PasswordResetRequest.countDocuments = async (f) => { pwFilter = f; return 2; };
ServiceType.countDocuments = async () => 1; ServiceType.find = async () => [];
DailyCount.find = async () => counts;
R('models/CommunityFeedback').countDocuments = async () => 3; // Telegram messages waiting
const upserts = []; DailyCount.findOneAndUpdate = async (f, u) => { upserts.push({ f, u }); return {}; };
const app = express(); app.set('trust proxy', 1); app.use(express.json()); app.use('/api/analytics', R('routes/analytics'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const ADMIN = jwt.sign({ id: 'adm', isAdmin: true }, 't'), PRO = jwt.sign({ id: 's1' }, 't');
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const server = app.listen(8237, async () => {
  const call = async (m, u, t, body, ip = '1.1.1.1') => { const r = await fetch('http://localhost:8237' + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  console.log('--- ANONYMOUS TREND SIGNALS ---');
  let r = await call('POST', '/api/analytics/event', null, { kind: 'search', key: 'knotless-braids' });
  check('a search for a real style is counted (day + style only)', r.s === 200 && upserts[0].f.kind === 'search' && upserts[0].f.key === 'knotless-braids' && /^\d{4}-\d\d-\d\d$/.test(upserts[0].f.day) && upserts[0].u.$inc.count === 1);
  check('nothing about the person is stored', Object.keys(upserts[0].f).sort().join() === 'day,key,kind');
  r = await call('POST', '/api/analytics/event', null, { kind: 'search', key: 'made-up-style' });
  check('a made-up style is refused (only real styles are counted)', r.s === 400);
  r = await call('POST', '/api/analytics/event', null, { kind: 'purchase', key: 'knotless-braids' });
  check('an unknown kind of signal is refused', r.s === 400);
  let blocked = null;
  for (let i = 1; i <= 125 && !blocked; i++) { const x = await call('POST', '/api/analytics/event', null, { kind: 'search', key: 'fade' }, '9.9.9.9'); if (x.s === 429) blocked = i; }
  check('flooding one style from one address stops at 121', blocked === 121, 'blocked at ' + blocked);
  console.log('--- WHO CAN SEE IT ---');
  check('not logged in → refused', (await call('GET', '/api/analytics/overview')).s === 401);
  check('a normal professional → refused', (await call('GET', '/api/analytics/overview', PRO)).s === 403);
  check('the map is admin-only too', (await call('GET', '/api/analytics/map', PRO)).s === 403);
  console.log('--- THE NUMBERS ---');
  r = await call('GET', '/api/analytics/overview?days=30', ADMIN);
  const o = r.j, m = o.members;
  check('members: 8 in total (5 pro accounts + 3 customers)', r.s === 200 && m.total === 8 && m.customers === 3);
  check('confirmed emails counted (1), and how many said yes to news (1)', m.withEmail === 1 && m.newsOptIn === 1);
  check('2 live shops (restricted and waiting ones excluded), 1 verified', m.liveShops === 2 && m.verified === 1);
  check('1 awaiting approval (the apprentice is not counted as a shop)', m.awaitingApproval === 1);
  check('2 restricted accounts (one shop, one customer), 1 active apprentice', m.restricted === 2 && m.apprentices === 1);
  check('founding members: 6 of 1,000 (numbers ≤ 1000)', m.founding.count === 6 && m.founding.latestNumber === 1300);
  check('growth: one row per day for 30 days', o.growth.length === 30 && o.growth.reduce((t, d) => t + d.professionals + d.customers, 0) === 6);
  check('new in the last 30 days: 6 (vs 1 in the 30 before)', m.newInWindow === 6 && m.newInPrevious === 1 && m.changePercent === 500);
  const b = o.bookings;
  check('bookings: 5, completion rate 67% (2 of 3 finished)', b.total === 5 && b.completionRate === 67);
  check('acceptance rate 75% (3 of 4 answered)', b.acceptanceRate === 75);
  check('recorded value kept per currency: GH₵300 + £20 all time', b.valueAllTime.GHS === 300 && b.valueAllTime.GBP === 20);
  check('…and only GH₵300 in the last 30 days', b.valueInWindow.GHS === 300 && !b.valueInWindow.GBP);
  check('most requested service this month: Knotless (3)', b.topServices[0].key === 'Knotless' && b.topServices[0].count === 3);
  check('places: "Kasoa" and " kasoa " counted as ONE city with 2 shops, labelled "Kasoa"', o.places.shopsByCity.length === 1 && o.places.shopsByCity[0].count === 2 && o.places.shopsByCity[0].name === 'Kasoa');
  check('shops by country named: Ghana 2', o.places.shopsByCountry[0].name === 'Ghana' && o.places.shopsByCountry[0].count === 2);
  check('demand: knotless is the most searched (30), with its real name', o.demand.topSearched[0].key === 'knotless-braids' && o.demand.topSearched[0].count === 30 && /notless/i.test(o.demand.topSearched[0].name));
  check('most loved style: knotless (3 loves)', o.demand.topLoved[0].key === 'knotless-braids' && o.demand.topLoved[0].count === 3);
  check('WANTED BUT SCARCE: locs (25 searches, no shops) comes first', o.demand.wantedButScarce[0].key === 'locs' && o.demand.wantedButScarce[0].shops === 0);
  check('engagement: 4 likes, 2 follows, 4 conversations', o.engagement.likes === 4 && o.engagement.follows === 2 && o.engagement.conversations === 4);
  check('trust: 2 open reports (1 urgent), 1 ID waiting, 2 password requests (counted as OPEN)', o.trust.openReports === 2 && o.trust.urgentOpen === 1 && o.trust.pendingVerifications === 1 && o.trust.passwordHelp === 2 && pwFilter.status === 'OPEN');
  check('community feedback waiting is counted for the To do badge (3)', o.trust.communityFeedback === 3);
  check('invites and training counted', o.invites.VALIDATED === 2 && o.training.skillsSignedOff === 2 && o.training.graduated === 1 && o.training.worksPosted === 6);
  console.log('--- THE MAP ---');
  r = await call('GET', '/api/analytics/map', ADMIN);
  const pins = r.j.pins;
  check('the admin map uses EXACT pins (not rounded)', r.s === 200 && pins.find((p) => p.name === 'Etornam Braids').lat === 5.534);
  check('status shown: live, restricted', pins.find((p) => p.name === 'Kofi').status === 'LIVE' && pins.find((p) => p.name === 'Bad').status === 'RESTRICTED');
  check('shops with no location are counted, not guessed', r.j.withoutLocation === 1);
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
});
