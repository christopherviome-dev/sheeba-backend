// Admin switches with safe defaults, read on demand (cheap, rarely changed).
const Setting = require('../models/Setting');
const DEFAULTS = { ageCheck: false }; // the age check is off until the admin switches it on

async function getSetting(key) {
  try { const d = await Setting.findById(key); if (d && d.value !== null && d.value !== undefined) return d.value; } catch (e) { /* use the default */ }
  return DEFAULTS[key];
}
async function setSetting(key, value, adminId) {
  await Setting.findOneAndUpdate({ _id: key }, { $set: { value, updatedAt: Date.now(), updatedBy: adminId || null } }, { upsert: true });
  return value;
}
module.exports = { getSetting, setSetting, DEFAULTS };
