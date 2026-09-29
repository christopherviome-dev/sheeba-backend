const express = require('express');
const Stylist = require('../models/Stylist');
const { getCatalog } = require('../lib/catalog');
const { getSetting } = require('../lib/settings');
const { getCountry } = require('../lib/countries');
const { understand, search, answerFor, TOWNS } = require('../lib/assist');
const attempts = require('../lib/attempts');
const router = express.Router();

const countryOf = (s) => s.country || 'GH';
// AI reads the question only when a key is set AND the admin switch is on.
async function aiUnderstand(q, catalog) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !(await getSetting('aiAssistant'))) return null;
  const styles = catalog.flatMap((s) => (s.styles || []).map((x) => x.key));
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 150,
        system: `Extract what a beauty-services customer in Ghana is asking for. Reply with ONLY a JSON object: {"service": one of ${JSON.stringify(catalog.map((s) => s.key))} or null, "style": one of ${JSON.stringify(styles)} or null, "place": the town or area named (lowercase) or null, "budget": a number or null, "nearMe": true if they want something near them}. "locks"/"locs" means dreadlocks. No other text.`,
        messages: [{ role: 'user', content: String(q).slice(0, 300) }],
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const j = JSON.parse(String((d.content || []).map((c) => c.text || '').join('')).replace(/```json|```/g, '').trim());
    const st = j.style && catalog.flatMap((s) => (s.styles || []).map((x) => ({ key: x.key, name: x.name, service: s.key }))).find((x) => x.key === j.style);
    const service = st ? st.service : catalog.some((s) => s.key === j.service) ? j.service : null;
    const place = typeof j.place === 'string' && j.place.trim() ? j.place.trim().toLowerCase().slice(0, 40) : null;
    const budget = typeof j.budget === 'number' && j.budget > 0 && j.budget < 1e6 ? Math.round(j.budget) : null;
    return { service, style: st || null, place, budget, nearMe: j.nearMe === true, home: false, by: 'ai' };
  } catch (e) { return null; } finally { clearTimeout(timer); }
}

// POST /api/assist { q, country, lat, lng } → { understood, answer, results }
router.post('/', async (req, res) => {
  const ip = req.ip || 'x';
  const k = `assist:${ip}`; // 40 questions per 15 minutes per address
  if (attempts.status([k]).blocked) return res.status(429).json({ error: 'Too many questions for now. Try again in a few minutes.' });
  attempts.fail([[k, 40]]);
  const q = typeof req.body.q === 'string' ? req.body.q.trim().slice(0, 300) : '';
  if (q.length < 2) return res.status(400).json({ error: 'Ask me something, like "braids in Kasoa under 300".' });
  const country = getCountry(String(req.body.country || '').toUpperCase()) ? String(req.body.country).toUpperCase() : 'GH';
  const lat = Number(req.body.lat), lng = Number(req.body.lng);
  const me = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  const catalog = await getCatalog();
  const verifiedOnly = !!(await getSetting('verifiedOnly'));
  const shops = (await Stylist.find({ status: 'APPROVED', accountStatus: 'ACTIVE' })).filter((s) => countryOf(s) === country && (!verifiedOnly || s.verified) && s.role !== 'APPRENTICE');
  const places = [...new Set(shops.flatMap((s) => [s.area, s.city]).filter(Boolean))];
  let u = null;
  const ak = `assist-ai:${ip}`; // AI reads at most 15 questions per 15 minutes per address (cost); rules after that
  if (!attempts.status([ak]).blocked) { attempts.fail([[ak, 15]]); u = await aiUnderstand(q, catalog); }
  if (!u) u = { ...understand(q, catalog, places), by: 'rules' };
  if (u.place && !TOWNS[u.place] && !places.some((p) => p.toLowerCase().includes(u.place))) u = { ...u, place: null, unknownPlace: true };
  const results = search(u, shops, catalog, me);
  const out = answerFor(u, results, catalog);
  if (u.nearMe && !me) out.answer = 'Turn on your location so I can find who is near you. ' + out.answer;
  res.json({ understood: { service: u.service, style: u.style ? u.style.name : null, place: u.place, budget: u.budget, nearMe: u.nearMe, by: u.by }, ...out });
});

module.exports = router;
