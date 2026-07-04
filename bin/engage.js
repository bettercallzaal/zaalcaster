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
//   --drafts     generate suggested replies in Zaal's voice using OpenRouter API
//                (reads OPENROUTER_API_KEY from ~/.zao/private/openrouter.key)
//   --all        include likes/recasts/follows too (default: replies + mentions
//                + quotes only - the ones that can actually be answered)

import fs from 'fs'
import path from 'path'
import { ZAO_CONTEXT } from '../context.js'
import { getNotifications, getCastDetails, getAnsweredParents } from '../lib.js'

const OPENROUTER_KEY_PATH = path.join(process.env.HOME, '.zao/private/openrouter.key')

function loadOpenRouterKey() {
  try {
    if (!fs.existsSync(OPENROUTER_KEY_PATH)) return null
    const key = fs.readFileSync(OPENROUTER_KEY_PATH, 'utf-8').trim()
    return key || null
  } catch {
    return null
  }
}

async function generateDraft(castText, parentText) {
  const openrouterKey = loadOpenRouterKey()
  if (!openrouterKey) return null

  const systemPrompt = `You draft Farcaster replies for Zaal (@zaal). Voice rules:
- short, plain, direct. one or two sentences max. lowercase is fine.
- "ppl", "u", "imho" are fine. no hype adjectives, no exclamation stacking.
- no emojis, no em dashes (plain hyphens only).
- answer the actual thing they asked or said; add one concrete detail when it helps.
- keep it under 280 chars.
- if this really does not need a reply, just output "SKIP".

Ground the reply in these facts when relevant (do not force them, do not list them, just be accurate):
${ZAO_CONTEXT}
`

  const userPrompt = parentText
    ? `their cast you're responding to: "${parentText}"\n\nthey said: "${castText}"\n\nDraft a one-line reply in Zaal's voice (or SKIP):`
    : `they said: "${castText}"\n\nDraft a one-line reply in Zaal's voice (or SKIP):`

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-fable-5',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 100,
        temperature: 0.7,
      }),
    })

    if (!response.ok) return null
    const data = await response.json()
    const draft = data.choices?.[0]?.message?.content?.trim() || null
    return draft === 'SKIP' ? 'SKIP' : draft
  } catch {
    return null
  }
}

async function main() {
  const args = process.argv.slice(2)
  const limit = args.includes('--limit') ? args[args.indexOf('--limit') + 1] : '15'
  const withContext = args.includes('--context') || args.includes('--json') || args.includes('--drafts')
  const asJson = args.includes('--json')
  const withDrafts = args.includes('--drafts')
  const includeAll = args.includes('--all')
  const answerable = new Set(['reply', 'mention', 'quote'])

  const [notifs, answered] = await Promise.all([
    getNotifications({ limit: Number(limit) }),
    getAnsweredParents(),
  ])

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
      draft: null,
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

  if (withDrafts && !asJson) {
    const openrouterKey = loadOpenRouterKey()
    if (!openrouterKey) {
      console.log('Note: OpenRouter API key not found at ~/.zao/private/openrouter.key')
      console.log('Showing casts without drafts. Create the file to enable draft generation.\n')
    } else {
      console.log(`Generating drafts for ${items.length} item(s)...\n`)
    }

    if (openrouterKey) {
      for (const item of items) {
        const draft = await generateDraft(item.text, item.parent?.text)
        item.draft = draft
      }
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
      }
    }
    console.log('')
  }
  if (!items.length) console.log('Inbox zero - everything answered.')
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
