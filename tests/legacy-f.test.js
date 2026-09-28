// Restored from the earlier test suites (sessions of 25–27 Sep).
process.env.JWT_SECRET = 't'; process.env.PAYSTACK_SECRET_KEY = 't';
const path = require('path'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
require(path.join(B, 'node_modules/express-async-errors'));
// Added after this suite was written: rewards past their 7-day check are confirmed in one bulk update.
{ const IR = R('models/InviteReward'); IR.updateMany = async () => ({ modifiedCount: 0 }); }
const jwt = R('node_modules/jsonwebtoken'), express = R('node_modules/express');
const Stylist = R('models/Stylist'), Customer = R('models/Customer'), Counter = R('models/Counter'), FxRate = R('models/FxRate');
const Notification = R('models/Notification'), Activity = R('models/Activity'), InviteReward = R('models/InviteReward');
const { ensureMemberNumbers, nextMemberNumber } = R('lib/members');
const fx = R('lib/fx');

const mk = (f) => ({ ...f, _id: { toString: () => f.id, toJSON: () => f.id }, save: async function () { return this; } });
let S, C, COUNTER, FX, notes = [], seq = 0;
const fields = (M, T) => {
  M.find = async () => Object.values(T);
  M.findById = async (id) => T[String(id)] || null;
  M.findOne = async (f) => Object.values(T).find((d) => (f.$or ? f.$or.some((x) => d.code === x.code || (d.legacyCodes || []).includes(x.legacyCodes)) : Object.entries(f).every(([k, v]) => d[k] === v || (v && v.$in && v.$in.includes(d[k]))))) || null;
  M.exists = async (f) => !!(await M.findOne(f));
  M.updateOne = async (q, u) => { const d = T[String(q._id)]; Object.assign(d, u.$set || {}); if (u.$addToSet) d.legacyCodes = [...new Set([...(d.legacyCodes || []), u.$addToSet.legacyCodes])]; return {}; };
  M.create = async (f) => { const id = 'n' + (++seq); T[id] = mk({ id, styles: [], staffAccess: [], ...f }); return T[id]; };
};
Counter.findById = async (id) => COUNTER[id] || null;
Counter.create = async (d) => { if (COUNTER[d._id]) throw new Error('dup'); COUNTER[d._id] = { ...d }; return COUNTER[d._id]; };
Counter.findOneAndUpdate = async (q, u) => { const c = COUNTER[q._id] || (COUNTER[q._id] = { _id: q._id, seq: 0 }); c.seq += u.$inc.seq; return c; };
FxRate.findById = async (id) => FX[id] || null;
FxRate.findOneAndUpdate = async (q, u) => { FX[q._id] = { ...(u.$set || {}) }; return FX[q._id]; };
Notification.create = async (n) => { notes.push(n); return n; }; Activity.create = async () => ({});
InviteReward.find = () => { const p = Promise.resolve([]); p.sort = () => Promise.resolve([]); return p; };
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };

