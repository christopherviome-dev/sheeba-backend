// Restored from the earlier test suites (sessions of 25–27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), Request = R('models/Request'), Activity = R('models/Activity');
const V = R('lib/validate');

let styl, activity;
const mk = (f) => { const d = { ...f, _id: { toString: () => f.id }, markModified() {}, save: async function () { return this; } };
  d.toObject = function () { const { toObject, save, markModified, ...r } = this; return { ...r }; }; return d; };
Stylist.findById = async (id) => styl[id] || null;
Stylist.find = async () => Object.values(styl);
Request.countDocuments = async () => 0;
Activity.create = async (a) => { activity.push(a); return a; };

const app = express(); app.use(express.json({ limit: '20mb' }));
app.use('/api/stylists', R('routes/stylists'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (p) => jwt.sign(p, 't');
const PRO = T({ id: 'pro1' }), CUST = T({ id: 'c1', role: 'customer' });
const img = (kb) => 'data:image/jpeg;base64,' + 'A'.repeat(kb * 1024);
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };

const server = app.listen(8197, async () => {
  const call = async (m, u, tok, body) => { const r = await fetch('http://localhost:8197' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  const reset = () => { activity = []; styl = { pro1: mk({ id: 'pro1', name: 'Chelsea', salonName: '', status: 'UNDER_REVIEW', accountStatus: 'ACTIVE', availability: 'AVAILABLE', styles: [], workModes: [], groupPoints: 0 }) }; };
  reset();

  console.log('--- WHO CAN EDIT ---');
  let r = await call('PUT', '/api/stylists/me', null, { bio: 'x' });
  check('not logged in → 401', r.s === 401);
  r = await call('PUT', '/api/stylists/me', CUST, { bio: 'x' });
  check('a customer login cannot edit a shop', r.s === 401 || r.s === 403);

  console.log('--- PROFILE ---');
  r = await call('PUT', '/api/stylists/me', PRO, { salonName: '  Chelsea   Beauty ', area: 'Kasoa', category: 'Makeup', bio: 'Bridal makeup.\n\nHome visits too.' });
  check('valid edit saved, extra spaces tidied', r.s === 200 && styl.pro1.salonName === 'Chelsea Beauty', JSON.stringify(r.j).slice(0, 120));
  check('description keeps its paragraph break', styl.pro1.bio === 'Bridal makeup.\n\nHome visits too.');
  r = await call('PUT', '/api/stylists/me', PRO, { name: ' ' });
  check('empty name refused', r.s === 400);
  r = await call('PUT', '/api/stylists/me', PRO, { bio: 'x'.repeat(601) });
  check('over-long description refused', r.s === 400);
  r = await call('PUT', '/api/stylists/me', PRO, { profilePhoto: 'https://tracker.example/pixel.jpg' });
  check('TRACKING: web-address photo refused', r.s === 400 && !styl.pro1.profilePhoto);
  r = await call('PUT', '/api/stylists/me', PRO, { profilePhoto: 'data:image/svg+xml;base64,PHN2Zz4=' });
  check('SVG refused (can carry scripts)', r.s === 400);
  r = await call('PUT', '/api/stylists/me', PRO, { profilePhoto: img(100) });
  check('real uploaded photo accepted', r.s === 200 && styl.pro1.profilePhoto && styl.pro1.profilePhoto.startsWith('data:image/jpeg'));
  r = await call('PUT', '/api/stylists/me', PRO, { profilePhoto: img(600) });
  check('oversized photo refused', r.s === 400);
  r = await call('PUT', '/api/stylists/me', PRO, { profilePhoto: '' });
  check('photo can be removed', r.s === 200 && styl.pro1.profilePhoto === null);
  r = await call('PUT', '/api/stylists/me', PRO, { workModes: ['HOME', 'MOBILE', 'HOME'] });
  check('"How I work" saved (duplicates dropped)', r.s === 200 && JSON.stringify(styl.pro1.workModes) === '["HOME","MOBILE"]');
  r = await call('PUT', '/api/stylists/me', PRO, { workModes: ['SPACESHIP'] });
  check('unknown way of working refused', r.s === 400);
  r = await call('PUT', '/api/stylists/me', PRO, { availability: 'BUSY' });
  check('unknown availability refused', r.s === 400);
  r = await call('PUT', '/api/stylists/me', PRO, { availability: 'AWAY' });
  check('valid availability saved', r.s === 200 && styl.pro1.availability === 'AWAY');
  r = await call('PUT', '/api/stylists/me', PRO, { lat: 5.6, lng: -0.2 });
  check('GPS location saved', styl.pro1.location && styl.pro1.location.lat === 5.6);

  console.log('--- SERVICES ---');
  r = await call('POST', '/api/stylists/me/styles', PRO, { price: 100 });
  check('service without a name refused', r.s === 400);
  r = await call('POST', '/api/stylists/me/styles', PRO, { name: 'Bridal glam' });
  check('service without a price refused', r.s === 400);
  r = await call('POST', '/api/stylists/me/styles', PRO, { name: 'Bridal glam', price: 'abc' });
  check('price "abc" refused', r.s === 400);
  r = await call('POST', '/api/stylists/me/styles', PRO, { name: 'Bridal glam', price: -5 });
  check('negative price refused', r.s === 400);
  r = await call('POST', '/api/stylists/me/styles', PRO, { name: 'Bridal glam', price: 'x', photo: 'https://tracker.example/a.jpg' });
  check('bad service rejected, nothing added', r.s === 400 && styl.pro1.styles.length === 0);
  r = await call('POST', '/api/stylists/me/styles', PRO, { name: 'Bridal glam', price: '450', duration: '2 hours', photo: img(120) });
  check('valid service added, "450" stored as a number', r.s === 200 && styl.pro1.styles[0].price === 450);
  check('work photo recorded as activity', activity.some((a) => a.type === 'WORK_UPLOADED'));
  const sid = styl.pro1.styles[0].id;
  r = await call('PUT', `/api/stylists/me/styles/${sid}`, PRO, { name: 'Bridal glam deluxe', duration: '3 hours', desc: 'Includes lashes.' });
  check('EDIT: name, duration, description now editable', r.s === 200 && styl.pro1.styles[0].name === 'Bridal glam deluxe' && styl.pro1.styles[0].duration === '3 hours');
  r = await call('PUT', `/api/stylists/me/styles/${sid}`, PRO, { active: false });
  check('service can be switched off', styl.pro1.styles[0].active === false);
  r = await call('PUT', `/api/stylists/me/styles/${sid}`, PRO, { price: 'free' });
  check('bad price on edit refused, old price kept', r.s === 400 && styl.pro1.styles[0].price === 450);
  r = await call('PUT', '/api/stylists/me/styles/nope', PRO, { name: 'x y' });
  check('editing a service that isn\'t yours/doesn\'t exist → 404', r.s === 404);
  r = await call('DELETE', '/api/stylists/me/styles/nope', PRO);
  check('deleting an unknown service → 404', r.s === 404);
  r = await call('DELETE', `/api/stylists/me/styles/${sid}`, PRO);
  check('service deleted', r.s === 200 && styl.pro1.styles.length === 0);

  console.log('--- LIMITS ---');
  styl.pro1.styles = Array.from({ length: 40 }, (_, i) => ({ id: 's' + i, name: 'S' + i, price: 10, likes: [] }));
  r = await call('POST', '/api/stylists/me/styles', PRO, { name: 'One more', price: 10 });
  check('41st service refused (limit 40)', r.s === 400 && styl.pro1.styles.length === 40);
  // 40 full-size service photos + ID + cover ≈ 13.5 MB, so one more 490 KB profile photo genuinely crosses 14 MB.
  styl.pro1.styles = Array.from({ length: 40 }, (_, i) => ({ id: 's' + i, name: 'S' + i, price: 10, photo: img(299), likes: [] }));
  styl.pro1.verifyPhoto = img(1400); styl.pro1.coverPhoto = img(490);
  const before = V.totalPhotoChars(styl.pro1);
  r = await call('PUT', '/api/stylists/me', PRO, { profilePhoto: img(490) });
  check(`STORAGE: save refused when total would pass 14 MB (was ${(before/1048576).toFixed(1)} MB)`, r.s === 400 && /storage limit/.test(r.j.error || ''), JSON.stringify(r.j));

  console.log('--- PUBLIC VIEW ---');
  reset(); styl.pro1.status = 'APPROVED'; styl.pro1.workModes = ['HOME']; styl.pro1.mustChangePassword = true;
  r = await call('GET', '/api/stylists');
  check('"How I work" visible to customers', r.j[0] && JSON.stringify(r.j[0].workModes) === '["HOME"]');
  check('password status still private', r.j[0] && r.j[0].mustChangePassword === undefined);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); process.exit(fail ? 1 : 0);
});
