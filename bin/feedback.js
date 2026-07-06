#!/usr/bin/env node
// Read (and optionally clear) the in-app feedback Zaal leaves in the web app.
// Feedback lives in the synced state blob (zc:state.feedback) in KV/Upstash.
//
//   node bin/feedback.js          # list feedback newest-first
//   node bin/feedback.js --clear  # list, then empty it
//
// Needs the KV creds in env. This loads them from ~/.zao/private/farcaster-zaal.env
// if present (add KV_REST_API_URL + KV_REST_API_TOKEN there - copy from Vercel).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// pull any KV/Upstash vars from the creds file into process.env (store.js reads env)
try {
  const p = path.join(os.homedir(), '.zao/private/farcaster-zaal.env')
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no creds file - rely on ambient env */ }

const { storeEnabled, kvGet, kvSet } = await import('../store.js')

const KEY = 'zc:state'
const clear = process.argv.includes('--clear')

if (!storeEnabled()) {
  console.log('Store not reachable from this terminal.')
  console.log('Add KV_REST_API_URL + KV_REST_API_TOKEN (from Vercel > Storage) to')
  console.log('  ~/.zao/private/farcaster-zaal.env')
  console.log('then re-run. (Same values that power cross-device sync on the site.)')
  process.exit(0)
}

const state = (await kvGet(KEY)) || {}
const fb = Array.isArray(state.feedback) ? state.feedback : []

if (!fb.length) { console.log('No feedback logged yet.'); process.exit(0) }

console.log(`${fb.length} feedback item(s), newest first:\n`)
for (const f of fb) {
  const when = f.at ? new Date(f.at).toLocaleString() : '?'
  console.log(`- [${f.tab || '?'}] ${when}`)
  console.log(`  ${(f.text || '').replace(/\n/g, '\n  ')}\n`)
}

if (clear) {
  state.feedback = []
  await kvSet(KEY, state)
  console.log('(cleared)')
}
