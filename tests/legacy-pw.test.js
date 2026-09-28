// Restored from the earlier test suites (sessions of 25–27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express'), bcrypt = R('node_modules/bcryptjs');
const Stylist = R('models/Stylist'), Customer = R('models/Customer'), PRR = R('models/PasswordResetRequest');
const AdminAction = R('models/AdminAction'), Notification = R('models/Notification'), Activity = R('models/Activity');

const mk = (f) => ({ ...f, _id: { toString: () => f.id }, toObject() { const { toObject, save, ...r } = this; return { ...r }; }, save: async function () { return this; } });
let styl, custs, reqs, audit, notes, seq;
const matchPhone = (acc, f) => f.phone && f.phone.$in ? f.phone.$in.includes(acc.phone) : acc.phone === f.phone;
Stylist.findOne = async (f) => Object.values(styl).find((s) => matchPhone(s, f)) || null;
Stylist.findById = async (id) => styl[id] || null;
Stylist.find = async (f = {}) => Object.values(styl).filter((s) => !f.isAdmin || s.isAdmin);
Customer.findOne = async (f) => Object.values(custs).find((c) => matchPhone(c, f)) || null;
Customer.findById = async (id) => custs[id] || null;
PRR.findOne = async (f) => Object.values(reqs).find((r) => r.accountType === f.accountType && r.accountId === f.accountId && r.status === f.status) || null;
PRR.create = async (f) => { const id = 'pr' + (++seq); reqs[id] = mk({ id, status: 'OPEN', createdAt: Date.now(), ...f }); return reqs[id]; };
PRR.findById = async (id) => { if (String(id).includes('!')) throw new Error('Cast'); return reqs[id] || null; };
PRR.find = () => ({ sort: async () => Object.values(reqs).filter((r) => r.status === 'OPEN') });
AdminAction.create = async (a) => { audit.push(a); return a; };
Notification.create = async (n) => { notes.push(n); return n; };
Activity.create = async () => ({});

const app = express(); app.use(express.json());
app.use('/api/auth', R('routes/auth')); app.use('/api/customers', R('routes/customers'));
app.use('/api/admin', R('routes/admin')); app.use('/api/stylists', R('routes/stylists'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });

const T = (p) => jwt.sign(p, 't');
const ADMIN = T({ id: 'adm', isAdmin: true }), PRO = T({ id: 'pro1' }), CUST = T({ id: 'c1', role: 'customer' });
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };

