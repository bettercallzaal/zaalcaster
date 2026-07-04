#!/usr/bin/env node
// engage - the live-engagement view: inbound mentions/replies you have NOT
// answered yet, newest first, each with a one-tap farcaster.xyz link.
// Filters out anything you already replied to so drafts are never stale.
//
// For the keyboard-driven walk-through of the same list, use: npm run cockpit
//
// Flags:
//   --limit n    how many notifications to scan (default 15)
//   --context    fetch the parent cast of each reply so the thread reads in place
//   --json       machine-readable output (feed to a Claude session to draft
//                replies in Zaal's voice; posting still needs Zaal's yes)
//   --drafts     generate suggested replies in Zaal's voice. One batched model
//                call: OpenRouter if ~/.zao/private/openrouter.key exists,
//                otherwise the local claude CLI. Print-only, never posts.
//   --all        include likes/recasts/follows too (default: replies + mentions
//                + quotes only - the ones that can actually be answered)

import { getUnansweredInbound } from '../lib.js'
import { generateDrafts } from '../voice.js'

async function main() {
  const args = process.argv.slice(2)
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 15
  const asJson = args.includes('--json')
  const withDrafts = args.includes('--drafts')
  const withContext = args.includes('--context') || asJson || withDrafts
  const includeAll = args.includes('--all')

  const items = await getUnansweredInbound({ limit, includeAll, withContext })

  if (withDrafts && !asJson && items.length) {
    console.log(`Drafting replies for ${items.length} item(s)...\n`)
    const backend = await generateDrafts(items)
    if (!backend) {
      console.log('Draft generation unavailable (no OpenRouter key, claude CLI failed). Showing casts without drafts.\n')
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
    if (withDrafts && item.draft) {
      if (item.draft === 'SKIP') {
        console.log('  draft: (no reply needed)')
      } else {
        console.log(`  draft: ${item.draft}`)
        console.log(`  post:  npm run reply -- "${item.link}" "${item.draft.replace(/"/g, '\\"')}"`)
      }
    }
    console.log('')
  }
  if (!items.length) console.log('Inbox zero - everything answered.')
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
