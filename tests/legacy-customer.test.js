// Restored from the earlier test suites (sessions of 25–27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
// Admin switches: a stand-in returning nothing, so every switch uses its safe default (instant, no database).
{ const Setting = require(path.join(B, 'models/Setting')); Setting.findById = async () => null; }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), Customer = R('models/Customer'), Request = R('models/Request'), StyleRecord = R('models/StyleRecord');
const RepeatPreference = R('models/RepeatPreference'), Activity = R('models/Activity'), Notification = R('models/Notification'), Conversation = R('models/Conversation');

let seq = 0;
const mk = (f) => { const d = { ...f, _id: { toString: () => f.id }, markModified() {}, save: async function () { return this; }, deleteOne: async () => {} };
  d.toObject = function () { const { toObject, save, markModified, deleteOne, ...r } = this; return { ...r }; }; return d; };
const match = (d, f) => Object.entries(f).every(([k, v]) => {
  if (k === '_id') return String(d.id) === String(v);
  if (k === 'followers') return (d.followers || []).includes(v);
  return d[k] === v;
});
const S = {}, C = {}, RQ = {}, SR = {}, RP = {};
const table = (T, prefix, Model) => {
  Model.findById = async (id) => { if (String(id).includes('!')) { const e = new Error('Cast'); throw e; } return T[String(id)] || null; };
  Model.findOne = async (f) => Object.values(T).find((d) => match(d, f)) || null;
  Model.exists = async (f) => !!Object.values(T).find((d) => match(d, f));
  Model.find = (f = {}) => { const list = Object.values(T).filter((d) => match(d, f)); const p = Promise.resolve(list); p.sort = () => Promise.resolve(list); return p; };
  Model.create = async (f) => { const id = prefix + (++seq); T[id] = mk({ id, ...f }); return T[id]; };
  Model.findOneAndUpdate = async (f, u) => { let d = Object.values(T).find((x) => match(x, f)); if (!d) { const id = prefix + (++seq); d = T[id] = mk({ id, ...f }); } Object.assign(d, u.$set || u); return d; };
};
table(S, 'st', Stylist); table(C, 'cu', Customer); table(RQ, 'rq', Request); table(SR, 'sr', StyleRecord); table(RP, 'rp', RepeatPreference);
Request.countDocuments = async () => 0; Activity.create = async () => ({}); Notification.create = async () => ({});
Conversation.findOne = async () => null; Conversation.create = async () => ({});

