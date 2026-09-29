// Admin switches (enforced on the server), return patterns, founding flag (28 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Setting = R('models/Setting'), Stylist = R('models/Stylist'), Customer = R('models/Customer'), Request = R('models/Request');
const AdminAction = R('models/AdminAction'), Activity = R('models/Activity'), Notification = R('models/Notification'), Conversation = R('models/Conversation');
const InviteReward = R('models/InviteReward'), StyleRecord = R('models/StyleRecord');
const { discoverCard } = R('lib/discover');
const SET = {}, audit = [];
Setting.findById = async (k) => (k in SET ? { _id: k, value: SET[k] } : null);
Setting.findOneAndUpdate = async (f, u) => { SET[f._id] = u.$set.value; return {}; };
AdminAction.create = async (a) => { audit.push(a); return a; };
const DAY = 86400000, now = Date.now();
const doc = (f) => ({ ...f, _id: { toString: () => f.id, toJSON: () => f.id }, save: async function () { return this; }, markModified() {} });
const S = { adm: doc({ id: 'adm', name: 'Christopher', isAdmin: true, accountStatus: 'ACTIVE' }),
  shop: doc({ id: 'shop', name: 'Etornam', status: 'APPROVED', accountStatus: 'ACTIVE', availability: 'AVAILABLE', verified: true, country: 'GH', styles: [{ id: 's1', name: 'Knotless', price: 300 }] }),
  plain: doc({ id: 'plain', name: 'Kofi', status: 'APPROVED', accountStatus: 'ACTIVE', verified: false, country: 'GH', styles: [] }) };
