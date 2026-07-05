// GET /api/feed - reading feeds for the web client (following, trending,
// channel). Consolidated to stay under Vercel Hobby's 12-function limit.
//   ?type=following|trending       following / trending casts
//   ?type=channel&id=zao,wavewarz  a channel feed
//   ?trending=1                    list of hot channels (chip row)
//   ?limit=25 ?cursor=...
// Read-only, compact safe cast shape.

import { getFollowingFeed, getTrendingFeed, getChannelFeed, getTrendingChannels } from '../lib.js'
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
    if (req.query.trending === '1') {
      const channels = await getTrendingChannels({ limit: 10 })
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ trending: channels })
      return
    }

    const limit = Math.min(Number(req.query.limit) || 25, 50)
    const cursor = req.query.cursor || null
    const type = ['trending', 'channel'].includes(req.query.type) ? req.query.type : 'following'

    let data
    if (type === 'channel') {
      const id = (req.query.id || 'zao,wavewarz,zabal').replace(/[^a-zA-Z0-9,_-]/g, '')
      data = await getChannelFeed(id, { limit, cursor })
    } else if (type === 'trending') {
      data = await getTrendingFeed({ limit, cursor })
    } else {
      data = await getFollowingFeed({ limit, cursor })
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ type, casts: (data.casts || []).map(compact), cursor: data.next?.cursor || null })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'feed failed' })
  }
}
