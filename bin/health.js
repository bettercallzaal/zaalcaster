#!/usr/bin/env node
// Self-monitor: is posting wired up, and did the scheduled-post cron actually
// run recently? Exits non-zero (loud) if unhealthy - so the next version of the
// two silent failures (deploy rate-limit killing cron, signer/api-key mismatch)
// gets caught fast instead of days later.
//
//   node bin/health.js

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// load creds (Neynar + KV) from the creds file into env before importing lib/store
try {
  const p = path.join(os.homedir(), '.zao/private/farcaster-zaal.env')
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* rely on ambient env */ }

const { getSystemHealth } = await import('../lib.js')
const h = await getSystemHealth()

console.log('posting  :', h.posting.ready ? 'READY (signer matches key)' : `NOT READY - ${h.posting.reason || 'unknown'}`)
console.log('cron last:', h.cronLast ? new Date(h.cronLast).toLocaleString() : '(unknown - store off, or cron never fired)')
if (h.cronStaleHours != null) console.log('cron age :', `${h.cronStaleHours}h ago ${h.cronStaleHours < 1 ? '(ok)' : '(STALE - GitHub Action / cron may be down)'}`)
console.log('')
console.log(h.ok ? 'HEALTHY' : 'UNHEALTHY - see above')
process.exit(h.ok ? 0 : 1)
