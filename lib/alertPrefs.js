// What rings a person's phone: they choose by group (nothing rings until they
// turn alerts on). The in-app list always keeps everything.
const GROUPS = {
  bookings: ['REQUEST_CREATED', 'REQUEST_ACCEPTED', 'REQUEST_DECLINED', 'SERVICE_COMPLETED', 'CUSTOMER_CHECKED_IN', 'SERVICE_DUE_SOON', 'SERVICE_OVERDUE'],
  messages: ['NEW_MESSAGE'],
  looks: ['FRESH_LOOK', 'RATING_RECEIVED'],
  team: ['APPRENTICE_REQUEST', 'APPRENTICE_APPROVED', 'APPRENTICE_DECLINED', 'STAFF_ACCESS_GRANTED', 'TRAINING_UPDATE', 'APPRENTICE_GRADUATED'],
  rewards: ['INVITE_JOINED', 'INVITE_REWARD_EARNED', 'INVITE_REWARD_PAID'],
  account: ['SHOP_APPROVED', 'VERIFICATION_APPROVED', 'VERIFICATION_REJECTED', 'ACCOUNT_RESTRICTED', 'ACCOUNT_RESTORED', 'SERVICE_APPROVED', 'SERVICE_REJECTED', 'PAYMENT_SUCCESSFUL', 'PAYMENT_FAILED', 'REFUND_SUCCESSFUL', 'ADMIN_ROLE'],
  admin: ['SHOP_UNDER_REVIEW', 'REPORT_FILED', 'COMMUNITY_FEEDBACK', 'VERIFICATION_SUBMITTED', 'PASSWORD_RESET_REQUESTED', 'MEMBER_MILESTONE', 'SERVICE_PROPOSED'],
};
const GROUP_OF = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, types]) => types.map((t) => [t, g])));
// Starting choice when someone turns alerts on (they can change it any time).
const DEFAULTS = { bookings: true, messages: true, looks: false, team: false, rewards: false, account: true, admin: false };

const prefsOf = (saved) => ({ ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) });
function cleanPrefs(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of Object.keys(DEFAULTS)) if (typeof input[k] === 'boolean') out[k] = input[k];
  return out;
}
// Unknown types ring (safer than silently dropping something new).
const rings = (saved, type) => { const g = GROUP_OF[type]; return g ? prefsOf(saved)[g] !== false : true; };

module.exports = { GROUPS, GROUP_OF, DEFAULTS, prefsOf, cleanPrefs, rings };
