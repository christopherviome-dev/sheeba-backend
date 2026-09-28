// Restored from the earlier test suites (sessions of 25–27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), Customer = R('models/Customer'), InviteReward = R('models/InviteReward'), Request = R('models/Request');
const Notification = R('models/Notification'), Activity = R('models/Activity'), AdminAction = R('models/AdminAction');
const Counter = R('models/Counter'), Setting = R('models/Setting');
const { markInviteEarned, validateDue } = R('lib/invites');

// A stand-in database that understands the operators these features use.
const ok = (d, f) => Object.entries(f).every(([k, v]) => {
  const x = k === '_id' ? d.id : d[k];
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('$in' in v) return v.$in.map(String).includes(String(x));
    if ('$lte' in v) return x != null && x <= v.$lte;
  }
  if (v === null) return x === null || x === undefined;
  return String(x) === String(v);
});
let seq = 0;
const mk = (f) => ({ ...f, _id: { toString: () => f.id, toJSON: () => f.id }, save: async function () { return this; } });
const table = (T, M) => {
  M.findById = async (id) => T[String(id)] || null;
  M.findOne = async (f) => Object.values(T).find((d) => (f.$or ? f.$or.some((x) => ok(d, x)) : ok(d, f))) || null;
  M.exists = async (f) => !!(await M.findOne(f));
  M.find = async (f = {}) => Object.values(T).filter((d) => ok(d, f));
  M.create = async (f) => { const id = 'x' + (++seq); T[id] = mk({ id, styles: [], staffAccess: [], createdAt: new Date(), ...f }); return T[id]; };
  M.findOneAndUpdate = async (f, u) => { const d = Object.values(T).find((x) => ok(x, f)); if (!d) return null; Object.assign(d, u.$set || {}); return d; };
  M.updateMany = async (f, u) => { const l = Object.values(T).filter((d) => ok(d, f)); l.forEach((d) => Object.assign(d, u.$set)); return { modifiedCount: l.length }; };
};
const S = {}, C = {}, INV = {}, RQ = {}, SET = {}, notes = [], audit = [];
table(S, Stylist); table(C, Customer); table(INV, InviteReward); table(RQ, Request);
Counter.findById = async () => ({ seq: 1 }); let cseq = 500; Counter.findOneAndUpdate = async () => ({ seq: ++cseq });
Setting.findById = async (id) => SET[id] || null; Setting.findOneAndUpdate = async (q, u) => { SET[q._id] = { ...u.$set }; return SET[q._id]; };
Notification.create = async (n) => { notes.push(n); return n; }; Activity.create = async () => ({}); AdminAction.create = async (a) => { audit.push(a); return a; };
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const DAY = 24 * 3600 * 1000;
const deps = { Stylist, Customer, notify: async () => {} };

