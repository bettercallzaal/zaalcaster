#!/usr/bin/env node
// channel - read a Farcaster channel feed. Usage: node bin/channel.js <id> [--limit N]
// e.g. node bin/channel.js zao   |   node bin/channel.js wavewarz --limit 15
import { getChannelFeed } from '../lib.js'

async function main() {
  const args = process.argv.slice(2)
  const id = args.find((a) => !a.startsWith('--'))
  if (!id) { console.error('Usage: zaalcaster-channel <channelId> [--limit N]   (e.g. zao, wavewarz, zabal)'); process.exit(1) }
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 20
  const feed = await getChannelFeed(id, { limit })
  const casts = feed.casts || []
  if (!casts.length) { console.log(`/${id} - no casts.`); return }
  for (const c of casts) {
    const u = c.author?.username || '?'
    const link = `https://farcaster.xyz/${u}/${(c.hash || '').slice(0, 10)}`
    const react = `likes:${c.reactions?.likes_count || 0} replies:${c.replies?.count || 0}`
    console.log(`@${u}  ${link}  [${react}]`)
    console.log(`  ${(c.text || '').replace(/\s+/g, ' ').slice(0, 200)}`)
    console.log('')
  }
}
main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
