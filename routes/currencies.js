const express = require('express');
const router = express.Router();

// A small module-level cache — the underlying free service updates once
// daily and asks callers to cache responses rather than hammer it. Six
// hours is a reasonable middle ground: fresh enough to matter, far short
// of hitting any real rate limit.
const CACHE_TTL = 6 * 60 * 60 * 1000;
const cache = new Map(); // base currency -> { data, fetchedAt }

router.get('/rates', async (req, res) => {
  const base = (req.query.base || 'GHS').toUpperCase();
  const cached = cache.get(base);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL) {
    return res.json({ ...cached.data, cached: true });
  }
  try {
    const resp = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    if (!resp.ok) throw new Error('Exchange rate service returned an error.');
    const body = await resp.json();
    if (body.result !== 'success') throw new Error('Exchange rate service reported failure.');
    const data = {
      base,
      rates: body.rates,
      // The real update time from the provider, not "now" — an honest
      // timestamp for the actual data, not a fabricated freshness claim.
      asOf: body.time_last_update_utc,
      source: 'exchangerate-api.com (open access)',
    };
    cache.set(base, { data, fetchedAt: Date.now() });
    res.json({ ...data, cached: false });
  } catch (e) {
    // Per the explicit requirement: never invent a rate. If we have any
    // cached value at all, even a stale one, it's still real data and more
    // honest than nothing — but we say plainly that it's stale. With no
    // cache at all, we say so and the frontend must fall back to showing
    // only the original local price.
    if (cached) return res.json({ ...cached.data, cached: true, stale: true });
    res.status(503).json({ error: 'Exchange rate service is currently unavailable.' });
  }
});

module.exports = router;
