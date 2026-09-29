// Restored from the earlier test suites (sessions of 25–27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
// Admin switches: a stand-in returning nothing, so every switch uses its safe default (instant, no database).
{ const Setting = require(path.join(B, 'models/Setting')); Setting.findById = async () => null; }
const jwt = R('node_modules/jsonwebtoken'); const express = R('node_modules/express');
const Stylist = R('models/Stylist'), Request = R('models/Request'), Customer = R('models/Customer');
const Activity = R('models/Activity'), Notification = R('models/Notification'), Conversation = R('models/Conversation');

let styl, reqs, custs, activity = [];
function sdoc(f) { return { ...f, _id: { toString: () => f.id }, toObject() { const { toObject, save, ...r } = this; return { ...r }; }, save: async function () { return this; } }; }
function rdoc(f) { const d = { ...f, _id: f.id }; d.toObject = () => { const { toObject, ...r } = d; return { ...r }; }; return d; }
const idOk = (id) => { if (String(id).includes('!')) { const e = new Error('Cast'); e.name = 'CastError'; throw e; } };
Stylist.findById = async (id) => { idOk(id); return id === 'adm' ? { _id: 'adm', isAdmin: true, accountStatus: 'ACTIVE' } : styl[id] || null; };
Stylist.find = async (f = {}) => Object.values(styl).filter((s) => !f['staffAccess.stylistId'] || (s.staffAccess || []).some((a) => a.stylistId === f['staffAccess.stylistId']));
Stylist.exists = async (f) => Object.values(styl).some((s) => s.id === f._id && (s.staffAccess || []).some((a) => a.stylistId === f['staffAccess.stylistId']));
Stylist.findOne = async (f) => Object.values(styl).find((s) => s.id === String(f._id) && (s.staffAccess || []).some((a) => a.stylistId === f['staffAccess.stylistId'])) || null;
Customer.exists = async (f) => { idOk(f._id); return !!custs[f._id]; };
Customer.findById = async (id) => custs[id] || null;
Request.find = async () => Object.values(reqs);
Request.findById = async (id) => { idOk(id); return reqs[id] || null; };
let seq = 0;
Request.create = async (f) => { const id = 'r' + (++seq); reqs[id] = rdoc({ id, rating: null, ...f }); return reqs[id]; };
Request.findOneAndUpdate = async (q, upd) => { idOk(q._id); const r = reqs[q._id]; if (!r) return null;
  for (const k of Object.keys(q)) if (k !== '_id' && r[k] !== q[k]) return null; Object.assign(r, upd); return r; };
Activity.create = async (a) => { activity.push(a); return a; };
// Added after this suite was written: counting, saved-style records and invite rewards on completion.
Request.countDocuments = async (f = {}) => Object.values(reqs).filter((r) => Object.entries(f).every(([k, v]) => r[k] === v)).length;
{ const StyleRecord = R('models/StyleRecord'); StyleRecord.findOne = async () => null; StyleRecord.create = async (f) => f; }
{ const InviteReward = R('models/InviteReward'); InviteReward.findOne = async () => null; InviteReward.find = async () => []; }
Notification.create = async () => ({}); Conversation.findOne = async () => null; Conversation.create = async () => ({});

const app = express(); app.use(express.json());
app.use('/api/requests', R('routes/requests'));
app.get('/boom', async () => { throw new Error('deliberate async failure'); });
app.use((err, req, res, next) => res.status(500).json({ error: 'Something went wrong.' }));

const T = (p) => jwt.sign(p, 't');
const PRO_A = T({ id: 'proA' }), PRO_B = T({ id: 'proB' }), STAFF = T({ id: 'staff1' }), ADMIN = T({ id: 'adm', isAdmin: true });
const CUST = T({ id: 'cust1', role: 'customer' }), CUST2 = T({ id: 'cust2', role: 'customer' });
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const future = () => Date.now() + 2 * 24 * 3600 * 1000;

