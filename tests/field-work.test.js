// Field work: trips, stops (offline-safe), consent, coverage (28 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
// Admin switches: a stand-in returning nothing, so every switch uses its safe default (instant, no database).
{ const Setting = require(path.join(B, 'models/Setting')); Setting.findById = async () => null; }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), FieldTrip = R('models/FieldTrip'), FieldVisit = R('models/FieldVisit');
let seq = 0; const H = 3600000, t0 = Date.now() - 5 * H;
const doc = (f) => ({ ...f, _id: { toString: () => f.id, toJSON: () => f.id }, save: async function () { return this; }, toObject() { const { toObject, save, ...r } = this; return JSON.parse(JSON.stringify(r)); } });
const S = { chris: doc({ id: 'chris', name: 'Christopher', isAdmin: true, accountStatus: 'ACTIVE' }), fay: doc({ id: 'fay', name: 'Fay', adminRole: 'FIELD_AGENT', accountStatus: 'ACTIVE' }),
  ann: doc({ id: 'ann', name: 'Ann', adminRole: 'ANALYST', accountStatus: 'ACTIVE' }), pro: doc({ id: 'pro', name: 'Pro', accountStatus: 'ACTIVE' }),
  newshop: doc({ id: 'newshop', name: 'Aisha', salonName: 'Aisha Beads', phone: '+233209990000' }) };
