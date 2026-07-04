#!/usr/bin/env node

// reply - reply to a cast. Preview is the DEFAULT: without --yes it shows the
// parent and exactly what would go out, and sends nothing. --yes actually posts.
//
// Usage: zaalcaster-reply <parentHashOrUrl> "your reply text" [--embed url] [--yes]
//   parent can be a cast hash or a farcaster.xyz link (as printed by engage/channels)

import { postCast, resolveCast } from '../lib.js'

async function main() {
  const args = process.argv.slice(2)
  const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--embed')

  if (positional.length < 2) {
    console.error('Usage: zaalcaster-reply <parentHashOrUrl> "your reply text" [--embed url] [--yes]')
    console.error('  parent can be a cast hash or a farcaster.xyz link (as printed by engage/channels)')
    console.error('  without --yes this only previews; nothing is posted')
    process.exit(1)
  }

  const [parent, text] = positional
  const send = args.includes('--yes')
  let embedUrl = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--embed' && args[i + 1]) {
      embedUrl = args[i + 1]
      i++
    }
  }

  try {
    console.log('Resolving parent cast...')
    const parentCast = await resolveCast(parent)

    console.log('Reply preview:')
    console.log(`  to:      @${parentCast.author.username}: ${(parentCast.text || '').replace(/\s+/g, ' ').slice(0, 100)}`)
    console.log(`  text:    ${text}`)
    console.log(`  chars:   ${text.length}${text.length > 320 ? ' (WARNING: over 320, may be truncated)' : ''}`)
    if (embedUrl) console.log(`  embed:   ${embedUrl}`)
    console.log('')

    if (!send) {
      console.log('NOT POSTED. Rerun with --yes to send exactly the above.')
      return
    }

    console.log('Posting reply...')
    const response = await postCast(text, {
      embedUrl,
      parentHash: parentCast.hash,
      parentFid: parentCast.author.fid,
    })

    console.log('Reply posted successfully!')
    console.log(`Hash: ${response.cast.hash}`)
    console.log(`Link: https://farcaster.xyz/${response.cast.author.username}/${response.cast.hash.slice(0, 10)}`)
  } catch (error) {
    console.error('Error posting reply:', error.message)
    process.exit(1)
  }
}

main()
