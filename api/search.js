// GET /api/search?q=... - search users + casts for the web client. Read-only.

import { searchCasts, searchUsers } from '../lib.js'
import { blockedByAuth } from '../auth.js'

function compactCast(cast) {
  const a = cast.author || {}
  return {
    hash: cast.hash, author: a.username || '?', display: a.display_name || a.username || '?',
    pfp: a.pfp_url || null, fid: a.fid || null, text: cast.text || '', timestamp: cast.timestamp || null,
    power: !!a.power_badge, score: (a.experimental?.neynar_user_score ?? a.score) != null ? Math.round((a.experimental?.neynar_user_score ?? a.score) * 100) / 100 : null,
    channel: cast.channel?.id || null, likes: cast.reactions?.likes_count || 0,
    recasts: cast.reactions?.recasts_count || 0, replies: cast.replies?.count || 0,
    embeds: (cast.embeds || []).map((e) => e.url).filter(Boolean),
    link: `https://farcaster.xyz/${a.username || '?'}/${(cast.hash || '').slice(0, 10)}`,
  }
}

export default async function handler(req, res) {
  if (blockedByAuth(req, res)) return
  try {
    const q = (req.query.q || '').trim()
    if (!q) { res.status(400).json({ error: 'empty query' }); return }
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
