// Restored from the earlier test suites (sessions of 25–27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
// Admin switches: a stand-in returning nothing, so every switch uses its safe default (instant, no database).
{ const Setting = require(path.join(B, 'models/Setting')); Setting.findById = async () => null; }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), ServiceType = R('models/ServiceType'), Request = R('models/Request');
const Notification = R('models/Notification'), Activity = R('models/Activity'), AdminAction = R('models/AdminAction');
let seq = 0;
const mk = (f) => { const d = { ...f, _id: { toString: () => f.id, toJSON: () => f.id }, markModified() {}, save: async function () { return this; } };
  d.toObject = function () { const { toObject, save, markModified, ...r } = this; return { ...r }; }; return d; };
const S = {}, ST = {}, notes = [], audit = [];
const nested = (d, k, v) => k === 'pendingServices.proposalId' ? (d.pendingServices || []).some((p) => p.proposalId === v) : (k === 'staffAccess.stylistId' ? false : String(k === '_id' ? d.id : d[k]) === String(v));
Stylist.findById = async (id) => S[String(id)] || null;
Stylist.find = async (f = {}) => Object.values(S).filter((d) => f.$or ? f.$or.some((x) => Object.entries(x).every(([k, v]) => (v && typeof v === 'object' && '$ne' in v) ? (d[k] ?? null) !== v.$ne : nested(d, k, v))) : Object.entries(f).every(([k, v]) => nested(d, k, v)));
ServiceType.find = async (f = {}) => Object.values(ST).filter((d) => Object.entries(f).every(([k, v]) => d[k] === v));
ServiceType.findOne = async (f) => Object.values(ST).find((d) => Object.entries(f).every(([k, v]) => d[k] === v)) || null;
ServiceType.findById = async (id) => ST[String(id)] || null;
ServiceType.create = async (f) => { const id = 'p' + (++seq); ST[id] = mk({ id, status: 'PENDING', ...f }); return ST[id]; };
Request.countDocuments = async () => 0; Notification.create = async (n) => { notes.push(n); return n; };
Activity.create = async () => ({}); AdminAction.create = async (a) => { audit.push(a); return a; };