const C = { ama: doc({ id: 'ama', name: 'Ama', accountStatus: 'ACTIVE' }), yaw: doc({ id: 'yaw', name: 'Yaw', accountStatus: 'ACTIVE' }) };
const RQ = {
  a1: doc({ id: 'a1', stylistId: 'shop', clientId: 'ama', status: 'completed', completedAt: now - 75 * DAY, updatedAt: now }),
  a2: doc({ id: 'a2', stylistId: 'shop', clientId: 'ama', status: 'completed', completedAt: now - 40 * DAY, updatedAt: now }),
  a3: doc({ id: 'a3', stylistId: 'shop', clientId: 'ama', status: 'completed', completedAt: now - 5 * DAY, updatedAt: now }),
  y1: doc({ id: 'y1', stylistId: 'shop', clientId: 'yaw', status: 'completed', completedAt: now - 60 * DAY, updatedAt: now }),
  y2: doc({ id: 'y2', stylistId: 'shop', clientId: 'yaw', status: 'completed', completedAt: now - 40 * DAY, updatedAt: now }),
  job: doc({ id: 'job', stylistId: 'shop', clientId: 'walkin-browser', status: 'accepted', preferredAt: now + DAY }), // not Ama: keeps her visit pattern clean
};
Stylist.findById = async (id) => S[String(id)] || null;
Stylist.find = async (f) => (f && (f.isAdmin || f.$or) ? [S.adm] : Object.values(S).filter((s) => s.status === 'APPROVED'));
Customer.findById = async (id) => C[String(id)] || null;
Request.find = async (f) => Object.values(RQ).filter((r) => r.stylistId === f.stylistId && r.clientId);
Request.findById = async (id) => RQ[String(id)] || null;
Request.findOneAndUpdate = async (f, u) => { const r = RQ[String(f._id)]; if (!r || r.status !== f.status) return null; Object.assign(r, u); return r; };
Request.countDocuments = async () => 0;
Activity.create = async () => ({}); Activity.aggregate = async () => [];
Notification.create = async () => ({}); Conversation.findOne = async () => null;
StyleRecord.findOne = async () => null; StyleRecord.create = async (f) => f;
let rewardLookups = 0; InviteReward.findOne = async () => { rewardLookups++; return null; };
const app = express(); app.use(express.json());
app.use('/api/settings', R('routes/settings')); app.use('/api/admin', R('routes/admin')); app.use('/api/auth', R('routes/auth'));
app.use('/api/customers', R('routes/customers')); app.use('/api/requests', R('routes/requests')); app.use('/api', R('routes/messages'));
app.use('/api/stylists', R('routes/crm')); app.use('/api/stylists', R('routes/stylists'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (p) => jwt.sign(p, 't'); const ADMIN = T({ id: 'adm' }), SHOP = T({ id: 'shop' }), AMA = T({ id: 'ama', role: 'customer' });
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const server = app.listen(0, async () => {
  const port = server.address().port;
  const call = async (m, u, t, body) => { const r = await fetch(`http://localhost:${port}${u}`, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  const set = (k, v, t = ADMIN) => call('PUT', `/api/admin/settings/${k}`, t, { value: v });
  console.log('--- THE SWITCHES ---');
  let r = await call('GET', '/api/settings');
  check('safe defaults: nothing paused, rewards and messages on, no announcement', r.j.pauseSignups === false && r.j.pauseBookings === false && r.j.messages === true && r.j.inviteRewards === true && r.j.announcement === '');
  check('a normal professional cannot flip switches', (await set('pauseBookings', true, SHOP)).s === 403);
  check('an unknown switch is refused', (await set('selfDestruct', true)).s === 404);
  r = await call('GET', '/api/admin/settings', ADMIN);
  check('the admin sees every switch, including "ID-checked only"', r.s === 200 && r.j.verifiedOnly === false && r.j.inviteRewards === true && 'announcement' in r.j);
  check('a normal professional cannot read the admin switch list', (await call('GET', '/api/admin/settings', SHOP)).s === 403);
  check('a switch needs on or off, not text', (await set('pauseBookings', 'yes')).s === 400);
  r = await set('announcement', '   New:   Fresh Look is here!   ' + 'x'.repeat(300));
  check('the announcement is tidied and kept to 200 characters; logged', r.s === 200 && SET.announcement.startsWith('New: Fresh Look is here!') && SET.announcement.length === 200 && audit.some((a) => a.targetId === 'announcement'));
  r = await call('GET', '/api/settings');
  check('everyone sees the announcement', r.j.announcement.startsWith('New: Fresh Look'));
  console.log('--- EACH ONE REALLY WORKS ---');
  await set('pauseSignups', true);
  r = await call('POST', '/api/customers/register', null, { phone: '0551234567', password: 'goodpass1', name: 'New', country: 'GH' });
  check('PAUSE SIGN-UPS: customers told to try later', r.s === 503 && /paused/.test(r.j.error));
  r = await call('POST', '/api/auth/register', null, { phone: '0551234568', password: 'goodpass1', name: 'New Pro', country: 'GH' });
  check('…and professionals too', r.s === 503);
  await set('pauseSignups', false);
  await set('pauseBookings', true);
  r = await call('POST', '/api/requests', AMA, { stylistId: 'shop', styleId: 's1', clientId: 'ama', clientName: 'Ama', clientPhone: '0241112222', preferredAt: now + DAY });
  check('PAUSE BOOKINGS: new requests told to try later', r.s === 503 && /paused/.test(r.j.error));
  r = await call('POST', '/api/customers/me/book-again/a3', AMA, {});
  check('…including "book again"', r.s === 503);
  await set('pauseBookings', false);
  await set('messages', false);
  r = await call('POST', '/api/conversations', AMA, { stylistId: 'shop' });
  check('MESSAGES OFF: new conversations refused, pointing to call or WhatsApp', r.s === 503 && /WhatsApp/.test(r.j.error));
  r = await call('POST', '/api/conversations/c1/messages', AMA, { text: 'hi' });
  check('…and sending too', r.s === 503);
  await set('messages', true);
  await set('verifiedOnly', true);
  r = await call('GET', '/api/stylists/discover?country=GH');
  check('ID-CHECKED ONLY: Discover shows only ID-checked professionals', r.s === 200 && r.j.length === 1 && r.j[0].name === 'Etornam', JSON.stringify(r.j.map((x) => x.name)));
  await set('verifiedOnly', false);
  r = await call('GET', '/api/stylists/discover?country=GH');
  check('…and everyone again when switched off', r.j.length === 2);
  await set('inviteRewards', false);
  rewardLookups = 0;
  r = await call('PUT', '/api/requests/job/status', SHOP, { status: 'completed' });
  check('INVITE REWARDS OFF: completing a job earns no reward', r.s === 200 && rewardLookups === 0, `status ${r.s}, lookups ${rewardLookups}`);
  await set('inviteRewards', true);
  console.log('--- RETURN PATTERNS (from real visits) ---');
  r = await call('GET', '/api/stylists/me/customers', SHOP);
  const ama = r.j.find((c) => c.name === 'Ama'), yaw = r.j.find((c) => c.name === 'Yaw');
  check('Ama visits every ~35 days (75, 40 and 5 days ago)', ama.usualEveryDays === 35 && ama.returnStatus === 'ON_TRACK');
  check("Yaw usually comes every 20 days, but his last visit was 40 days ago: OVERDUE", yaw.usualEveryDays === 20 && yaw.returnStatus === 'OVERDUE');
  check('one visit is not enough to predict (no guessing)', r.j.every((c) => c.totalCompleted >= 2 || c.usualEveryDays === null));
  console.log('--- FOUNDING MEMBERS ---');
  check('founding member #3 → gold ring flag (a yes/no, never the number)', discoverCard({ _id: 'x', name: 'A', memberNumber: 3, styles: [] }).card.founding === true && !('memberNumber' in discoverCard({ _id: 'x', name: 'A', memberNumber: 3, styles: [] }).card));
  check('member #1500 → no ring', discoverCard({ _id: 'y', name: 'B', memberNumber: 1500, styles: [] }).card.founding === false);
  check('the feed knows when a professional joined (for "New on Sheeba")', discoverCard({ _id: 'z', name: 'C', createdAt: '2026-09-28T10:00:00Z', styles: [] }).card.joinedAt === Date.parse('2026-09-28T10:00:00Z'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
});
