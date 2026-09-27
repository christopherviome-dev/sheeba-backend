const express = require('express');
const crypto = require('crypto');
const Stylist = require('../models/Stylist');
const TrainingPlan = require('../models/TrainingPlan');
const TrainingWork = require('../models/TrainingWork');
const V = require('../lib/validate');
const { requireAuth } = require('../middleware/auth');
const { SKILL_TEMPLATES } = require('../lib/skills');
const { notify, notifyAllAdmins } = require('./notifications');

const router = express.Router();
const uid = () => crypto.randomBytes(6).toString('hex');
const findSafe = async (id) => { try { return await Stylist.findById(id); } catch (e) { return null; } };
const planFor = async (apprentice) => (await TrainingPlan.findOne({ apprenticeId: apprentice._id.toString() }))
  || TrainingPlan.create({ apprenticeId: apprentice._id.toString(), supervisorId: apprentice.supervisorId });
const summary = (plan) => {
  const total = plan.skills.length, done = plan.skills.filter((s) => s.status === 'SIGNED_OFF').length;
  return { total, signedOff: done, percent: total ? Math.round((done / total) * 100) : 0 };
};

router.get('/templates', requireAuth, (req, res) => res.json(SKILL_TEMPLATES));

// ---------- The apprentice's own training ----------
router.get('/me', requireAuth, async (req, res) => {
  const me = await findSafe(req.stylistId);
  if (!me || !me.supervisorId || !['APPROVED', 'GRADUATED'].includes(me.supervisorStatus)) return res.status(404).json({ error: 'No training yet. Your supervisor needs to confirm you first.' });
  const plan = await planFor(me);
  const sup = await findSafe(me.supervisorId);
  res.json({ plan, progress: summary(plan), supervisor: sup ? { name: sup.salonName || sup.name } : null, graduated: me.supervisorStatus === 'GRADUATED', isMinor: !!me.isMinor });
});

// The apprentice can say they're practising a skill, but never sign it off.
router.put('/me/skills/:skillId', requireAuth, async (req, res) => {
  const me = await findSafe(req.stylistId);
  if (!me || me.supervisorStatus !== 'APPROVED') return res.status(404).json({ error: 'No training found.' });
  if (!['NOT_STARTED', 'PRACTISING'].includes(req.body.status)) return res.status(403).json({ error: 'Only your supervisor can sign off a skill.' });
  const plan = await planFor(me);
  const skill = plan.skills.find((s) => s.id === req.params.skillId);
  if (!skill) return res.status(404).json({ error: 'Skill not found.' });
  if (skill.status === 'SIGNED_OFF') return res.status(400).json({ error: 'Already signed off by your supervisor.' });
  skill.status = req.body.status;
  plan.markModified && plan.markModified('skills');
  await plan.save();
  res.json({ plan, progress: summary(plan) });
});

// ---------- Work progress: the apprentice posts, the supervisor reviews ----------
const WAITING_LIMIT = 10, TOTAL_LIMIT = 60;
const workOut = (w, skills = []) => ({
  _id: w._id, photo: w.photo, thumb: w.thumb, caption: w.caption, status: w.status, supervisorComment: w.supervisorComment,
  showOnShop: w.showOnShop, createdAt: w.createdAt, decidedAt: w.decidedAt,
  skillId: w.skillId, skillName: (skills.find((s) => s.id === w.skillId) || {}).name || null,
});

