// The Mepluge assistant: plain questions → real professionals (29 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
const SET = {};
{ const Setting = R('models/Setting'); Setting.findById = async (k) => (k in SET ? { value: SET[k] } : null); }
const express = R('node_modules/express'), Stylist = R('models/Stylist'), attempts = R('lib/attempts');
R('models/ServiceType').find = async () => []; // no extra approved services in this test (instant, no database)
attempts._setNowForTests(() => 1e12);
const { understand } = R('lib/assist'); const { DEFAULT_SERVICES } = R('lib/catalog');
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const st = (serviceKey, styleKey, name, price, extra = {}) => ({ serviceKey, styleKey, name, price, ...extra });
const shop = (id, f) => ({ _id: { toString: () => id }, status: 'APPROVED', accountStatus: 'ACTIVE', country: 'GH', availability: 'AVAILABLE', ...f });
const SHOPS = [
  shop('k1', { name: 'Efua', salonName: 'Efua Glam', city: 'Koforidua', area: 'Adweso', location: { lat: 6.09, lng: -0.26 }, services: ['makeup'], styles: [st('makeup', 'bridal-makeup', 'Bridal Makeup', 400), st('makeup', 'natural-glam', 'Natural Glam', 150)], verified: true, memberNumber: 20 }),
  shop('a1', { name: 'Akos', salonName: 'Akos Beauty', city: 'Accra', area: 'Madina', location: { lat: 5.6687, lng: -0.1653 }, services: ['makeup', 'hair'], styles: [st('makeup', 'event-makeup', 'Event Makeup', 250), st('hair', 'dreadlocks', 'Dreadlocks retwist', 180)] }),
  shop('l1', { name: 'Kojo', salonName: 'Kojo Locs', city: 'Kasoa', location: { lat: 5.53, lng: -0.42 }, services: ['hair'], styles: [st('hair', 'dreadlocks', 'Starter locs', 350), st('hair', 'dreadlocks', 'Retwist', 150, { photoThumb: 'data:image/jpeg;base64,AA' })], verified: true }),
  shop('b1', { name: 'Yaw', salonName: 'Gentlemans look', city: 'Kasoa', location: { lat: 5.535, lng: -0.417 }, services: ['barbering'], styles: [st('barbering', 'fade', 'Skin fade', 50)] }),
  shop('x1', { name: 'Hidden', accountStatus: 'RESTRICTED', city: 'Koforidua', services: ['makeup'], styles: [st('makeup', 'natural-glam', 'Glam', 100)] }),
];
Stylist.find = async (f) => SHOPS.filter((s) => s.status === f.status && s.accountStatus === f.accountStatus);
const app = express(); app.set('trust proxy', 1); app.use(express.json()); app.use('/api/assist', R('routes/assist'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const server = app.listen(0, async () => {
  const port = server.address().port; let ip = 0;
  const ask = async (q, extra = {}, fixedIp) => { const r = await fetch(`http://localhost:${port}/api/assist`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': fixedIp || '10.2.0.' + (++ip) }, body: JSON.stringify({ q, country: 'GH', ...extra }) }); return { s: r.status, j: await r.json() }; };
  console.log('--- UNDERSTANDING ---');
  const u = (q) => understand(q, DEFAULT_SERVICES);
  check('"I\'m at Koforidua, where do I find a makeup artist?" → makeup, Koforidua', u("I'm at Koforidua, where do I find a makeup artist?").service === 'makeup' && u("I'm at Koforidua, where do I find a makeup artist?").place === 'koforidua');
  check('"I have a budget of 200 for locks" → Dreadlocks, 200', u('I have a budget of 200 for locks').style.key === 'dreadlocks' && u('I have a budget of 200 for locks').budget === 200);
  check('"GH₵150 nails East Legon" → nails, 150, East Legon', u('GH₵150 nails East Legon').service === 'nails' && u('GH₵150 nails East Legon').budget === 150 && u('GH₵150 nails East Legon').place === 'east legon');
  check('"barber near me" → barbering, near me', u('barber near me').service === 'barbering' && u('barber near me').nearMe === true);
  check('"photographer for my wedding in Accra" → photography, Accra', u('photographer for my wedding in Accra').service === 'photography' && u('photographer for my wedding in Accra').place === 'accra');
  console.log('--- REAL ANSWERS ---');
  let r = await ask("I'm at Koforidua, where do I find a makeup artist?");
  check('Koforidua makeup: Efua Glam, with a plain answer', r.s === 200 && r.j.results[0].name === 'Efua Glam' && /makeup artist/.test(r.j.answer) && /Koforidua/.test(r.j.answer), r.j.answer);
  check('a restricted shop is never suggested', !r.j.results.some((x) => x.name === 'Hidden'));
  check('results show the place, never exact coordinates', r.j.results[0].place === 'Adweso, Koforidua' && !('location' in r.j.results[0]));
  r = await ask('I have a budget of 200 for locks');
  check('200 for locks: Akos (GH₵180) and Kojo (retwist GH₵150), within budget', r.j.results.length === 2 && r.j.results.every((x) => x.offer.price <= 200), JSON.stringify(r.j.results.map((x) => [x.name, x.offer && x.offer.price])));
  check("…Kojo's matching offer is the GH₵150 retwist, with its photo", r.j.results.find((x) => x.name === 'Kojo Locs').offer.price === 150 && r.j.results.find((x) => x.name === 'Kojo Locs').thumb);
  r = await ask('makeup in Kasoa');
  check('nobody in the town → says so honestly, and offers the nearest', r.j.results.length > 0 && /^No .* in Kasoa yet\. The nearest is/.test(r.j.answer), r.j.answer);
  r = await ask('barber near me', { lat: 5.53, lng: -0.42 });
  check('"near me" with location: the barber in Kasoa, about 1 km away', r.j.results[0].name === 'Gentlemans look' && r.j.results[0].km <= 1, JSON.stringify(r.j.results[0]));
  r = await ask('barber near me');
  check('"near me" without location: asks to turn location on', /Turn on your location/.test(r.j.answer));
  r = await ask('hello');
  check('a vague question gets an example of what to ask', /For example/.test(r.j.answer) && r.j.results.length === 0);
  check('an empty question is refused', (await ask(' ')).s === 400);
  SET.verifiedOnly = true;
  r = await ask('dreadlocks');
  check('"ID-checked only" switch: only ID-checked professionals are suggested', r.j.results.length === 1 && r.j.results[0].name === 'Kojo Locs');
  SET.verifiedOnly = false;
  console.log('--- AI (only when a key is set) ---');
  const realFetch = global.fetch; let aiCalls = 0;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async (url, opts) => {
    if (String(url).includes('api.anthropic.com')) { aiCalls++; return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"service":"makeup","style":null,"place":"koforidua","budget":300,"nearMe":false}' }] }) }; }
    return realFetch(url, opts);
  };
  r = await ask('abeg who fit do my face for Kof-town, I get 300');
  check('with a key, AI reads a question the rules could not: makeup, Koforidua, 300', r.j.understood.by === 'ai' && r.j.results[0].name === 'Efua Glam' && aiCalls === 1, JSON.stringify(r.j.understood));
  global.fetch = async (url, opts) => (String(url).includes('api.anthropic.com') ? { ok: false, json: async () => ({}) } : realFetch(url, opts));
  r = await ask('makeup in Koforidua');
  check('if AI fails, the built-in understanding answers instead', r.s === 200 && r.j.understood.by === 'rules' && r.j.results[0].name === 'Efua Glam');
  SET.aiAssistant = false; aiCalls = 0;
  global.fetch = async (url, opts) => { if (String(url).includes('api.anthropic.com')) aiCalls++; return realFetch(url, opts); };
  r = await ask('makeup in Koforidua');
  check('admin switch off: no AI calls at all (no cost)', aiCalls === 0 && r.j.understood.by === 'rules');
  SET.aiAssistant = true; global.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY;
  console.log('--- LIMITS ---');
  let blockedAt = null;
  for (let i = 1; i <= 42 && !blockedAt; i++) { const x = await ask('braids', {}, '9.9.9.9'); if (x.s === 429) blockedAt = i; }
  check('41st question from one address in 15 minutes is paused', blockedAt === 41, 'blocked at ' + blockedAt);
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
});
