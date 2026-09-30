// "Continue with Google": checks a Google sign-in token properly, with no extra
// library: Google's signature (its published keys), issued by Google, meant for
// OUR app (GOOGLE_CLIENT_ID), not expired, and a confirmed email address.
const crypto = require('crypto');
const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
let cache = { keys: null, until: 0 };
const b64 = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

async function googleKeys() {
  if (cache.keys && Date.now() < cache.until) return cache.keys;
  const r = await fetch(CERTS);
  const j = await r.json();
  const m = /max-age=(\d+)/.exec((r.headers && r.headers.get && r.headers.get('cache-control')) || '');
  cache = { keys: j.keys || [], until: Date.now() + (m ? Number(m[1]) * 1000 : 3600 * 1000) };
  return cache.keys;
}

async function verifyGoogleIdToken(token) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('Google sign-in is not set up yet.');
  if (typeof token !== 'string' || token.split('.').length !== 3 || token.length > 4096) throw new Error('That Google sign-in did not work. Try again.');
  const [h, p, s] = token.split('.');
  let header, payload;
  try { header = JSON.parse(b64(h).toString()); payload = JSON.parse(b64(p).toString()); } catch (e) { throw new Error('That Google sign-in did not work. Try again.'); }
  if (header.alg !== 'RS256') throw new Error('That Google sign-in did not work. Try again.');
  let key = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!key) { cache.until = 0; key = (await googleKeys()).find((k) => k.kid === header.kid); } // Google rotates its keys
  if (!key) throw new Error('That Google sign-in did not work. Try again.');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key, format: 'jwk' }), b64(s));
  if (!ok) throw new Error('That Google sign-in did not work. Try again.');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) throw new Error('That Google sign-in did not work. Try again.');
  if (payload.aud !== clientId) throw new Error('That Google sign-in did not work. Try again.');
  if (!payload.exp || payload.exp * 1000 < Date.now() - 60 * 1000) throw new Error('That Google sign-in expired. Try again.');
  if (payload.email_verified !== true || !payload.email) throw new Error('Your Google email is not confirmed yet.');
  return { sub: String(payload.sub), email: String(payload.email).toLowerCase(), name: typeof payload.name === 'string' ? payload.name.slice(0, 60) : null };
}

module.exports = { verifyGoogleIdToken, _resetGoogleCacheForTests: () => { cache = { keys: null, until: 0 }; } };
