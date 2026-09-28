// Apprentice work progress: posting, review, sign-off, the shop gallery (27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), TrainingPlan = R('models/TrainingPlan'), TrainingWork = R('models/TrainingWork'), Notification = R('models/Notification');
const notes = []; let seq = 0;
const doc = (f) => ({ ...f, _id: { toString: () => f.id, toJSON: () => f.id }, save: async function () { return this; }, markModified() {} });
const S = {
  boss: doc({ id: 'boss', name: 'Etornam', role: 'PROFESSIONAL' }), other: doc({ id: 'other', name: 'Kofi', role: 'PROFESSIONAL' }),
  abena: doc({ id: 'abena', name: 'Abena Owusu', role: 'APPRENTICE', supervisorId: 'boss', supervisorStatus: 'APPROVED', isMinor: false }),
  esi: doc({ id: 'esi', name: 'Esi', role: 'APPRENTICE', supervisorId: 'boss', supervisorStatus: 'APPROVED', isMinor: true }),
  waiting: doc({ id: 'waiting', name: 'W', role: 'APPRENTICE', supervisorId: 'boss', supervisorStatus: 'PENDING' }),
};
const PLANS = { abena: doc({ id: 'p1', apprenticeId: 'abena', supervisorId: 'boss', skills: [{ id: 'k1', name: 'Knotless braids', status: 'PRACTISING' }], feedback: [] }),
  esi: doc({ id: 'p2', apprenticeId: 'esi', supervisorId: 'boss', skills: [], feedback: [] }) };
