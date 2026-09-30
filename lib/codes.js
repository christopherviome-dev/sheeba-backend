const crypto = require('crypto');

// Mepluge codes: one per account, for life (a trainee who becomes a
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
// Friendly codes: first name + member number, e.g. AKUA0042 (lib/members.js).
const FRIENDLY_PATTERN = /^[A-Z]{2,8}\d{4,7}$/;
function normalizeCode(raw) {
  if (typeof raw !== 'string') return null;
  const c = raw.toUpperCase().replace(/[\s-]/g, '');
  return CODE_PATTERN.test(c) || FRIENDLY_PATTERN.test(c) ? c : null;
}

// Finds an account by its current code OR any older code, so links and QR
// codes shared before codes became friendly still work.
const codeQuery = (c) => ({ $or: [{ code: c }, { legacyCodes: c }] });

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
  if (doc.code && doc.memberNumber) {
    // Tidy: an account's CURRENT code never belongs in its list of old codes.
    if ((doc.legacyCodes || []).includes(doc.code)) {
      doc.legacyCodes = doc.legacyCodes.filter((c) => c !== doc.code);
      await doc.save();
    }
    return doc.code;
  }
  const { nextMemberNumber, friendlyCode } = require('./members');
  if (!doc.memberNumber) doc.memberNumber = await nextMemberNumber({ Stylist, Customer });
  const next = friendlyCode(doc.name, doc.memberNumber);
  if (doc.code && doc.code !== next) doc.legacyCodes = [...new Set([...(doc.legacyCodes || []), doc.code])];
  doc.legacyCodes = (doc.legacyCodes || []).filter((c) => c !== next);
  doc.code = next;
  await doc.save();
  return doc.code;
}

module.exports = { randomCode, normalizeCode, uniqueCode, ensureCode, codeQuery, ALPHABET, CODE_PATTERN, FRIENDLY_PATTERN };