const TRIPS = {}, VISITS = {};
const q = (list) => { const p = Promise.resolve(list); p.sort = () => { const x = Promise.resolve(list); x.limit = () => Promise.resolve(list); return x; }; return p; };
Stylist.findById = async (id) => S[String(id)] || null;
Stylist.findOne = async (f) => Object.values(S).find((s) => f.phone.$in.includes(s.phone)) || null;
FieldTrip.create = async (f) => { const id = 't' + (++seq); TRIPS[id] = doc({ id, startedAt: Date.now(), endedAt: null, ...f }); return TRIPS[id]; };
FieldTrip.findById = async (id) => { if (String(id).includes('!')) throw new Error('Cast'); return TRIPS[String(id)] || null; };
FieldTrip.find = () => q(Object.values(TRIPS));
FieldVisit.create = async (f) => { const id = 'v' + (++seq); VISITS[id] = doc({ id, ...f }); return VISITS[id]; };
FieldVisit.findOne = async (f) => Object.values(VISITS).find((v) => v.clientKey === f.clientKey) || null;
FieldVisit.findById = async (id) => VISITS[String(id)] || null;
FieldVisit.find = async (f) => Object.values(VISITS).filter((v) => !f || !f.tripId || (f.tripId.$in ? f.tripId.$in.includes(v.tripId) : v.tripId === f.tripId));
FieldVisit.deleteOne = async (f) => { delete VISITS[String(f._id)]; };
const app = express(); app.use(express.json({ limit: '3mb' })); app.use('/api/field', R('routes/field'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (id) => jwt.sign({ id }, 't');
const img = (kb) => 'data:image/jpeg;base64,' + 'A'.repeat(kb * 1024);
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const server = app.listen(8247, async () => {
  const call = async (m, u, who, body) => { const r = await fetch('http://localhost:8247' + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T(who) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  console.log('--- WHO CAN USE FIELD WORK ---');
  check('a normal professional cannot', (await call('GET', '/api/field/trips', 'pro')).s === 403);
  check('an Analyst cannot', (await call('GET', '/api/field/trips', 'ann')).s === 403);
  check('a Field agent can', (await call('GET', '/api/field/trips', 'fay')).s === 200);
  console.log('--- A TRIP ---');
  check('a trip needs a name', (await call('POST', '/api/field/trips', 'chris', { name: 'x' })).s === 400);
  let r = await call('POST', '/api/field/trips', 'chris', { name: 'Tamale, Saturday', area: 'Tamale', region: 'Northern' });
  const trip = r.j._id;
  check('Christopher starts "Tamale, Saturday" (Northern region)', r.s === 200 && TRIPS[trip].region === 'Northern' && TRIPS[trip].createdByName === 'Christopher');
  console.log('--- LOGGING STOPS ---');
  const stop = (k, extra) => ({ clientKey: 'phone-key-' + k, placeName: 'Shop ' + k, area: 'Tamale Central', outcome: 'INTERESTED', ...extra });
  check("a stop needs the shop's name", (await call('POST', `/api/field/trips/${trip}/visits`, 'chris', stop(0, { placeName: '' }))).s === 400);
  check('and an outcome', (await call('POST', `/api/field/trips/${trip}/visits`, 'chris', stop(0, { outcome: 'MAYBE' }))).s === 400);
  check('photos WITHOUT consent are refused', (await call('POST', `/api/field/trips/${trip}/visits`, 'chris', stop(0, { photos: [img(50)] }))).s === 400);
  check('more than 4 photos are refused', (await call('POST', `/api/field/trips/${trip}/visits`, 'chris', stop(0, { photos: [img(9), img(9), img(9), img(9), img(9)], photoConsent: true }))).s === 400);
  check('TRACKING: a web-address photo is refused', (await call('POST', `/api/field/trips/${trip}/visits`, 'chris', stop(0, { photos: ['https://x.example/p.jpg'], photoConsent: true }))).s === 400);
  r = await call('POST', `/api/field/trips/${trip}/visits`, 'chris', stop(1, { lat: 9.4000, lng: -0.8400, at: t0, placeName: 'Aisha Beads', services: ['hair', 'beading'], outcome: 'SIGNED_UP',
    note: 'Hand-beading learned from her grandmother; beads threaded by hand, a Dagomba tradition', photos: [img(60), img(60)], photoConsent: true }));
  check('a stop with GPS, services, the craft story and 2 consented photos is saved', r.s === 200 && r.j.visit.photos.length === 2 && /grandmother/.test(r.j.visit.note));
  r = await call('POST', `/api/field/trips/${trip}/visits`, 'chris', stop(1, { lat: 9.4000, lng: -0.8400, placeName: 'Aisha Beads', outcome: 'SIGNED_UP' }));
  check('OFFLINE RETRY: the same stop sent again counts ONCE', r.s === 200 && r.j.duplicate === true && Object.keys(VISITS).length === 1);
  await call('POST', `/api/field/trips/${trip}/visits`, 'fay', stop(2, { lat: 9.4090, lng: -0.8400, at: t0 + 2 * H, outcome: 'NOT_INTERESTED' }));
  await call('POST', `/api/field/trips/${trip}/visits`, 'fay', stop(3, { lat: 9.4180, lng: -0.8400, at: t0 + 4 * H, area: 'Lamashegu', outcome: 'FOLLOW_UP' }));
  r = await call('GET', `/api/field/trips/${trip}`, 'chris');
  const st = r.j.stats;
  check('trip results: 3 stops, 1 signed up (33%), 1 to follow up', st.stops === 3 && st.signedUp === 1 && st.conversion === 33 && st.interested === 1);
  check(`distance between stops ≈ 2 km (${st.km} km), 4 hours out, 2 areas`, st.km >= 1.9 && st.km <= 2.1 && st.hours === 4 && st.areas === 2);
  console.log('--- LATER ---');
  const followUp = Object.values(VISITS).find((v) => v.outcome === 'FOLLOW_UP');
  r = await call('PUT', `/api/field/visits/${followUp._id.toString()}`, 'chris', { linkPhone: '0209990000' });
  check('when the shop signs up, linking their phone marks it SIGNED UP and links the account', r.s === 200 && followUp.outcome === 'SIGNED_UP' && followUp.signedUpStylistId === 'newshop');
  check('linking an unknown number explains itself', (await call('PUT', `/api/field/visits/${followUp._id.toString()}`, 'chris', { linkPhone: '0200000000' })).s === 404);
  r = await call('PUT', `/api/field/trips/${trip}`, 'chris', { end: true, notes: 'Great response in Tamale Central' });
  check('the trip is ended with notes', r.s === 200 && TRIPS[trip].endedAt > 0);
  console.log('--- COVERAGE ---');
  r = await call('GET', '/api/field/overview', 'chris');
  check('overview: 1 trip, 3 stops, 2 signed up, 1 linked account', r.j.trips === 1 && r.j.totals.stops === 3 && r.j.totals.signedUp === 2 && r.j.linkedAccounts === 1);
  check('results by region: Northern, 3 stops', r.j.byRegion[0].key === 'Northern' && r.j.byRegion[0].stops === 3);
  check('results by area: Tamale Central 2, Lamashegu 1', r.j.byArea.find((a) => a.key === 'Tamale Central').stops === 2 && r.j.byArea.find((a) => a.key === 'Lamashegu').stops === 1);
  check('the coverage map gets every stop, without the photos (light)', r.j.stops.length === 3 && !('photos' in r.j.stops[0]) && typeof r.j.stops[0].lat === 'number');
  r = await call('DELETE', `/api/field/visits/${followUp._id.toString()}`, 'chris');
  check('a mistaken stop can be deleted', r.s === 200 && Object.keys(VISITS).length === 2);
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
});