(async () => {
  console.log('--- WARNING SIGNS ---');
  S.ref = mk({ id: 'ref', name: 'Referrer' }); S.proX = mk({ id: 'proX', name: 'Pro X' }); S.proY = mk({ id: 'proY', name: 'Pro Y' });
  // a genuine one: joined a week ago, first job with an unrelated professional
  C.c1 = mk({ id: 'c1', name: 'Genuine', createdAt: new Date(Date.now() - 8 * DAY) });
  INV.i1 = mk({ id: 'i1', referrerType: 'stylist', referrerId: 'ref', referredType: 'customer', referredId: 'c1', status: 'JOINED' });
  RQ.j1 = mk({ id: 'j1', stylistId: 'proY', clientId: 'c1' });
  await markInviteEarned(RQ.j1, deps);
  check('genuine first job → CHECKING, no warning signs', INV.i1.status === 'CHECKING' && INV.i1.flags.length === 0);
  // quick: the account was created an hour before its first job
  C.c2 = mk({ id: 'c2', name: 'Quick', createdAt: new Date(Date.now() - 3600 * 1000) });
  INV.i2 = mk({ id: 'i2', referrerType: 'stylist', referrerId: 'ref', referredType: 'customer', referredId: 'c2', status: 'JOINED' });
  RQ.j2 = mk({ id: 'j2', stylistId: 'proX', clientId: 'c2' });
  await markInviteEarned(RQ.j2, deps);
  check('first job within 24 hours of joining → UNDER REVIEW (QUICK_FIRST_JOB)', INV.i2.status === 'UNDER_REVIEW' && INV.i2.flags.includes('QUICK_FIRST_JOB'));
  // pattern: referrals keep completing with the same professional (proX)
  for (const k of ['c3', 'c4']) {
    C[k] = mk({ id: k, name: k, createdAt: new Date(Date.now() - 10 * DAY) });
    INV['i' + k] = mk({ id: 'i' + k, referrerType: 'stylist', referrerId: 'ref', referredType: 'customer', referredId: k, status: 'JOINED' });
    RQ['j' + k] = mk({ id: 'j' + k, stylistId: 'proX', clientId: k });
    await markInviteEarned(RQ['j' + k], deps);
  }
  check('2nd referral with the same professional: not yet a pattern', INV.ic3.status === 'CHECKING', INV.ic3.status + ' ' + INV.ic3.flags);
  check('3rd referral completing with the same professional → UNDER REVIEW (SAME_PROFESSIONAL)', INV.ic4.status === 'UNDER_REVIEW' && INV.ic4.flags.includes('SAME_PROFESSIONAL'), INV.ic4.status + ' ' + INV.ic4.flags);

  console.log('--- AUTOMATIC CONFIRMATION AFTER 7 QUIET DAYS ---');
  INV.i1.earnedAt = Date.now() - 8 * DAY; INV.i2.earnedAt = Date.now() - 8 * DAY; INV.ic3.earnedAt = Date.now() - 2 * DAY;
  await validateDue();
  check('checking for 8 days, no warning signs → VALIDATED automatically', INV.i1.status === 'VALIDATED' && INV.i1.validatedBy === 'auto');
  check('under review is NEVER confirmed automatically (the admin decides)', INV.i2.status === 'UNDER_REVIEW');
  check('checking for only 2 days → still checking', INV.ic3.status === 'CHECKING');

  console.log('--- AGE SWITCH ---');
  const app = express(); app.use(express.json());
  app.use('/api/auth', R('routes/auth')); app.use('/api/customers', R('routes/customers'));
  app.use('/api/settings', R('routes/settings')); app.use('/api/admin', R('routes/admin'));
  app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
  S.adm = mk({ id: 'adm', name: 'Christopher', isAdmin: true }); S.boss = mk({ id: 'boss', name: 'Etornam', code: 'ETNM22', role: 'PROFESSIONAL', staffAccess: [] });
  const ADMIN = jwt.sign({ id: 'adm', isAdmin: true }, 't'), PRO = jwt.sign({ id: 'boss' }, 't');
  const server = app.listen(8215, async () => {
    const call = async (m, u, tok, body) => { const r = await fetch('http://localhost:8215' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
    let r = await call('GET', '/api/settings');
    check('switch is OFF by default', r.s === 200 && r.j.ageCheck === false);
    r = await call('POST', '/api/customers/register', null, { phone: '0241230001', password: 'pass12345', name: 'No Box' });
    check('switch off: signup needs no age box', r.s === 200);
    r = await call('PUT', '/api/admin/settings/ageCheck', PRO, { value: true });
    check('a normal professional cannot flip the switch (403)', r.s === 403);
    r = await call('PUT', '/api/admin/settings/ageCheck', ADMIN, { value: 'yes' });
    check('switch needs a real on/off', r.s === 400);
    r = await call('PUT', '/api/admin/settings/ageCheck', ADMIN, { value: true });
    check('admin switches it ON, logged', r.s === 200 && audit.some((a) => a.action === 'SETTING_CHANGED' && a.targetId === 'ageCheck'));
    r = await call('GET', '/api/settings');
    check('signup forms can see it is on', r.j.ageCheck === true);
    r = await call('POST', '/api/customers/register', null, { phone: '0241230002', password: 'pass12345', name: 'Unticked' });
    check('switch on: customer without the 18+ box → refused', r.s === 400 && /18 or older/.test(r.j.error));
    r = await call('POST', '/api/customers/register', null, { phone: '0241230003', password: 'pass12345', name: 'Ticked', ageConfirmed: true });
    check('switch on: customer who ticks 18+ → accepted, recorded', r.s === 200 && Object.values(C).find((c) => c.name === 'Ticked').ageConfirmedAt > 0);
    r = await call('POST', '/api/auth/register', null, { phone: '0551230004', password: 'pass12345', name: 'Pro Unticked' });
    check('switch on: professional without the box → refused', r.s === 400);
    r = await call('POST', '/api/auth/register', null, { phone: '0551230005', password: 'pass12345', name: 'Young One', role: 'APPRENTICE', supervisorCode: 'ETNM22', apprenticeAge: 'MINOR' });
    check('15-17 apprentice without a guardian → refused', r.s === 400 && /guardian/.test(r.j.error));
    r = await call('POST', '/api/auth/register', null, { phone: '0551230005', password: 'pass12345', name: 'Young One', role: 'APPRENTICE', supervisorCode: 'ETNM22', apprenticeAge: 'MINOR', guardianName: 'Mama Esi', guardianPhone: '024 999 0000', guardianConsent: false });
    check('…or without the guardian agreeing → refused', r.s === 400);
    r = await call('POST', '/api/auth/register', null, { phone: '0551230005', password: 'pass12345', name: 'Young One', role: 'APPRENTICE', supervisorCode: 'ETNM22', apprenticeAge: 'MINOR', guardianName: 'Mama Esi', guardianPhone: '024 999 0000', guardianConsent: true });
    const young = Object.values(S).find((s) => s.name === 'Young One');
    check('15-17 apprentice with guardian consent → accepted, marked minor', r.s === 200 && young.isMinor === true && young.guardianName === 'Mama Esi' && young.guardianPhone === '+233249990000');
    check("guardian's details never in the signup reply", !JSON.stringify(r.j).includes('Mama Esi') && !JSON.stringify(r.j).includes('249990000'));
    r = await call('POST', '/api/auth/register', null, { phone: '0551230006', password: 'pass12345', name: 'Adult Apprentice', role: 'APPRENTICE', supervisorCode: 'ETNM22', apprenticeAge: 'ADULT' });
    check('adult apprentice → accepted, not a minor', r.s === 200 && Object.values(S).find((s) => s.name === 'Adult Apprentice').isMinor === false);
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    server.close(); process.exit(fail ? 1 : 0);
  });
})();
