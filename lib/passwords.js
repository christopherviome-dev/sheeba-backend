const crypto = require('crypto');

// Easy-to-read characters only (no 0/O or 1/l/I), since temporary
// passwords get read aloud over the phone.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

// e.g. "Mepluge-k7mp-3xqa". crypto.randomInt avoids the slight bias that
// "random byte % alphabet length" would introduce.
function generateTempPassword() {
  const pick = (n) => Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return `Mepluge-${pick(4)}-${pick(4)}`;
}

const TOO_COMMON = new Set(['12345678', '123456789', '1234567890', 'password', 'password1', 'sheeba123', '11111111', '00000000', 'qwertyui']);

// Returns an error message, or null if the new password is acceptable.
function checkNewPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use at least 8 characters.';
  // bcrypt only uses the first 72 bytes; anything longer would be silently cut.
  if (Buffer.byteLength(pw, 'utf8') > 72) return 'That password is too long. Please use fewer than 72 characters.';
  if (TOO_COMMON.has(pw.toLowerCase())) return 'That password is too easy to guess. Please choose another.';
  return null;
}

// The same number can be written several ways: 0544377501, 054 437 7501,
// 233544377501, +233 54 437 7501 (Ghana) or 07700 900123, +44 7700 900123
// (UK). Accounts are stored the way they were typed at registration, so
// lookups try every normal variant for every supported country.
function phoneCandidates(raw) {
  if (typeof raw !== 'string') return [];
  const { COUNTRIES } = require('./countries');
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  const set = new Set([trimmed, digits, trimmed.replace(/[\s\-().]/g, '')]);
  for (const c of Object.values(COUNTRIES)) {
    const intl = c.dial.length + c.nsnLength;
    if (digits.length === intl && digits.startsWith(c.dial)) {
      const nsn = digits.slice(c.dial.length);
      set.add(c.trunk + nsn); set.add('+' + digits); set.add(nsn);
    }
    if (digits.length === c.nsnLength + c.trunk.length && digits.startsWith(c.trunk)) {
      const nsn = digits.slice(c.trunk.length);
      set.add(c.dial + nsn); set.add('+' + c.dial + nsn);
    }
  }
  return [...set].filter((p) => p.length >= 6);
}

// How phone numbers are STORED: no spaces, dashes, dots or brackets, keeping
// a leading + if typed. Every lookup variant above is in this same form, so a
// number saved as "07700 900123" can still be found from "+44 7700 900123".
function canonicalPhone(raw) {
  return String(raw || '').trim().replace(/[\s\-().]/g, '');
}

// Turns what someone typed, plus their chosen country, into one international
// form: "+" + country code + number, the way WhatsApp and Instagram store numbers.
// Accepts "024 123 4567" (Ghana), "07700 900123" (UK), "+44 7700 900123",
// "0044 7700 900123". Countries with a known length get an exact check.
function toE164(raw, countryCode) {
  const { getCountry } = require('./countries');
  const typed = String(raw || '').trim();
  const digits = typed.replace(/\D/g, '');
  if (!digits) return { ok: false, error: 'Enter your phone number.' };
  const c = getCountry(countryCode);
  let full;
  if (typed.startsWith('+')) full = digits;
  else if (digits.startsWith('00')) full = digits.slice(2);
  else if (!c) return { ok: false, error: 'Choose your country first.' };
  else if (!digits.startsWith('0') && digits.startsWith(c.dial) && digits.length > c.dial.length + 6) full = digits; // typed with the country code but no "+"
  else full = c.dial + (digits.startsWith('0') ? digits.slice(1) : digits); // most countries drop the leading 0 internationally
  if (full.length < 8 || full.length > 15) return { ok: false, error: 'That phone number looks too short or too long.' };
  if (c && c.nsnLength && full.startsWith(c.dial) && full.length !== c.dial.length + c.nsnLength) {
    return { ok: false, error: `A ${c.name} number has ${c.nsnLength} digits after the first 0.` };
  }
  return { ok: true, value: '+' + full };
}

module.exports = { generateTempPassword, checkNewPassword, phoneCandidates, canonicalPhone, toE164 };
