// GET /api/channel - channel feed for the web client.
// Query: ?id=zao  (comma-separated ids ok, e.g. zao,wavewarz,zabal)  ?limit=25
// Read-only, same compact cast shape as /api/feed.

import { getChannelFeed, getTrendingChannels } from '../lib.js'
import { blockedByAuth } from '../auth.js'

function compact(cast) {
  const a = cast.author || {}
  return {
    hash: cast.hash,
    author: a.username || '?',
    display: a.display_name || a.username || '?',
    pfp: a.pfp_url || null,
    fid: a.fid || null,
    text: cast.text || '',
    timestamp: cast.timestamp || null,
    channel: cast.channel?.id || null,
    likes: cast.reactions?.likes_count || 0,
    recasts: cast.reactions?.recasts_count || 0,
    replies: cast.replies?.count || 0,
    embeds: (cast.embeds || []).map((e) => e.url).filter(Boolean),
    link: `https://farcaster.xyz/${a.username || '?'}/${(cast.hash || '').slice(0, 10)}`,
  }
}

export default async function handler(req, res) {
  if (blockedByAuth(req, res)) return
  try {
    // ?trending=1 -> just the list of hot channels (for the chip row)
    if (req.query.trending === '1') {
      const channels = await getTrendingChannels({ limit: 10 })
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ trending: channels })
      return
    }
    const id = (req.query.id || 'zao,wavewarz,zabal').replace(/[^a-zA-Z0-9,_-]/g, '')
    const limit = Math.min(Number(req.query.limit) || 25, 50)
    const cursor = req.query.cursor || null
    const data = await getChannelFeed(id, { limit, cursor })

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ id, casts: (data.casts || []).map(compact), cursor: data.next?.cursor || null })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'channel failed' })
  }
}
