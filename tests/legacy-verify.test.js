// Restored from the earlier test suites (sessions of 25–27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path');
const B = path.join(__dirname, '..');
const jwt = require(path.join(B, 'node_modules/jsonwebtoken'));
const express = require(path.join(B, 'node_modules/express'));
const Stylist = require(path.join(B, 'models/Stylist'));
const AdminAction = require(path.join(B, 'models/AdminAction'));
const Notification = require(path.join(B, 'models/Notification'));

// ---- stand-in database ----
function doc(f) { return { ...f, _id: { toString: () => f.id }, save: async function () { return this; },
  toObject() { const { save, toObject, ...rest } = this; return { ...rest }; } }; }
let db = {};
const adminLog = [], notes = [];
AdminAction.create = async (a) => { adminLog.push(a); return a; };
Notification.create = async (n) => { notes.push(n); return n; };
Stylist.findById = async (id) => { if (id === 'bad!id') { const e = new Error('Cast to ObjectId failed'); e.name = 'CastError'; throw e; } return db[id] || null; };
Stylist.find = (filter = {}) => {
  let r = Object.values(db);
  if (filter.pendingReview) r = r.filter((s) => s.pendingReview);
  if (filter.ghanaCardNum) r = r.filter((s) => s.ghanaCardNum);
  if (filter.isAdmin) r = r.filter((s) => s.isAdmin);
  const p = Promise.resolve(r); p.sort = () => Promise.resolve(r); return p;
};

const app = express(); app.use(express.json({ limit: '10mb' }));
app.use('/api/stylists', require(path.join(B, 'routes/stylists')));
app.use('/api/admin', require(path.join(B, 'routes/admin')));

const ADMIN = jwt.sign({ id: 'admin1', isAdmin: true }, 't');
const STYL = jwt.sign({ id: 'st1' }, 't');
const CUST = jwt.sign({ id: 'c1', role: 'customer' }, 't');
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

let pass = 0, fail = 0;
function check(label, cond, extra = '') { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (cond ? '' : '  ' + extra)); }