router.post('/me/works', requireAuth, async (req, res) => {
  const me = await findSafe(req.stylistId);
  if (!me || me.supervisorStatus !== 'APPROVED') return res.status(404).json({ error: 'Only confirmed apprentices can post training work.' });
  const photo = V.photo(req.body.photo, 'service');
  if (!photo.ok || !photo.value) return res.status(400).json({ error: photo.error || 'Add a photo of your work.' });
  const thumb = req.body.thumb ? V.photo(req.body.thumb, 'thumb') : { ok: true, value: null };
  if (!thumb.ok) return res.status(400).json({ error: thumb.error });
  const caption = typeof req.body.caption === 'string' ? req.body.caption.trim().slice(0, 200) : '';
  const plan = await planFor(me);
  const skillId = req.body.skillId ? String(req.body.skillId) : null;
  if (skillId && !plan.skills.some((s) => s.id === skillId)) return res.status(400).json({ error: 'That skill isn\u2019t in your training.' });
  const mine = await TrainingWork.find({ apprenticeId: me._id.toString() });
  if (mine.length >= TOTAL_LIMIT) return res.status(400).json({ error: `You can keep up to ${TOTAL_LIMIT} work photos. Delete an older one first.` });
  if (mine.filter((w) => w.status === 'PENDING').length >= WAITING_LIMIT) return res.status(400).json({ error: `You have ${WAITING_LIMIT} photos waiting for your supervisor. Wait for them to review those first.` });
  const w = await TrainingWork.create({ apprenticeId: me._id.toString(), supervisorId: me.supervisorId, photo: photo.value, thumb: thumb.value, caption: caption || null, skillId });
  await notify({ recipientId: me.supervisorId, recipientType: 'stylist', type: 'TRAINING_UPDATE', title: `${me.name} posted work for you to review`, message: caption.slice(0, 80), entityType: 'shop', entityId: me.supervisorId, priority: 'normal' });
  res.json(workOut(w, plan.skills));
});

router.get('/me/works', requireAuth, async (req, res) => {
  const me = await findSafe(req.stylistId);
  if (!me || !['APPROVED', 'GRADUATED'].includes(me.supervisorStatus)) return res.status(404).json({ error: 'No training found.' });
  const plan = await planFor(me);
  const list = await TrainingWork.find({ apprenticeId: me._id.toString() });
  res.json(list.sort((a, b) => b.createdAt - a.createdAt).map((w) => workOut(w, plan.skills)));
});

router.delete('/me/works/:workId', requireAuth, async (req, res) => {
  let w = null;
  try { w = await TrainingWork.findById(req.params.workId); } catch (e) { /* bad id */ }
  if (!w || w.apprenticeId !== String(req.stylistId)) return res.status(404).json({ error: 'Not found.' });
  await TrainingWork.deleteOne({ _id: w._id });
  res.json({ ok: true });
});

// Public: approved work the supervisor chose to show on their shop page.
// Never work by under-18 apprentices. Small thumbnails only.
router.get('/shop/:shopId/works', async (req, res) => {
  const shopId = String(req.params.shopId);
  const works = await TrainingWork.find({ supervisorId: shopId, status: 'APPROVED', showOnShop: true });
  const out = [];
  for (const w of works.sort((a, b) => b.decidedAt - a.decidedAt).slice(0, 24)) {
    const a = await findSafe(w.apprenticeId);
    if (!a || a.isMinor || a.supervisorId !== shopId || !['APPROVED', 'GRADUATED'].includes(a.supervisorStatus)) continue;
    out.push({ _id: w._id, thumb: w.thumb || (w.photo && w.photo.length <= 300 * 1024 ? w.photo : null), caption: w.caption, apprentice: String(a.name || '').trim().split(/\s+/)[0] || 'Apprentice' });
  }
  res.json(out.filter((x) => x.thumb));
});

// ---------- The supervisor ----------
// Only the apprentice's own confirmed supervisor gets through.
async function asSupervisor(req, res) {
  const a = await findSafe(req.params.id);
  if (!a || a.supervisorId !== String(req.stylistId) || !['APPROVED', 'GRADUATED'].includes(a.supervisorStatus)) {
    res.status(404).json({ error: 'No such apprentice.' });
    return null;
  }
  return { a, plan: await planFor(a) };
}

router.get('/apprentices/:id', requireAuth, async (req, res) => {
  const x = await asSupervisor(req, res); if (!x) return;
  res.json({ name: x.a.name, isMinor: !!x.a.isMinor, graduated: x.a.supervisorStatus === 'GRADUATED', plan: x.plan, progress: summary(x.plan) });
});

