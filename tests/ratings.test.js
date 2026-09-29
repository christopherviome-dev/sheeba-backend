// Ratings: given by the customer who booked, once, after completion; shown from 3 up (29 Sep audit fix).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
{ const Setting = R('models/Setting'); Setting.findById = async () => null; }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), Request = R('models/Request'), Activity = R('models/Activity'), Notification = R('models/Notification');
const doc = (f) => ({ ...f, _id: { toString: () => f.id } });
const shop = doc({ id: 'shop', name: 'Etornam', status: 'APPROVED', accountStatus: 'ACTIVE', styles: [], followers: [] });
const RQ = { r1: doc({ id: 'r1', stylistId: 'shop', clientId: 'ama', status: 'completed', rating: null }), r2: doc({ id: 'r2', stylistId: 'shop', clientId: 'ama', status: 'accepted', rating: null }),
  r3: doc({ id: 'r3', stylistId: 'shop', clientId: 'yaw', status: 'completed', rating: 4 }), r4: doc({ id: 'r4', stylistId: 'shop', clientId: 'esi', status: 'completed', rating: null }) };
const notes = [];
Stylist.findById = async (id) => (String(id) === 'shop' ? shop : null);
Request.findById = async (id) => RQ[String(id)] || null;
Request.findOneAndUpdate = async (f, u) => { const r = RQ[String(f._id)]; if (!r || r.status !== f.status || r.rating !== f.rating) return null; Object.assign(r, u); return r; };
Request.countDocuments = async (f) => Object.values(RQ).filter((r) => r.stylistId === f.stylistId && r.status === f.status).length;
Request.find = async (f) => Object.values(RQ).filter((r) => r.stylistId === f.stylistId && r.status === f.status && (!f.rating || (r.rating || 0) >= f.rating.$gte));
Activity.create = async () => ({}); Notification.create = async (n) => { notes.push(n); return n; };
const app = express(); app.use(express.json()); app.use('/api/requests', R('routes/requests')); app.use('/api/stylists', R('routes/stylists'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const server = app.listen(0, async () => {
  const port = server.address().port;
  const call = async (m, u, who, body) => { const r = await fetch(`http://localhost:${port}${u}`, { method: m, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: 'Bearer ' + jwt.sign({ id: who, role: 'customer' }, 't') } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  let r = await call('GET', '/api/stylists/shop');
  check('with fewer than 3 ratings, the shop shows no average yet', r.s === 200 && r.j.stats.rating === null);
  check('someone else cannot rate Ama\'s visit', (await call('PUT', '/api/requests/r1/rate', 'yaw', { rating: 1 })).s === 403);
  check('not before the service is completed', (await call('PUT', '/api/requests/r2/rate', 'ama', { rating: 5 })).s === 400);
  check('only whole stars from 1 to 5', (await call('PUT', '/api/requests/r1/rate', 'ama', { rating: 9 })).s === 400);
  r = await call('PUT', '/api/requests/r1/rate', 'ama', { rating: 5 });
  check('Ama rates her completed visit 5 stars; the professional is told', r.s === 200 && RQ.r1.rating === 5 && notes.some((n) => n.type === 'RATING_RECEIVED' && n.recipientId === 'shop'));
  check('she cannot rate the same visit twice', (await call('PUT', '/api/requests/r1/rate', 'ama', { rating: 1 })).s !== 200 && RQ.r1.rating === 5);
  await call('PUT', '/api/requests/r4/rate', 'esi', { rating: 3 });
  r = await call('GET', '/api/stylists/shop');
  check('from 3 ratings the shop shows the average: ★ 4 (5, 4, 3)', r.j.stats.rating && r.j.stats.rating.average === 4 && r.j.stats.rating.count === 3, JSON.stringify(r.j.stats));
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
});
