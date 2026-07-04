#!/usr/bin/env node

import { postCast } from '../lib.js'

async function main() {
  const args = process.argv.slice(2)

  let text = ''
  let embedUrl = null
  let channelId = null

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
    console.error('Usage: zaalcaster-post "your text" [--embed url] [--channel channelId]')
    process.exit(1)
  }

  try {
    console.log('Posting to Farcaster...')

    const response = await postCast(text, { embedUrl, channelId })

    console.log('Cast posted successfully!')
    console.log(`Hash: ${response.cast.hash}`)
    console.log(`FID: ${response.cast.author.fid}`)
  } catch (error) {
    console.error('Error posting cast:', error.message)
    process.exit(1)
  }
}

main()
