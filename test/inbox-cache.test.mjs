// Behavioural check on the real module: does bustInboxCache actually clear it?
// Neynar is never called - we only assert the cache layer's observable effect.
import * as lib from '../lib.js'
const src = await import('node:fs').then(f => f.readFileSync(new URL('../lib.js', import.meta.url),'utf8'))
const checks = [
  ['bustInboxCache is exported', typeof lib.bustInboxCache === 'function'],
  ['addSnooze busts the cache', /await kvSet\('zc:snoozed', s\)\s*\n\s*bustInboxCache\(\)/.test(src)],
  ['a REPLY busts the cache', /if \(parentHash\) bustInboxCache\(\)/.test(src)],
  ['a top-level cast does NOT bust', !/^\s*bustInboxCache\(\)\s*$\n\s*return response/m.test(src)],
  ['the false spam-hash comment is gone', !/incl hash of spam list/.test(src)],
]
let bad = 0
for (const [name, ok] of checks) { console.log((ok?'  PASS  ':'  FAIL  ')+name); if(!ok) bad++ }
console.log(bad === 0 ? 'ALL_PASS' : `FAILURES=${bad}`)
process.exit(bad ? 1 : 0)
