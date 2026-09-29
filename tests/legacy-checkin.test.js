// Restored from the earlier test suites (sessions of 25–27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
// Admin switches: a stand-in returning nothing, so every switch uses its safe default (instant, no database).
{ const Setting = require(path.join(B, 'models/Setting')); Setting.findById = async () => null; }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), Customer = R('models/Customer'), Request = R('models/Request'), Notification = R('models/Notification');
const mk = (f) => ({ ...f, _id: { toString: () => f.id, toJSON: () => f.id }, save: async function () { return this; } });
const S = { pro: mk({ id: 'pro', name: 'Etornam', salonName: 'Etornam Braids', staffAccess: [{ stylistId: 'staff' }] }), other: mk({ id: 'other', name: 'Kofi' }), staff: mk({ id: 'staff', name: 'Apprentice' }) };
const C = { ama: mk({ id: 'ama', name: 'Ama Serwaa', code: 'AMA234' }), yaw: mk({ id: 'yaw', name: 'Yaw Boateng', code: 'YAW234' }) };
const now = Date.now(), H = 3600 * 1000;
const RQ = {
  a1: mk({ id: 'a1', stylistId: 'pro', clientId: 'ama', status: 'accepted', preferredAt: now + 2 * H, serviceNameSnapshot: 'Knotless' }),
  a2: mk({ id: 'a2', stylistId: 'pro', clientId: 'ama', status: 'pending', preferredAt: now + 48 * H, serviceNameSnapshot: 'Trim' }),
  a3: mk({ id: 'a3', stylistId: 'pro', clientId: 'ama', status: 'completed', preferredAt: now - 10 * 24 * H }),
  a4: mk({ id: 'a4', stylistId: 'pro', clientId: 'ama', status: 'accepted', preferredAt: now - 5 * 24 * H }), // long past, never checked in
  k1: mk({ id: 'k1', stylistId: 'other', clientId: 'yaw', status: 'accepted', preferredAt: now + H }),
};
const notes = [];
Stylist.exists = async (f) => !!Object.values(S).find((s) => s.id === String(f._id) && (s.staffAccess || []).some((a) => a.stylistId === f['staffAccess.stylistId']));
Stylist.find = async (f) => Object.values(S).filter((s) => (s.staffAccess || []).some((a) => a.stylistId === f['staffAccess.stylistId']));
Stylist.findById = async (id) => S[id] || null;
// Codes are looked up as "code is X, or X is one of the old codes" (added after this suite was written).
const codeIn = (f) => f.code || ((f.$or || []).find((x) => x.code) || {}).code;
Customer.findOne = async (f) => { const c = codeIn(f); return Object.values(C).find((x) => x.code === c || (x.legacyCodes || []).includes(c)) || null; };
Request.find = async (f) => Object.values(RQ).filter((r) => r.clientId === f.clientId);
Request.findById = async (id) => { if (String(id).includes('!')) throw new Error('Cast'); return RQ[id] || null; };
Notification.create = async (n) => { notes.push(n); return n; };

const app = express(); app.use(express.json()); app.use('/api/checkin', R('routes/checkin'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (p) => jwt.sign(p, 't');
const PRO = T({ id: 'pro' }), OTHER = T({ id: 'other' }), STAFF = T({ id: 'staff' }), AMA = T({ id: 'ama', role: 'customer' });
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };

const server = app.listen(8209, async () => {
  const call = async (m, u, tok, body) => { const r = await fetch('http://localhost:8209' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };

  console.log('--- WHO CAN SCAN ---');
  let r = await call('GET', '/api/checkin/ama234');
  check('not logged in → 401', r.s === 401);
  r = await call('GET', '/api/checkin/ama234', AMA);
  check('a customer login cannot use check-in', r.s === 401 || r.s === 403);

  console.log('--- PRIVACY: NAMES ONLY WITH A REAL APPOINTMENT ---');
  r = await call('GET', '/api/checkin/ama234', OTHER);
  check('a professional with NO appointment with Ama learns nothing', r.s === 200 && r.j.found === false && !JSON.stringify(r.j).includes('Ama'));
  r = await call('GET', '/api/checkin/ama234', PRO);
  check('Etornam (has appointments with Ama) sees her first name only', r.s === 200 && r.j.found === true && r.j.firstName === 'Ama' && !JSON.stringify(r.j).includes('Serwaa'));
  const ids = (r.j.appointments || []).map((a) => String(a._id));
  check('upcoming accepted + pending listed, soonest first', ids[0] === 'a1' && ids.includes('a2'), JSON.stringify(ids));
  check('completed and long-past appointments left out', !ids.includes('a3') && !ids.includes('a4'));
  r = await call('GET', '/api/checkin/ama234', STAFF);
  check("authorised staff sees the shop's appointments too", r.j.found === true && r.j.appointments.length === 2);
  r = await call('GET', '/api/checkin/ZZZZ22', PRO);
  check('unknown code → 404', r.s === 404);

  console.log('--- CHECKING IN ---');
  r = await call('POST', '/api/checkin/a1', PRO, { code: 'YAW234' });
  check("wrong customer's code refused (must match the appointment)", r.s === 400 && !RQ.a1.checkedInAt);
  r = await call('POST', '/api/checkin/k1', PRO, { code: 'YAW234' });
  check("can't check in someone at ANOTHER shop", r.s === 403);
  r = await call('POST', '/api/checkin/a2', PRO, { code: 'AMA234' });
  check('pending appointment: accept it first', r.s === 400 && !RQ.a2.checkedInAt);
  r = await call('POST', '/api/checkin/a1', PRO, {});
  check('no code → refused', r.s === 400);
  r = await call('POST', '/api/checkin/a1', PRO, { code: 'ama-234' });
  check('check-in works (code typed in lowercase with a dash)', r.s === 200 && typeof RQ.a1.checkedInAt === 'number');
  check("Ama is told she's checked in", notes.some((n) => n.recipientId === 'ama' && /checked in at Etornam Braids/.test(n.title)));
  const first = RQ.a1.checkedInAt;
  r = await call('POST', '/api/checkin/a1', STAFF, { code: 'AMA234' });
  check('checking in twice keeps the first time', r.s === 200 && r.j.already === true && RQ.a1.checkedInAt === first);
  r = await call('POST', '/api/checkin/bad!id', PRO, { code: 'AMA234' });
  check('malformed appointment id → clean 404', r.s === 404);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); process.exit(fail ? 1 : 0);
});
