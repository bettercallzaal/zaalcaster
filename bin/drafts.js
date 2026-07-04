#!/usr/bin/env node

// drafts - reply drafts in Zaal's voice for every unanswered inbound item.
// Pulls engage --json, hands the thread context to the claude CLI, prints
// numbered drafts with the reply command ready to copy.
//
// NEVER posts. Every draft still needs Zaal's yes, then a manual
// zaalcaster-reply (or an explicit "autopost" per repo rules).
//
// Usage: zaalcaster-drafts [--limit n]
// Requires: claude CLI on PATH (it is on this machine).

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const bin = path.dirname(fileURLToPath(import.meta.url))

const VOICE = `You draft Farcaster replies for Zaal (@zaal). Voice rules, non-negotiable:
- short, plain, direct. one or two sentences. lowercase is fine.
- "ppl", "u", "imho" are fine. no hype adjectives, no exclamation stacking.
- no emojis, no em dashes (plain hyphens only).
- answer the actual question; add one concrete detail when it helps.
- if the item does not need a reply, output SKIP for it.`

async function main() {
  const args = process.argv.slice(2)
  const limit = args.includes('--limit') ? args[args.indexOf('--limit') + 1] : '15'

  const engage = spawnSync('node', [path.join(bin, 'engage.js'), '--json', '--limit', limit], {
    encoding: 'utf8',
  })
  if (engage.status !== 0) {
    console.error('engage failed:', engage.stderr || engage.stdout)
    process.exit(1)
  }

  const { unanswered } = JSON.parse(engage.stdout)
  if (!unanswered.length) {
    console.log('Inbox zero - nothing to draft.')
    return
  }

  const itemsBlock = unanswered
    .map((item, i) => {
      const parent = item.parent ? `zaal's cast they are responding to: "${item.parent.text}"\n` : ''
      return `ITEM ${i + 1} (@${item.user}, ${item.type}):\n${parent}their message: "${item.text}"`
    })
    .join('\n\n')

  const prompt = `${VOICE}

For each item below output exactly one line in the form:
ITEM <n>: <draft reply text or SKIP>

${itemsBlock}`

  console.log(`Drafting replies for ${unanswered.length} item(s)...\n`)
  const claude = spawnSync('claude', ['-p', prompt], { encoding: 'utf8', timeout: 120000 })
  if (claude.status !== 0) {
    console.error('claude CLI failed:', claude.stderr || 'no output')
    process.exit(1)
  }

  const drafts = new Map()
  for (const line of claude.stdout.split('\n')) {
    const m = line.match(/^ITEM (\d+):\s*(.+)$/)
    if (m) drafts.set(Number(m[1]), m[2].trim())
  }

  unanswered.forEach((item, i) => {
    const draft = drafts.get(i + 1)
    console.log(`[${i + 1}] @${item.user}  ${item.link}`)
    if (item.parent) console.log(`    re: ${item.parent.text.slice(0, 100)}`)
    console.log(`    them: ${item.text.slice(0, 140)}`)
    if (!draft || draft === 'SKIP') {
      console.log('    draft: (skip - no reply needed)')
    } else {
      console.log(`    draft: ${draft}`)
      console.log(`    post:  npm run reply -- "${item.link}" "${draft.replace(/"/g, '\\"')}"`)
    }
    console.log('')
  })
  console.log('Review each draft with Zaal before posting - nothing above was sent.')
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
