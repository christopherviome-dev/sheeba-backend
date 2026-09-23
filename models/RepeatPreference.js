const mongoose = require('mongoose');

// Customer-controlled, per stylist+style. The customer explicitly chooses
// this — it is never silently inferred from a single completed service.
const RepeatPreferenceSchema = new mongoose.Schema({
  customerId: { type: String, required: true },
  stylistId: { type: String, required: true },
  styleId: { type: String, default: null },
  serviceName: { type: String, default: null },
  intervalDays: { type: Number, required: true },
  remindersEnabled: { type: Boolean, default: true },
  lastCompletedAt: { type: Number, required: true }, // the REAL date of the completion this preference is tracking from
  // Dedup for notifications — set once a DUE/OVERDUE alert has actually
  // been sent for the current cycle, so re-checking status on every page
  // load can never spam repeat notifications for the same due date.
  lastNotifiedStatus: { type: String, enum: [null, 'APPROACHING', 'DUE', 'OVERDUE'], default: null },
  createdAt: { type: Number, default: () => Date.now() },
  updatedAt: { type: Number, default: () => Date.now() },
});

// One preference per customer+stylist+style combination — updating an
// existing preference, never silently duplicating it.
RepeatPreferenceSchema.index({ customerId: 1, stylistId: 1, styleId: 1 }, { unique: true });

module.exports = mongoose.models.RepeatPreference || mongoose.model('RepeatPreference', RepeatPreferenceSchema);

// Real status math — the reminder window scales with the interval itself
// (a 2-week service gets a short approaching window, an 8-week service gets
// a longer one), rather than one fixed window applied to everything.
module.exports.computeStatus = function computeStatus(pref) {
  const DAY = 24 * 60 * 60 * 1000;
  const nextExpectedAt = pref.lastCompletedAt + pref.intervalDays * DAY;
  const daysUntilDue = (nextExpectedAt - Date.now()) / DAY;
  const window = Math.max(1, Math.min(7, Math.round(pref.intervalDays * 0.2)));
  let status;
  if (daysUntilDue > window) status = 'NOT_DUE';
  else if (daysUntilDue > 0) status = 'APPROACHING';
  else if (daysUntilDue > -window) status = 'DUE';
  else status = 'OVERDUE';
  return { status, nextExpectedAt, daysUntilDue: Math.round(daysUntilDue) };
};