const app = express(); app.use(express.json());
app.use('/api/stylists', R('routes/stylists')); app.use('/api/admin', R('routes/admin')); app.use('/api/catalog', R('routes/catalog'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (p) => jwt.sign(p, 't');
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };

const server = app.listen(8217, async () => {
  const call = async (m, u, tok, body) => { const r = await fetch('http://localhost:8217' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  S.adm = mk({ id: 'adm', name: 'Christopher', isAdmin: true, styles: [] });
  S.a = mk({ id: 'a', name: 'Ama', salonName: 'Ama Beauty', category: 'Makeup', status: 'APPROVED', accountStatus: 'ACTIVE', styles: [], services: [], pendingServices: [], groupPoints: 0 });
  S.b = mk({ id: 'b', name: 'Kofi', salonName: 'Kofi Cuts', category: 'Barbering', status: 'APPROVED', accountStatus: 'ACTIVE', styles: [], services: [], pendingServices: [], groupPoints: 0 });
  const A = T({ id: 'a' }), Bk = T({ id: 'b' }), ADMIN = T({ id: 'adm', isAdmin: true });

  console.log('--- THE CATALOG ---');
  let r = await call('GET', '/api/catalog');
  const keys = r.j.services.map((x) => x.key);
  check('seven services (Photography added 30 Sep), Barbering is its own service', r.s === 200 && keys.join(',') === 'hair,barbering,makeup,nails,lashes,skin,photography');
  check('barbering has its own styles (fade, waves, beard…)', r.j.services.find((x) => x.key === 'barbering').styles.some((x) => x.key === 'fade'));
  check("Men's Dreadlocks marked as a men's style", r.j.services.find((x) => x.key === 'hair').styles.find((x) => x.key === 'mens-dreadlocks').for === 'men');

  console.log('--- WHAT A SHOP OFFERS ---');
  r = await call('PUT', '/api/stylists/me', A, { services: ['makeup', 'lashes'] });
  check('shop chooses its services', r.s === 200 && S.a.services.join(',') === 'makeup,lashes');
  r = await call('PUT', '/api/stylists/me', A, { services: ['makeup', 'rocket-science'] });
  check('unknown service refused', r.s === 400 && S.a.services.join(',') === 'makeup,lashes');
  r = await call('PUT', '/api/stylists/me', A, { services: 'makeup' });
  check('services must be a list', r.s === 400);

  console.log('--- TAGGING MENU ITEMS ---');
  r = await call('POST', '/api/stylists/me/styles', A, { name: 'Wedding glam', price: 400, serviceKey: 'makeup', styleKey: 'bridal-makeup' });
  check('item tagged with service + style', r.s === 200 && S.a.styles[0].serviceKey === 'makeup' && S.a.styles[0].styleKey === 'bridal-makeup');
  r = await call('POST', '/api/stylists/me/styles', A, { name: 'Oops', price: 100, serviceKey: 'makeup', styleKey: 'fade' });
  check('a style from another service refused (fade is barbering)', r.s === 400);
  r = await call('POST', '/api/stylists/me/styles', A, { name: 'Oops', price: 100, serviceKey: 'teleportation' });
  check('unknown service on an item refused', r.s === 400);
  r = await call('POST', '/api/stylists/me/styles', A, { name: 'Untagged', price: 100 });
  check('tagging is optional', r.s === 200);

  console.log('--- PROPOSING A NEW SERVICE ---');
  r = await call('POST', '/api/stylists/me/service-proposals', A, { name: 'Hi' });
  check('too-short name refused', r.s === 400);
  r = await call('POST', '/api/stylists/me/service-proposals', A, { name: 'nails' });
  check('proposing something that exists just adds it (no admin needed)', r.s === 200 && r.j.added === 'nails' && S.a.services.includes('nails'));
  r = await call('POST', '/api/stylists/me/service-proposals', A, { name: 'Henna Art' });
  const prop = Object.values(ST)[0];
  check('new service → pending, shown on their shop', r.s === 200 && r.j.pending === true && prop.key === 'henna-art' && S.a.pendingServices.some((p) => p.name === 'Henna Art'));
  check('admin notified once', notes.filter((n) => n.type === 'SERVICE_PROPOSED').length === 1);
  r = await call('POST', '/api/stylists/me/service-proposals', Bk, { name: 'henna art' });
  check('another shop proposing the same thing joins the same proposal (no duplicate)', r.s === 200 && Object.values(ST).length === 1 && S.b.pendingServices.length === 1 && notes.filter((n) => n.type === 'SERVICE_PROPOSED').length === 1);
  await call('POST', '/api/stylists/me/service-proposals', A, { name: 'Scalp Detox' });
  await call('POST', '/api/stylists/me/service-proposals', A, { name: 'Hair Tattoo' });
  r = await call('POST', '/api/stylists/me/service-proposals', A, { name: 'Fourth Idea' });
  check('at most 3 waiting per shop', r.s === 400 && S.a.pendingServices.length === 3);

  console.log('--- ADMIN DECIDES ---');
  r = await call('GET', '/api/admin/service-proposals', A);
  check('a normal professional cannot see proposals (403)', r.s === 403);
  r = await call('GET', '/api/admin/service-proposals', ADMIN);
  const henna = r.j.find((x) => x.key === 'henna-art');
  check('admin sees each proposal and every shop waiting on it', r.s === 200 && henna && henna.shops.length === 2);
  r = await call('POST', `/api/admin/service-proposals/${prop.id}/reject`, ADMIN, { reason: 'no' });
  check('rejecting needs a real reason', r.s === 400 && prop.status === 'PENDING');
  r = await call('POST', `/api/admin/service-proposals/${prop.id}/approve`, ADMIN);
  check('approved: both shops now offer it, no longer pending', r.s === 200 && S.a.services.includes('henna-art') && S.b.services.includes('henna-art') && !S.a.pendingServices.some((p) => p.proposalId === prop.id) && S.b.pendingServices.length === 0);
  check('both shops told, decision logged', notes.filter((n) => n.type === 'SERVICE_APPROVED').length === 2 && audit.some((a) => a.action === 'SERVICE_APPROVED'));
  r = await call('GET', '/api/catalog');
  check('it is now in the catalog for everyone', r.j.services.some((x) => x.key === 'henna-art' && x.custom));
  const scalp = Object.values(ST).find((x) => x.key === 'scalp-detox');
  r = await call('POST', `/api/admin/service-proposals/${scalp.id}/reject`, ADMIN, { reason: 'This fits under Skin & spa.' });
  check('rejected: removed from the shop, reason sent', r.s === 200 && !S.a.pendingServices.some((p) => p.name === 'Scalp Detox') && notes.some((n) => n.type === 'SERVICE_REJECTED' && n.message === 'This fits under Skin & spa.'));
  r = await call('POST', `/api/admin/service-proposals/${scalp.id}/approve`, ADMIN);
  check('a decided proposal cannot be decided again', r.s === 404);

  console.log('--- DISCOVER FEED ---');
  const { discoverCard } = R('lib/discover');
  const card = discoverCard(S.b).card;
  check("older shop's category maps to its service", JSON.stringify(discoverCard(mk({ id: 'z', category: 'Barbering', styles: [] })).card.services) === '["barbering"]');
  check("feed carries each item's service and style", discoverCard(S.a).card.work.some((w) => w.serviceKey === 'makeup' && w.styleKey === 'bridal-makeup'));
  check('feed shows services waiting for approval as the shop\'s own label', discoverCard(S.a).card.pendingServices.includes('Hair Tattoo'));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); process.exit(fail ? 1 : 0);
});
