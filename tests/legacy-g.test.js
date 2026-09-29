// Restored from the earlier test suites (sessions of 25–27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
// Admin switches: a stand-in returning nothing, so every switch uses its safe default (instant, no database).
{ const Setting = require(path.join(B, 'models/Setting')); Setting.findById = async () => null; }
// Member numbers (added after this suite was written): a stand-in counter.
{ const Counter = R('models/Counter'); let seqN = 100; Counter.findById = async () => ({ _id: 'members', seq: seqN }); Counter.findOneAndUpdate = async () => ({ seq: ++seqN }); Counter.create = async () => ({}); }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), Customer = R('models/Customer'), Request = R('models/Request'), Notification = R('models/Notification');
const Activity = R('models/Activity'), InviteReward = R('models/InviteReward');
let seq = 0;
const mk = (f) => ({ ...f, _id: { toString: () => f.id, toJSON: () => f.id }, save: async function () { return this; }, toObject() { const { toObject, save, ...r } = this; return { ...r }; } });
const match = (d, f) => Object.entries(f).every(([k, v]) => {
  if (k === '$or') return v.some((x) => match(d, x)); // e.g. a code OR one of the old codes
  if (Array.isArray(d[k]) && (v === null || typeof v !== 'object')) return d[k].includes(v); // array field contains the value
  if (v && typeof v === 'object' && '$in' in v) return v.$in.map(String).includes(k === '_id' ? String(d.id) : String(d[k]));
  if (k === '_id') return String(d.id) === String(v);
  return d[k] === v;
});
const S = {}, C = {}, RQ = {}, notes = [];
const table = (T, prefix, M) => {
  M.findById = async (id) => { if (String(id).includes('!')) throw new Error('Cast'); return T[String(id)] || null; };
  M.findOne = async (f) => Object.values(T).find((d) => match(d, f)) || null;
  M.exists = async (f) => !!Object.values(T).find((d) => match(d, f));
  M.find = async (f = {}) => Object.values(T).filter((d) => match(d, f));
  M.create = async (f) => { const id = prefix + (++seq); T[id] = mk({ id, styles: [], staffAccess: [], ...f }); return T[id]; };
};
table(S, 'st', Stylist); table(C, 'cu', Customer); table(RQ, 'rq', Request);
Notification.create = async (n) => { notes.push(n); return n; }; Activity.create = async () => ({});
InviteReward.create = async () => { throw new Error('none'); }; InviteReward.findOne = async () => null;