(async () => {
  console.log('--- NUMBERING EXISTING ACCOUNTS, IN JOIN ORDER ---');
  S = { a: mk({ id: 'a', name: 'Christopher Viome', code: 'K7M2QX', createdAt: new Date('2026-08-01') }), b: mk({ id: 'b', name: 'Etornam', code: 'ETNM22', createdAt: new Date('2026-08-10') }) };
  C = { c: mk({ id: 'c', name: 'Ama Serwaa', code: 'AMAS22', createdAt: new Date('2026-08-05') }), d: mk({ id: 'd', name: 'Kofi', createdAt: new Date('2026-09-01') }) };
  COUNTER = {}; FX = {};
  fields(Stylist, S); fields(Customer, C);
  let did = await ensureMemberNumbers({ Stylist, Customer });
  check('numbers follow real join order across shops AND customers', did && S.a.memberNumber === 1 && C.c.memberNumber === 2 && S.b.memberNumber === 3 && C.d.memberNumber === 4);
  check('friendly codes: CHRISTOP0001, AMA0002, ETORNAM0003, KOFI0004', S.a.code === 'CHRISTOP0001' && C.c.code === 'AMA0002' && S.b.code === 'ETORNAM0003' && C.d.code === 'KOFI0004', [S.a.code, C.c.code, S.b.code, C.d.code].join(','));
  check('old codes kept as aliases', S.a.legacyCodes.includes('K7M2QX') && C.c.legacyCodes.includes('AMAS22'));
  check('an account with no old code gets no empty alias', !(C.d.legacyCodes || []).length);
  S.a.memberNumber = 99; did = await ensureMemberNumbers({ Stylist, Customer });
  check('running it again changes nothing (numbers are permanent)', did === false && S.a.memberNumber === 99);
  check('the next signup is #5', (await nextMemberNumber({ Stylist, Customer })) === 5);

  console.log('--- THE 1,000th MEMBER ---');
  COUNTER.members.seq = 998;
  const app = express(); app.use(express.json());
  app.use('/api/auth', R('routes/auth')); app.use('/api/customers', R('routes/customers')); app.use('/api/invites', R('routes/invites'));
  app.use((err, req, res, next) => { console.log('SERVER ERROR', err.message); res.status(500).json({ error: 'x' }); });
  S.adm = mk({ id: 'adm', name: 'Christopher', isAdmin: true });
  const server = app.listen(8213, async () => {
    const call = async (m, u, tok, body) => { const r = await fetch('http://localhost:8213' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
    let r = await call('POST', '/api/customers/register', null, { phone: '0241110001', password: 'pass12345', name: 'Abena Ninehundred' });
    const m999 = Object.values(C).find((c) => c.name === 'Abena Ninehundred');
    check('member #999: founding, no milestone yet', r.s === 200 && m999.memberNumber === 999 && !notes.some((n) => n.type === 'MEMBER_MILESTONE'));
    r = await call('POST', '/api/auth/register', null, { phone: '0551110002', password: 'pass12345', name: 'Yaw Thousand' });
    const m1000 = Object.values(S).find((s) => s.name === 'Yaw Thousand');
    check('member #1,000 gets code YAW1000', r.s === 200 && m1000.memberNumber === 1000 && m1000.code === 'YAW1000', m1000 && m1000.code);
    check('the 1,000th signup alerts the admin as a milestone', notes.some((n) => n.type === 'MEMBER_MILESTONE' && /1000th member just joined: Yaw Thousand/.test(n.title)));
    r = await call('POST', '/api/customers/register', null, { phone: '0241110003', password: 'pass12345', name: 'Esi After' });
    check('numbering carries on past 1,000 (#1001)', Object.values(C).find((c) => c.name === 'Esi After').memberNumber === 1001);

    console.log('--- EXCHANGE RATES ---');
    let calls = 0, mode = 'ok';
    const realFetch = global.fetch;
    global.fetch = async (url, opts) => {
      if (String(url).startsWith('https://open.er-api.com')) { calls++; if (mode === 'down') throw new Error('offline');
        return { json: async () => ({ result: 'success', time_last_update_unix: 1790000000, rates: { GHS: 1, GBP: 0.066, USD: 0.083 } }) }; }
      return realFetch(url, opts);
    };
    fx._resetForTests();
    let v = await fx.fromGHS(100, 'GBP');
    check('GH₵1 → £0.07 (0.066 rounded to the nearest penny)', v && v.amountMinor === 7 && v.currency === 'GBP');
    await fx.fromGHS(100, 'USD');
    check('rates fetched once, then reused (not on every request)', calls === 1);
    check('cedis stay cedis', (await fx.fromGHS(100, 'GHS')).amountMinor === 100);
    check('unknown currency → no conversion shown (never invented)', (await fx.fromGHS(100, 'XXX')) === null);
    fx._resetForTests(); FX.GHS.fetchedAt = Date.now() - 13 * 3600 * 1000; mode = 'down';
    v = await fx.fromGHS(100, 'GBP');
    check('rate service down → last known rates used', v && v.amountMinor === 7 && calls === 2);
    fx._resetForTests(); FX = {}; mode = 'down';
    check('no rates ever fetched and service down → nothing shown', (await fx.fromGHS(100, 'GBP')) === null);

    console.log('--- REWARDS SHOWN LOCALLY ---');
    mode = 'ok'; fx._resetForTests();
    S.uk = mk({ id: 'uk', name: 'Grace Mensah', country: 'GB', currency: 'GBP', memberNumber: 57, code: 'GRACE0057' });
    r = await call('GET', '/api/invites/me', jwt.sign({ id: 'uk' }, 't'));
    check('UK account: reward is GH₵1, shown as about £0.07', r.s === 200 && r.j.reward.currency === 'GHS' && r.j.reward.amountMinor === 100 && r.j.rewardLocal && r.j.rewardLocal.currency === 'GBP' && r.j.rewardLocal.amountMinor === 7, JSON.stringify(r.j.rewardLocal));
    check('founding member #57 is marked founding', r.j.founding === true && r.j.memberNumber === 57, 'status=' + r.s + ' ' + JSON.stringify(r.j).slice(0, 300));
    r = await call('GET', '/api/invites/me', jwt.sign({ id: 'b' }, 't'));
    check('Ghana account: no conversion needed', r.j.rewardLocal === null);
    global.fetch = realFetch;
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    server.close(); process.exit(fail ? 1 : 0);
  });
})();
