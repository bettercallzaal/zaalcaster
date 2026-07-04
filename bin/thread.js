#!/usr/bin/env node

// thread - the full conversation around a cast: ancestors above, replies below.
// Read this before replying so the answer lands in context.
//
// Usage: zaalcaster-thread <hashOrUrl> [--depth n]
//   accepts a cast hash or a farcaster.xyz link (as engage/channels print)

import { getConversation } from '../lib.js'

function line(cast, indent, marker = '') {
  const pad = '  '.repeat(indent)
  const user = cast.author?.username || '?'
  const when = new Date(cast.timestamp).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const link = `https://farcaster.xyz/${user}/${cast.hash.slice(0, 10)}`
  console.log(`${pad}${marker}@${user}  ${when}  ${link}`)
  for (const chunk of (cast.text || '').split('\n')) {
    if (chunk.trim()) console.log(`${pad}  ${chunk.trim()}`)
  }
  const likes = cast.reactions?.likes_count || 0
  const recasts = cast.reactions?.recasts_count || 0
  console.log(`${pad}  likes ${likes} | recasts ${recasts}`)
  console.log('')
}

function printReplies(replies, indent) {
  for (const r of replies || []) {
    line(r, indent)
    printReplies(r.direct_replies, indent + 1)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const target = args.find((a) => !a.startsWith('--'))
  const depth = args.includes('--depth') ? parseInt(args[args.indexOf('--depth') + 1], 10) : 2

  if (!target) {
    console.error('Usage: zaalcaster-thread <hashOrUrl> [--depth n]')
    process.exit(1)
  }

  const convo = await getConversation(target, { replyDepth: depth })
  const ancestors = convo.conversation?.chronological_parent_casts || []
  const cast = convo.conversation?.cast

  if (!cast) {
    console.error('Cast not found.')
    process.exit(1)
  }

  for (const a of ancestors) line(a, 0)
  line(cast, ancestors.length ? 1 : 0, '>> ')
  printReplies(cast.direct_replies, ancestors.length ? 2 : 1)
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