const server = app.listen(8191, async () => {
  async function call(method, url, token, body) {
    const r = await fetch('http://localhost:8191' + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j };
  }
  function reset() {
    db = {
      admin1: doc({ id: 'admin1', name: 'Christopher', isAdmin: true, status: 'APPROVED', accountStatus: 'ACTIVE' }),
      st1: doc({ id: 'st1', name: 'Etornam', salonName: 'Etornam Braids', status: 'APPROVED', accountStatus: 'ACTIVE', verified: false, pendingReview: false, passwordHash: 'x' }),
    };
  }

  console.log('--- privacy: public pages never expose ID details ---');
  reset(); Object.assign(db.st1, { legalFullName: 'Etornam Akosua Viome', ghanaCardNum: 'GHA-123456789-0', verifyPhoto: PHOTO, verificationRejectedReason: 'x' });
  let r = await call('GET', '/api/stylists');
  const pub = r.j.find((s) => s.name === 'Etornam');
  check('public list hides legal name', pub && pub.legalFullName === undefined);
  check('public list hides card number', pub && pub.ghanaCardNum === undefined);
  check('public list hides card photo', pub && pub.verifyPhoto === undefined);
  check('public list hides rejection reason', pub && pub.verificationRejectedReason === undefined);
  check('public list hides password hash', pub && pub.passwordHash === undefined);
  r = await call('GET', '/api/stylists', ADMIN);
  check('admin CAN see legal name', r.j.find((s) => s.name === 'Etornam').legalFullName === 'Etornam Akosua Viome');

  console.log('--- stylist submission ---');
  reset();
  r = await call('POST', '/api/stylists/me/verify', null, {});
  check('not logged in → 401', r.s === 401);
  r = await call('POST', '/api/stylists/me/verify', STYL, { legalFullName: 'Etornam Akosua Viome', ghanaCardNum: '0544377501', verifyPhoto: PHOTO });
  check('phone number as card → rejected', r.s === 400, JSON.stringify(r));
  r = await call('POST', '/api/stylists/me/verify', STYL, { legalFullName: 'Etornam', ghanaCardNum: 'GHA-123456789-0', verifyPhoto: PHOTO });
  check('single name → rejected', r.s === 400);
  r = await call('POST', '/api/stylists/me/verify', STYL, { legalFullName: 'Etornam Akosua Viome', ghanaCardNum: 'GHA-123456789-0' });
  check('no photo on file → rejected', r.s === 400);
  r = await call('POST', '/api/stylists/me/verify', STYL, { legalFullName: 'Etornam Akosua Viome', ghanaCardNum: 'GHA-123456789-0', verifyPhoto: 'https://evil.example/x.jpg' });
  check('non-image photo → rejected', r.s === 400);
  r = await call('POST', '/api/stylists/me/verify', STYL, { legalFullName: '  etornam   Akosua Viome ', ghanaCardNum: ' gha 1234567890 ', verifyPhoto: PHOTO });
  check('valid submission → accepted', r.s === 200, JSON.stringify(r.j));
  check('card number stored normalized', db.st1.ghanaCardNum === 'GHA-123456789-0', db.st1.ghanaCardNum);
  check('legal name stored cleaned', db.st1.legalFullName === 'etornam Akosua Viome', db.st1.legalFullName);
  check('marked pending review', db.st1.pendingReview === true);
  check('admins notified with correct type', notes.some((n) => n.type === 'VERIFICATION_SUBMITTED'));
  r = await call('POST', '/api/stylists/me/verify', STYL, { legalFullName: 'Etornam Akosua Viome', ghanaCardNum: 'GHA-123456789-0' });
  check('resubmit keeps existing photo', r.s === 200 && db.st1.verifyPhoto === PHOTO);

  console.log('--- admin authorization ---');
  r = await call('POST', '/api/stylists/st1/approve', STYL);
  check('stylist cannot approve (403)', r.s === 403);
  r = await call('POST', '/api/stylists/st1/approve', CUST);
  check('customer cannot approve (403)', r.s === 403);
  r = await call('POST', '/api/stylists/st1/reject-verification', STYL, { reason: 'nope nope' });
  check('stylist cannot reject (403)', r.s === 403);
  r = await call('GET', '/api/admin/verifications', STYL);
  check('stylist cannot see queue (403)', r.s === 403);
  r = await call('GET', '/api/admin/verifications');
  check('anonymous cannot see queue (401)', r.s === 401);

  console.log('--- admin review queue signals ---');
  db.st2 = doc({ id: 'st2', name: 'Kofi', salonName: 'Kofi Cuts', ghanaCardNum: 'gha-123456789-0', verified: true, pendingReview: false });
  r = await call('GET', '/api/admin/verifications', ADMIN);
  const item = r.j[0] || {};
  check('queue lists the pending submission', r.s === 200 && item.name === 'Etornam');
  check('name check: MATCH (Etornam in legal name)', item.nameCheck === 'MATCH', item.nameCheck);
  check('DUPLICATE CARD flagged (same number, other account)', item.duplicateAccounts && item.duplicateAccounts.length === 1 && item.duplicateAccounts[0].name === 'Kofi', JSON.stringify(item.duplicateAccounts));

  console.log('--- admin decisions ---');
  r = await call('POST', '/api/stylists/bad!id/approve', ADMIN);
  check('malformed id → clean 404, no crash', r.s === 404);
  r = await call('POST', '/api/stylists/st1/reject-verification', ADMIN, { reason: 'no' });
  check('reject without a real reason → 400', r.s === 400);
  r = await call('POST', '/api/stylists/st1/reject-verification', ADMIN, { reason: 'Name does not match the card' });
  check('reject with reason → 200', r.s === 200);
  check('rejection stored + no longer pending', db.st1.verificationRejectedReason === 'Name does not match the card' && db.st1.pendingReview === false);
  check('rejection in audit log WITH reason', adminLog.some((a) => a.action === 'VERIFICATION_REJECTED' && a.reason === 'Name does not match the card'));
  check('stylist notified of rejection', notes.some((n) => n.type === 'VERIFICATION_REJECTED' && n.recipientId === 'st1'));
  r = await call('POST', '/api/stylists/st1/approve', ADMIN);
  check('cannot approve when nothing is pending', r.s === 400);
  await call('POST', '/api/stylists/me/verify', STYL, { legalFullName: 'Etornam Akosua Viome', ghanaCardNum: 'GHA-123456789-0' });
  check('resubmission clears old rejection', db.st1.verificationRejectedReason === null && db.st1.pendingReview === true);
  db.st1.legalFullName = null; // simulate an old-style submission
  r = await call('POST', '/api/stylists/st1/approve', ADMIN);
  check('old submission without legal name CANNOT be approved', r.s === 400);
  db.st1.legalFullName = 'Etornam Akosua Viome';
  r = await call('POST', '/api/stylists/st1/approve', ADMIN);
  check('complete submission → approved', r.s === 200 && db.st1.verified === true && db.st1.pendingReview === false);
  check('approval in audit log', adminLog.some((a) => a.action === 'VERIFICATION_APPROVED'));
  check('stylist notified of approval', notes.some((n) => n.type === 'VERIFICATION_APPROVED'));
  r = await call('POST', '/api/stylists/me/verify', STYL, { legalFullName: 'Someone Else Entirely', ghanaCardNum: 'GHA-999999999-9', verifyPhoto: PHOTO });
  check('VERIFIED account cannot swap its ID details', r.s === 400 && db.st1.ghanaCardNum === 'GHA-123456789-0');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); process.exit(fail ? 1 : 0);
});