const server = app.listen(8195, async () => {
  const call = async (m, u, tok, body) => { const r = await fetch('http://localhost:8195' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  styl = { adm: mk({ id: 'adm', name: 'Christopher', isAdmin: true, phone: '0200000000', passwordHash: bcrypt.hashSync('adminpass1', 10), status: 'APPROVED', accountStatus: 'ACTIVE' }),
           pro1: mk({ id: 'pro1', name: 'Etornam', salonName: 'Etornam Braids', phone: '0544377501', passwordHash: bcrypt.hashSync('oldpass123', 10), status: 'APPROVED', accountStatus: 'ACTIVE' }) };
  custs = { c1: mk({ id: 'c1', name: 'Ama', phone: '0241112222', passwordHash: bcrypt.hashSync('amapass123', 10) }) };
  reqs = {}; audit = []; notes = []; seq = 0;

  console.log('--- LOGIN ACCEPTS NORMAL PHONE FORMATS ---');
  for (const typed of ['0544377501', '+233 54 437 7501', '233544377501']) {
    const r = await call('POST', '/api/auth/login', null, { phone: typed, password: 'oldpass123' });
    check(`login works typed as "${typed}"`, r.s === 200 && r.j.token, JSON.stringify(r.j));
  }

  console.log('--- FORGOT PASSWORD ---');
  let r = await call('POST', '/api/auth/forgot-password', null, { phone: '0209999999', accountType: 'stylist' });
  const unknownReply = r.j.message;
  check('unknown number: polite reply, nothing created', r.s === 200 && Object.keys(reqs).length === 0);
  r = await call('POST', '/api/auth/forgot-password', null, { phone: '+233 54 437 7501', accountType: 'stylist' });
  check('real number: EXACT same reply (no way to tell who is registered)', r.s === 200 && r.j.message === unknownReply);
  check('real number: one help request created', Object.keys(reqs).length === 1);
  check('admins notified', notes.some((n) => n.type === 'PASSWORD_RESET_REQUESTED'));
  await call('POST', '/api/auth/forgot-password', null, { phone: '0544377501', accountType: 'stylist' });
  await call('POST', '/api/auth/forgot-password', null, { phone: '0544377501', accountType: 'stylist' });
  check('SPAM: repeated requests do not pile up (still one open)', Object.keys(reqs).length === 1);

  console.log('--- ADMIN QUEUE ---');
  r = await call('GET', '/api/admin/password-resets', PRO);
  check('a normal professional cannot see the queue (403)', r.s === 403);
  r = await call('GET', '/api/admin/password-resets', CUST);
  check('a customer cannot see the queue', r.s === 401 || r.s === 403);
  r = await call('GET', '/api/admin/password-resets', ADMIN);
  check('admin sees the request with the phone ON THE ACCOUNT', r.s === 200 && r.j[0].phone === '0544377501' && r.j[0].name === 'Etornam');
  r = await call('POST', '/api/admin/password-resets/pr1/issue', PRO);
  check('a normal professional cannot issue passwords (403)', r.s === 403);
  r = await call('POST', '/api/admin/password-resets/pr1/issue', ADMIN);
  const temp = r.j.tempPassword;
  check('admin issues a temporary password', r.s === 200 && /^Sheeba-/.test(temp || ''), JSON.stringify(r.j));
  check('stored scrambled, and it really works', bcrypt.compareSync(temp, styl.pro1.passwordHash));
  check('old password no longer works', !bcrypt.compareSync('oldpass123', styl.pro1.passwordHash));
  check('account marked "must change password"', styl.pro1.mustChangePassword === true);
  check('request resolved', reqs.pr1.status === 'RESOLVED');
  check('audit log records the reset but NEVER the password', audit.some((a) => a.action === 'PASSWORD_RESET_ISSUED') && !JSON.stringify(audit).includes(temp));
  r = await call('POST', '/api/admin/password-resets/pr1/issue', ADMIN);
  check('cannot issue twice from the same request', r.s === 404);
  r = await call('POST', '/api/admin/password-resets/bad!id/issue', ADMIN);
  check('malformed request id → clean 404', r.s === 404);

  console.log('--- FORCED CHANGE AFTER TEMPORARY PASSWORD ---');
  r = await call('POST', '/api/auth/login', null, { phone: '0544377501', password: temp });
  check('login with temporary password says "must change"', r.s === 200 && r.j.mustChangePassword === true);
  r = await call('GET', '/api/stylists', null);
  check('"must change" flag never shown publicly', r.j.every((s) => s.mustChangePassword === undefined));
  r = await call('POST', '/api/auth/change-password', PRO, { currentPassword: 'wrong', newPassword: 'mynewpass2026' });
  check('wrong current password refused', r.s === 400);
  r = await call('POST', '/api/auth/change-password', PRO, { currentPassword: temp, newPassword: 'short' });
  check('too-short new password refused', r.s === 400);
  r = await call('POST', '/api/auth/change-password', PRO, { currentPassword: temp, newPassword: 'password' });
  check('too-common new password refused', r.s === 400);
  r = await call('POST', '/api/auth/change-password', PRO, { currentPassword: temp, newPassword: temp });
  check('same password refused', r.s === 400);
  r = await call('POST', '/api/auth/change-password', PRO, { currentPassword: temp, newPassword: 'kente-braids-26' });
  check('valid change accepted', r.s === 200);
  check('"must change" cleared', styl.pro1.mustChangePassword === false);
  r = await call('POST', '/api/auth/login', null, { phone: '0544377501', password: 'kente-braids-26' });
  check('new password logs in', r.s === 200 && r.j.mustChangePassword === false);
  r = await call('POST', '/api/auth/login', null, { phone: '0544377501', password: temp });
  check('temporary password no longer works', r.s === 401);
  r = await call('POST', '/api/auth/change-password', null, { currentPassword: 'x', newPassword: 'whatever123' });
  check('change password needs a login (401)', r.s === 401);

  console.log('--- CUSTOMERS ---');
  r = await call('POST', '/api/auth/forgot-password', null, { phone: '024 111 2222', accountType: 'customer' });
  const cReq = Object.values(reqs).find((x) => x.accountType === 'customer');
  check('customer help request created', !!cReq && cReq.accountId === 'c1');
  r = await call('POST', `/api/admin/password-resets/${cReq.id}/issue`, ADMIN);
  const ctemp = r.j.tempPassword;
  check('admin issues customer a temporary password', bcrypt.compareSync(ctemp, custs.c1.passwordHash) && custs.c1.mustChangePassword === true);
  r = await call('POST', '/api/customers/login', null, { phone: '+233241112222', password: ctemp });
  check('customer logs in with it (any phone format), told to change', r.s === 200 && r.j.customer.mustChangePassword === true);
  r = await call('POST', '/api/auth/change-password', CUST, { currentPassword: ctemp, newPassword: 'amanewpass9' });
  check("a customer login can't use the professional change route", r.s === 401 || r.s === 403);
  r = await call('POST', '/api/customers/me/change-password', CUST, { currentPassword: ctemp, newPassword: 'amanewpass9' });
  check('customer changes password', r.s === 200 && custs.c1.mustChangePassword === false && bcrypt.compareSync('amanewpass9', custs.c1.passwordHash));

  console.log('--- DISMISS ---');
  await call('POST', '/api/auth/forgot-password', null, { phone: '0544377501', accountType: 'stylist' });
  const again = Object.values(reqs).find((x) => x.status === 'OPEN');
  r = await call('POST', `/api/admin/password-resets/${again.id}/dismiss`, ADMIN);
  check('admin can dismiss a request (e.g. not really them)', r.s === 200 && reqs[again.id].status === 'DISMISSED' && bcrypt.compareSync('kente-braids-26', styl.pro1.passwordHash));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); process.exit(fail ? 1 : 0);
});
