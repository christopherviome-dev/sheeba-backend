// Speed and safe updates: browsers remember CORS permission; health reflects the database (30 Sep).
process.env.JWT_SECRET = 't';
const path = require('path'); const fs = require('fs'); const B = path.join(__dirname, '..');
const R = (m) => require(path.join(B, m));
const express = R('node_modules/express'), cors = R('node_modules/cors'), mongoose = R('node_modules/mongoose');
const { corsOptions } = R('lib/http');
let pass = 0, fail = 0; const check = (l, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + l + (c ? '' : '  ' + x)); };
let state = 1;
Object.defineProperty(mongoose.connection, 'readyState', { get: () => state, configurable: true });
const app = express(); app.use(cors(corsOptions)); app.use('/api/health', R('routes/health'));
app.post('/api/requests', (req, res) => res.json({ ok: true }));
const server = app.listen(0, async () => {
  const port = server.address().port;
  const pre = await fetch(`http://localhost:${port}/api/requests`, { method: 'OPTIONS', headers: { Origin: 'https://mepluge.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  check('a logged-in request\'s permission check is answered…', pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*');
  check('…and browsers are told to REMEMBER it for 2 hours (fewer trips)', pre.headers.get('access-control-max-age') === '7200', pre.headers.get('access-control-max-age'));
  let r = await fetch(`http://localhost:${port}/api/health`);
  check('health: OK while the database is connected', r.status === 200 && (await r.json()).ok === true);
  state = 0;
  r = await fetch(`http://localhost:${port}/api/health`);
  check('health: NOT OK when the database is down (a new version waits)', r.status === 503);
  const src = fs.readFileSync(path.join(B, 'server.js'), 'utf8');
  check('the real server uses these settings and serves /api/health', src.includes("cors(require('./lib/http').corsOptions)") && src.includes("app.use('/api/health'"));
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); server.close(); process.exit(fail ? 1 : 0);
});
