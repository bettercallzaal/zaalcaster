// GET /api/thread?hash=... - the conversation around a cast (ancestors + cast +
// direct replies) for the tap-to-thread view. Read-only.

import { getConversation } from '../lib.js'

function node(cast) {
  const a = cast.author || {}
  return {
    hash: cast.hash, author: a.username || '?', display: a.display_name || a.username || '?',
    pfp: a.pfp_url || null, fid: a.fid || null, text: cast.text || '', timestamp: cast.timestamp || null,
    likes: cast.reactions?.likes_count || 0, recasts: cast.reactions?.recasts_count || 0,
    replies: cast.replies?.count || 0,
    embeds: (cast.embeds || []).map((e) => e.url).filter(Boolean),
    link: `https://farcaster.xyz/${a.username || '?'}/${(cast.hash || '').slice(0, 10)}`,
  }
}

export default async function handler(req, res) {
  try {
    const hash = (req.query.hash || '').trim()
    if (!hash) { res.status(400).json({ error: 'missing hash' }); return }

    const data = await getConversation(hash, { replyDepth: 2, limit: 30 })
    const conv = data.conversation || {}
    const ancestors = (conv.chronological_parent_casts || []).map(node)
    const root = conv.cast ? node(conv.cast) : null
    const replies = (conv.cast?.direct_replies || []).map((r) => ({ ...node(r), sub: (r.direct_replies || []).map(node) }))

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ ancestors, cast: root, replies })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'thread failed' })
  }
}