const app = express(); app.use(express.json());
app.use('/api/auth', R('routes/auth')); app.use('/api/stylists', R('routes/stylists')); app.use('/api/checkin', R('routes/checkin'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (p) => jwt.sign(p, 't');
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };

const server = app.listen(8211, async () => {
  const call = async (m, u, tok, body) => { const r = await fetch('http://localhost:8211' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  S.boss = mk({ id: 'boss', name: 'Etornam', salonName: 'Etornam Braids', code: 'ETORNAM0003', status: 'APPROVED', accountStatus: 'ACTIVE', staffAccess: [], role: 'PROFESSIONAL' });
  S.other = mk({ id: 'other', name: 'Kofi', code: 'KOFI0004', status: 'APPROVED', accountStatus: 'ACTIVE', staffAccess: [] });
  const BOSS = T({ id: 'boss' }), OTHER = T({ id: 'other' });

  console.log('--- APPRENTICE SIGNUP ---');
  let r = await call('POST', '/api/auth/register', null, { phone: '0551112222', password: 'pass12345', name: 'Abena', role: 'APPRENTICE' });
  check('apprentice without a supervisor code → refused', r.s === 400 && !Object.values(S).some((s) => s.name === 'Abena'));
  r = await call('POST', '/api/auth/register', null, { phone: '0551112222', password: 'pass12345', name: 'Abena', role: 'APPRENTICE', supervisorCode: 'NOPE99' });
  check('unknown supervisor code → refused', r.s === 400);
  r = await call('POST', '/api/auth/register', null, { phone: '0551112222', password: 'pass12345', name: 'Abena', role: 'APPRENTICE', supervisorCode: 'etornam-0003' });
  const ab = Object.values(S).find((s) => s.name === 'Abena');
  check('apprentice signs up with the supervisor\'s code: pending', r.s === 200 && ab && ab.role === 'APPRENTICE' && ab.supervisorId === 'boss' && ab.supervisorStatus === 'PENDING', 'status=' + r.s + ' ' + JSON.stringify(r.j));
  check('supervisor is asked to confirm', notes.some((n) => n.type === 'APPRENTICE_REQUEST' && n.recipientId === 'boss'));
  r = await call('POST', '/api/auth/register', null, { phone: '0551113333', password: 'pass12345', name: 'Yaa', role: 'APPRENTICE', supervisorCode: ab.code || 'XXXX22' });
  check("an apprentice can't be someone's supervisor", r.s === 400);

  console.log('--- SUPERVISOR ANSWERS ---');
  r = await call('GET', '/api/stylists/me/apprentices', BOSS);
  check('supervisor sees the request', r.s === 200 && r.j.length === 1 && r.j[0].name === 'Abena' && r.j[0].status === 'PENDING');
  r = await call('POST', `/api/stylists/me/apprentices/${ab.id}/approve`, OTHER);
  check('a different professional cannot approve', r.s === 404 && ab.supervisorStatus === 'PENDING');
  r = await call('POST', `/api/stylists/me/apprentices/${ab.id}/approve`, BOSS);
  check('supervisor approves → apprentice joins the shop\'s staff access', r.s === 200 && ab.supervisorStatus === 'APPROVED' && S.boss.staffAccess.some((x) => x.stylistId === ab.id));
  check('apprentice is told', notes.some((n) => n.type === 'APPRENTICE_APPROVED' && n.recipientId === ab.id));
  r = await call('POST', `/api/stylists/me/apprentices/${ab.id}/decline`, BOSS);
  check('answering twice refused', r.s === 400);
  r = await call('POST', `/api/stylists/me/apprentices/${ab.id}/delete`, BOSS);
  check('unknown decision → 404', r.s === 404);

  console.log('--- STAFF BY PHONE (numbers now stored internationally) ---');
  S.helper = mk({ id: 'helper', name: 'Helper', phone: '+233209998888', staffAccess: [] });
  r = await call('POST', '/api/stylists/me/staff', OTHER, { phone: '020 999 8888' });
  check('owner typing "020 999 8888" finds the "+233…" account', r.s === 200 && S.other.staffAccess.some((x) => x.stylistId === 'helper'));
  check('staff notification has its own proper type', notes.some((n) => n.type === 'STAFF_ACCESS_GRANTED' && n.recipientId === 'helper'));

  console.log('--- CUSTOMER SELF CHECK-IN (scanning the shop\'s QR) ---');
  C.ama = mk({ id: 'ama', name: 'Ama Serwaa' });
  const AMA = T({ id: 'ama', role: 'customer' }), H = 3600 * 1000;
  RQ.now = mk({ id: 'now', stylistId: 'boss', clientId: 'ama', status: 'accepted', preferredAt: Date.now() + H, serviceNameSnapshot: 'Knotless' });
  RQ.later = mk({ id: 'later', stylistId: 'boss', clientId: 'ama', status: 'accepted', preferredAt: Date.now() + 3 * 24 * H });
  r = await call('GET', '/api/checkin/self/ETORNAM0003');
  check('not logged in → 401', r.s === 401);
  r = await call('GET', '/api/checkin/self/ETORNAM0003', BOSS);
  check('a professional login cannot self check-in', r.s === 401 || r.s === 403);
  r = await call('GET', '/api/checkin/self/KOFI0004', AMA);
  check('no appointment at that shop → nothing offered', r.s === 200 && r.j.found === false);
  r = await call('GET', '/api/checkin/self/etornam0003', AMA);
  check("offers today's appointment (not the one in 3 days)", r.s === 200 && r.j.found === true && r.j.appointment._id === 'now' && r.j.shopName === 'Etornam Braids');
  r = await call('POST', '/api/checkin/self/ETORNAM0003', AMA);
  check('customer checks in: time recorded, marked as self check-in', r.s === 200 && typeof RQ.now.checkedInAt === 'number' && RQ.now.checkedInBy === 'customer');
  check('the shop is told the customer has arrived', notes.some((n) => n.type === 'CUSTOMER_CHECKED_IN' && n.recipientId === 'boss' && /Ama has arrived/.test(n.title)));
  check("the appointment 3 days away was NOT checked in", !RQ.later.checkedInAt);
  RQ.now.checkedInAt = null; RQ.now.status = 'pending';
  r = await call('POST', '/api/checkin/self/ETORNAM0003', AMA);
  check('not yet accepted → cannot self check-in', r.s === 400 && !RQ.now.checkedInAt);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); process.exit(fail ? 1 : 0);
});
