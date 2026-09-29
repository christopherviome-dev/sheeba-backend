// The Sheeba assistant: understands questions like "I'm at Koforidua, where do I
// find a makeup artist?" or "I have 200 for locks" and answers with real results.
// Built-in understanding (free, instant). If an AI key is set, AI can read the
// question instead, but it only EXTRACTS what was asked; the answer always comes
// from Sheeba's real data, so it can never invent shops, prices or places.
const { servicesOf } = require('./catalog');
const { distanceKm } = require('./geo');

// Towns people name, with rough centres, so "in Koforidua" also finds shops nearby.
const TOWNS = {
  accra: [5.6037, -0.187], kumasi: [6.6885, -1.6244], tamale: [9.4008, -0.8393], takoradi: [4.8975, -1.7603], sekondi: [4.934, -1.7137],
  'cape coast': [5.1053, -1.2466], koforidua: [6.0941, -0.2591], ho: [6.6008, 0.4713], sunyani: [7.3399, -2.3268], techiman: [7.5906, -1.9391],
  bolgatanga: [10.7856, -0.8514], wa: [10.0601, -2.5099], tema: [5.6698, -0.0166], kasoa: [5.5345, -0.4168], madina: [5.6687, -0.1653],
  adenta: [5.706, -0.165], ashaiman: [5.6947, -0.0293], nsawam: [5.8089, -0.3503], winneba: [5.3511, -0.6231], obuasi: [6.2023, -1.6649],
  tarkwa: [5.3006, -1.9951], nkawkaw: [6.551, -0.766], hohoe: [7.1519, 0.4734], aflao: [6.1167, 1.1833], 'east legon': [5.6358, -0.1579],
  teshie: [5.5836, -0.1069], dansoman: [5.55, -0.2667], achimota: [5.6167, -0.2333], spintex: [5.639, -0.117], lapaz: [5.606, -0.25],
  weija: [5.557, -0.336], dodowa: [5.8829, -0.0982], ejisu: [6.716, -1.483], mampong: [7.0627, -1.4001], yendi: [9.4427, -0.0099],
  bawku: [11.0616, -0.2417], elmina: [5.0847, -1.3509], 'agona swedru': [5.5343, -0.7003], suhum: [6.04, -0.45], 'akim oda': [5.9265, -0.9858],
  berekum: [7.4534, -2.584], somanya: [6.104, -0.015], akosombo: [6.2994, 0.0591], keta: [5.9179, 0.9913], damongo: [9.0833, -1.8167],
  dambai: [8.0667, 0.1833], nalerigu: [10.527, -0.369], goaso: [6.8036, -2.5172], 'sefwi wiawso': [6.2058, -2.4894],
};
// Everyday words for each service, and extra ways people name styles.
const SERVICE_WORDS = {
  hair: ['hairdresser', 'hair stylist', 'hairstylist', 'stylist', 'braider', 'hair salon', 'hair'],
  barbering: ['barbershop', 'barber', 'haircut', 'hair cut', 'barbering'],
  makeup: ['makeup artist', 'make up artist', 'makeup', 'make up', 'mua', 'face beat'],
  nails: ['nail tech', 'nail technician', 'manicurist', 'nails', 'nail'],
  lashes: ['lash tech', 'lashes', 'lash', 'brows', 'eyebrows'],
  skin: ['spa', 'facial', 'massage', 'waxing', 'skincare', 'skin care'],
};
const EXTRA_STYLE_WORDS = { dreadlocks: ['locks', 'lock', 'locs', 'loc', 'dreads', 'dread'], 'knotless-braids': ['knotless'], 'wigs-weaves': ['wig', 'wigs', 'weave'] };
const NEAR_ME = /\b(near me|around me|close to me|closest|nearest|nearby|close by)\b/;
const HOME = /\b(home service|come to (my|me)|at (my )?home|to my house)\b/;

const clean = (s) => ' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9₵£$\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
const has = (text, phrase) => text.includes(' ' + phrase + ' ');

// Read a question with built-in rules.
function understand(q, catalog, shopPlaces = []) {
  const t = clean(q);
  let style = null, best = 0;
  for (const sv of catalog) for (const st of sv.styles || []) {
    for (const w of [st.name, ...(st.aliases || []), ...(EXTRA_STYLE_WORDS[st.key] || [])].map((x) => clean(x).trim())) {
      if (w && has(t, w) && w.length > best) { best = w.length; style = { key: st.key, name: st.name, service: sv.key }; }
    }
  }
  let service = style ? style.service : null;
  if (!service) {
    let len = 0;
    for (const sv of catalog) for (const w of [...(SERVICE_WORDS[sv.key] || []), sv.name.toLowerCase()]) if (has(t, w) && w.length > len) { len = w.length; service = sv.key; }
  }
  let place = null;
  for (const p of [...Object.keys(TOWNS), ...shopPlaces.map((x) => clean(x).trim()).filter(Boolean)]) if (has(t, p) && (!place || p.length > place.length)) place = p;
  const m = t.match(/(?:₵|gh₵|ghc|ghs|£|\$)?\s?(\d{2,6})(?:\s?(?:cedis?|ghc|ghs|gh₵|pounds?|dollars?))?/);
  const budget = m ? Number(m[1]) : null;
  return { service, style, place, budget, nearMe: NEAR_ME.test(t), home: HOME.test(t) };
}

