// Restored from the earlier test suites (sessions of 25–27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
// Admin switches: a stand-in returning nothing, so every switch uses its safe default (instant, no database).
{ const Setting = require(path.join(B, 'models/Setting')); Setting.findById = async () => null; }
// Phones are stored in international format now (+233…): compare by the last 9 digits.
const samePhone = (a, b) => String(a || '').replace(/\D/g, '').slice(-9) === String(b || '').replace(/\D/g, '').slice(-9);
// Member numbers (added after this suite was written): a stand-in counter.
{ const Counter = R('models/Counter'); let seqN = 100; Counter.findById = async () => ({ _id: 'members', seq: seqN }); Counter.findOneAndUpdate = async () => ({ seq: ++seqN }); Counter.create = async () => ({}); }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express'), bcrypt = R('node_modules/bcryptjs');
const Stylist = R('models/Stylist'), Customer = R('models/Customer'), InviteReward = R('models/InviteReward');
const Request = R('models/Request'), Notification = R('models/Notification'), Activity = R('models/Activity');
const AdminAction = R('models/AdminAction'), Conversation = R('models/Conversation'), StyleRecord = R('models/StyleRecord');
const { normalizeCode, randomCode } = R('lib/codes');

let seq = 0; const nid = (p) => p + (++seq);
const mk = (f) => { const d = { ...f, _id: { toString: () => f.id }, markModified() {}, save: async function () { return this; } };
  d.toObject = function () { const { toObject, save, markModified, ...r } = this; return { ...r }; }; return d; };
const match = (d, f) => Object.entries(f).every(([k, v]) => {
  if (k === '$or') return v.some((x) => match(d, x)); // e.g. a code OR one of the old codes
  if (Array.isArray(d[k]) && (v === null || typeof v !== 'object')) return d[k].includes(v); // array field contains the value
  if (v && typeof v === 'object' && '$in' in v) return v.$in.map(String).includes(String(d[k]));
  if (k === '_id') return String(d.id) === String(v);
  return d[k] === v;
});
let S = {}, C = {}, INV = {}, REQ = {}, notes = [], audit = [];
const table = (T, prefix, Model) => {
  Model.findById = async (id) => { if (String(id).includes('!')) throw new Error('Cast'); return T[String(id)] || null; };
  Model.findOne = async (f) => Object.values(T).find((d) => match(d, f)) || null;
  Model.exists = async (f) => !!Object.values(T).find((d) => match(d, f));
  Model.find = (f = {}) => { const list = Object.values(T).filter((d) => match(d, f)); const p = Promise.resolve(list); p.sort = () => Promise.resolve(list); return p; };
  Model.countDocuments = async (f = {}) => Object.values(T).filter((d) => match(d, f)).length;
  Model.create = async (f) => {
    if (Model === InviteReward && Object.values(T).some((d) => d.referredType === f.referredType && d.referredId === f.referredId)) throw new Error('dup');
    const id = nid(prefix); T[id] = mk({ id, status: Model === InviteReward ? 'JOINED' : f.status, ...f }); return T[id];
  };
  Model.findOneAndUpdate = async (f, u) => { const d = Object.values(T).find((x) => match(x, f)); if (!d) return null; Object.assign(d, u.$set || u); return d; };
  Model.updateMany = async (f, u) => { const list = Object.values(T).filter((d) => match(d, f)); list.forEach((d) => Object.assign(d, u.$set)); return { modifiedCount: list.length }; };
};
table(S, 'st', Stylist); table(C, 'cu', Customer); table(INV, 'inv', InviteReward); table(REQ, 'rq', Request);
Notification.create = async (n) => { notes.push(n); return n; };
Activity.create = async () => ({}); AdminAction.create = async (a) => { audit.push(a); return a; };
Conversation.findOne = async () => null; Conversation.create = async () => ({}); StyleRecord.create = async () => ({});

