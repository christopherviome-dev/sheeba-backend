const crypto = require('crypto');

// Easy-to-read characters only (no 0/O or 1/l/I), since temporary
// passwords get read aloud over the phone.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

// e.g. "Sheeba-k7mp-3xqa". crypto.randomInt avoids the slight bias that
// "random byte % alphabet length" would introduce.
function generateTempPassword() {
  const pick = (n) => Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return `Sheeba-${pick(4)}-${pick(4)}`;
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

// The same Ghana number can be written several ways: 0544377501,
// 054 437 7501, 233544377501, +233 54 437 7501. Accounts are stored the way
// they were typed at registration, so lookups try every normal variant.
function phoneCandidates(raw) {
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  const set = new Set([trimmed, digits]);
  if (digits.length === 12 && digits.startsWith('233')) { set.add('0' + digits.slice(3)); set.add('+' + digits); }
  if (digits.length === 10 && digits.startsWith('0')) { set.add('233' + digits.slice(1)); set.add('+233' + digits.slice(1)); }
  return [...set].filter((p) => p.length >= 6);
}

module.exports = { generateTempPassword, checkNewPassword, phoneCandidates };
