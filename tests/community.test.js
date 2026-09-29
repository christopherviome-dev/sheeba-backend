// Community feedback from Telegram reaches the admin (29 Sep audit fix).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
{ const Setting = R('models/Setting'); Setting.findById = async () => null; }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), CommunityFeedback = R('models/CommunityFeedback'), Notification = R('models/Notification');
const doc = (f) => ({ ...f, _id: { toString: () => f.id } });
const S = { chris: doc({ id: 'chris', isAdmin: true, accountStatus: 'ACTIVE' }), mo: doc({ id: 'mo', adminRole: 'MODERATOR', accountStatus: 'ACTIVE' }), sue: doc({ id: 'sue', adminRole: 'SUPPORT', accountStatus: 'ACTIVE' }) };
const FB = { f1: { _id: 'f1', senderName: 'Ama', text: 'Can you add pedicure in Ho?', handled: false } }, notes = [];
Stylist.findById = async (id) => S[String(id)] || null;
Stylist.find = async (f) => Object.values(S).filter((s) => (f.$or || []).some((x) => (x.isAdmin && s.isAdmin) || (x.adminRole && s.adminRole)));
CommunityFeedback.find = () => ({ sort: () => ({ limit: async () => Object.values(FB) }) });
CommunityFeedback.findByIdAndUpdate = async (id, u) => { if (String(id).includes('!')) throw new Error('Cast'); const f = FB[id]; if (f) Object.assign(f, u); return f || null; };
Notification.create = async (n) => { notes.push(n); return n; };
const app = express(); app.use(express.json()); app.use('/api/telegram', R('routes/telegram'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const server = app.listen(0, async () => {
  const port = server.address().port;
  const call = async (m, u, who) => { const r = await fetch(`http://localhost:${port}${u}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt.sign({ id: who }, 't') } }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  check('a Moderator can read community feedback', (await call('GET', '/api/telegram/feedback', 'mo')).s === 200);
  check('Support cannot', (await call('GET', '/api/telegram/feedback', 'sue')).s === 403);
  let r = await call('PUT', '/api/telegram/feedback/f1/handled', 'mo');
  check('a Moderator marks it handled', r.s === 200 && FB.f1.handled === true);
  check('a bad link gets a clean 404 (no crash)', (await call('PUT', '/api/telegram/feedback/bad!id/handled', 'mo')).s === 404);
  const { notifyAllAdmins } = R('routes/notifications');
  await notifyAllAdmins({ type: 'COMMUNITY_FEEDBACK', title: 'Community: Ama', entityType: 'admin' });
  check('new community feedback alerts Christopher and the Moderator (not Support)', notes.map((n) => n.recipientId).sort().join() === 'chris,mo', notes.map((n) => n.recipientId).join());
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
});