const app = express(); app.use(express.json());
app.use('/api/auth', R('routes/auth')); app.use('/api/customers', R('routes/customers'));
app.use('/api/stylists', R('routes/stylists')); app.use('/api/requests', R('routes/requests'));
app.use('/api/u', R('routes/codes')); app.use('/api/invites', R('routes/invites')); app.use('/api/admin', R('routes/admin'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (p) => jwt.sign(p, 't');
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };

const server = app.listen(8201, async () => {
  const call = async (m, u, tok, body) => { const r = await fetch('http://localhost:8201' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  S.adm = mk({ id: 'adm', name: 'Christopher', isAdmin: true, phone: '0200000000', status: 'APPROVED', accountStatus: 'ACTIVE', styles: [], code: 'ADMN22' });
  S.pro = mk({ id: 'pro', name: 'Etornam', salonName: 'Etornam Braids', phone: '0544377501', status: 'APPROVED', accountStatus: 'ACTIVE', currency: 'GHS', styles: [{ id: 's1', name: 'Knotless', price: 300 }], availability: 'AVAILABLE', code: 'K7M2QX' });
  S.old = mk({ id: 'old', name: 'Old shop', phone: '0277777777', status: 'UNDER_REVIEW', accountStatus: 'ACTIVE', styles: [] }); // no code yet
  const ADMIN = T({ id: 'adm', isAdmin: true }), PRO = T({ id: 'pro' }), OLD = T({ id: 'old' });

  console.log('--- CODES ---');
  const sample = new Set(Array.from({ length: 2000 }, randomCode));
  check('2000 random codes: all 6 characters, no I/L/O/0/1', [...sample].every((c) => /^[A-HJKMNP-Z2-9]{6}$/.test(c)));
  check('typed "k7m-2qx" is understood as K7M2QX', normalizeCode(' k7m-2qx ') === 'K7M2QX');
  check('look-alike characters rejected (O0I1L)', normalizeCode('O0I1LA') === null);
  let r = await call('POST', '/api/auth/register', null, { phone: '0551112222', password: 'pass12345', name: 'New Pro' });
  const newPro = Object.values(S).find((s) => s.phone === '+233551112222'); // phones are stored in international format now
  check('new professional gets a friendly code at signup (e.g. NEWPRO0101)', r.s === 200 && newPro && /^[A-Z]{2,8}\d{4,7}$/.test(newPro.code || ''), newPro ? newPro.code : 'no account');
  r = await call('GET', '/api/stylists/me', OLD);
  check('an older account gets its friendly code the first time it opens My Shop', r.s === 200 && /^[A-Z]{2,8}\d{4,7}$/.test(S.old.code || ''), S.old.code + ' / ' + r.s);

  console.log('--- WHAT A SCAN REVEALS ---');
  r = await call('GET', '/api/u/k7m2qx');
  check('live professional → their shop', r.s === 200 && r.j.type === 'professional' && r.j.name === 'Etornam Braids');
  r = await call('GET', `/api/u/${S.old.code}`);
  check('shop awaiting approval → just "member", no name', r.s === 200 && r.j.type === 'member' && !r.j.name && !r.j.id);
  r = await call('GET', '/api/u/ZZZZZZ');
  check('unknown code → 404', r.s === 404);
  r = await call('GET', '/api/u/hello!');
  check('junk → 404', r.s === 404);

  console.log('--- JOINING WITH A CODE ---');
  r = await call('POST', '/api/customers/register', null, { phone: '0241112222', password: 'pass12345', name: 'Ama Serwaa', inviteCode: 'k7m-2qx' });
  const ama = Object.values(C).find((c) => samePhone(c.phone, '0241112222'));
  const amaTok = r.j.token;
  const inv1 = Object.values(INV).find((i) => i.referredId === ama.id);
  check('customer joins with Etornam\'s code → invite recorded as JOINED', !!inv1 && inv1.status === 'JOINED' && inv1.referrerId === 'pro');
  check('customer gets their own friendly code too', /^[A-Z]{2,8}\d{4,7}$/.test(ama.code || ''), ama.code);
  check('Etornam is told someone joined', notes.some((n) => n.type === 'INVITE_JOINED' && n.recipientId === 'pro'));
  r = await call('GET', `/api/u/${ama.code}`);
  check('scanning a CUSTOMER code reveals nothing personal', r.s === 200 && r.j.type === 'member' && !JSON.stringify(r.j).includes('Ama'));
  r = await call('POST', '/api/customers/register', null, { phone: '+233 54 437 7501', password: 'pass12345', name: 'Etornam again', inviteCode: 'K7M2QX' });
  check('SELF-INVITE: same phone, own code → no reward', r.s === 200 && Object.values(INV).length === 1);
  r = await call('POST', '/api/customers/register', null, { phone: '0209998888', password: 'pass12345', name: 'Kofi', inviteCode: 'NOPE99' });
  check('unknown code → signup still works, no reward', r.s === 200 && Object.values(INV).length === 1);
  r = await call('POST', '/api/auth/register', null, { phone: '0263334444', password: 'pass12345', name: 'Yaa Pro', inviteCode: ama.code });
  const yaa = Object.values(S).find((s) => samePhone(s.phone, '0263334444'));
  check('a customer can invite a professional too', Object.values(INV).some((i) => i.referredId === yaa.id && i.referrerId === ama.id));

  // Rewritten 28 Sep for the CURRENT reward rules (Christopher retired the original cash design):
  // a first completed job moves an invite to CHECKING, or UNDER_REVIEW if something looks wrong;
  // the admin then confirms (VALIDATED) or voids it. No cash, so no "owed" or "paid" ledger.
  console.log('--- FIRST COMPLETED JOB: CHECKED, NOT PAID ---');
  const complete = async (reqDoc) => {
    REQ[reqDoc.id] = mk({ status: 'accepted', ...reqDoc });
    return call('PUT', `/api/requests/${reqDoc.id}/status`, T({ id: reqDoc.stylistId }), { status: 'completed' });
  };
  S[yaa.id].status = 'APPROVED';
  r = await complete({ id: 'job1', stylistId: yaa.id, clientId: ama.id, clientName: 'Ama', clientPhone: '0241112222', serviceNameSnapshot: 'Cornrows', priceSnapshot: 150 });
  const amaInv = Object.values(INV).find((i) => i.referredId === ama.id), yaaInv = Object.values(INV).find((i) => i.referredId === yaa.id);
  check("Ama's first completed job → Etornam's reward is being CHECKED (GH₵1)", r.s === 200 && amaInv.status === 'CHECKING' && amaInv.amountMinor === 100 && amaInv.currency === 'GHS', JSON.stringify({ s: r.s, st: amaInv.status }));
  check("FRAUD CHECK: Ama invited Yaa AND was Yaa's customer → UNDER REVIEW", yaaInv.status === 'UNDER_REVIEW' && (yaaInv.flags || []).includes('REFERRER_INVOLVED'));
  check("Etornam wasn't on the job → no flag on hers", !amaInv.flag);
  check('both people who invited are told', notes.filter((n) => n.type === 'INVITE_REWARD_EARNED').length === 2);
  const earnedAt = amaInv.earnedAt;
  await complete({ id: 'job2', stylistId: yaa.id, clientId: ama.id, clientName: 'Ama', clientPhone: '0241112222' });
  check('a second completed job adds nothing more', amaInv.earnedAt === earnedAt && Object.values(INV).filter((i) => i.status !== 'JOINED').length === 2);

  console.log('--- MY INVITES (what people see) ---');
  r = await call('GET', '/api/invites/me', PRO);
  check('Etornam sees her code and 1 reward being checked (GH₵1)', r.s === 200 && /^[A-Z]{2,8}\d{4,7}$/.test(r.j.code) && (S.pro.legacyCodes || []).includes('K7M2QX') && r.j.counts.checking === 1 && r.j.totals.checkingMinor === 100 && r.j.totals.validatedMinor === 0, JSON.stringify(r.j.counts));
  check('only a first name is shown, no phone number', r.j.invites[0].name === 'Ama' && !JSON.stringify(r.j).includes('0241112222'));
  r = await call('GET', '/api/invites/me', amaTok);
  check("Ama's own login shows her invite under review", r.s === 200 && r.j.counts.underReview === 1);
  r = await call('GET', '/api/invites/me');
  check('not logged in → 401', r.s === 401);

  console.log('--- ADMIN: CONFIRM OR VOID ---');
  r = await call('GET', '/api/admin/invite-rewards', PRO);
  check('a normal professional cannot see rewards (403)', r.s === 403);
  r = await call('GET', '/api/admin/invite-rewards?status=UNDER_REVIEW', ADMIN);
  const gAma = r.s === 200 && r.j.groups.find((g) => g.referrerId === ama.id);
  check('the flagged reward shows under review, with its warning sign', gAma && gAma.rewards[0].flags.includes('REFERRER_INVOLVED'));
  r = await call('GET', '/api/admin/invite-rewards?status=CHECKING', ADMIN);
  const gE = r.s === 200 && r.j.groups.find((g) => g.referrerId === 'pro');
  check("Etornam's reward is being checked, with her phone and the qualifying job", gE && samePhone(gE.phone, '0544377501') && gE.totalMinor === 100 && gE.rewards[0].job && gE.rewards[0].job.service === 'Cornrows' && gE.rewards[0].job.professional === 'Yaa Pro');
  r = await call('POST', `/api/admin/invite-rewards/${yaaInv.id}/void`, ADMIN, { reason: 'no' });
  check('voiding needs a real reason', r.s === 400);
  r = await call('POST', `/api/admin/invite-rewards/${yaaInv.id}/void`, PRO, { reason: 'Referrer was the customer on the job' });
  check('a normal professional cannot void (403)', r.s === 403);
  r = await call('POST', `/api/admin/invite-rewards/${yaaInv.id}/void`, ADMIN, { reason: 'Referrer was the customer on the job' });
  check('admin voids the flagged reward; the reason is logged', r.s === 200 && yaaInv.status === 'VOID' && audit.some((a) => a.action === 'INVITE_REWARD_VOIDED'));
  r = await call('POST', `/api/admin/invite-rewards/${yaaInv.id}/validate`, ADMIN);
  check('a voided reward can never be confirmed', r.s === 400);
  r = await call('POST', `/api/admin/invite-rewards/${amaInv.id}/validate`, ADMIN);
  check("admin confirms Etornam's reward; it's logged", r.s === 200 && amaInv.status === 'VALIDATED' && audit.some((a) => a.action === 'INVITE_REWARD_VALIDATED'));
  r = await call('GET', '/api/invites/me', PRO);
  check('Etornam now sees GH₵1 confirmed, nothing left being checked', r.j.totals.validatedMinor === 100 && r.j.totals.checkingMinor === 0);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); process.exit(fail ? 1 : 0);
});
