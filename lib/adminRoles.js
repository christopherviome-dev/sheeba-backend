// Admin team roles: who may do what. The super admin can do everything,
// including managing the admin team; everyone else only their own area.
// Roles are ALWAYS checked in the database at the moment of each action (never
// trusted from a login token), so removing someone's role takes effect on their
// very next click.
const jwt = require('jsonwebtoken');

const ROLES = {
  SUPER_ADMIN: { label: 'Super admin', perms: ['*'] },
  VERIFIER: { label: 'Verifier', perms: ['shops', 'ids', 'services'] },
  MODERATOR: { label: 'Moderator', perms: ['reports', 'restrict', 'conversations', 'telegram'] },
  SUPPORT: { label: 'Support', perms: ['passwords'] },
  ANALYST: { label: 'Analyst', perms: ['analytics'] },
  FIELD_AGENT: { label: 'Field agent', perms: ['field'] }, // goes out signing shops up in person
};

// An account's admin role right now (null if none, or if the account itself is restricted).
function roleOf(s) {
  if (!s || (s.accountStatus || 'ACTIVE') !== 'ACTIVE') return null;
  if (s.adminRole && ROLES[s.adminRole]) return s.adminRole;
  if (s.isAdmin) return 'SUPER_ADMIN'; // accounts that were admins before roles existed
  return null;
}
const can = (role, perm) => !!role && !!ROLES[role] && (ROLES[role].perms.includes('*') || ROLES[role].perms.includes(perm));

async function roleById(id) {
  if (!id) return null;
  const Stylist = require('../models/Stylist');
  try { return roleOf(await Stylist.findById(id, 'adminRole isAdmin accountStatus')); } catch (e) { return null; }
}

// The role of whoever sent this request (checked in the database), or null.
// For routes that anyone can call but where admins see more.
async function requestRole(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  try {
    const p = jwt.verify(h.slice(7), process.env.JWT_SECRET);
    if (p.role === 'customer') return null;
    return roleById(p.id);
  } catch (e) { return null; }
}

// Which permission handles each kind of admin notification.
// (Anything not listed goes to super admins only.)
const NOTIFY_PERM = {
  REPORT_FILED: 'reports', VERIFICATION_SUBMITTED: 'ids', SHOP_UNDER_REVIEW: 'shops',
  PASSWORD_RESET_REQUESTED: 'passwords', SERVICE_PROPOSED: 'services', COMMUNITY_FEEDBACK: 'telegram',
};

module.exports = { ROLES, roleOf, can, roleById, requestRole, NOTIFY_PERM };
