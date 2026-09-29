// Shop team and the chair card: helpers serve customers without being able to take them (28 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
// Admin switches: a stand-in returning nothing, so every switch uses its safe default (instant, no database).
{ const Setting = require(path.join(B, 'models/Setting')); Setting.findById = async () => null; }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), Customer = R('models/Customer'), Request = R('models/Request'), CustomerNote = R('models/CustomerNote');
const StyleRecord = R('models/StyleRecord'), TeamAccessLog = R('models/TeamAccessLog'), Activity = R('models/Activity'), Notification = R('models/Notification'), Conversation = R('models/Conversation'), Message = R('models/Message');
const HOUR = 3600000, now = Date.now();
const doc = (f) => ({ ...f, _id: { toString: () => f.id, toJSON: () => f.id }, save: async function () { return this; }, markModified() {}, toObject() { const { toObject, save, markModified, ...r } = this; return JSON.parse(JSON.stringify(r)); } });
const S = {
  boss: doc({ id: 'boss', name: 'Kwame', salonName: 'Gentlemans look', status: 'APPROVED', accountStatus: 'ACTIVE', staffAccess: [{ stylistId: 'boy', addedAt: 1 }, { stylistId: 'kid', addedAt: 2, canManageBookings: false }] }),
  boy: doc({ id: 'boy', name: 'Kofi', status: 'UNDER_REVIEW' }), kid: doc({ id: 'kid', name: 'Esi', role: 'APPRENTICE', supervisorId: 'boss' }), other: doc({ id: 'other', name: 'Outsider' }),
};
const C = { yaw: doc({ id: 'yaw', name: 'Yaw Mensah', phone: '+233241112222' }), ama: doc({ id: 'ama', name: 'Ama Owusu', phone: '+233209998877' }) };
const RQ = {
  r1: doc({ id: 'r1', stylistId: 'boss', clientId: 'yaw', clientName: 'Yaw Mensah', clientPhone: '+233241112222', emergency: 'Mum 0200000000', status: 'accepted', preferredAt: now + 2 * HOUR, serviceNameSnapshot: 'Low fade' }),
  r2: doc({ id: 'r2', stylistId: 'boss', clientId: 'ama', clientName: 'Ama Owusu', clientPhone: '+233209998877', status: 'pending', preferredAt: now + 7 * 24 * HOUR, serviceNameSnapshot: 'Cornrows' }),
  r3: doc({ id: 'r3', stylistId: 'boss', clientId: 'yaw', clientName: 'Yaw Mensah', clientPhone: '+233241112222', status: 'completed', preferredAt: now - 30 * 24 * HOUR, completedAt: now - 30 * 24 * HOUR, serviceNameSnapshot: 'Low fade', servedByName: 'Kwame' }),
  r4: doc({ id: 'r4', stylistId: 'boss', clientId: 'ama', clientName: 'Ama Owusu', clientPhone: '+233209998877', status: 'accepted', preferredAt: now + 5 * 24 * HOUR, serviceNameSnapshot: 'Beard' }),
};
const NOTES = [{ stylistId: 'boss', customerId: 'yaw', note: '1.5 guard on the sides, sensitive scalp', authorName: 'Kwame', createdAt: now - 20 * 24 * HOUR }];
const LOGS = [];
const byId = (T) => async (id) => { if (String(id).includes('!')) throw new Error('Cast'); return T[String(id)] || null; };
Stylist.findById = byId(S); Customer.findById = byId(C); Request.findById = byId(RQ);
Stylist.find = async (f) => (f && f['staffAccess.stylistId'] ? Object.values(S).filter((s) => (s.staffAccess || []).some((x) => x.stylistId === f['staffAccess.stylistId'])) : []);
Stylist.findOne = async (f) => { const s = S[String(f._id)]; return s && (s.staffAccess || []).some((x) => x.stylistId === f['staffAccess.stylistId']) ? s : null; };
Stylist.exists = async () => false;
Request.find = async (f) => Object.values(RQ).filter((r) => Object.entries(f || {}).every(([k, v]) => r[k] === v));
Request.countDocuments = async (f) => Object.values(RQ).filter((r) => Object.entries(f).every(([k, v]) => r[k] === v)).length;
Request.findOneAndUpdate = async (f, u) => { const r = RQ[String(f._id)]; if (!r || r.status !== f.status) return null; Object.assign(r, u); return r; };
CustomerNote.find = async (f) => NOTES.filter((n) => n.stylistId === f.stylistId && n.customerId === f.customerId);
CustomerNote.create = async (n) => { NOTES.push({ ...n, createdAt: Date.now() }); return n; };
StyleRecord.find = async () => [{ finishedPhoto: 'data:image/jpeg;base64,AA', notes: 'Skin fade, line-up', date: now - 30 * 24 * HOUR }];
StyleRecord.findOne = async () => null; StyleRecord.create = async (f) => f;
TeamAccessLog.create = async (l) => { LOGS.push({ ...l, at: Date.now() }); return l; };
TeamAccessLog.findOne = async (f) => LOGS.filter((l) => l.shopId === f.shopId && l.staffId === f.staffId).sort((a, b) => b.at - a.at)[0] || null;
TeamAccessLog.find = async (f) => LOGS.filter((l) => l.shopId === f.shopId);
Activity.create = async () => ({}); Notification.create = async () => ({}); Conversation.findOne = async () => null; Message.create = async () => ({});
const app = express(); app.use(express.json()); app.use('/api/requests', R('routes/requests')); app.use('/api/team', R('routes/team'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (id) => jwt.sign({ id }, 't');
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const server = app.listen(8239, async () => {
  const call = async (m, u, t, body) => { const r = await fetch('http://localhost:8239' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  console.log('--- WHAT EACH PERSON SEES IN BOOKINGS ---');
  let r = await call('GET', '/api/requests', T('boss'));
  check('the master sees full phone numbers', r.j.find((x) => x._id === 'r1').clientPhone === '+233241112222');
  r = await call('GET', '/api/requests', T('boy'));
  const b1 = r.j.find((x) => x._id === 'r1');
  check("his boy sees all the shop's bookings (he can manage them)", r.j.filter((x) => ['r1', 'r2', 'r3', 'r4'].includes(x._id)).length === 4);
  check('…but phone numbers are hidden: •••• ••22, and no emergency contact', b1.clientPhone === '•••• ••22' && b1.phoneHidden === true && !('emergency' in b1));
  r = await call('GET', '/api/requests', T('kid'));
  const kidIds = r.j.map((x) => x._id).filter((x) => x.startsWith('r')).sort().join();
  check('the young helper (no "manage bookings") sees only today\'s chair', kidIds === 'r1', kidIds);
  console.log('--- WHO CAN CHANGE BOOKINGS ---');
  r = await call('PUT', '/api/requests/r2/status', T('kid'), { status: 'accepted' });
  check('the young helper cannot accept or decline bookings', r.s === 403);
  r = await call('PUT', '/api/requests/r1/status', T('kid'), { status: 'completed' });
  check("…but CAN complete today's appointment: recorded as served by Esi", r.s === 200 && RQ.r1.status === 'completed' && RQ.r1.servedBy === 'kid' && RQ.r1.servedByName === 'Esi');
  r = await call('PUT', '/api/requests/r2/status', T('boy'), { status: 'accepted' });
  check('the boy (allowed) can accept bookings', r.s === 200 && RQ.r2.status === 'accepted');
  r = await call('PUT', '/api/requests/r4/status', T('other'), { status: 'declined' });
  check("an outsider cannot touch the shop's bookings", r.s === 403);
  console.log('--- THE CHAIR CARD ---');
  RQ.r1.status = 'accepted';
  r = await call('GET', '/api/team/chair/r1', T('boy'));
  const card = r.j;
  check("the boy opens Yaw's card on the day: first name only", r.s === 200 && card.name === 'Yaw');
  check('…phone hidden', card.phone === '•••• ••22' && card.phoneHidden === true);
  check("…he sees Yaw's past visits here, and who did them", card.visits.length >= 1 && card.visits[0].service === 'Low fade' && card.visits.some((v) => v.servedBy === 'Kwame'));
  check('…the shop\'s notes ("1.5 guard…") and Yaw\'s saved style photo', card.notes.some((n) => /1\.5 guard/.test(n.note)) && card.styles[0].photo);
  check('…and opening it was LOGGED for the master', LOGS.length === 1 && LOGS[0].staffId === 'boy' && LOGS[0].customerId === 'yaw');
  r = await call('GET', '/api/team/chair/r4', T('boy'));
  check("the boy CANNOT open a customer's card days before their visit", r.s === 403);
  r = await call('GET', '/api/team/chair/r1', T('other'));
  check('an outsider cannot open any card', r.s === 403);
  r = await call('GET', '/api/team/chair/r4', T('boss'));
  check('the master can open any of his customers, with full name and phone', r.s === 200 && r.j.name === 'Ama Owusu' && r.j.phone === '+233209998877');
  check("…and the master's own look isn't logged as a helper's", LOGS.length === 1);
  r = await call('POST', '/api/team/chair/r1/notes', T('boy'), { note: 'Used 1.5 on sides, he liked it' });
  const n = NOTES[NOTES.length - 1];
  check('a note from the boy is saved to the SHOP, marked "Kofi"', r.s === 200 && n.stylistId === 'boss' && n.authorName === 'Kofi');
  RQ.r1.status = 'completed'; // Esi's job from earlier, done
  console.log("--- THE MASTER'S TEAM VIEW ---");
  r = await call('GET', '/api/team/me', T('boss'));
  const boy = r.j.find((x) => x.id === 'boy'), kid = r.j.find((x) => x.id === 'kid');
  check('team list: Kofi (manages bookings, phones hidden) and Esi (apprentice, today only)', boy.canManageBookings === true && boy.canSeePhones === false && kid.canManageBookings === false && kid.apprentice === true);
  check('jobs served: Esi 1', kid.jobsServed === 1);
  check("Kofi's last card opening is shown", boy.lastOpenedCard > 0);
  r = await call('GET', '/api/team/me/activity', T('boss'));
  check('activity: "Kofi opened Yaw\'s card"', r.j[0].staff === 'Kofi' && r.j[0].customer === 'Yaw');
  r = await call('PUT', '/api/team/me/boy', T('other'), { canSeePhones: true });
  check("an outsider can't change the master's switches", r.s === 404);
  r = await call('PUT', '/api/team/me/boy', T('boss'), { canSeePhones: true });
  r = await call('GET', '/api/requests', T('boy'));
  check('once the master allows it, Kofi sees phone numbers', r.j.find((x) => x._id === 'r1').clientPhone === '+233241112222');
  S.boss.staffAccess = S.boss.staffAccess.filter((x) => x.stylistId !== 'boy');
  r = await call('GET', '/api/team/chair/r1', T('boy'));
  check('when Kofi leaves the shop, his access ends instantly', r.s === 403);
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
});
