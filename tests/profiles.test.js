// Profiles, menu badges and shop social proof (28 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
// Admin switches: a stand-in returning nothing, so every switch uses its safe default (instant, no database).
{ const Setting = require(path.join(B, 'models/Setting')); Setting.findById = async () => null; }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), Customer = R('models/Customer'), Request = R('models/Request'), StyleRecord = R('models/StyleRecord');
const Conversation = R('models/Conversation'), TrainingWork = R('models/TrainingWork');
const doc = (f) => ({ ...f, _id: { toString: () => f.id, toJSON: () => f.id }, save: async function () { return this; }, toObject() { const { toObject, save, ...r } = this; return JSON.parse(JSON.stringify(r)); } });
const S = { pro: doc({ id: 'pro', name: 'Etornam', status: 'APPROVED', accountStatus: 'ACTIVE', memberNumber: 3, verified: true, createdAt: '2026-09-19',
  styles: [{ id: 'a', name: 'Knotless', price: 300, photoThumb: 'data:image/jpeg;base64,AA', likes: ['x', 'y', 'z'] }, { id: 'b', name: 'Cornrows', price: 100, likes: ['q'], active: false }], followers: ['c1', 'c2'] }) };
const C = { ama: doc({ id: 'ama', name: 'Ama', memberNumber: 1500, createdAt: '2026-09-26' }) };
const RQ = [{ stylistId: 'pro', clientId: 'ama', status: 'completed' }, { stylistId: 'pro', clientId: 'ama', status: 'completed' }, { stylistId: 'pro', clientId: 'yaw', status: 'completed' }, { stylistId: 'pro', status: 'pending' }];
const match = (d, f) => Object.entries(f).every(([k, v]) => (v && v.$in ? v.$in.includes(d[k]) : d[k] === v));
Stylist.findById = async (id) => S[String(id)] || null;
Stylist.find = async () => [];
Stylist.countDocuments = async (f) => (f.supervisorStatus === 'PENDING' ? 2 : f.followers === 'ama' ? 1 : 0);
Customer.findById = async (id) => C[String(id)] || null;
Request.find = async (f) => RQ.filter((r) => match(r, f));
Request.countDocuments = async (f) => RQ.filter((r) => match(r, f)).length;
StyleRecord.countDocuments = async () => 4; Conversation.countDocuments = async () => 5; TrainingWork.countDocuments = async () => 1;
const app = express(); app.use(express.json({ limit: '2mb' }));
app.use('/api/stylists', R('routes/stylists')); app.use('/api/customers', R('routes/customers'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const PRO = jwt.sign({ id: 'pro' }, 't'), AMA = jwt.sign({ id: 'ama', role: 'customer' }, 't');
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const server = app.listen(8235, async () => {
  const call = async (m, u, t, body) => { const r = await fetch('http://localhost:8235' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  let r = await call('GET', '/api/stylists/me/home-counts');
  check('menu counts need a login', r.s === 401);
  r = await call('GET', '/api/stylists/me/home-counts', PRO);
  check('menu badges: 1 new request, 5 unread, 1 work to review, 2 apprentice requests', r.s === 200 && r.j.pendingRequests === 1 && r.j.unreadMessages === 5 && r.j.workToReview === 1 && r.j.apprenticeRequests === 2, JSON.stringify(r.j));
  r = await call('GET', '/api/stylists/me/profile-stats', PRO);
  check('profile: 4 loves, 1 work posted, 1 active service', r.s === 200 && r.j.loves === 4 && r.j.worksPosted === 1 && r.j.services === 1);
  check('profile: 3 jobs completed for 2 different customers, 2 followers', r.j.completedJobs === 3 && r.j.customersServed === 2 && r.j.followers === 2);
  check('profile: founding member #3, verified', r.j.founding === true && r.j.memberNumber === 3 && r.j.verified === true);
  r = await call('GET', '/api/stylists/pro');
  check('public shop page shows social proof: 4 loves, 3 jobs done', r.s === 200 && r.j.stats.loves === 4 && r.j.stats.completedJobs === 3);
  r = await call('PUT', '/api/customers/me', AMA, { profilePhoto: 'https://tracker.example/me.jpg' });
  check('TRACKING: a web-address profile photo is refused', r.s === 400 && !C.ama.profilePhoto);
  r = await call('PUT', '/api/customers/me', AMA, { profilePhoto: 'data:image/jpeg;base64,' + 'A'.repeat(1024) });
  check('a real uploaded photo is saved', r.s === 200 && C.ama.profilePhoto && r.j.profilePhoto);
  r = await call('PUT', '/api/customers/me', AMA, { profilePhoto: null });
  check('and can be removed', r.s === 200 && C.ama.profilePhoto === null);
  r = await call('GET', '/api/customers/me/profile-stats', AMA);
  check('customer profile: 2 services completed, 4 styles saved, 1 shop saved', r.s === 200 && r.j.completedServices === 2 && r.j.savedStyles === 4 && r.j.savedShops === 1);
  check('customer #1500 is a member but not a founding member', r.j.memberNumber === 1500 && r.j.founding === false);
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
});
