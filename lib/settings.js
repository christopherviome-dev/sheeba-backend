// Admin switches with safe defaults, read on demand (cheap, rarely changed).
const Setting = require('../models/Setting');
// Admin switches, each with a safe default (everything normal, nothing paused).
const DEFAULTS = {
  ageCheck: false,       // the age check is off until the admin switches it on
  pauseSignups: false,   // stop new accounts for a while (e.g. during maintenance)
  pauseBookings: false,  // stop new booking requests for a while
  verifiedOnly: false,   // Discover shows only ID-checked professionals
  inviteRewards: true,   // first completed jobs earn invite rewards
  messages: true,        // customers and professionals can message each other
  aiAssistant: true,     // the assistant may use AI to read questions (only if an AI key is set; costs money)
  announcement: '',      // a message shown at the top of every page ('' = none)
};

async function getSetting(key) {
  try { const d = await Setting.findById(key); if (d && d.value !== null && d.value !== undefined) return d.value; } catch (e) { /* use the default */ }
  return DEFAULTS[key];
}
async function setSetting(key, value, adminId) {
  await Setting.findOneAndUpdate({ _id: key }, { $set: { value, updatedAt: Date.now(), updatedBy: adminId || null } }, { upsert: true });
  return value;
}
module.exports = { getSetting, setSetting, DEFAULTS };
