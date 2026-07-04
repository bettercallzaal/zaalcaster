#!/usr/bin/env node

// channels - recent casts from Zaal's home channels (/zao /wavewarz /zabal),
// or any single channel by id.
//
// Usage: zaalcaster-channels [channelId] [--limit n]
//   no arg      all home channels, interleaved newest first
//   channelId   just that channel (e.g. zao, wavewarz, zabal, farcaster)

import { getChannelFeed, formatCast } from '../lib.js'

const HOME_CHANNELS = ['zao', 'wavewarz', 'zabal']

async function main() {
  const args = process.argv.slice(2)
  let limit = 10
  let channel = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10)
      i++
    } else if (!args[i].startsWith('--')) {
      channel = args[i].replace(/^\//, '')
    }
  }

  // Neynar feed/channels accepts comma-separated channel ids in one call
  const ids = channel ? channel : HOME_CHANNELS.join(',')
  const response = await getChannelFeed(ids, { limit })
  const casts = response.casts || []

  if (casts.length === 0) {
    console.log(`No casts in ${channel ? '/' + channel : HOME_CHANNELS.map((c) => '/' + c).join(' ')}.`)
    return
  }

  for (const cast of casts) {
    const f = formatCast(cast)
    const ch = cast.channel?.id ? `/${cast.channel.id}` : ''
    const link = `https://farcaster.xyz/${cast.author.username}/${f.hash.slice(0, 10)}`
    console.log(`${ch} @${cast.author.username}  ${f.timestamp}  ${link}`)
    console.log(`  ${f.text.replace(/\s+/g, ' ').slice(0, 200)}`)
    console.log(`  replies ${f.replies} | recasts ${f.recasts} | likes ${f.likes}`)
    console.log('')
  }
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
