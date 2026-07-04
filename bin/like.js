#!/usr/bin/env node

// like - like (or recast) a cast. Takes a hash or a farcaster.xyz link.
// Zaal running this command IS the approval - it acts immediately.
//
// Usage: zaalcaster-like <hashOrUrl> [--recast]

import { resolveCast, postReaction } from '../lib.js'

async function main() {
  const args = process.argv.slice(2)
  const target = args.find((a) => !a.startsWith('--'))
  const type = args.includes('--recast') ? 'recast' : 'like'

  if (!target) {
    console.error('Usage: zaalcaster-like <hashOrUrl> [--recast]')
    process.exit(1)
  }

  const cast = await resolveCast(target)
  console.log(`${type === 'like' ? 'Liking' : 'Recasting'} @${cast.author.username}: ${(cast.text || '').replace(/\s+/g, ' ').slice(0, 80)}`)

  await postReaction(type, cast.hash, cast.author.fid)
  console.log('Done.')
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
