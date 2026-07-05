// GET /api/feed - the reading feed for the web client.
// Query: ?type=following|trending (default following)  ?limit=25  ?cursor=...
// Read-only, returns a compact, safe cast shape for the UI.

import { getFollowingFeed, getTrendingFeed } from '../lib.js'
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
    const type = req.query.type === 'trending' ? 'trending' : 'following'
    const limit = Math.min(Number(req.query.limit) || 25, 50)
    const cursor = req.query.cursor || null

    const data = type === 'trending'
      ? await getTrendingFeed({ limit, cursor })
      : await getFollowingFeed({ limit, cursor })

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      type,
      casts: (data.casts || []).map(compact),
      cursor: data.next?.cursor || null,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'feed failed' })
  }
}
