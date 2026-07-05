// GET /api/profile?user=<fid|username> - a user's profile + recent casts. Read-only.

import { getUser, getUserCasts } from '../lib.js'

function compactCast(cast) {
  const a = cast.author || {}
  return {
    hash: cast.hash, author: a.username || '?', display: a.display_name || a.username || '?',
    pfp: a.pfp_url || null, fid: a.fid || null, text: cast.text || '', timestamp: cast.timestamp || null,
    channel: cast.channel?.id || null, likes: cast.reactions?.likes_count || 0,
    recasts: cast.reactions?.recasts_count || 0, replies: cast.replies?.count || 0,
    embeds: (cast.embeds || []).map((e) => e.url).filter(Boolean),
    link: `https://farcaster.xyz/${a.username || '?'}/${(cast.hash || '').slice(0, 10)}`,
  }
}

export default async function handler(req, res) {
  try {
    const target = (req.query.user || '').trim()
    if (!target) { res.status(400).json({ error: 'missing user' }); return }

    const user = await getUser(target)
    if (!user) { res.status(404).json({ error: 'user not found' }); return }
    const castsRes = await getUserCasts({ fid: user.fid, limit: 20 }).catch(() => ({ casts: [] }))

    const vc = user.viewer_context || {}
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      user: {
        username: user.username, display: user.display_name || user.username, pfp: user.pfp_url || null,
        fid: user.fid, bio: user.profile?.bio?.text || '', followers: user.follower_count || 0,
        following: user.following_count || 0, score: user.experimental?.neynar_user_score ?? null,
        youFollow: !!vc.following, followsYou: !!vc.followed_by,
        link: `https://farcaster.xyz/${user.username}`,
      },
      casts: (castsRes.casts || []).map(compactCast),
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'profile failed' })
  }
}
