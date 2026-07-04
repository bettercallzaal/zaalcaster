#!/usr/bin/env node
// engage - the live-engagement view: inbound mentions/replies you have NOT
// answered yet, newest first, each with a one-tap farcaster.xyz link.
// Filters out anything you already replied to so drafts are never stale.
//
// Flags:
//   --limit n    how many notifications to scan (default 15)
//   --context    fetch the parent cast of each reply so the thread reads in place
//   --json       machine-readable output (feed to a Claude session to draft
//                replies in Zaal's voice; posting still needs Zaal's yes)
//   --all        include likes/recasts/follows too (default: replies + mentions
//                + quotes only - the ones that can actually be answered)

import { getNotifications, getCastDetails, getUserCasts } from '../lib.js'

async function main() {
  const args = process.argv.slice(2)
  const limit = args.includes('--limit') ? args[args.indexOf('--limit') + 1] : '15'
  const withContext = args.includes('--context') || args.includes('--json')
  const asJson = args.includes('--json')
  const includeAll = args.includes('--all')
  const answerable = new Set(['reply', 'mention', 'quote'])

  const [notifs, mineRes] = await Promise.all([
    getNotifications({ limit: Number(limit) }),
    getUserCasts({ limit: 50, includeReplies: true }),
  ])

  const answered = new Set(
    (mineRes.casts || []).map((c) => c.parent_hash).filter(Boolean),
  )

  const items = []
  for (const n of notifs.notifications || []) {
    const c = n.cast || {}
    if (!includeAll && !answerable.has(n.type)) continue
    if (!c.hash || answered.has(c.hash)) continue
    items.push({
      type: n.type,
      user: c.author?.username || '?',
      hash: c.hash,
      link: `https://farcaster.xyz/${c.author?.username || '?'}/${c.hash.slice(0, 10)}`,
      text: (c.text || '').replace(/\s+/g, ' '),
      parentHash: c.parent_hash || null,
      parent: null,
    })
  }

  if (withContext) {
    // one lookup per unique parent, shared across items in the same thread
    const parentHashes = [...new Set(items.map((i) => i.parentHash).filter(Boolean))]
    const parents = new Map()
    await Promise.all(parentHashes.map(async (h) => {
      try {
        const res = await getCastDetails(h)
        parents.set(h, {
          user: res.cast.author?.username || '?',
          text: (res.cast.text || '').replace(/\s+/g, ' '),
        })
      } catch {
        // parent deleted or unfetchable - show the item without context
      }
    }))
    for (const item of items) {
      if (item.parentHash) item.parent = parents.get(item.parentHash) || null
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ unanswered: items }, null, 2))
    return
  }

  for (const item of items) {
    console.log(`[${item.type}] @${item.user}  ${item.link}`)
    if (item.parent) console.log(`  in reply to @${item.parent.user}: ${item.parent.text.slice(0, 120)}`)
    console.log(`  ${item.text.slice(0, 140)}`)
    console.log('')
  }
  if (!items.length) console.log('Inbox zero - everything answered.')
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
