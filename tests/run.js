// Runs every tests/*.test.js file and totals the results: `npm test`.
// Tests use stand-in data (no real database), so they're safe to run anywhere.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
for (const f of fs.readdirSync(__dirname).filter((x) => x.endsWith('.test.js')).sort()) {
  let out = '';
  try { out = execFileSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const p = m ? +m[1] : 0, q = m ? +m[2] : 1;
  pass += p; fail += q;
  console.log(`${q ? 'FAIL' : ' ok '}  ${f.padEnd(28)} ${p} passed, ${q} failed`);
  if (q) console.log(out.split('\n').filter((l) => /FAIL|Error/.test(l)).slice(0, 6).map((l) => '      ' + (l.length > 160 ? l.slice(0, 160) + '…' : l)).join('\n'));
}
console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
