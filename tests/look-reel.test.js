// Look Reel: 3 to 8 angles of a look, public for services, private for a customer's look (28 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), Request = R('models/Request'), StyleRecord = R('models/StyleRecord'), LookReel = R('models/LookReel');
const { discoverCard } = R('lib/discover');
const DAY = 86400000, now = Date.now();
const doc = (f) => ({ ...f, _id: { toString: () => f.id }, save: async function () { return this; }, markModified() {} });
const S = {
  shop: doc({ id: 'shop', name: 'Etornam', status: 'APPROVED', accountStatus: 'ACTIVE', staffAccess: [{ stylistId: 'boy' }], styles: [{ id: 's1', name: 'Knotless', active: true }, { id: 's2', name: 'Hidden', active: false }] }),
  boy: doc({ id: 'boy', name: 'Kofi', styles: [] }), other: doc({ id: 'other', name: 'Outsider', status: 'APPROVED', styles: [{ id: 'x1', name: 'Theirs' }] }),
};
const RQ = { done: doc({ id: 'done', stylistId: 'shop', clientId: 'ama', status: 'completed', completedAt: now - DAY }), pend: doc({ id: 'pend', stylistId: 'shop', clientId: 'ama', status: 'accepted' }),
  old: doc({ id: 'old', stylistId: 'shop', clientId: 'ama', status: 'completed', completedAt: now - 30 * DAY }), anon: doc({ id: 'anon', stylistId: 'shop', clientId: 'b-1', status: 'completed', completedAt: now - DAY }) };
const REC = { done: doc({ id: 'rec', requestId: 'done', customerId: 'ama' }) };
const REELS = {};
const byId = (T) => async (id) => T[String(id)] || null;
Stylist.findById = byId(S); Request.findById = byId(RQ);
Stylist.findOne = async (f) => { const s = S[String(f._id)]; return s && (s.staffAccess || []).some((x) => x.stylistId === f['staffAccess.stylistId']) ? s : null; };
StyleRecord.findOne = async (f) => REC[f.requestId] || null;
LookReel.findOneAndUpdate = async (f, u) => { REELS[f.key] = { ...(REELS[f.key] || {}), ...u }; return REELS[f.key]; };
LookReel.findOne = async (f) => REELS[f.key] || null;
LookReel.deleteOne = async (f) => { delete REELS[f.key]; };
const app = express(); app.use(express.json({ limit: '3mb' })); app.use('/api/reels', R('routes/reels'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (id, role) => jwt.sign(role ? { id, role } : { id }, 't');
const img = (kb) => 'data:image/jpeg;base64,' + 'A'.repeat(kb * 1024);
const frames = (n, kb = 60) => Array.from({ length: n }, () => img(kb));
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const server = app.listen(8245, async () => {
  const call = async (m, u, t, body) => { const r = await fetch('http://localhost:8245' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  console.log('--- A SERVICE REEL ---');
  check('2 photos is too few', (await call('POST', '/api/reels/service/s1', T('shop'), { frames: frames(2) })).s === 400);
  check('9 photos is too many', (await call('POST', '/api/reels/service/s1', T('shop'), { frames: frames(9) })).s === 400);
  check('TRACKING: a web-address frame is refused', (await call('POST', '/api/reels/service/s1', T('shop'), { frames: [...frames(3), 'https://tracker.example/a.jpg'] })).s === 400);
  check('an oversized frame is refused', (await call('POST', '/api/reels/service/s1', T('shop'), { frames: [...frames(3), img(110)] })).s === 400);
  let r = await call('POST', '/api/reels/service/s1', T('shop'), { frames: frames(5) });
  check('5 angles saved; the service knows it has a 5-angle reel', r.s === 200 && S.shop.styles[0].reelCount === 5 && REELS['service:shop:s1'].frames.length === 5);
  check("another professional cannot add a reel to this shop's service", (await call('POST', '/api/reels/service/s1', T('other'), { frames: frames(3) })).s === 404);
  r = await call('GET', '/api/reels/service/shop/s1');
  check("anyone can watch a live shop's service reel", r.s === 200 && r.j.frames.length === 5);
  await call('POST', '/api/reels/service/s2', T('shop'), { frames: frames(3) });
  check("a hidden service's reel is not public…", (await call('GET', '/api/reels/service/shop/s2')).s === 404);
  check('…but its owner can still watch it', (await call('GET', '/api/reels/service/shop/s2', T('shop'))).s === 200);
  const card = discoverCard({ _id: { toString: () => 'shop' }, name: 'E', styles: [{ id: 's1', name: 'K', photoThumb: 'data:image/jpeg;base64,AA', reelCount: 5, likes: [] }] }).card;
  check('Discover shows "5 angles" without sending the photos', card.work[0].reelCount === 5 && !('frames' in card.work[0]));
  r = await call('DELETE', '/api/reels/service/s1', T('shop'));
  check('the owner can delete a reel', r.s === 200 && !REELS['service:shop:s1'] && S.shop.styles[0].reelCount === 0);
  console.log("--- A CUSTOMER'S FINISHED-LOOK REEL ---");
  check("an outsider cannot add angles to the shop's booking", (await call('POST', '/api/reels/look/done', T('other'), { frames: frames(4) })).s === 403);
  check('not before the service is completed', (await call('POST', '/api/reels/look/pend', T('shop'), { frames: frames(4) })).s === 400);
  check('not after 14 days', (await call('POST', '/api/reels/look/old', T('shop'), { frames: frames(4) })).s === 400);
  check('not for a booking without a customer account', (await call('POST', '/api/reels/look/anon', T('shop'), { frames: frames(4) })).s === 400);
  r = await call('POST', '/api/reels/look/done', T('boy'), { frames: frames(4) });
  check("the helper who served adds 4 angles; the customer's look shows it", r.s === 200 && REC.done.reelCount === 4);
  check('Ama (the customer) can watch her look reel', (await call('GET', '/api/reels/look/done', T('ama', 'customer'))).s === 200);
  check('the shop owner and the helper can too', (await call('GET', '/api/reels/look/done', T('shop'))).s === 200 && (await call('GET', '/api/reels/look/done', T('boy'))).s === 200);
  check("another customer can NOT see Ama's look", (await call('GET', '/api/reels/look/done', T('yaw', 'customer'))).s === 404);
  check('an outsider professional can NOT', (await call('GET', '/api/reels/look/done', T('other'))).s === 404);
  check('nor anyone not logged in', (await call('GET', '/api/reels/look/done')).s === 404);
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
});
