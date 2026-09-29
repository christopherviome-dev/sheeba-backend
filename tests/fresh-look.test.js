// Fresh Look: the shop adds the finished-look photo to the customer's gallery (28 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
// Admin switches: a stand-in returning nothing, so every switch uses its safe default (instant, no database).
{ const Setting = require(path.join(B, 'models/Setting')); Setting.findById = async () => null; }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), Customer = R('models/Customer'), Request = R('models/Request'), StyleRecord = R('models/StyleRecord'), Notification = R('models/Notification');
const DAY = 86400000, now = Date.now(), notes = [];
const doc = (f) => ({ ...f, _id: { toString: () => f.id }, save: async function () { return this; } });
const S = { shop: doc({ id: 'shop', name: 'Etornam', salonName: 'Etornam Braids', staffAccess: [{ stylistId: 'boy' }] }), boy: doc({ id: 'boy', name: 'Kofi' }), other: doc({ id: 'other', name: 'Outsider' }) };
const RQ = {
  done: doc({ id: 'done', stylistId: 'shop', clientId: 'ama', status: 'completed', completedAt: now - DAY }),
  pending: doc({ id: 'pending', stylistId: 'shop', clientId: 'ama', status: 'accepted' }),
  old: doc({ id: 'old', stylistId: 'shop', clientId: 'ama', status: 'completed', completedAt: now - 20 * DAY }),
  anon: doc({ id: 'anon', stylistId: 'shop', clientId: 'browser-123', status: 'completed', completedAt: now - DAY }),
};
const REC = { done: doc({ id: 'rec1', requestId: 'done', customerId: 'ama', stylistId: 'shop', finishedPhoto: 'data:image/jpeg;base64,CUSTOMER' }) };
Stylist.findById = async (id) => S[String(id)] || null;
Stylist.findOne = async (f) => { const s = S[String(f._id)]; return s && (s.staffAccess || []).some((x) => x.stylistId === f['staffAccess.stylistId']) ? s : null; };
Request.findById = async (id) => RQ[String(id)] || null;
StyleRecord.findOne = async (f) => REC[f.requestId] || null;
Customer.exists = async (f) => String(f._id) === 'ama';
Customer.findById = async (id) => (String(id) === 'ama' ? { _id: 'ama' } : null);
Notification.create = async (n) => { notes.push(n); return n; };
const app = express(); app.use(express.json({ limit: '2mb' })); app.use('/api/requests', R('routes/requests'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (id) => jwt.sign({ id }, 't');
const img = (kb) => 'data:image/jpeg;base64,' + 'A'.repeat(kb * 1024);
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const server = app.listen(8243, async () => {
  const call = async (u, t, body) => { const r = await fetch('http://localhost:8243' + u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  let r = await call('/api/requests/done/look', T('other'), { photo: img(100) });
  check("an outsider cannot add a look to the shop's booking", r.s === 403);
  r = await call('/api/requests/pending/look', T('shop'), { photo: img(100) });
  check('not before the service is completed', r.s === 400);
  r = await call('/api/requests/done/look', T('shop'), { photo: 'https://tracker.example/x.jpg' });
  check('TRACKING: a web-address photo is refused', r.s === 400);
  r = await call('/api/requests/done/look', T('shop'), { photo: img(150), thumb: img(30) });
  const rec = REC.done;
  check("the shop adds the finished look → saved in the customer's style record", r.s === 200 && rec.proPhoto && rec.proThumb && rec.proPhotoBy === 'Etornam');
  check("…without replacing the customer's own photo", rec.finishedPhoto === 'data:image/jpeg;base64,CUSTOMER');
  check('…and the customer is told: "Your fresh look from Etornam Braids ✨"', notes.length === 1 && notes[0].recipientId === 'ama' && /Etornam Braids/.test(notes[0].title));
  r = await call('/api/requests/done/look', T('boy'), { photo: img(120) });
  check('the helper who served can add (or retake) it too, credited to him', r.s === 200 && rec.proPhotoBy === 'Kofi');
  check('…a retake does not notify the customer again', notes.length === 1);
  r = await call('/api/requests/old/look', T('shop'), { photo: img(100) });
  check('not more than 14 days after the service', r.s === 400 && /14 days/.test(r.j.error));
  r = await call('/api/requests/anon/look', T('shop'), { photo: img(100) });
  check('a booking made without an account has no gallery: explained clearly', r.s === 400 && /without an account/.test(r.j.error));
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
});