const W = {};
Stylist.findById = async (id) => { if (String(id).includes('!')) throw new Error('Cast'); return S[String(id)] || null; };
Stylist.find = async () => [];
TrainingPlan.findOne = async (f) => PLANS[f.apprenticeId] || null;
TrainingPlan.create = async (f) => { PLANS[f.apprenticeId] = doc({ id: 'p' + (++seq), skills: [], feedback: [], ...f }); return PLANS[f.apprenticeId]; };
TrainingWork.find = async (f) => Object.values(W).filter((w) => Object.entries(f).every(([k, v]) => w[k] === v));
TrainingWork.create = async (f) => { const id = 'w' + (++seq); W[id] = doc({ id, status: 'PENDING', showOnShop: false, createdAt: Date.now() + seq, decidedAt: null, ...f }); return W[id]; };
TrainingWork.findById = async (id) => { if (String(id).includes('!')) throw new Error('Cast'); return W[String(id)] || null; };
TrainingWork.deleteOne = async (f) => { delete W[String(f._id)]; };
Notification.create = async (n) => { notes.push(n); return n; };
const app = express(); app.use(express.json({ limit: '3mb' })); app.use('/api/training', R('routes/training'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (id) => jwt.sign({ id }, 't');
const img = (kb) => 'data:image/jpeg;base64,' + 'A'.repeat(kb * 1024);
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const server = app.listen(8231, async () => {
  const call = async (m, u, t, body) => { const r = await fetch('http://localhost:8231' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  console.log('--- POSTING WORK ---');
  let r = await call('POST', '/api/training/me/works', T('waiting'), { photo: img(50) });
  check('an unconfirmed apprentice cannot post', r.s === 404);
  r = await call('POST', '/api/training/me/works', T('boss'), { photo: img(50) });
  check('a normal professional has nothing to post here', r.s === 404);
  r = await call('POST', '/api/training/me/works', T('abena'), { photo: 'https://tracker.example/x.jpg' });
  check('TRACKING: a web-address photo is refused', r.s === 400);
  r = await call('POST', '/api/training/me/works', T('abena'), { caption: 'no photo' });
  check('a post needs a photo', r.s === 400);
  r = await call('POST', '/api/training/me/works', T('abena'), { photo: img(50), skillId: 'nope' });
  check('linking a skill not in her training is refused', r.s === 400);
  r = await call('POST', '/api/training/me/works', T('abena'), { photo: img(150), thumb: img(30), caption: '  My first knotless!  ', skillId: 'k1' });
  const w1 = r.j._id;
  check('posted: waiting for review, linked to the skill, tidied caption', r.s === 200 && r.j.status === 'PENDING' && r.j.skillName === 'Knotless braids' && r.j.caption === 'My first knotless!');
  check('her supervisor is told', notes.some((n) => n.recipientId === 'boss' && /posted work/.test(n.title)));
  for (let i = 0; i < 9; i++) await call('POST', '/api/training/me/works', T('abena'), { photo: img(20) });
  r = await call('POST', '/api/training/me/works', T('abena'), { photo: img(20) });
  check('at most 10 waiting at a time', r.s === 400 && /10 photos waiting/.test(r.j.error));
  console.log('--- REVIEWING ---');
  r = await call('GET', '/api/training/apprentices/abena/works', T('other'));
  check("another professional cannot see Abena's work", r.s === 404);
  r = await call('GET', '/api/training/apprentices/abena/works', T('boss'));
  check('her supervisor sees all 10, waiting ones first', r.s === 200 && r.j.length === 10 && r.j[0].status === 'PENDING');
  const second = r.j.find((x) => x._id !== w1)._id;
  r = await call('POST', `/api/training/apprentices/abena/works/${second}/decision`, T('boss'), { decision: 'send_back' });
  check('sending back needs a comment', r.s === 400);
  r = await call('POST', `/api/training/apprentices/abena/works/${second}/decision`, T('boss'), { decision: 'send_back', comment: 'Parting is uneven: try again.' });
  check('sent back with a comment; she is told', r.s === 200 && W[second].status === 'SENT_BACK' && notes.some((n) => n.recipientId === 'abena' && /sent your work back/.test(n.title)));
  r = await call('POST', `/api/training/apprentices/abena/works/${w1}/decision`, T('boss'), { decision: 'approve', signOffSkill: true, showOnShop: true, comment: 'Lovely work.' });
  check('approved: skill signed off, shown on the shop page', r.s === 200 && W[w1].status === 'APPROVED' && W[w1].showOnShop === true && r.j.signedOff === 'Knotless braids' && PLANS.abena.skills[0].status === 'SIGNED_OFF');
  check('she is told, including the sign-off', notes.some((n) => n.recipientId === 'abena' && /approved and Knotless braids signed off/.test(n.title)));
  console.log('--- UNDER-18s ---');
  r = await call('POST', '/api/training/me/works', T('esi'), { photo: img(60), thumb: img(20), caption: 'Cornrows practice' });
  const we = r.j._id;
  r = await call('POST', `/api/training/apprentices/esi/works/${we}/decision`, T('boss'), { decision: 'approve', showOnShop: true });
  check("an under-18 apprentice's work is approved but NEVER shown publicly", r.s === 200 && W[we].status === 'APPROVED' && W[we].showOnShop === false && r.j.showOnShop === false);
  console.log('--- THE SHOP PAGE ---');
  r = await call('GET', '/api/training/shop/boss/works');
  check('public: only the approved work chosen for the shop page', r.s === 200 && r.j.length === 1 && r.j[0]._id === w1);
  check('first name only, small thumbnail, no full photo', r.j[0].apprentice === 'Abena' && r.j[0].thumb.length === img(30).length && !('photo' in r.j[0]));
  S.abena.supervisorStatus = 'DECLINED';
  r = await call('GET', '/api/training/shop/boss/works');
  check("if she's no longer with the shop, her work comes off its page", r.j.length === 0);
  S.abena.supervisorStatus = 'APPROVED';
  console.log('--- OWN POSTS ONLY ---');
  r = await call('DELETE', `/api/training/me/works/${w1}`, T('esi'));
  check("another apprentice cannot delete Abena's post", r.s === 404 && W[w1]);
  r = await call('DELETE', `/api/training/me/works/${w1}`, T('abena'));
  check('Abena can delete her own post', r.s === 200 && !W[w1]);
  r = await call('DELETE', '/api/training/me/works/bad!id', T('abena'));
  check('bad id → clean 404', r.s === 404);
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
});
