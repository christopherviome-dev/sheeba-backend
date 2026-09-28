// Restored from the earlier test suites (sessions of 25–27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
const express = R('node_modules/express');
const Stylist = R('models/Stylist'), FxRate = R('models/FxRate');
const { percentile, summarise } = R('lib/prices');
const fx = R('lib/fx');
let SHOPS = [];
const mk = (id, f) => ({ id, _id: { toString: () => id }, status: 'APPROVED', accountStatus: 'ACTIVE', ...f });
Stylist.find = async () => SHOPS;
FxRate.findById = async () => null; FxRate.findOneAndUpdate = async () => ({});
const realFetch = global.fetch;
global.fetch = async (u, o) => String(u).startsWith('https://open.er-api.com')
  ? { json: async () => ({ result: 'success', time_last_update_unix: 1790000000, rates: { GHS: 1, GBP: 0.066 } }) } : realFetch(u, o);
const item = (price, serviceKey, styleKey, extra = {}) => ({ price, serviceKey, styleKey, ...extra });
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };

(async () => {
  console.log('--- THE MATHS ---');
  check('median of 100,200,300,400 = 250', percentile([100, 200, 300, 400], 0.5) === 250);
  check('quarter points: 175 and 325', percentile([100, 200, 300, 400], 0.25) === 175 && percentile([100, 200, 300, 400], 0.75) === 325);
  const busy = mk('busy', { styles: [item(1000, 'hair', 'box-braids'), item(1000, 'hair', 'box-braids'), item(1000, 'hair', 'box-braids'), item(1000, 'hair', 'box-braids')] });
  const s = summarise([busy, mk('a', { styles: [item(200, 'hair', 'box-braids')] }), mk('b', { styles: [item(300, 'hair', 'box-braids')] })], { style: 'box-braids' });
  check('one figure per shop: a shop listing 4 items counts once', s.enough && s.shops === 3 && s.median === 300, JSON.stringify(s));
  check('fewer than 3 shops → no range shown', summarise([busy, mk('a', { styles: [item(200, 'hair', 'box-braids')] })], { style: 'box-braids' }).enough === false);
  check('hidden (switched-off) items ignored', summarise([mk('x', { styles: [item(9999, 'hair', 'box-braids', { active: false })] })], { style: 'box-braids' }).shops === 0);

  console.log('--- LOCAL RANGES ---');
  const Accra = { lat: 5.6037, lng: -0.1870 }, Kumasi = { lat: 6.6885, lng: -1.6244 };
  SHOPS = [
    mk('g1', { country: 'GH', city: 'Accra', location: Accra, styles: [item(150, 'hair', 'box-braids')] }),
    mk('g2', { country: 'GH', city: 'accra', location: { lat: 5.62, lng: -0.20 }, styles: [item(250, 'hair', 'box-braids')] }),
    mk('g3', { country: 'GH', city: 'Accra ', location: { lat: 5.58, lng: -0.17 }, styles: [item(350, 'hair', 'box-braids')] }),
    mk('g4', { country: 'GH', city: 'Kumasi', location: Kumasi, styles: [item(100, 'hair', 'box-braids')] }),
    mk('g5', { country: 'GH', city: 'Kumasi', location: { lat: 6.69, lng: -1.62 }, styles: [item(120, 'hair', 'box-braids')] }),
    mk('g6', { country: 'GH', city: 'Kumasi', location: { lat: 6.70, lng: -1.63 }, styles: [item(140, 'hair', 'box-braids')] }),
    mk('bar', { country: 'GH', city: 'Accra', category: 'Barbering', location: Accra, styles: [item(50, null, null)] }),
    mk('u1', { country: 'GB', city: 'London', currency: 'GBP', styles: [item(80, 'hair', 'box-braids')] }),
    mk('u2', { country: 'GB', city: 'London', currency: 'GBP', styles: [item(100, 'hair', 'box-braids')] }),
    mk('u3', { country: 'GB', city: 'London', currency: 'GBP', styles: [item(120, 'hair', 'box-braids')] }),
  ];
  const app = express(); app.use('/api/prices', R('routes/prices'));
  const server = app.listen(8219, async () => {
    const get = async (q) => { const r = await realFetch('http://localhost:8219/api/prices' + q); return { s: r.status, j: await r.json() }; };
    let r = await get(`?country=GH&style=box-braids&lat=${Accra.lat}&lng=${Accra.lng}&km=25`);
    check('near Accra: only the 3 Accra shops count (Kumasi is 200 km away)', r.j.enough && r.j.scope === 'near' && r.j.shops === 3 && r.j.median === 250, JSON.stringify(r.j));
    check('range in cedis: GH₵200–300', r.j.currency === 'GHS' && r.j.low === 200 && r.j.high === 300);
    r = await get('?country=GH&style=box-braids&city=Kumasi');
    check('Kumasi: typical GH₵120 (cheaper than Accra)', r.j.enough && r.j.median === 120);
    r = await get('?country=GH&style=box-braids');
    check('whole of Ghana: 6 shops', r.j.shops === 6);
    r = await get(`?country=GH&style=box-braids&lat=${Accra.lat}&lng=${Accra.lng}&exclude=g1`);
    check("'what OTHERS charge' leaves your own shop out (2 left → not enough)", r.j.enough === false && r.j.shops === 2);
    r = await get('?country=GH&service=barbering');
    check('older shop with category "Barbering" counts for barbering', r.j.shops === 1);
    check('no shop names or IDs ever in the reply', !JSON.stringify(r.j).match(/g1|g2|bar|Accra/));

    console.log('--- COMPARE ACROSS CITIES AND COUNTRIES ---');
    fx._resetForTests();
    r = await (async () => { const x = await realFetch('http://localhost:8219/api/prices/compare?style=box-braids&currency=GHS'); return { s: x.status, j: await x.json() }; })();
    const accra = r.j.cities.find((c) => c.city.toLowerCase().trim() === 'accra'), kumasi = r.j.cities.find((c) => c.city === 'Kumasi');
    check('cities compared, "Accra", "accra" and "Accra " treated as one city', accra && accra.shops === 3 && kumasi && kumasi.median === 120);
    const uk = r.j.countries.find((c) => c.country === 'GB');
    check('UK shown in pounds (£100) with an APPROXIMATE cedi figure (≈ GH₵1,515)', uk && uk.currency === 'GBP' && uk.median === 100 && uk.approx && uk.approx.approx === true && Math.round(uk.approx.amount) === 1515, JSON.stringify(uk));
    check('the reply says conversions are approximate', /approximate/i.test(r.j.approxNote));
    check("Ghana compared in its own currency needs no conversion", r.j.countries.find((c) => c.country === 'GH').approx === null);
    global.fetch = realFetch;
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    server.close(); process.exit(fail ? 1 : 0);
  });
})();
