const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.stylistId = payload.id;
    req.isAdmin = !!payload.isAdmin;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired — please log in again.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: 'Admins only.' });
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

module.exports = { requireAuth, requireAdmin, requireCustomerAuth };
