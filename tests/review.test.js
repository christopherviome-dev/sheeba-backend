// Engineering review (27 Sep): public privacy, anti-abuse ceilings, input checks.
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
// Admin switches: a stand-in returning nothing, so every switch uses its safe default (instant, no database).
{ const Setting = require(path.join(B, 'models/Setting')); Setting.findById = async () => null; }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), Customer = R('models/Customer'), Request = R('models/Request'), Activity = R('models/Activity');
const SavingsGoal = R('models/SavingsGoal'), Referral = R('models/Referral'), Notification = R('models/Notification'), Conversation = R('models/Conversation');
const attempts = R('lib/attempts'); attempts._setNowForTests(() => 1e12);
const { discoverCard } = R('lib/discover');
let seq = 0;
const doc = (f) => ({ ...f, _id: { toString: () => f.id, toJSON: () => f.id }, save: async function () { return this; }, markModified() {}, toObject() { const { toObject, save, markModified, ...r } = this; return JSON.parse(JSON.stringify(r)); } });
const S = { shop: doc({ id: 'shop', name: 'Gentlemans look', status: 'APPROVED', accountStatus: 'ACTIVE', isAdmin: true, isMinor: false, staffAccess: [{ stylistId: 'x' }], restrictionReason: null,
  location: { lat: 5.603716, lng: -0.186964 }, styles: [{ id: 's1', name: 'Cut', price: 50, likes: [] }], followers: [], availability: 'AVAILABLE', ageConfirmedAt: 123, idType: 'GHANA_CARD', verificationSubmittedAt: 1 }) };
