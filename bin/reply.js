#!/usr/bin/env node

import { postCast, getCastDetails } from '../lib.js'

async function main() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.error('Usage: zaalcaster-reply <parentHash> "your reply text" [--embed url]')
    process.exit(1)
  }

  const parentHash = args[0]
  let text = args[1]
  let embedUrl = null

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--embed' && args[i + 1]) {
      embedUrl = args[i + 1]
      i++
    }
  }

  try {
    console.log('Fetching parent cast...')
    const parentResponse = await getCastDetails(parentHash)
    const parentCast = parentResponse.cast

    console.log('Posting reply...')
    const response = await postCast(text, {
      embedUrl,
      parentHash,
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
