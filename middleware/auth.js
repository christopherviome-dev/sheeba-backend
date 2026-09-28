const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // requireAuth guards professional/admin routes only. A customer token is
    // a valid login, but not for these routes, so it must never pass here
    // (e.g. a customer "claiming" a professional's booking).
    if (payload.role === 'customer') return res.status(403).json({ error: 'This action is for professional accounts.' });
    req.stylistId = payload.id;
    req.isAdmin = false; // admin rights are checked in the database, never taken from the token
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired — please log in again.' });
  }
}

// Admin checks read the account's role from the DATABASE on every request
// (never from the login token), so a removed admin loses access immediately.
function requirePermission(perm) {
  return async (req, res, next) => {
    const { roleById, can } = require('../lib/adminRoles');
    const role = await roleById(req.stylistId);
    if (!can(role, perm)) return res.status(403).json({ error: role ? 'Your admin role doesn\u2019t include this.' : 'Admins only.' });
    req.adminRole = role;
    req.isAdmin = true;
    next();
  };
}
// Any admin role at all.
async function requireAdmin(req, res, next) {
  const { roleById } = require('../lib/adminRoles');
  const role = await roleById(req.stylistId);
  if (!role) return res.status(403).json({ error: 'Admins only.' });
  req.adminRole = role;
  req.isAdmin = true;
  next();
}

// Separate from requireAuth on purpose: a customer token and a stylist token
// must never be interchangeable, so this checks for an explicit role claim.
// Existing stylist tokens (issued before this existed) have no role field
// at all, so they simply fail this check rather than being misread as a
// customer — no ambiguity, no backward-compat risk to the stylist side.
function requireCustomerAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'customer') return res.status(401).json({ error: 'Not a customer session.' });
    req.customerId = payload.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired — please log in again.' });
  }
}

module.exports = { requireAuth, requireAdmin, requirePermission, requireCustomerAuth };
