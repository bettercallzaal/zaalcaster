#!/usr/bin/env node

import { postCast, resolveCast } from '../lib.js'

async function main() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.error('Usage: zaalcaster-reply <parentHashOrUrl> "your reply text" [--embed url]')
    console.error('  parent can be a cast hash or a farcaster.xyz link (as printed by engage/channels)')
    process.exit(1)
  }

  const parent = args[0]
  let text = args[1]
  let embedUrl = null

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--embed' && args[i + 1]) {
      embedUrl = args[i + 1]
      i++
    }
  }

  try {
    console.log('Resolving parent cast...')
    const parentCast = await resolveCast(parent)
    console.log(`Replying to @${parentCast.author.username}: ${(parentCast.text || '').replace(/\s+/g, ' ').slice(0, 80)}`)

    console.log('Posting reply...')
    const response = await postCast(text, {
      embedUrl,
      parentHash: parentCast.hash,
      parentFid: parentCast.author.fid,
    })

    console.log('Reply posted successfully!')
    console.log(`Hash: ${response.cast.hash}`)
  } catch (error) {
    console.error('Error posting reply:', error.message)
    process.exit(1)
  }
}

main()
