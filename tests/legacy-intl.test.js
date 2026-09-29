// Restored from the earlier test suites (sessions of 25–27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
// Admin switches: a stand-in returning nothing, so every switch uses its safe default (instant, no database).
{ const Setting = require(path.join(B, 'models/Setting')); Setting.findById = async () => null; }
// Member numbers (added after this suite was written): a stand-in counter.
{ const Counter = R('models/Counter'); let seqN = 100; Counter.findById = async () => ({ _id: 'members', seq: seqN }); Counter.findOneAndUpdate = async () => ({ seq: ++seqN }); Counter.create = async () => ({}); }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), Customer = R('models/Customer'), InviteReward = R('models/InviteReward');
const Request = R('models/Request'), Notification = R('models/Notification'), Activity = R('models/Activity'), AdminAction = R('models/AdminAction');
const { rewardFor } = R('lib/invites');

let seq = 0;
const mk = (f) => { const d = { ...f, _id: { toString: () => f.id }, markModified() {}, save: async function () { return this; } };
  d.toObject = function () { const { toObject, save, markModified, ...r } = this; return { ...r }; }; return d; };
const match = (d, f) => Object.entries(f).every(([k, v]) => {
  if (v && typeof v === 'object' && '$in' in v) return v.$in.map(String).includes(String(d[k]));
  if (k === '_id') return String(d.id) === String(v);
  return d[k] === v;
});
const S = {}, C = {}, INV = {};
const table = (T, prefix, Model) => {
  Model.findById = async (id) => T[String(id)] || null;
  Model.findOne = async (f) => Object.values(T).find((d) => match(d, f)) || null;
  Model.exists = async (f) => !!Object.values(T).find((d) => match(d, f));
  Model.find = (f = {}) => { const list = Object.values(T).filter((d) => match(d, f)); const p = Promise.resolve(list); p.sort = () => Promise.resolve(list); return p; };
  Model.create = async (f) => { const id = prefix + (++seq); T[id] = mk({ id, ...f }); return T[id]; };
};
table(S, 'st', Stylist); table(C, 'cu', Customer); table(INV, 'inv', InviteReward);
Request.countDocuments = async () => 0; Notification.create = async () => ({}); Activity.create = async () => ({}); Activity.aggregate = async () => [];
AdminAction.create = async () => ({});

