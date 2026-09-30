// Stops password guessing.
//  - 5 wrong passwords for one account within 15 minutes → that account's
//    logins pause for 15 minutes.
//  - 20 failures from one internet address within 15 minutes → that address
//    pauses (someone trying many different numbers).
// The same message whether or not the number has an account, so guessing
// can't reveal who is on Mepluge. Kept in memory: fine for one server; a
// restart simply clears the counts.
const WINDOW = 15 * 60 * 1000;
const LOCK = 15 * 60 * 1000;
const LIMITS = { account: 5, ip: 20, reset: 3, resetIp: 10 };
let now = () => Date.now();
const store = new Map(); // key → { fails: [times], lockedUntil }

function prune() {
  if (store.size < 5000) return;
  const t = now();
  for (const [k, v] of store) if ((v.lockedUntil || 0) < t && !v.fails.some((f) => t - f < WINDOW)) store.delete(k);
}

// A phone number in any format → one key (its last 9 digits).
const phoneKey = (kind, phone) => `${kind}:${String(phone || '').replace(/\D/g, '').slice(-9)}`;

function status(keys) {
  const t = now();
  let wait = 0;
  for (const k of keys) { const v = store.get(k); if (v && v.lockedUntil > t) wait = Math.max(wait, v.lockedUntil - t); }
  return { blocked: wait > 0, retryMinutes: Math.max(1, Math.ceil(wait / 60000)) };
}

function fail(entries) { // entries: [[key, limit], ...]
  const t = now();
  for (const [k, limit] of entries) {
    const v = store.get(k) || { fails: [], lockedUntil: 0 };
    v.fails = v.fails.filter((f) => t - f < WINDOW);
    v.fails.push(t);
    if (v.fails.length >= limit) { v.lockedUntil = t + LOCK; v.fails = []; }
    store.set(k, v);
  }
  prune();
}

const clear = (key) => store.delete(key);

// Login helpers: one account key + one address key.
function loginKeys(kind, phone, ip) { return { account: phoneKey(kind, phone), ip: `ip:${ip || 'unknown'}` }; }
function loginBlocked(k) { return status([k.account, k.ip]); }
function loginFailed(k) { fail([[k.account, LIMITS.account], [k.ip, LIMITS.ip]]); }
const loginSucceeded = (k) => clear(k.account);
const LOCKED_MESSAGE = (m) => `Too many wrong attempts. Please wait ${m} minute${m === 1 ? '' : 's'} and try again, or use "Forgot password".`;

function _setNowForTests(fn) { now = fn; store.clear(); }
module.exports = { LIMITS, phoneKey, status, fail, clear, loginKeys, loginBlocked, loginFailed, loginSucceeded, LOCKED_MESSAGE, _setNowForTests };