const svcName = (catalog, key) => { const s = catalog.find((x) => x.key === key); return s ? s.name : null; };
// The trade's own titles (same as the app's lib/titles.js).
const WHO = { hair: ['hairdresser', 'hairdressers'], barbering: ['barber', 'barbers'], makeup: ['makeup artist', 'makeup artists'], nails: ['nail technician', 'nail technicians'], lashes: ['lash & brow technician', 'lash & brow technicians'], skin: ['beauty therapist', 'beauty therapists'] };
const money = (n, cur) => (cur === 'GBP' ? '£' : cur === 'USD' ? '$' : 'GH₵') + n;

// Find real, live professionals for what was understood.
function search(u, shops, catalog, me) {
  const origin = u.place && TOWNS[u.place] ? { lat: TOWNS[u.place][0], lng: TOWNS[u.place][1] } : u.nearMe && me ? me : null;
  const out = [];
  for (const s of shops) {
    const offers = (s.styles || []).filter((x) => x.active !== false && (u.style ? x.styleKey === u.style.key : u.service ? x.serviceKey === u.service : true));
    const offersService = u.style ? offers.length > 0 : u.service ? servicesOf(s).includes(u.service) || offers.length > 0 : true;
    if (!offersService) continue;
    const priced = offers.filter((x) => typeof x.price === 'number').sort((a, b) => a.price - b.price);
    const cheapest = priced[0] || null;
    if (u.budget && !(cheapest && cheapest.price <= u.budget)) continue;
    const text = clean(`${s.area || ''} ${s.city || ''}`);
    const inPlaceByName = u.place ? has(text, u.place) : false;
    const km = origin && s.location && typeof s.location.lat === 'number' ? distanceKm(origin, s.location) : null;
    if (u.place && !TOWNS[u.place] && !inPlaceByName) continue; // an area we only know by name: must match
    const offer = u.budget ? priced.filter((x) => x.price <= u.budget)[0] : cheapest || offers[0] || null;
    out.push({
      id: s._id.toString(), name: s.salonName || s.name, services: servicesOf(s), place: [s.area, s.city].filter(Boolean).join(', ') || null,
      km: km === null ? null : Math.round(km), inPlace: u.place ? inPlaceByName || (km !== null && km <= 15) : null,
      offer: offer ? { name: offer.name, price: typeof offer.price === 'number' ? offer.price : null, currency: s.currency || 'GHS' } : null,
      thumb: (offer && offer.photoThumb) || (offers.find((x) => x.photoThumb) || {}).photoThumb || null,
      idChecked: !!s.verified, founding: !!(s.memberNumber && s.memberNumber <= 1000), available: s.availability === 'AVAILABLE',
    });
  }
  out.sort((a, b) => (a.km !== null && b.km !== null ? a.km - b.km : 0) || ((a.offer && a.offer.price) ?? 1e9) - ((b.offer && b.offer.price) ?? 1e9));
  return out;
}

function answerFor(u, results, catalog) {
  const what = u.style ? u.style.name : u.service ? (WHO[u.service] ? WHO[u.service][1] : svcName(catalog, u.service)) : 'professionals';
  const where = u.place ? ` in ${u.place.replace(/\b\w/g, (c) => c.toUpperCase())}` : u.nearMe ? ' near you' : '';
  const budget = u.budget ? ` for ${money(u.budget)} or less` : '';
  const here = u.place ? results.filter((r) => r.inPlace) : results;
  if (!u.style && !u.service && !u.place && !u.budget && !u.nearMe) return { answer: 'Tell me what you need, where, and your budget. For example: "braids in Kasoa under 300".', results: [] };
  if (here.length) {
    const first = here[0];
    const extra = first.offer && first.offer.price !== null ? ` ${u.budget ? 'from' : 'at'} ${money(first.offer.price, first.offer.currency)}` : '';
    return { answer: `${here.length} ${here.length === 1 && WHO[u.service] && !u.style ? WHO[u.service][0] : what}${where}${budget}. ${first.km !== null ? 'Closest' : u.budget ? 'Best price' : 'Top'}: ${first.name}${first.place ? ` (${first.place})` : ''}${extra}.`, results: here.slice(0, 20) };
  }
  if (u.place && results.length) {
    const n = results[0];
    return { answer: `No ${what}${budget} listed${where} yet. The nearest is ${n.name}${n.place ? ` in ${n.place}` : ''}${n.km !== null ? `, about ${n.km} km away` : ''}.`, results: results.slice(0, 10) };
  }
  return { answer: `No ${what}${where}${budget} on Sheeba yet.${u.budget ? ' Try a higher budget.' : ' New professionals join every week.'}`, results: [] };
}

module.exports = { understand, search, answerFor, TOWNS, clean };
