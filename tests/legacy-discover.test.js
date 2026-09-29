// Restored from the earlier test suites (sessions of 25–27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
// Admin switches: a stand-in returning nothing, so every switch uses its safe default (instant, no database).
{ const Setting = require(path.join(B, 'models/Setting')); Setting.findById = async () => null; }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), Request = R('models/Request'), Activity = R('models/Activity');

let styl, activity, aggResult;
const mk = (f) => { const d = { ...f, _id: { toString: () => f.id }, markModified() {}, save: async function () { return this; } };
  d.toObject = function () { const { toObject, save, markModified, ...r } = this; return { ...r }; }; return d; };
Stylist.findById = async (id) => styl[id] || null;
Stylist.find = async (f = {}) => Object.values(styl).filter((s) => (!f.status || s.status === f.status) && (!f.accountStatus || s.accountStatus === f.accountStatus));
Request.countDocuments = async () => 0;
Activity.create = async (a) => { activity.push(a); return a; };
Activity.aggregate = async () => aggResult;

const app = express(); app.use(express.json({ limit: '20mb' }));
app.use('/api/stylists', R('routes/stylists'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const PRO = jwt.sign({ id: 'pro1' }, 't');
const img = (kb) => 'data:image/jpeg;base64,' + 'A'.repeat(kb * 1024);
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };

const server = app.listen(8199, async () => {
  const call = async (m, u, tok, body) => { const r = await fetch('http://localhost:8199' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch (e) {} return { s: r.status, j, bytes: text.length }; };
  activity = []; aggResult = [{ _id: 'pro1', n: 5 }];
  styl = {
    pro1: mk({ id: 'pro1', name: 'Etornam', salonName: 'Etornam Braids', status: 'APPROVED', accountStatus: 'ACTIVE', verified: true,
      phone: '0544377501', passwordHash: 'x', ghanaCardNum: 'GHA-1', legalFullName: 'Etornam A V', verifyPhoto: img(900), coverPhoto: img(400),
      followers: ['browser-abc'], groupPoints: 60, bio: 'B'.repeat(500), profilePhoto: img(80), location: { lat: 5.6, lng: -0.2 }, workModes: ['HOME'],
      styles: [
        { id: 's1', name: 'Knotless', price: 300, photo: img(250), photoThumb: img(30), likes: ['a', 'b'], addedAt: 100 },
        { id: 's2', name: 'Big old photo, no thumb', price: 200, photo: img(900), likes: [] },
        { id: 's3', name: 'Hidden', price: 100, photo: img(100), photoThumb: img(20), likes: [], active: false },
        { id: 's4', name: 'Cornrows', price: 150, likes: ['c'] },
      ] }),
    pro2: mk({ id: 'pro2', name: 'Kofi', status: 'APPROVED', accountStatus: 'ACTIVE', styles: [], groupPoints: 0 }),
    pending: mk({ id: 'pending', name: 'Chelsea', status: 'UNDER_REVIEW', accountStatus: 'ACTIVE', styles: [] }),
    banned: mk({ id: 'banned', name: 'Bad', status: 'APPROVED', accountStatus: 'RESTRICTED', styles: [] }),
  };

  console.log('--- WHO APPEARS ---');
  let r = await call('GET', '/api/stylists/discover');
  const ids = r.j.map((c) => String(c._id && (c._id.toString ? c._id : c._id)));
  const e = r.j.find((c) => c.name === 'Etornam');
  check('approved + active shops listed', r.s === 200 && r.j.some((c) => c.name === 'Etornam') && r.j.some((c) => c.name === 'Kofi'));
  check('shops awaiting approval NOT listed', !r.j.some((c) => c.name === 'Chelsea'));
  check('restricted accounts NOT listed', !r.j.some((c) => c.name === 'Bad'));
  check('shop with real work photos ranked first', r.j[0].name === 'Etornam');

  console.log('--- NOTHING PRIVATE OR HEAVY ---');
  const raw = JSON.stringify(r.j);
  for (const f of ['phone', 'passwordHash', 'ghanaCardNum', 'legalFullName', 'verifyPhoto', 'coverPhoto', 'followers', 'likes', 'groupPoints'])
    check(`"${f}" not in the feed`, !(f in e) && !e.work.some((w) => f in w));
  check('no follower/like ID codes anywhere', !raw.includes('browser-abc') && !raw.includes('"a"'));
  check('the full-size work photo is NOT sent (thumbnail instead)', e.work.find((w) => w.id === 's1').thumb.length === img(30).length);
  check('an old 900 KB photo with no thumbnail is left out, not sent', e.work.find((w) => w.id === 's2').thumb === null);
  check('hidden services not in the feed', !e.work.some((w) => w.id === 's3'));
  check('services without photos still listed (for prices/budget)', e.work.some((w) => w.id === 's4'));
  check('bio trimmed to 200 characters', e.bio.length === 200);
  check(`whole feed is small: ${(r.bytes / 1024).toFixed(0)} KB (shop holds ~2.7 MB of photos)`, r.bytes < 250 * 1024);

  console.log('--- REAL NUMBERS ---');
  check('like count is the real count', e.work.find((w) => w.id === 's1').likeCount === 2);
  check('"popular this week" true for 5 real visits', e.popularThisWeek === true);
  check('"popular this week" false with no visits', r.j.find((c) => c.name === 'Kofi').popularThisWeek === false);
  check('raw visit count never sent', !('weekVisits' in e) && !raw.includes('"n":'));
  aggResult = null; Activity.aggregate = async () => { throw new Error('db hiccup'); };
  r = await call('GET', '/api/stylists/discover');
  check('feed still works if popularity data fails', r.s === 200 && r.j.length === 2);

  console.log('--- THUMBNAILS ON UPLOAD ---');
  styl.pro1.styles = [];
  r = await call('POST', '/api/stylists/me/styles', PRO, { name: 'Bob', price: 90, photo: img(150), photoThumb: img(25) });
  const st = styl.pro1.styles[0];
  check('new service stores photo + thumbnail + date added', r.s === 200 && st.photoThumb && typeof st.addedAt === 'number');
  r = await call('POST', '/api/stylists/me/styles', PRO, { name: 'Too big thumb', price: 90, photo: img(150), photoThumb: img(80) });
  check('oversized thumbnail refused', r.s === 400);
  r = await call('POST', '/api/stylists/me/styles', PRO, { name: 'Web thumb', price: 90, photo: img(150), photoThumb: 'https://tracker.example/t.jpg' });
  check('TRACKING: web-address thumbnail refused', r.s === 400);
  r = await call('PUT', `/api/stylists/me/styles/${st.id}`, PRO, { photo: img(160) });
  check('replacing the photo without a new thumbnail clears the old one', styl.pro1.styles[0].photoThumb === null);
  r = await call('PUT', `/api/stylists/me/styles/${st.id}`, PRO, { photo: img(160), photoThumb: img(25) });
  r = await call('PUT', `/api/stylists/me/styles/${st.id}`, PRO, { photo: null });
  check('removing the photo removes the thumbnail too', styl.pro1.styles[0].photo === null && styl.pro1.styles[0].photoThumb === null);
  r = await call('PUT', `/api/stylists/me/styles/${st.id}`, PRO, { name: 'Bob cut' });
  check('editing just the name leaves photos alone', r.s === 200 && styl.pro1.styles[0].name === 'Bob cut');

  console.log('--- LIKES ---');
  styl.pro1.styles = [{ id: 'k1', name: 'K', price: 1, likes: [] }];
  r = await call('POST', '/api/stylists/pro1/styles/k1/like?lean=1', null, { clientId: 'browser-1' });
  check('lean like: tiny reply {liked, likeCount}', r.s === 200 && r.j.liked === true && r.j.likeCount === 1 && r.bytes < 100);
  r = await call('POST', '/api/stylists/pro1/styles/k1/like?lean=1', null, { clientId: 'browser-1' });
  check('tapping again un-likes', r.j.liked === false && r.j.likeCount === 0);
  r = await call('POST', '/api/stylists/pro1/styles/k1/like', null, { clientId: 'browser-2' });
  check('old-style like (older site) still returns the shop', r.s === 200 && r.j.name === 'Etornam');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); process.exit(fail ? 1 : 0);
});
