#!/usr/bin/env node

// post - publish a cast. Preview is the DEFAULT: without --yes it prints
// exactly what would go out and sends nothing. --yes actually posts.
// This enforces the repo rule: Zaal sees the exact text before anything ships.
//
// Usage: zaalcaster-post "your text" [--embed url] [--channel channelId] [--yes]

import { postCast } from '../lib.js'

async function main() {
  const args = process.argv.slice(2)

  let text = ''
  let embedUrl = null
  let channelId = null
  const send = args.includes('--yes')

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--embed' && args[i + 1]) {
      embedUrl = args[i + 1]
      i++
    } else if (args[i] === '--channel' && args[i + 1]) {
      channelId = args[i + 1]
      i++
    } else if (!args[i].startsWith('--')) {
      text = args[i]
    }
  }

  if (!text) {
    console.error('Usage: zaalcaster-post "your text" [--embed url] [--channel channelId] [--yes]')
    console.error('  without --yes this only previews; nothing is posted')
    process.exit(1)
  }

  console.log('Cast preview:')
  console.log(`  text:    ${text}`)
  console.log(`  chars:   ${text.length}${text.length > 320 ? ' (WARNING: over 320, may be truncated)' : ''}`)
  if (embedUrl) console.log(`  embed:   ${embedUrl}`)
  if (channelId) console.log(`  channel: /${channelId}`)
  console.log('')

  if (!send) {
    console.log('NOT POSTED. Rerun with --yes to send exactly the above.')
    return
  }

  try {
    console.log('Posting to Farcaster...')

    const response = await postCast(text, { embedUrl, channelId })

    console.log('Cast posted successfully!')
    console.log(`Hash: ${response.cast.hash}`)
    console.log(`Link: https://farcaster.xyz/${response.cast.author.username}/${response.cast.hash.slice(0, 10)}`)
  } catch (error) {
    console.error('Error posting cast:', error.message)
    process.exit(1)
  }
}

main()
