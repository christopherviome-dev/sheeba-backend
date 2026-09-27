// Real local price ranges, worked out from what professionals actually charge.
//  - One figure per SHOP (the middle of its own matching prices), so a shop
//    listing many variations can't pull "typical" its way.
//  - A range is only shown once at least MIN_SHOPS different shops have prices:
//    meaningful numbers, and never one professional's prices shown as "typical".
const { servicesOf } = require('./catalog');
const { distanceKm } = require('./geo');

const MIN_SHOPS = 3;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)) * 100) / 100;
}

// One number per shop: the median of its active items that match.
function shopPrice(shop, service, style) {
  const own = servicesOf(shop);
  const prices = (shop.styles || [])
    .filter((x) => x.active !== false && typeof x.price === 'number' && Number.isFinite(x.price))
    .filter((x) => !service || x.serviceKey === service || (!x.serviceKey && own.includes(service)))
    .filter((x) => !style || x.styleKey === style)
    .map((x) => x.price).sort((a, b) => a - b);
  return prices.length ? percentile(prices, 0.5) : null;
}

function summarise(shops, { service, style }) {
  const perShop = shops.map((s) => shopPrice(s, service, style)).filter((v) => v !== null).sort((a, b) => a - b);
  if (perShop.length < MIN_SHOPS) return { enough: false, shops: perShop.length };
  return { enough: true, shops: perShop.length, low: percentile(perShop, 0.25), median: percentile(perShop, 0.5), high: percentile(perShop, 0.75) };
}

const cityKey = (c) => String(c || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Which shops count as "here": within a radius of a point, else the same city, else the country.
function localShops(shops, { lat, lng, km = 25, city }) {
  if (typeof lat === 'number' && typeof lng === 'number') {
    return shops.filter((s) => s.location && s.location.lat != null && distanceKm(lat, lng, s.location.lat, s.location.lng) <= km);
  }
  if (city) return shops.filter((s) => cityKey(s.city) === cityKey(city));
  return shops;
}

module.exports = { MIN_SHOPS, percentile, shopPrice, summarise, localShops, cityKey };
