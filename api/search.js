// GET /api/search?q=... - search users + casts (guest-readable, public
// network data), plus ?zao=1 for "Ask ZAO" - the Bonfire knowledge-graph
// search (owner-only: the graph is the ZAO's internal memory of meetings
// and decisions, not public data - which is why one file carries two auth
// tiers, same pattern as api/feed.js). Read-only.

import { searchCasts, searchUsers } from '../lib.js'
import { blockedByGuestAuth, getSession } from '../auth.js'
import { delve } from '../zoe.js'

function compactCast(cast) {
  const a = cast.author || {}
  return {
    hash: cast.hash, author: a.username || '?', display: a.display_name || a.username || '?',
    pfp: a.pfp_url || null, fid: a.fid || null, text: cast.text || '', timestamp: cast.timestamp || null,
    power: !!a.power_badge, score: (a.experimental?.neynar_user_score ?? a.score) != null ? Math.round((a.experimental?.neynar_user_score ?? a.score) * 100) / 100 : null,
    channel: cast.channel?.id || null, likes: cast.reactions?.likes_count || 0,
    recasts: cast.reactions?.recasts_count || 0, replies: cast.replies?.count || 0,
    embeds: (cast.embeds || []).map((e) => { const url = e.url; if (!url) return null; const ct = e.metadata?.content_type || ''; return { url, img: ct.startsWith('image/') || !!e.metadata?.image || /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url) } }).filter(Boolean),
    link: `https://farcaster.xyz/${a.username || '?'}/${(cast.hash || '').slice(0, 10)}`,
  }
}

export default async function handler(req, res) {
  if (blockedByGuestAuth(req, res)) return
  try {
    const q = (req.query.q || '').trim()
    if (!q) { res.status(400).json({ error: 'empty query' }); return }

    // Ask ZAO: search the Bonfire knowledge graph (Zaal-only - internal
    // institutional memory, not public data like the cast search below).
    if (req.query.zao === '1') {
      const session = getSession(req)
      if (!session || session.role !== 'zaal') { res.status(403).json({ error: 'zaal only' }); return }
      const r = await delve(q)
      res.setHeader('Cache-Control', 'no-store')
      if (!r.ok) { res.status(r.status === 501 ? 501 : 502).json({ error: r.error }); return }
      const episodes = (r.data.episodes || []).slice(0, 10).map((e) => ({
        name: e.name || null,
        content: (e.content || '').slice(0, 600),
        source: e.source_description || null,
        at: e.valid_at || null,
      }))
      res.status(200).json({ q, results: r.data.num_results ?? episodes.length, episodes })
      return
    }
    const channel = (req.query.channel || '').replace(/[^a-zA-Z0-9_-]/g, '') || null

    const [users, casts] = await Promise.all([
      searchUsers(q, { limit: 8 }).catch(() => ({ result: { users: [] } })),
      searchCasts(q, { limit: 20, channelId: channel }).catch(() => ({ result: { casts: [] } })),
    ])
    const userList = (users.result?.users || users.users || []).map((u) => ({
      username: u.username, display: u.display_name || u.username, pfp: u.pfp_url || null, fid: u.fid,
      followers: u.follower_count || 0, bio: (u.profile?.bio?.text || '').slice(0, 120),
    }))
    const castList = (casts.result?.casts || casts.casts || []).map(compactCast)

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ q, channel, users: userList, casts: castList })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'search failed' })
  }
}