const C = { ama: doc({ id: 'ama', name: 'Ama', accountStatus: 'ACTIVE' }) };
const GOALS = [], LINKS = [];
Stylist.findById = async (id) => S[String(id)] || null; Stylist.find = async () => Object.values(S);
Customer.findById = async (id) => C[String(id)] || null; Customer.exists = async (f) => !!C[String(f._id)];
Activity.findOne = async () => null; Activity.create = async () => ({}); Request.countDocuments = async () => 0;
Request.create = async (f) => ({ ...f, _id: { toString: () => 'r' + (++seq) } }); Notification.create = async () => ({});
Request.find = async () => []; // no ratings yet in this suite
Conversation.findOne = async () => null; Conversation.create = async () => ({ _id: { toString: () => 'c' }, save: async () => {} });
SavingsGoal.countDocuments = async () => GOALS.length; SavingsGoal.create = async (f) => { GOALS.push(f); return f; };
Referral.countDocuments = async () => LINKS.length; Referral.exists = async () => false; Referral.create = async (f) => { LINKS.push(f); return f; };
const app = express(); app.set('trust proxy', 1); app.use(express.json());
app.use('/api/stylists', R('routes/stylists')); app.use('/api/stylists', R('routes/crm')); app.use('/api/requests', R('routes/requests')); app.use('/api/customers', R('routes/customers'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (p) => jwt.sign(p, 't'); const PRO = T({ id: 'shop', isAdmin: true }), AMA = T({ id: 'ama', role: 'customer' });
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const server = app.listen(8233, async () => {
  const call = async (m, u, t, body, ip = '1.1.1.1') => { const r = await fetch('http://localhost:8233' + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  console.log('--- PUBLIC SHOP RECORDS ---');
  let r = await call('GET', '/api/stylists/shop');
  for (const k of ['isAdmin', 'isMinor', 'staffAccess', 'ageConfirmedAt', 'idType', 'verificationSubmittedAt']) check(`"${k}" no longer public`, !(k in r.j));
  check('public location rounded to ~1 km (5.60, -0.19)', r.j.location.lat === 5.6 && r.j.location.lng === -0.19, JSON.stringify(r.j.location));
  r = await call('GET', '/api/stylists');
  check('same in the public list', r.j.length && !('isAdmin' in r.j[0]) && r.j[0].location.lat === 5.6);
  r = await call('GET', '/api/stylists', PRO);
  check('the ADMIN list still shows everything, exact location included', r.j[0].isAdmin === true && r.j[0].location.lat === 5.603716);
  r = await call('GET', '/api/stylists/me', PRO);
  check('the professional still sees their own exact pin', r.j.location.lat === 5.603716);
  const card = discoverCard(S.shop).card;
  check('the Discover feed is rounded too', card.location.lat === 5.6 && card.location.lng === -0.19);
  console.log('--- FLOODS OF FAKE FOLLOWS, LIKES, VISITS ---');
  let blockedAt = null;
  for (let i = 1; i <= 305 && !blockedAt; i++) { const x = await call('POST', '/api/stylists/shop/visit', null, { clientId: 'fake-' + i }, '9.9.9.9'); if (x.s === 429) blockedAt = i; }
  check('301st anonymous action from one address in 15 minutes is refused', blockedAt === 301, 'blocked at ' + blockedAt);
  r = await call('POST', '/api/stylists/shop/styles/s1/like?lean=1', null, { clientId: 'real-person' }, '8.8.8.8');
  check('someone on a different network is unaffected', r.s === 200);
  r = await call('POST', '/api/stylists/shop/visit', null, { clientId: 'x'.repeat(5000) }, '7.7.7.7');
  check('a huge visitor id is trimmed, not stored whole (visit still counted)', r.s === 200);
  console.log('--- FAKE BOOKINGS WITHOUT AN ACCOUNT ---');
  let anonBlocked = null;
  for (let i = 1; i <= 22 && !anonBlocked; i++) { const x = await call('POST', '/api/requests', null, { stylistId: 'shop', styleId: 's1', clientId: 'anon-' + i, clientName: 'X', clientPhone: '0240000000', preferredAt: Date.now() + 86400000 }, '6.6.6.6'); if (x.s === 429) anonBlocked = i; }
  check('21st booking without an account from one address → refused', anonBlocked === 21, 'blocked at ' + anonBlocked);
  r = await call('POST', '/api/requests', AMA, { stylistId: 'shop', styleId: 's1', clientId: 'ama', clientName: 'Ama', clientPhone: '0241112222', preferredAt: Date.now() + 86400000 }, '6.6.6.6');
  check('a logged-in customer on the same network still books', r.s === 200, r.s + ' ' + JSON.stringify(r.j).slice(0, 80));
  console.log('--- CUSTOMER NAME, SAVINGS GOALS, LINKS ---');
  r = await call('PUT', '/api/customers/me', AMA, { name: { evil: true } });
  check("a name that isn't text is refused cleanly (no crash)", r.s === 400);
  r = await call('PUT', '/api/customers/me', AMA, { name: 'x'.repeat(61) });
  check('an over-long name is refused', r.s === 400);
  r = await call('PUT', '/api/customers/me', AMA, { name: '  Ama   Serwaa ' });
  check('a normal name is saved tidily', r.s === 200 && C.ama.name === 'Ama Serwaa');
  r = await call('POST', '/api/customers/me/savings-goals', AMA, { label: 'Wedding braids', targetAmountMinor: -500 });
  check('a negative savings target is refused', r.s === 400);
  r = await call('POST', '/api/customers/me/savings-goals', AMA, { label: 'Wedding braids', targetAmountMinor: 'lots' });
  check('a non-number target is refused', r.s === 400);
  r = await call('POST', '/api/customers/me/savings-goals', AMA, { label: 'Wedding braids', targetAmountMinor: 60000, currency: 'MONOPOLY', note: 'n'.repeat(900) });
  check('valid goal saved: unknown currency → GHS, note trimmed to 300', r.s === 200 && GOALS[0].currency === 'GHS' && GOALS[0].note.length === 300);
  while (GOALS.length < 20) GOALS.push({});
  r = await call('POST', '/api/customers/me/savings-goals', AMA, { label: 'One more', targetAmountMinor: 100 });
  check('at most 20 savings goals', r.s === 400);
  r = await call('POST', '/api/stylists/me/referrals', PRO, { label: 'x'.repeat(61) });
  check('an over-long link name is refused', r.s === 400);
  r = await call('POST', '/api/stylists/me/referrals', PRO, { label: 'WhatsApp status', channel: 'CARRIER_PIGEON' });
  check('an unknown channel becomes "Other" instead of an error', r.s === 200 && LINKS[0].channel === 'OTHER');
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
});
