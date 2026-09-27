const express = require('express');
const Stylist = require('../models/Stylist');
const { summarise, localShops, cityKey, MIN_SHOPS } = require('../lib/prices');
const { getCountry, countryOf } = require('../lib/countries');
const { convert } = require('../lib/fx');

const router = express.Router();
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
// Only what price maths needs: never photos or private fields.
const FIELDS = 'styles.price styles.active styles.serviceKey styles.styleKey services category location city country currency';
const liveShops = async () => Stylist.find({ status: 'APPROVED', accountStatus: 'ACTIVE' }, FIELDS);

// Typical prices "here" for a service or style: near a point, in a city, or in a country.
// GET /api/prices?country=GH&service=hair&style=box-braids&lat=5.6&lng=-0.2&km=25&exclude=<shopId>
router.get('/', async (req, res) => {
  const country = getCountry(String(req.query.country || '').toUpperCase()) ? String(req.query.country).toUpperCase() : 'GH';
  const lat = num(req.query.lat), lng = num(req.query.lng), km = Math.min(Math.max(num(req.query.km) || 25, 1), 200);
  let shops = (await liveShops()).filter((s) => countryOf(s) === country);
  if (req.query.exclude) shops = shops.filter((s) => s._id.toString() !== String(req.query.exclude)); // "what OTHERS charge"
  const here = localShops(shops, { lat: Number.isFinite(lat) ? lat : undefined, lng: Number.isFinite(lng) ? lng : undefined, km, city: req.query.city });
  const scope = Number.isFinite(lat) && Number.isFinite(lng) ? 'near' : req.query.city ? 'city' : 'country';
  res.json({ scope, currency: getCountry(country).currency, minShops: MIN_SHOPS, ...summarise(here, { service: req.query.service, style: req.query.style }) });
});

// Compare a service or style across cities (exact, same currency) and across
// countries (each in its own currency, plus an APPROXIMATE conversion).
// GET /api/prices/compare?service=hair&style=box-braids&currency=GHS
router.get('/compare', async (req, res) => {
  const want = { service: req.query.service, style: req.query.style };
  const viewerCurrency = String(req.query.currency || 'GHS').toUpperCase();
  const shops = await liveShops();
  const byCountry = {};
  for (const s of shops) (byCountry[countryOf(s)] = byCountry[countryOf(s)] || []).push(s);
  const cities = [], countries = [];
  for (const [code, list] of Object.entries(byCountry)) {
    const c = getCountry(code);
    const whole = summarise(list, want);
    if (whole.enough) {
      const approx = c.currency === viewerCurrency ? null : await convert(whole.median, c.currency, viewerCurrency);
      countries.push({ country: code, name: c.name, currency: c.currency, ...whole, approx });
    }
    const byCity = {};
    for (const s of list) if (s.city) (byCity[cityKey(s.city)] = byCity[cityKey(s.city)] || { name: s.city, shops: [] }).shops.push(s);
    for (const { name, shops: cs } of Object.values(byCity)) {
      const st = summarise(cs, want);
      if (st.enough) cities.push({ city: name, country: code, currency: c.currency, ...st });
    }
  }
  cities.sort((a, b) => b.shops - a.shops); countries.sort((a, b) => b.shops - a.shops);
  res.json({ minShops: MIN_SHOPS, cities: cities.slice(0, 12), countries, approxNote: 'Conversions between currencies are approximate, using today\'s exchange rates.' });
});

module.exports = router;
