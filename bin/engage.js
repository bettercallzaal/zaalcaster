#!/usr/bin/env node
// engage - the live-engagement view: inbound mentions/replies you have NOT
// answered yet, newest first, each with a one-tap farcaster.xyz link.
// Filters out anything you already replied to so drafts are never stale.

import { getNotifications } from '../lib.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function env() {
  const p = path.join(os.homedir(), '.zao/private/farcaster-zaal.env')
  const out = {}
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

async function main() {
  const { NEYNAR_API_KEY, ZAAL_FID } = env()
  const args = process.argv.slice(2)
  const limit = args.includes('--limit') ? args[args.indexOf('--limit') + 1] : '15'

  const [notifs, mineRes] = await Promise.all([
    getNotifications({ limit: Number(limit) }),
    fetch(
      `https://api.neynar.com/v2/farcaster/feed/user/casts?fid=${ZAAL_FID}&limit=50&include_replies=true`,
      { headers: { 'x-api-key': NEYNAR_API_KEY, accept: 'application/json' } },
    ).then((r) => r.json()),
  ])

  const answered = new Set(
    (mineRes.casts || []).map((c) => c.parent_hash).filter(Boolean),
  )

  let shown = 0
  for (const n of notifs.notifications || []) {
    const c = n.cast || {}
    if (!c.hash || answered.has(c.hash)) continue
    const user = c.author?.username || '?'
    const link = `https://farcaster.xyz/${user}/${c.hash.slice(0, 10)}`
    const text = (c.text || '').replace(/\s+/g, ' ').slice(0, 140)
    console.log(`[${n.type}] @${user}  ${link}`)
    console.log(`  ${text}`)
    console.log('')
    shown++
  }
  if (!shown) console.log('Inbox zero - everything answered.')
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
