// Trainee workspace: training, sign-offs, graduation (27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), TrainingPlan = R('models/TrainingPlan'), Notification = R('models/Notification');
const notes = []; let seq = 0;
const doc = (f) => ({ ...f, _id: { toString: () => f.id, toJSON: () => f.id }, save: async function () { return this; }, markModified() {} });
const S = {
  boss: doc({ id: 'boss', name: 'Etornam', salonName: 'Etornam Braids', role: 'PROFESSIONAL' }),
  other: doc({ id: 'other', name: 'Kofi', role: 'PROFESSIONAL' }),
  adm: doc({ id: 'adm', name: 'Admin', isAdmin: true, accountStatus: 'ACTIVE' }),
  abena: doc({ id: 'abena', name: 'Abena', role: 'APPRENTICE', supervisorId: 'boss', supervisorStatus: 'APPROVED', isMinor: false }),
  young: doc({ id: 'young', name: 'Esi', role: 'APPRENTICE', supervisorId: 'boss', supervisorStatus: 'APPROVED', isMinor: true }),
  waiting: doc({ id: 'waiting', name: 'Pending', role: 'APPRENTICE', supervisorId: 'boss', supervisorStatus: 'PENDING' }),
};
const PLANS = {};
Stylist.findById = async (id) => { if (String(id).includes('!')) throw new Error('Cast'); return S[String(id)] || null; };
Stylist.find = async (f) => (f && (f.isAdmin || f.$or) ? [S.adm] : Object.values(S).filter((s) => !f || !f.supervisorId || s.supervisorId === f.supervisorId));
TrainingPlan.findOne = async (f) => PLANS[f.apprenticeId] || null;
TrainingPlan.create = async (f) => { PLANS[f.apprenticeId] = doc({ id: 'tp' + (++seq), skills: [], feedback: [], startedAt: Date.now(), expectedCompletion: null, weekFocus: null, graduatedAt: null, ...f }); return PLANS[f.apprenticeId]; };
Notification.create = async (n) => { notes.push(n); return n; };
const app = express(); app.use(express.json());
app.use('/api/training', R('routes/training')); app.use('/api/stylists', R('routes/stylists'));
app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
const T = (id) => jwt.sign({ id }, 't');
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
const server = app.listen(8229, async () => {
  const call = async (m, u, t, body) => { const r = await fetch('http://localhost:8229' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  console.log('--- WHO SEES WHAT ---');
  let r = await call('GET', '/api/training/me', T('waiting'));
  check('an apprentice still waiting for confirmation has no training yet', r.s === 404);
  r = await call('GET', '/api/training/me', T('other'));
  check('a normal professional has no training page', r.s === 404);
  r = await call('GET', '/api/training/me', T('abena'));
  check('a confirmed apprentice sees her training, with her supervisor', r.s === 200 && r.j.supervisor.name === 'Etornam Braids' && r.j.progress.total === 0);
  r = await call('GET', '/api/training/apprentices/abena', T('other'));
  check("another professional cannot open Abena's training", r.s === 404);
  r = await call('GET', '/api/training/apprentices/bad!id', T('boss'));
  check('bad id → clean 404', r.s === 404);
  r = await call('GET', '/api/training/templates', T('boss'));
  check('ready-made skill lists per service', r.s === 200 && r.j.barbering.includes('Fades') && r.j.hair.includes('Knotless braids'));
  console.log('--- SUPERVISOR SETS IT UP ---');
  r = await call('POST', '/api/training/apprentices/abena/skills', T('boss'), { names: ['Cornrows', 'Box braids', 'Knotless braids', 'cornrows', 'Pricing for my shop'] });
  check('skills added (template + her own); the duplicate "cornrows" ignored', r.s === 200 && r.j.plan.skills.length === 4 && r.j.added === 4);
  r = await call('POST', '/api/training/apprentices/abena/skills', T('boss'), { names: ['x'.repeat(61)] });
  check('an over-long skill name is refused', r.s === 400);
  r = await call('POST', '/api/training/apprentices/abena/skills', T('boss'), { names: Array.from({ length: 37 }, (_, i) => 'Skill ' + i) });
  check('no more than 40 skills per plan', r.s === 400);
  r = await call('PUT', '/api/training/apprentices/abena', T('boss'), { expectedCompletion: Date.now() - 10 * 86400000 });
  check('a completion date in the past is refused', r.s === 400);
  const done = Date.now() + 90 * 86400000;
  r = await call('PUT', '/api/training/apprentices/abena', T('boss'), { expectedCompletion: done, weekFocus: '  Neat parting on knotless  ' });
  check("completion date and this week's focus saved", r.s === 200 && r.j.plan.expectedCompletion === done && r.j.plan.weekFocus === 'Neat parting on knotless');
  console.log('--- ONLY THE SUPERVISOR SIGNS OFF ---');
  const knot = PLANS.abena.skills.find((s) => s.name === 'Knotless braids'), corn = PLANS.abena.skills.find((s) => s.name === 'Cornrows');
  r = await call('PUT', `/api/training/me/skills/${knot.id}`, T('abena'), { status: 'PRACTISING' });
  check('Abena marks knotless as "practising"', r.s === 200 && knot.status === 'PRACTISING');
  r = await call('PUT', `/api/training/me/skills/${knot.id}`, T('abena'), { status: 'SIGNED_OFF' });
  check('…but she can NEVER sign it off herself', r.s === 403 && knot.status === 'PRACTISING');
  r = await call('PUT', `/api/training/apprentices/abena/skills/${corn.id}`, T('boss'), { status: 'SIGNED_OFF' });
  check('Etornam signs off cornrows: dated, and Abena is told', r.s === 200 && corn.status === 'SIGNED_OFF' && corn.signedOffAt > 0 && notes.some((n) => n.recipientId === 'abena' && /Cornrows/.test(n.title)));
  check('progress: 1 of 4 signed off = 25%', r.j.progress.signedOff === 1 && r.j.progress.percent === 25);
  r = await call('PUT', `/api/training/me/skills/${corn.id}`, T('abena'), { status: 'NOT_STARTED' });
  check('she cannot undo a skill her supervisor signed off', r.s === 400 && corn.status === 'SIGNED_OFF');
  r = await call('POST', '/api/training/apprentices/abena/feedback', T('boss'), { text: 'k' });
  check('empty-ish feedback refused', r.s === 400);
  r = await call('POST', '/api/training/apprentices/abena/feedback', T('boss'), { text: 'Great tension on your cornrows this week.' });
  check('feedback saved and Abena told', r.s === 200 && PLANS.abena.feedback.length === 1 && notes.some((n) => n.recipientId === 'abena' && n.title === 'New feedback from your supervisor'));
  const pricing = PLANS.abena.skills.find((s) => s.name === 'Pricing for my shop');
  r = await call('DELETE', `/api/training/apprentices/abena/skills/${pricing.id}`, T('boss'));
  check('supervisor can remove a skill', r.s === 200 && PLANS.abena.skills.length === 3);
  console.log('--- GRADUATION ---');
  r = await call('POST', '/api/training/apprentices/young/graduate', T('boss'));
  check('an apprentice under 18 cannot graduate yet', r.s === 400 && /18/.test(r.j.error) && S.young.role === 'APPRENTICE');
  r = await call('POST', '/api/training/apprentices/abena/graduate', T('other'));
  check('only her own supervisor can graduate her', r.s === 404 && S.abena.role === 'APPRENTICE');
  r = await call('POST', '/api/training/apprentices/abena/graduate', T('boss'));
  check('graduated: now a professional, same account (code and history kept)', r.s === 200 && S.abena.role === 'PROFESSIONAL' && S.abena.supervisorStatus === 'GRADUATED' && S.abena.graduatedAt > 0);
  check('she is congratulated, and the admin is told', notes.some((n) => n.recipientId === 'abena' && n.type === 'APPRENTICE_GRADUATED') && notes.some((n) => n.recipientId === 'adm' && n.type === 'APPRENTICE_GRADUATED'));
  r = await call('POST', '/api/training/apprentices/abena/graduate', T('boss'));
  check('graduating twice refused', r.s === 400);
  r = await call('GET', '/api/training/me', T('abena'));
  check('her training record stays, marked graduated', r.s === 200 && r.j.graduated === true && r.j.progress.signedOff === 1);
  r = await call('PUT', `/api/training/me/skills/${knot.id}`, T('abena'), { status: 'NOT_STARTED' });
  check('after graduating, the plan is closed to changes', r.s === 404);
  r = await call('GET', '/api/stylists/me/apprentices', T('boss'));
  check('the supervisor still sees her, as graduated', r.s === 200 && r.j.some((x) => x.name === 'Abena' && x.status === 'GRADUATED'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
});
