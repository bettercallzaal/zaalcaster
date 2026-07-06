// GET /api/view - detail overlays for the web client. Consolidated (thread +
// profile) to stay under Vercel Hobby's 12-function limit.
//   ?kind=thread&hash=<hash>    conversation (ancestors + cast + replies)
//   ?kind=profile&user=<fid|username>   profile + recent casts
// Read-only.

import { getConversation, getUser, getUserCasts, getRelevantFollowers } from '../lib.js'
import { blockedByAuth } from '../auth.js'

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

async function thread(hash, res) {
  const data = await getConversation(hash, { replyDepth: 2, limit: 30 })
  const conv = data.conversation || {}
  const ancestors = (conv.chronological_parent_casts || []).map(compactCast)
  const root = conv.cast ? compactCast(conv.cast) : null
  const replies = (conv.cast?.direct_replies || []).map((r) => ({ ...compactCast(r), sub: (r.direct_replies || []).map(compactCast) }))
  res.status(200).json({ ancestors, cast: root, replies })
}

async function profile(target, res) {
  const user = await getUser(target)
  if (!user) { res.status(404).json({ error: 'user not found' }); return }
  const castsRes = await getUserCasts({ fid: user.fid, limit: 20 }).catch(() => ({ casts: [] }))
  const rel = await getRelevantFollowers(user.fid).catch(() => ({ names: [], count: 0 }))
  const vc = user.viewer_context || {}
  res.status(200).json({
    user: {
      username: user.username, display: user.display_name || user.username, pfp: user.pfp_url || null,
      fid: user.fid, bio: user.profile?.bio?.text || '', followers: user.follower_count || 0,
      following: user.following_count || 0, score: user.experimental?.neynar_user_score ?? null,
      youFollow: !!vc.following, followsYou: !!vc.followed_by,
      mutuals: rel.names.slice(0, 3), mutualCount: rel.count,
      link: `https://farcaster.xyz/${user.username}`,
    },
    casts: (castsRes.casts || []).map(compactCast),
  })
}

export default async function handler(req, res) {
  if (blockedByAuth(req, res)) return
  try {
    res.setHeader('Cache-Control', 'no-store')
    if (req.query.kind === 'profile') {
      const target = (req.query.user || '').trim()
      if (!target) { res.status(400).json({ error: 'missing user' }); return }
      await profile(target, res)
    } else {
      const hash = (req.query.hash || '').trim()
      if (!hash) { res.status(400).json({ error: 'missing hash' }); return }
      await thread(hash, res)
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'view failed' })
  }
}