const app = express(); app.use(express.json({ limit: '5mb' }));
app.use('/api/customers', R('routes/customers')); app.use('/api/stylists', R('routes/stylists')); app.use('/api/requests', R('routes/requests'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (p) => jwt.sign(p, 't');
const img = (kb) => 'data:image/jpeg;base64,' + 'A'.repeat(kb * 1024);
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };

const server = app.listen(8205, async () => {
  const call = async (m, u, tok, body) => { const r = await fetch('http://localhost:8205' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  S.shop = mk({ id: 'shop', name: 'Etornam', salonName: 'Etornam Braids', status: 'APPROVED', accountStatus: 'ACTIVE', availability: 'AVAILABLE', currency: 'GHS',
    phone: '0544377501', ghanaCardNum: 'GHA-123456789-0', verifyPhoto: img(50), legalFullName: 'Etornam Akosua Viome', idNumber: 'X1', followers: ['cu1'], styles: [{ id: 's1', name: 'Knotless', price: 300, likes: [] }] });
  S.banned = mk({ id: 'banned', name: 'Gone', status: 'APPROVED', accountStatus: 'RESTRICTED', followers: ['cu1'], styles: [] });
  S.away = mk({ id: 'away', name: 'Away', status: 'APPROVED', accountStatus: 'ACTIVE', availability: 'AWAY', styles: [] });
  C.cu1 = mk({ id: 'cu1', name: 'Ama', phone: '0241112222' }); C.cu2 = mk({ id: 'cu2', name: 'Kofi', phone: '0209998888' });
  const AMA = T({ id: 'cu1', role: 'customer' }), KOFI = T({ id: 'cu2', role: 'customer' });

  console.log('--- SAVED SHOPS: THE PRIVACY LEAK IS CLOSED ---');
  let r = await call('GET', '/api/customers/me/following', AMA);
  const raw = JSON.stringify(r.j);
  check('followed shop listed', r.s === 200 && r.j.length === 1 && r.j[0].name === 'Etornam');
  for (const f of ['GHA-123456789-0', 'Etornam Akosua Viome', '0544377501']) check(`"${f}" no longer sent`, !raw.includes(f));
  check('no ID photo, ID number or follower list', !('verifyPhoto' in r.j[0]) && !('idNumber' in r.j[0]) && !('followers' in r.j[0]));
  check('restricted shop not listed', !r.j.some((s) => s.name === 'Gone'));

  console.log('--- FOLLOWING ---');
  r = await call('POST', '/api/stylists/shop/follow?lean=1', null, { clientId: 'anon-browser-7' });
  check('anonymous browser can follow, lean reply', r.s === 200 && r.j.following === true && typeof r.j.followerCount === 'number');
  r = await call('POST', '/api/stylists/shop/follow?lean=1', null, { clientId: 'cu2' });
  check("IMPERSONATION: following as Kofi without Kofi's login → 401", r.s === 401 && !S.shop.followers.includes('cu2'));
  r = await call('POST', '/api/stylists/shop/follow?lean=1', AMA, { clientId: 'cu2' });
  check("…nor with someone else's login → 401", r.s === 401);
  r = await call('POST', '/api/stylists/shop/follow?lean=1', KOFI, { clientId: 'cu2' });
  check('Kofi follows with his own login', r.s === 200 && r.j.following === true && S.shop.followers.includes('cu2'));

  console.log('--- SAVE THIS STYLE ---');
  SR.rec = mk({ id: 'rec', customerId: 'cu1', requestId: 'rqX', serviceNameSnapshot: 'Knotless' });
  r = await call('PATCH', '/api/customers/me/style-records/rec', AMA, { finishedPhoto: 'https://tracker.example/x.jpg' });
  check('TRACKING: web-address photo refused', r.s === 400 && !SR.rec.finishedPhoto);
  r = await call('PATCH', '/api/customers/me/style-records/rec', AMA, { finishedPhoto: img(600) });
  check('oversized photo refused', r.s === 400);
  r = await call('PATCH', '/api/customers/me/style-records/rec', AMA, { notes: 'x'.repeat(501) });
  check('over-long notes refused', r.s === 400);
  r = await call('PATCH', '/api/customers/me/style-records/by-request/rqX', AMA, { finishedPhoto: img(120), notes: 'Loved it.' });
  check('real photo + notes saved', r.s === 200 && SR.rec.finishedPhoto && SR.rec.notes === 'Loved it.');
  r = await call('PATCH', '/api/customers/me/style-records/rec', KOFI, { notes: 'mine now' });
  check("another customer can't touch Ama's record", r.s === 404 && SR.rec.notes === 'Loved it.');

  console.log('--- BOOK AGAIN ---');
  const oldReq = (id, stylistId) => { RQ[id] = mk({ id, stylistId, styleId: 's1', clientId: 'cu1', clientName: 'Ama', clientPhone: '0241112222', status: 'completed' }); };
  oldReq('o1', 'banned'); oldReq('o2', 'away'); oldReq('o3', 'shop');
  r = await call('POST', '/api/customers/me/book-again/o1', AMA, {});
  check('restricted shop → refused', r.s === 404);
  r = await call('POST', '/api/customers/me/book-again/o2', AMA, {});
  check('shop that is away → refused', r.s === 400);
  r = await call('POST', '/api/customers/me/book-again/o3', AMA, { preferredAt: Date.now() - 3 * 86400000 });
  check('date in the past → refused', r.s === 400);
  r = await call('POST', '/api/customers/me/book-again/o3', KOFI, {});
  check("booking again from someone else's history → 403", r.s === 403);
  const when = Date.now() + 2 * 86400000;
  r = await call('POST', '/api/customers/me/book-again/o3', AMA, { preferredAt: when, meet: 'spaceship', emergency: 'E'.repeat(500) });
  check('valid rebook: pending, with the real date, current price', r.s === 200 && r.j.status === 'pending' && r.j.preferredAt === when && r.j.priceSnapshot === 300);
  check('junk "where" value dropped, emergency contact trimmed', r.j.meet === null && r.j.emergency.length === 120);

  console.log('--- REMIND ME ---');
  for (const [d, label] of [[3, '3 days'], [400, '400 days'], ['abc', '"abc"'], [10.5, '10.5 days']]) {
    r = await call('POST', '/api/customers/me/repeat-preferences', AMA, { stylistId: 'shop', intervalDays: d });
    check(`interval of ${label} refused`, r.s === 400);
  }
  r = await call('POST', '/api/customers/me/repeat-preferences', AMA, { stylistId: 'nope', intervalDays: 30 });
  check('a shop that doesn\'t exist → 404', r.s === 404);
  r = await call('POST', '/api/customers/me/repeat-preferences', AMA, { stylistId: 'shop', styleId: 's1', serviceName: 'Knotless', intervalDays: 42, lastCompletedAt: Date.now() + 86400000 * 30 });
  const pref = Object.values(RP)[0];
  check('valid reminder saved; a future "last done" date becomes today', r.s === 200 && pref.intervalDays === 42 && pref.lastCompletedAt <= Date.now());
  r = await call('PUT', `/api/customers/me/repeat-preferences/${pref.id}`, AMA, { intervalDays: -5 });
  check('editing to a negative interval refused', r.s === 400 && pref.intervalDays === 42);

  console.log('--- NORMAL BOOKING: the two unchecked fields ---');
  r = await call('POST', '/api/requests', AMA, { stylistId: 'shop', styleId: 's1', clientId: 'cu1', clientName: 'Ama', clientPhone: '0241112222', meet: '<script>', emergency: 'E'.repeat(900) });
  const made = Object.values(RQ).find((x) => x.clientId === 'cu1' && x.meet === null && x.emergency && x.emergency.length === 120);
  check('junk "meet" dropped, emergency contact trimmed to 120', r.s === 200 && !!made, 'status ' + r.s);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); process.exit(fail ? 1 : 0);
});
