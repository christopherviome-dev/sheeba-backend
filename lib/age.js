// The age rule, when the admin has switched it on (lib/settings.js):
//  - customers and independent professionals: 18 or older (one checkbox)
//  - apprentices: from 15, as Ghana's Children's Act, 1998 (Act 560) s.98
//    allows; 15-17 year olds add a parent or guardian's name, phone and consent
//    (the Act has the parent, guardian or relative enter the apprenticeship
//    agreement). Kept deliberately simple: self-declared, no date of birth.
const { toE164 } = require('./passwords');

function checkAge(body, { apprentice, country }) {
  if (!apprentice) {
    if (body.ageConfirmed !== true) return { ok: false, error: 'Please confirm you are 18 or older.' };
    return { ok: true, value: { ageConfirmedAt: Date.now() } };
  }
  if (body.apprenticeAge === 'ADULT') return { ok: true, value: { ageConfirmedAt: Date.now(), isMinor: false } };
  if (body.apprenticeAge !== 'MINOR') return { ok: false, error: 'Please tell us your age group.' };
  const guardianName = typeof body.guardianName === 'string' ? body.guardianName.replace(/\s+/g, ' ').trim() : '';
  if (guardianName.length < 2 || guardianName.length > 60) return { ok: false, error: 'Enter your parent or guardian\u2019s name.' };
  const phone = toE164(body.guardianPhone, country);
  if (!phone.ok) return { ok: false, error: 'Enter your parent or guardian\u2019s phone number.' };
  if (body.guardianConsent !== true) return { ok: false, error: 'Your parent or guardian needs to agree to you joining.' };
  return { ok: true, value: { ageConfirmedAt: Date.now(), isMinor: true, guardianName, guardianPhone: phone.value, guardianConsentAt: Date.now() } };
}
module.exports = { checkAge };
