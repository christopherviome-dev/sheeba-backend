// Admin team roles, checked LIVE in the database on every action (28 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), Customer = R('models/Customer'), Report = R('models/Report'), AdminAction = R('models/AdminAction'), Notification = R('models/Notification');
const PasswordResetRequest = R('models/PasswordResetRequest'), Conversation = R('models/Conversation'), Message = R('models/Message'), Request = R('models/Request');
const doc = (f) => ({ ...f, _id: { toString: () => f.id, toJSON: () => f.id }, save: async function () { return this; }, toObject() { const { toObject, save, ...r } = this; return JSON.parse(JSON.stringify(r)); } });
const S = {
  chris: doc({ id: 'chris', name: 'Christopher', phone: '+233200000001', isAdmin: true, accountStatus: 'ACTIVE', status: 'APPROVED' }),
  vera: doc({ id: 'vera', name: 'Vera', phone: '+233200000002', adminRole: 'VERIFIER', accountStatus: 'ACTIVE', status: 'APPROVED' }),
  mo: doc({ id: 'mo', name: 'Mo', phone: '+233200000003', adminRole: 'MODERATOR', accountStatus: 'ACTIVE' }),
  sue: doc({ id: 'sue', name: 'Sue', phone: '+233200000004', adminRole: 'SUPPORT', accountStatus: 'ACTIVE' }),
  ann: doc({ id: 'ann', name: 'Ann', phone: '+233200000005', adminRole: 'ANALYST', accountStatus: 'ACTIVE' }),
  kofi: doc({ id: 'kofi', name: 'Kofi', phone: '+233200000006', accountStatus: 'ACTIVE', status: 'APPROVED' }),
  newshop: doc({ id: 'newshop', name: 'New Shop', status: 'UNDER_REVIEW', accountStatus: 'ACTIVE', idNumber: 'GHA-123', location: { lat: 5.6, lng: -0.2 } }),
  amy: doc({ id: 'amy', name: 'Amy', phone: '+233200000007', accountStatus: 'ACTIVE' }),
};
const C = { yaw: doc({ id: 'yaw', name: 'Yaw', accountStatus: 'ACTIVE' }) };
const audit = [], notes = [];
const match = (d, f) => Object.entries(f || {}).every(([k, v]) => {
  if (k === '$or') return v.some((x) => match(d, x));
  if (v && typeof v === 'object' && '$ne' in v) return (d[k] ?? null) !== v.$ne;
  if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(d[k]);
  return d[k] === v;
});
Stylist.findById = async (id) => { if (String(id).includes('!')) throw new Error('Cast'); return S[String(id)] || null; };
Stylist.find = (f) => { const l = Object.values(S).filter((s) => match(s, f)); const p = Promise.resolve(l); p.sort = () => Promise.resolve(l); return p; };
Stylist.findOne = async (f) => Object.values(S).find((s) => match(s, f)) || null;
Stylist.findByIdAndUpdate = async (id, u) => { const s = S[String(id)]; if (!s) return null; Object.assign(s, u); return s; };
Customer.findById = async (id) => C[String(id)] || null;
Customer.findByIdAndUpdate = async (id, u) => { const c = C[String(id)]; if (!c) return null; Object.assign(c, u); return c; };
Report.find = () => { const p = Promise.resolve([]); p.sort = () => Promise.resolve([]); return p; };
PasswordResetRequest.find = () => { const p = Promise.resolve([]); p.sort = () => p; p.limit = () => Promise.resolve([]); return p; };
AdminAction.create = async (a) => { audit.push(a); return a; };
AdminAction.find = () => { const p = { sort: () => p, limit: () => Promise.resolve(audit.map((a) => ({ ...a }))) }; return p; };
Notification.create = async (n) => { notes.push(n); return n; };
Conversation.findById = async () => ({ _id: 'c1', customerId: 'yaw', stylistId: 'kofi' });
Message.find = () => { const p = Promise.resolve([]); p.sort = () => Promise.resolve([]); return p; };
Request.find = async () => [{ _id: 'r1', stylistId: 'kofi', clientPhone: '0240000000' }];
const app = express(); app.use(express.json());
app.use('/api/admin', R('routes/admin')); app.use('/api/analytics', R('routes/analytics')); app.use('/api/reports', R('routes/reports'));
app.use('/api/stylists', R('routes/stylists')); app.use('/api', R('routes/messages')); app.use('/api/requests', R('routes/requests'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (id, extra = {}) => jwt.sign({ id, ...extra }, 't');
const { notifyAllAdmins } = R('routes/notifications');
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const server = app.listen(8241, async () => {
  const call = async (m, u, t, body) => { const r = await fetch('http://localhost:8241' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  const s = async (m, u, who, body) => (await call(m, u, T(who), body)).s;
  console.log('--- AN OLD ADMIN TOKEN IS WORTHLESS ---');
  const KOFI_OLD = T('kofi', { isAdmin: true });
  check('Kofi\'s old "isAdmin" token cannot open reports', (await call('GET', '/api/reports', KOFI_OLD)).s === 403);
  check('…or the analytics', (await call('GET', '/api/analytics/map', KOFI_OLD)).s === 403);
  check("…or see every customer's bookings", (await call('GET', '/api/requests', KOFI_OLD)).j.every((r) => r.clientPhone !== '0240000000' || r.stylistId === 'kofi'));
  check('…or see unapproved shops and their ID numbers', !(await call('GET', '/api/stylists', KOFI_OLD)).j.some((x) => x.idNumber));
  console.log('--- EACH ROLE, ONLY ITS OWN AREA ---');
  check('Verifier: can check IDs', await s('GET', '/api/admin/verifications', 'vera') === 200);
  check('Verifier: can approve a shop', await s('POST', '/api/stylists/newshop/approve-review', 'vera') === 200);
  check('Verifier: sees waiting shops with their ID details', (await call('GET', '/api/stylists', T('vera'))).j.some((x) => x.idNumber === 'GHA-123'));
  check('Verifier: can NOT see reports, passwords or analytics', await s('GET', '/api/reports', 'vera') === 403 && await s('GET', '/api/admin/password-resets', 'vera') === 403 && await s('GET', '/api/analytics/map', 'vera') === 403);
  check('Moderator: can handle reports', await s('GET', '/api/reports', 'mo') === 200);
  check('Moderator: can restrict a customer', await s('POST', '/api/admin/customers/yaw/restrict', 'mo', { accountStatus: 'RESTRICTED', reason: 'Repeated no-shows' }) === 200);
  check('Moderator: can read a conversation (for a report)', await s('GET', '/api/conversations/c1/messages', 'mo') === 200);
  check('Moderator: can NOT see ID documents', await s('GET', '/api/admin/verifications', 'mo') === 403);
  check('Moderator: does NOT get ID numbers in shop lists', !(await call('GET', '/api/stylists', T('mo'))).j.some((x) => x.idNumber));
  check('Support: can handle password help', await s('GET', '/api/admin/password-resets', 'sue') === 200);
  check('Support: can NOT restrict or read reports', await s('POST', '/api/admin/customers/yaw/restore', 'sue') === 403 && await s('GET', '/api/reports', 'sue') === 403);
  check('Support: can NOT read conversations', await s('GET', '/api/conversations/c1/messages', 'sue') === 403);
  check('Analyst: can see the map', await s('GET', '/api/analytics/map', 'ann') === 200);
  check('Analyst: can NOT change anything (IDs, restrictions, switches)', await s('GET', '/api/admin/verifications', 'ann') === 403 && await s('POST', '/api/stylists/newshop/restrict', 'ann', { accountStatus: 'RESTRICTED', reason: 'testing it' }) === 403 && await s('PUT', '/api/admin/settings/ageCheck', 'ann', { value: true }) === 403);
  check('Nobody but a super admin sees the audit log or the team', await s('GET', '/api/admin/audit', 'vera') === 403 && await s('GET', '/api/admin/team', 'mo') === 403);
  console.log('--- ALERTS GO TO THE RIGHT PEOPLE ---');
  notes.length = 0; await notifyAllAdmins({ type: 'REPORT_FILED', title: 'x' });
  check('a new report alerts Christopher and Mo only', notes.map((n) => n.recipientId).sort().join() === 'chris,mo');
  notes.length = 0; await notifyAllAdmins({ type: 'VERIFICATION_SUBMITTED', title: 'x' });
  check('an ID submission alerts Christopher and Vera only', notes.map((n) => n.recipientId).sort().join() === 'chris,vera');
  notes.length = 0; await notifyAllAdmins({ type: 'MEMBER_MILESTONE', title: 'x' });
  check('everything else goes to the super admin only', notes.map((n) => n.recipientId).join() === 'chris');
  console.log('--- CHRISTOPHER MANAGES THE TEAM ---');
  let r = await call('GET', '/api/admin/team', T('chris'));
  check('Christopher sees the team: 5 admins, himself as super admin', r.s === 200 && r.j.team.length === 5 && r.j.team.find((m) => m.you).role === 'SUPER_ADMIN');
  r = await call('POST', '/api/admin/team', T('chris'), { phone: '0200000007', role: 'SUPPORT' });
  check('Christopher adds Amy (by phone) as Support; she is told; it is logged', r.s === 200 && S.amy.adminRole === 'SUPPORT' && notes.some((n) => n.recipientId === 'amy') && audit.some((a) => a.action === 'ADMIN_ROLE_GIVEN'));
  check('Amy can do password help straight away', await s('GET', '/api/admin/password-resets', 'amy') === 200);
  r = await call('PUT', '/api/admin/team/amy', T('chris'), { role: null });
  check("Christopher removes Amy: she's told, it's logged", r.s === 200 && audit.some((a) => a.action === 'ADMIN_ROLE_REMOVED'));
  check('…and her access ends on her VERY NEXT request', await s('GET', '/api/admin/password-resets', 'amy') === 403);
  r = await call('PUT', '/api/admin/team/chris', T('chris'), { role: 'ANALYST' });
  check('the LAST super admin can never be demoted (no lock-out)', r.s === 400 && S.chris.isAdmin === true);
  r = await call('PUT', '/api/admin/team/vera', T('chris'), { role: 'SUPER_ADMIN' });
  check('he can make Vera a second super admin', r.s === 200 && S.vera.adminRole === 'SUPER_ADMIN');
  r = await call('PUT', '/api/admin/team/vera', T('mo'), { role: null });
  check("a Moderator can't change anyone's role", r.s === 403 && S.vera.adminRole === 'SUPER_ADMIN');
  r = await call('GET', '/api/admin/audit', T('chris'));
  check('the audit log shows WHO did each action', r.s === 200 && r.j.some((a) => a.action === 'ADMIN_ROLE_REMOVED' && a.adminName === 'Christopher'));
  S.mo.accountStatus = 'SUSPENDED';
  check('a suspended account loses its admin powers too', await s('GET', '/api/reports', 'mo') === 403);
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
});
