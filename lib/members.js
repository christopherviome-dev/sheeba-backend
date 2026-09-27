// Member numbers and friendly Sheeba codes.
//  - Every account gets a member number in the order people join, across
//    professionals and customers. #1–1,000 are founding members.
//  - Its Sheeba code is first name + member number, e.g. AKUA0042: easy to say,
//    share and type. Unique because the number is. (Such codes are guessable,
//    which is fine: a code only credits an invite or opens a public page;
//    nothing private is ever revealed from a code alone.)
const Counter = require('../models/Counter');

const FOUNDING_LIMIT = 1000;

function friendlyCode(name, n) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  let prefix = first.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
  if (prefix.length < 2) prefix = 'SHEEBA';
  return prefix + String(n).padStart(4, '0');
}

// Numbers existing accounts ONCE, in join order, giving each a friendly code
// and keeping its old code as an alias so links already shared still work.
let running = null;
function ensureMemberNumbers({ Stylist, Customer }) {
  if (!running) running = (async () => {
    if (await Counter.findById('members')) return false;
    const people = [
      ...(await Stylist.find({}, '_id name createdAt code')).map((d) => ({ M: Stylist, d })),
      ...(await Customer.find({}, '_id name createdAt code')).map((d) => ({ M: Customer, d })),
    ].sort((a, b) => new Date(a.d.createdAt) - new Date(b.d.createdAt));
    let n = 0;
    for (const { M, d } of people) {
      n += 1;
      const update = { $set: { memberNumber: n, code: friendlyCode(d.name, n) } };
      if (d.code) update.$addToSet = { legacyCodes: d.code };
      await M.updateOne({ _id: d._id }, update);
    }
    try { await Counter.create({ _id: 'members', seq: n }); } catch (e) { /* already created */ }
    return true;
  })().finally(() => { running = null; });
  return running;
}

async function nextMemberNumber(models) {
  await ensureMemberNumbers(models);
  const c = await Counter.findOneAndUpdate({ _id: 'members' }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return c.seq;
}

module.exports = { friendlyCode, ensureMemberNumbers, nextMemberNumber, FOUNDING_LIMIT };
