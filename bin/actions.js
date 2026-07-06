#!/usr/bin/env node
// Action ledger: an append-only record of every write the tool actually made
// (cast / reply / quote / like / recast / delete), when. So if something goes
// out wrong you have a local trail, independent of Farcaster.
//
//   node bin/actions.js        # last 50
//   node bin/actions.js 200    # last N

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

try {
  const p = path.join(os.homedir(), '.zao/private/farcaster-zaal.env')
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* ambient env */ }

const { storeEnabled, kvList } = await import('../store.js')
if (!storeEnabled()) {
  console.log('Store not reachable - add KV_REST_API_URL + KV_REST_API_TOKEN to ~/.zao/private/farcaster-zaal.env')
  process.exit(0)
}

const limit = Number(process.argv[2]) || 50
const acts = await kvList('zc:actions', limit)
if (!acts.length) { console.log('No actions logged yet.'); process.exit(0) }

console.log(`${acts.length} action(s), newest first:\n`)
for (const a of acts) {
  const when = a.at ? new Date(a.at).toLocaleString() : '?'
  const bits = [a.text ? `"${a.text.slice(0, 70)}"` : '', a.channel ? `/${a.channel}` : '', a.hash ? a.hash.slice(0, 10) : '']
  console.log(`- [${(a.type || '?').padEnd(6)}] ${when}  ${bits.filter(Boolean).join('  ')}`)
}
