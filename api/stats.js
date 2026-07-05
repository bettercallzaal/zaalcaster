// GET /api/stats - the "what's working" growth view: your best casts, who
// engages you most, and follower count. Read-only.

import { blockedByAuth } from '../auth.js'
import { getUserCasts, getNotifications, getUser } from '../lib.js'

// engagement weight: replies + recasts count more than likes (they spread you)
function score(c) {
  return (c.reactions?.likes_count || 0) + 2 * (c.reactions?.recasts_count || 0) + 1.5 * (c.replies?.count || 0)
}

// pull actor usernames out of a notification, whatever its shape
function actors(n) {
  const out = []
  if (n.cast?.author?.username) out.push(n.cast.author.username)
  for (const r of n.reactions || []) if (r.user?.username) out.push(r.user.username)
  for (const f of n.follows || []) if (f.user?.username) out.push(f.user.username)
  return out
}

export default async function handler(req, res) {
  if (blockedByAuth(req, res)) return
  try {
    const [castsRes, notifsRes, me] = await Promise.all([
      getUserCasts({ limit: 50, includeReplies: false }).catch(() => ({ casts: [] })),
      getNotifications({ limit: 25 }).catch(() => ({ notifications: [] })),
      getUser(process.env.ZAAL_FID || '19640').catch(() => null),
    ])

    const topCasts = (castsRes.casts || [])
      .map((c) => ({
        hash: c.hash, text: (c.text || '').replace(/\s+/g, ' '), timestamp: c.timestamp || null,
        likes: c.reactions?.likes_count || 0, recasts: c.reactions?.recasts_count || 0,
        replies: c.replies?.count || 0, score: Math.round(score(c) * 10) / 10,
        link: `https://farcaster.xyz/${c.author?.username || 'zaal'}/${(c.hash || '').slice(0, 10)}`,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)

    const counts = new Map()
    for (const n of notifsRes.notifications || []) for (const u of actors(n)) counts.set(u, (counts.get(u) || 0) + 1)
    const topEngagers = [...counts.entries()].filter(([u]) => u && u !== 'zaal')
      .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([username, n]) => ({ username, n }))

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      followers: me?.follower_count ?? null,
      following: me?.following_count ?? null,
      score: me?.experimental?.neynar_user_score ?? null,
      topCasts, topEngagers,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'stats failed' })
  }
}