const server = app.listen(8193, async () => {
  const call = async (m, u, tok, body) => { const r = await fetch('http://localhost:8193' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  const reset = () => {
    activity = []; seq = 0;
    styl = { proA: sdoc({ id: 'proA', status: 'APPROVED', accountStatus: 'ACTIVE', availability: 'AVAILABLE', staffAccess: [{ stylistId: 'staff1' }], styles: [{ id: 's1', name: 'Low Fade', price: 80, duration: '45 min' }, { id: 's2', name: 'Old', price: 50, active: false }] }),
             proB: sdoc({ id: 'proB', status: 'APPROVED', accountStatus: 'ACTIVE', availability: 'AVAILABLE', styles: [] }),
             pending: sdoc({ id: 'pending', status: 'UNDER_REVIEW', accountStatus: 'ACTIVE', styles: [] }),
             away: sdoc({ id: 'away', status: 'APPROVED', accountStatus: 'ACTIVE', availability: 'AWAY', styles: [] }) };
    custs = { cust1: { _id: 'cust1', name: 'Ama' }, cust2: { _id: 'cust2', name: 'Kofi' } };
    reqs = {};
  };

  console.log('--- PRIVACY: who sees customer contact details ---');
  reset();
  await Request.create({ stylistId: 'proA', clientId: 'cust1', clientName: 'Ama', clientPhone: '0240000000', note: 'secret note', status: 'pending' });
  await Request.create({ stylistId: null, clientId: 'anonX', clientName: 'Yaw', clientPhone: '0550000000', note: 'need braids', area: 'Osu', status: 'open' });
  let r = await call('GET', '/api/requests');
  check('anonymous sees NO names/phones', r.j.every((x) => !x.clientPhone && !x.clientName), JSON.stringify(r.j));
  check('anonymous sees NO private notes', r.j.every((x) => !x.note));
  r = await call('GET', '/api/requests', PRO_B);
  const bOwn = r.j.find((x) => x.stylistId === 'proA'), bOpen = r.j.find((x) => x.status === 'open');
  check("other pro can't see proA's customer phone", !bOwn.clientPhone);
  check('pro sees open request details (area, note)...', bOpen.note === 'need braids' && bOpen.area === 'Osu');
  check('...but NOT the phone until claimed', !bOpen.clientPhone);
  r = await call('GET', '/api/requests', PRO_A);
  check('proA sees own customer phone', r.j.find((x) => x.stylistId === 'proA').clientPhone === '0240000000');
  r = await call('GET', '/api/requests', STAFF);
  check('authorised staff sees the booking, phone HIDDEN by default (owner decides)', r.j.find((x) => x.stylistId === 'proA').clientPhone === '•••• ••00');
  r = await call('GET', '/api/requests', CUST);
  check('customer sees own request in full', r.j.find((x) => x.clientId === 'cust1').clientPhone === '0240000000');
  r = await call('GET', '/api/requests', CUST2);
  check("other customer can't see Ama's phone", r.j.every((x) => x.clientPhone !== '0240000000'));
  r = await call('GET', '/api/requests', ADMIN);
  check('admin sees everything', r.j.length === 2 && r.j.every((x) => x.clientPhone));

  console.log('--- CREATING REQUESTS ---');
  reset();
  const base = { stylistId: 'proA', styleId: 's1', clientName: 'Ama', clientPhone: '0240000000' };
  r = await call('POST', '/api/requests', null, { ...base, clientId: 'cust1' });
  check('IMPERSONATION: using a customer id without their login → 401', r.s === 401);
  r = await call('POST', '/api/requests', CUST2, { ...base, clientId: 'cust1' });
  check('IMPERSONATION: another customer\'s login → 401', r.s === 401);
  r = await call('POST', '/api/requests', CUST, { ...base, clientId: 'cust1', preferredAt: future() });
  check('logged-in customer can request', r.s === 200, JSON.stringify(r.j));
  check('real appointment time stored', typeof reqs.r1.preferredAt === 'number');
  check('price snapshot captured (GH₵80)', reqs.r1.priceSnapshot === 80);
  r = await call('POST', '/api/requests', null, { ...base, clientId: 'anon-browser-id' });
  check('old anonymous booking path still works', r.s === 200);
  r = await call('POST', '/api/requests', CUST, { ...base, clientId: 'cust1', preferredAt: Date.now() - 3 * 24 * 3600 * 1000 });
  check('date in the past → refused', r.s === 400);
  r = await call('POST', '/api/requests', CUST, { ...base, stylistId: 'pending', styleId: undefined, clientId: 'cust1' });
  check('unapproved shop → refused', r.s === 400);
  r = await call('POST', '/api/requests', CUST, { ...base, stylistId: 'away', styleId: undefined, clientId: 'cust1' });
  check('professional set to AWAY → refused', r.s === 400);
  r = await call('POST', '/api/requests', CUST, { ...base, styleId: 's2', clientId: 'cust1' });
  check('switched-off service → refused', r.s === 400);
  r = await call('POST', '/api/requests', CUST, { ...base, stylistId: 'bad!id', clientId: 'cust1' });
  check('malformed shop id → clean 404', r.s === 404);

  console.log('--- MOVING A BOOKING ALONG ---');
  reset();
  await Request.create({ stylistId: 'proA', clientId: 'cust1', clientName: 'Ama', clientPhone: '0240000000', status: 'pending' });
  r = await call('PUT', '/api/requests/r1/status', PRO_A, { status: 'completed' });
  check('POINT FARMING: pending → completed directly refused', r.s === 400);
  r = await call('PUT', '/api/requests/r1/status', CUST, { status: 'accepted' });
  check('customer login cannot act as a professional', r.s === 403);
  r = await call('PUT', '/api/requests/r1/status', PRO_B, { status: 'accepted' });
  check("another pro can't touch proA's booking", r.s === 403);
  r = await call('PUT', '/api/requests/r1/status', STAFF, { status: 'accepted' });
  check('authorised staff can accept', r.s === 200 && reqs.r1.status === 'accepted');
  r = await call('PUT', '/api/requests/r1/status', PRO_A, { status: 'completed' });
  check('owner completes', r.s === 200 && reqs.r1.status === 'completed', 'status=' + r.s + ' body=' + JSON.stringify(r.j) + ' db=' + reqs.r1.status);
  r = await call('PUT', '/api/requests/r1/status', PRO_A, { status: 'completed' });
  check('POINT FARMING: completing twice refused', r.s === 400);
  check('only ONE completion recorded for points', activity.filter((a) => a.type === 'SERVICE_COMPLETED').length === 1);

  console.log('--- CLAIMING OPEN REQUESTS ---');
  reset();
  await Request.create({ stylistId: 'proA', clientId: 'x', clientName: 'A', clientPhone: '1', status: 'pending' });
  await Request.create({ stylistId: null, clientId: 'y', clientName: 'B', clientPhone: '2', status: 'open' });
  r = await call('PUT', '/api/requests/r1/claim', PRO_B);
  check("BOOKING THEFT: can't claim proA's booking", r.s === 409 && reqs.r1.stylistId === 'proA');
  r = await call('PUT', '/api/requests/r2/claim', PRO_B);
  check('can claim a genuinely open request', r.s === 200 && reqs.r2.stylistId === 'proB');
  r = await call('PUT', '/api/requests/r2/claim', PRO_A);
  check('second claimer gets "already taken"', r.s === 409);

  console.log('--- RATINGS ---');
  reset();
  await Request.create({ stylistId: 'proA', clientId: 'cust1', clientName: 'Ama', clientPhone: '1', status: 'accepted' });
  r = await call('PUT', '/api/requests/r1/rate', CUST, { rating: 5 });
  check("can't rate before the service is completed", r.s === 400);
  reqs.r1.status = 'completed';
  r = await call('PUT', '/api/requests/r1/rate', CUST2, { rating: 1 });
  check('FAKE RATING: a stranger cannot rate', r.s === 403);
  r = await call('PUT', '/api/requests/r1/rate', CUST, { rating: 9 });
  check('rating must be 1-5', r.s === 400);
  r = await call('PUT', '/api/requests/r1/rate', CUST, { rating: 5 });
  check('real customer rates once', r.s === 200 && reqs.r1.rating === 5);
  r = await call('PUT', '/api/requests/r1/rate', CUST, { rating: 5 });
  check('FAKE RATING: rating twice refused', r.s === 409);

  console.log('--- CRASH SAFETY ---');
  r = await call('GET', '/boom');
  check('an async error returns a clean 500 instead of crashing', r.s === 500);
  r = await call('GET', '/api/requests', ADMIN);
  check('server still answering after the error', r.s === 200);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); process.exit(fail ? 1 : 0);
});