router.put('/apprentices/:id', requireAuth, async (req, res) => {
  const x = await asSupervisor(req, res); if (!x) return;
  const { plan } = x;
  if (req.body.expectedCompletion !== undefined) {
    if (req.body.expectedCompletion === null) plan.expectedCompletion = null;
    else {
      const t = Number(req.body.expectedCompletion);
      if (!Number.isFinite(t) || t < Date.now() - 24 * 3600 * 1000 || t > Date.now() + 5 * 365 * 24 * 3600 * 1000) return res.status(400).json({ error: 'Choose a completion date within the next 5 years.' });
      plan.expectedCompletion = t;
    }
  }
  if (req.body.weekFocus !== undefined) {
    const f = typeof req.body.weekFocus === 'string' ? req.body.weekFocus.trim().slice(0, 200) : '';
    plan.weekFocus = f || null;
  }
  await plan.save();
  res.json({ plan, progress: summary(plan) });
});

router.post('/apprentices/:id/skills', requireAuth, async (req, res) => {
  const x = await asSupervisor(req, res); if (!x) return;
  const { plan } = x;
  const names = (Array.isArray(req.body.names) ? req.body.names : []).map((n) => (typeof n === 'string' ? n.replace(/\s+/g, ' ').trim() : '')).filter(Boolean);
  if (!names.length) return res.status(400).json({ error: 'Add at least one skill.' });
  if (names.some((n) => n.length < 2 || n.length > 60)) return res.status(400).json({ error: 'Skill names should be 2 to 60 characters.' });
  // No duplicates, whatever the capitals: not against existing skills, and not within this batch.
  const have = new Set(plan.skills.map((s) => s.name.toLowerCase()));
  const fresh = [];
  for (const n of names) { const k = n.toLowerCase(); if (!have.has(k)) { have.add(k); fresh.push(n); } }
  if (plan.skills.length + fresh.length > 40) return res.status(400).json({ error: 'A training plan can have up to 40 skills.' });
  fresh.forEach((name) => plan.skills.push({ id: uid(), name, status: 'NOT_STARTED' }));
  await plan.save();
  res.json({ plan, progress: summary(plan), added: fresh.length });
});

router.put('/apprentices/:id/skills/:skillId', requireAuth, async (req, res) => {
  const x = await asSupervisor(req, res); if (!x) return;
  const { a, plan } = x;
  if (!['NOT_STARTED', 'PRACTISING', 'SIGNED_OFF'].includes(req.body.status)) return res.status(400).json({ error: 'Unknown status.' });
  const skill = plan.skills.find((s) => s.id === req.params.skillId);
  if (!skill) return res.status(404).json({ error: 'Skill not found.' });
  const newlySignedOff = req.body.status === 'SIGNED_OFF' && skill.status !== 'SIGNED_OFF';
  skill.status = req.body.status;
  skill.signedOffAt = req.body.status === 'SIGNED_OFF' ? (skill.signedOffAt || Date.now()) : null;
  plan.markModified && plan.markModified('skills');
  await plan.save();
  if (newlySignedOff) await notify({ recipientId: a._id.toString(), recipientType: 'stylist', type: 'TRAINING_UPDATE', title: `Skill signed off: ${skill.name}`, message: 'Well done!', entityType: 'shop', entityId: a._id.toString(), priority: 'normal' });
  res.json({ plan, progress: summary(plan) });
});

router.delete('/apprentices/:id/skills/:skillId', requireAuth, async (req, res) => {
  const x = await asSupervisor(req, res); if (!x) return;
  const { plan } = x;
  const before = plan.skills.length;
  plan.skills = plan.skills.filter((s) => s.id !== req.params.skillId);
  if (plan.skills.length === before) return res.status(404).json({ error: 'Skill not found.' });
  await plan.save();
  res.json({ plan, progress: summary(plan) });
});

router.post('/apprentices/:id/feedback', requireAuth, async (req, res) => {
  const x = await asSupervisor(req, res); if (!x) return;
  const { a, plan } = x;
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (text.length < 2 || text.length > 1000) return res.status(400).json({ error: 'Feedback should be 2 to 1,000 characters.' });
  plan.feedback.push({ id: uid(), text, at: Date.now() });
  await plan.save();
  await notify({ recipientId: a._id.toString(), recipientType: 'stylist', type: 'TRAINING_UPDATE', title: 'New feedback from your supervisor', message: text.slice(0, 80), entityType: 'shop', entityId: a._id.toString(), priority: 'normal' });
  res.json({ plan, progress: summary(plan) });
});