const app = express(); app.use(express.json({ limit: '5mb' }));
app.use('/api/auth', R('routes/auth')); app.use('/api/customers', R('routes/customers'));
app.use('/api/stylists', R('routes/stylists')); app.use('/api/admin', R('routes/admin'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (p) => jwt.sign(p, 't');
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQ';
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };

const server = app.listen(8203, async () => {
  const call = async (m, u, tok, body) => { const r = await fetch('http://localhost:8203' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  S.adm = mk({ id: 'adm', name: 'Christopher', isAdmin: true, phone: '0200000000', status: 'APPROVED', accountStatus: 'ACTIVE', styles: [] });
  S.oldgh = mk({ id: 'oldgh', name: 'Old Ghana shop', phone: '0211111111', status: 'APPROVED', accountStatus: 'ACTIVE', styles: [], currency: 'GHS' }); // no country field: older account
  const ADMIN = T({ id: 'adm', isAdmin: true });

  console.log('--- SIGNUP BY COUNTRY ---');
  let r = await call('POST', '/api/auth/register', null, { phone: '07700 900123', password: 'pass12345', name: 'Grace Mensah', country: 'GB' });
  const uk = Object.values(S).find((s) => s.name === 'Grace Mensah');
  check('UK professional: country GB, prices in GBP', r.s === 200 && uk.country === 'GB' && uk.currency === 'GBP', JSON.stringify(r.j).slice(0, 100));
  r = await call('POST', '/api/auth/register', null, { phone: '0551234567', password: 'pass12345', name: 'Kwame Asante' });
  const gh = Object.values(S).find((s) => s.name === 'Kwame Asante');
  check('no country given → Ghana, cedis', gh.country === 'GH' && gh.currency === 'GHS');
  r = await call('POST', '/api/auth/register', null, { phone: '0551234999', password: 'pass12345', name: 'Zed', country: 'ZZ' });
  check('unsupported country refused, nothing created', r.s === 400 && !Object.values(S).some((s) => s.name === 'Zed'));
  r = await call('POST', '/api/customers/register', null, { phone: '07700 900456', password: 'pass12345', name: 'Esi', country: 'gb' });
  check('UK customer (lowercase "gb" accepted)', r.s === 200 && Object.values(C).find((c) => c.name === 'Esi').country === 'GB');

  console.log('--- UK PHONE LOGINS ---');
  for (const typed of ['07700 900123', '+44 7700 900123', '447700900123']) {
    r = await call('POST', '/api/auth/login', null, { phone: typed, password: 'pass12345' });
    check(`UK login works typed as "${typed}"`, r.s === 200 && r.j.token);
  }

  console.log('--- DISCOVER BY COUNTRY ---');
  uk.status = 'APPROVED'; uk.accountStatus = 'ACTIVE'; gh.status = 'APPROVED'; gh.accountStatus = 'ACTIVE'; uk.styles = []; gh.styles = [];
  r = await call('GET', '/api/stylists/discover?country=GB');
  check('UK Discover shows only UK shops', r.s === 200 && r.j.length === 1 && r.j[0].name === 'Grace Mensah');
  check('UK cards carry GBP', r.j[0].currency === 'GBP' && r.j[0].country === 'GB');
  r = await call('GET', '/api/stylists/discover');
  const names = r.j.map((c) => c.name);
  check('default Discover = Ghana, including older shops with no country set', names.includes('Kwame Asante') && names.includes('Old Ghana shop') && !names.includes('Grace Mensah'));
  r = await call('GET', '/api/stylists/discover?country=XX');
  check('unknown country falls back to Ghana', r.s === 200 && r.j.every((c) => c.country === 'GH'));

  console.log('--- ID DOCUMENTS PER COUNTRY ---');
  const UKT = T({ id: uk.id }), GHT = T({ id: gh.id });
  const base = { legalFullName: 'Grace Ama Mensah', verifyPhoto: PHOTO };
  r = await call('POST', '/api/stylists/me/verify', UKT, { ...base, ghanaCardNum: 'GHA-123456789-0' });
  check('UK: must choose a document (several are accepted)', r.s === 400);
  r = await call('POST', '/api/stylists/me/verify', UKT, { ...base, idType: 'GHANA_CARD', ghanaCardNum: 'GHA-123456789-0' });
  check('UK: a Ghana Card is not a UK document → refused', r.s === 400);
  r = await call('POST', '/api/stylists/me/verify', UKT, { ...base, idType: 'PASSPORT', idNumber: '12' });
  check('UK: too-short passport number refused', r.s === 400);
  r = await call('POST', '/api/stylists/me/verify', UKT, { ...base, idType: 'PASSPORT', idNumber: ' 5123 4567 8 ' });
  check('UK: passport accepted, number tidied', r.s === 200 && uk.idType === 'PASSPORT' && uk.idNumber === '512345678' && uk.ghanaCardNum === null, JSON.stringify(r.j).slice(0, 120));
  r = await call('POST', '/api/stylists/me/verify', GHT, { legalFullName: 'Kwame Kofi Asante', verifyPhoto: PHOTO, ghanaCardNum: 'gha 1234567890' });
  check('Ghana: Ghana Card still works with no type chosen (the only option)', r.s === 200 && gh.idType === 'GHANA_CARD' && gh.ghanaCardNum === 'GHA-123456789-0');
  r = await call('POST', '/api/stylists/me/verify', GHT, { legalFullName: 'Kwame Kofi Asante', verifyPhoto: PHOTO, idType: 'PASSPORT', idNumber: 'A1234567' });
  check('Ghana: a passport is not accepted there yet', r.s === 400);
  r = await call('GET', '/api/stylists/discover?country=GB');
  r = await call('GET', `/api/stylists/${uk.id}`);
  check('passport number never shown publicly', r.j.idNumber === undefined && !JSON.stringify(r.j).includes('512345678'));

  console.log('--- ADMIN QUEUE ---');
  S.dup = mk({ id: 'dup', name: 'Copycat', status: 'APPROVED', accountStatus: 'ACTIVE', styles: [], country: 'GB', idType: 'PASSPORT', idNumber: '512345678', verified: false });
  r = await call('GET', '/api/admin/verifications', ADMIN);
  const ukItem = r.j.find((i) => i.name === 'Grace Mensah');
  check('admin sees the document type and country', ukItem && ukItem.idLabel === 'Passport' && ukItem.country === 'United Kingdom' && ukItem.ghanaCardNum === '512345678');
  check('DUPLICATE passport on another account flagged', ukItem.duplicateAccounts.some((d) => d.name === 'Copycat'));
  check('Ghana Card submissions still labelled correctly', r.j.find((i) => i.name === 'Kwame Asante').idLabel === 'Ghana Card');
  r = await call('POST', `/api/stylists/${uk.id}/approve`, ADMIN);
  check('a UK passport submission can be approved', r.s === 200 && uk.verified === true);

  console.log('--- INVITE REWARD FOR A UK INVITER ---');
  check('UK inviter falls back to the GH₵1 reward (until a GBP amount is set)', JSON.stringify(rewardFor('GBP')) === JSON.stringify({ amountMinor: 100, currency: 'GHS' }));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); process.exit(fail ? 1 : 0);
});
