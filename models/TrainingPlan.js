const mongoose = require('mongoose');
// One apprentice's training with their supervisor (see routes/training.js).
// Skills: NOT_STARTED → PRACTISING (the apprentice may set this) → SIGNED_OFF
// (ONLY the supervisor can). Graduation turns the apprentice into an
// independent professional, keeping their code, number and history.
const SkillSchema = new mongoose.Schema({
  id: String,
  name: String,
  status: { type: String, enum: ['NOT_STARTED', 'PRACTISING', 'SIGNED_OFF'], default: 'NOT_STARTED' },
  signedOffAt: { type: Number, default: null },
}, { _id: false });
const FeedbackSchema = new mongoose.Schema({ id: String, text: String, at: Number }, { _id: false });
const TrainingPlanSchema = new mongoose.Schema({
  apprenticeId: { type: String, required: true, unique: true },
  supervisorId: { type: String, required: true },
  startedAt: { type: Number, default: () => Date.now() },
  expectedCompletion: { type: Number, default: null },
  weekFocus: { type: String, default: null },
  skills: { type: [SkillSchema], default: [] },
  feedback: { type: [FeedbackSchema], default: [] },
  graduatedAt: { type: Number, default: null },
});
module.exports = mongoose.models.TrainingPlan || mongoose.model('TrainingPlan', TrainingPlanSchema);