router.get('/apprentices/:id/works', requireAuth, async (req, res) => {
  const x = await asSupervisor(req, res); if (!x) return;
  const list = await TrainingWork.find({ apprenticeId: x.a._id.toString() });
  const order = { PENDING: 0, SENT_BACK: 1, APPROVED: 2 };
  res.json(list.sort((a, b) => (order[a.status] - order[b.status]) || (b.createdAt - a.createdAt)).map((w) => workOut(w, x.plan.skills)));
});

// Approve (optionally also signing off the linked skill, and showing it on
// the shop page) or send back with a comment.
router.post('/apprentices/:id/works/:workId/decision', requireAuth, async (req, res) => {
  const x = await asSupervisor(req, res); if (!x) return;
  const { a, plan } = x;
  let w = null;
  try { w = await TrainingWork.findById(req.params.workId); } catch (e) { /* bad id */ }
  if (!w || w.apprenticeId !== a._id.toString()) return res.status(404).json({ error: 'Work not found.' });
  const decision = req.body.decision;
  if (!['approve', 'send_back'].includes(decision)) return res.status(400).json({ error: 'Approve or send back.' });
  const comment = typeof req.body.comment === 'string' ? req.body.comment.trim().slice(0, 500) : '';
  if (decision === 'send_back' && comment.length < 2) return res.status(400).json({ error: 'Tell them what to improve.' });
  w.status = decision === 'approve' ? 'APPROVED' : 'SENT_BACK';
  w.supervisorComment = comment || null;
  w.decidedAt = Date.now();
  // Shown publicly only if chosen AND the apprentice is 18 or older.
  w.showOnShop = decision === 'approve' && req.body.showOnShop === true && !a.isMinor;
  await w.save();
  let signedOff = null;
  if (decision === 'approve' && req.body.signOffSkill === true && w.skillId) {
    const skill = plan.skills.find((s) => s.id === w.skillId);
    if (skill && skill.status !== 'SIGNED_OFF') { skill.status = 'SIGNED_OFF'; skill.signedOffAt = Date.now(); plan.markModified && plan.markModified('skills'); await plan.save(); signedOff = skill.name; }
  }
  await notify({ recipientId: a._id.toString(), recipientType: 'stylist', type: 'TRAINING_UPDATE',
    title: decision === 'approve' ? `Your work was approved${signedOff ? ` and ${signedOff} signed off` : ''}` : 'Your supervisor sent your work back',
    message: comment.slice(0, 80), entityType: 'shop', entityId: a._id.toString(), priority: 'normal' });
  res.json({ ok: true, status: w.status, showOnShop: w.showOnShop, signedOff });
});

// Graduation: the apprentice becomes an independent professional, keeping
// their code, member number and history. Their own shop then goes to the
// admin for the usual approval. Under-18s graduate once they turn 18.
router.post('/apprentices/:id/graduate', requireAuth, async (req, res) => {
  const x = await asSupervisor(req, res); if (!x) return;
  const { a, plan } = x;
  if (a.supervisorStatus === 'GRADUATED') return res.status(400).json({ error: 'Already graduated.' });
  if (a.isMinor) return res.status(400).json({ error: 'Apprentices under 18 can graduate to independent professional once they turn 18.' });
  a.role = 'PROFESSIONAL'; a.supervisorStatus = 'GRADUATED'; a.graduatedAt = Date.now();
  await a.save();
  plan.graduatedAt = a.graduatedAt;
  await plan.save();
  const sup = await findSafe(req.stylistId);
  await notify({ recipientId: a._id.toString(), recipientType: 'stylist', type: 'APPRENTICE_GRADUATED', title: '🎓 Congratulations, you\u2019ve graduated!', message: `${sup ? sup.salonName || sup.name : 'Your supervisor'} says you're ready. Set up your shop; Sheeba will review it before it goes public.`, entityType: 'shop', entityId: a._id.toString(), priority: 'important' });
  await notifyAllAdmins({ type: 'APPRENTICE_GRADUATED', title: `An apprentice graduated: ${a.name}`, message: 'Their shop will appear for approval once they set it up.', entityType: 'admin', entityId: a._id.toString(), priority: 'normal' });
  res.json({ ok: true });
});

module.exports = router;
