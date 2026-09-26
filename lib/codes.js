const crypto = require('crypto');

// Sheeba codes: one per account, for life (a trainee who becomes a
// professional keeps theirs, so printed QR posters never break).
// 6 characters from letters and digits that can't be confused when read
// aloud or typed (no I, L, O, 0 or 1): 31^6 ≈ 887 million possibilities.
// Random, never sequential, so nobody can guess their way through users.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[A-HJKMNP-Z2-9]{6}$/;

function randomCode() {
  return Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
}

// Accepts what people actually type: lowercase, spaces, a dash in the middle.
function normalizeCode(raw) {
  if (typeof raw !== 'string') return null;
  const c = raw.toUpperCase().replace(/[\s-]/g, '');
  return CODE_PATTERN.test(c) ? c : null;
}

// Unique across BOTH professionals and customers, since one link format serves everyone.
async function uniqueCode(Stylist, Customer) {
  for (let i = 0; i < 10; i++) {
    const c = randomCode();
    if (!(await Stylist.exists({ code: c })) && !(await Customer.exists({ code: c }))) return c;
  }
  throw new Error('Could not generate a unique code');
}

// Accounts created before codes existed get one the first time they're needed.
async function ensureCode(doc, Stylist, Customer) {
  if (doc.code) return doc.code;
  doc.code = await uniqueCode(Stylist, Customer);
  await doc.save();
  return doc.code;
}

module.exports = { randomCode, normalizeCode, uniqueCode, ensureCode, ALPHABET, CODE_PATTERN };
