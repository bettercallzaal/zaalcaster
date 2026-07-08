// GET /api/stats - the "what's working" growth view: your best casts, who
// engages you most, and follower count. Read-only.

import { blockedByAuth } from '../auth.js'
import { getUserCasts, getNotifications, getUser, getFollowSuggestions, getStorageUsage, loadEnv } from '../lib.js'

// engagement weight: replies + recasts count more than likes (they spread you)
function score(c) {
  return (c.reactions?.likes_count || 0) + 2 * (c.reactions?.recasts_count || 0) + 1.5 * (c.replies?.count || 0)
}

// pull actor users out of a notification, whatever its shape
function actors(n) {
  const out = []
  if (n.cast?.author?.username) out.push(n.cast.author)
  for (const r of n.reactions || []) if (r.user?.username) out.push(r.user)
  for (const f of n.follows || []) if (f.user?.username) out.push(f.user)
  return out
}

// pull several pages of notifications so "who engages you" is deep, not just
// the last 25. Caps at 4 pages (100 notifs) to stay fast.
async function recentNotifications(pages = 4) {
  let cursor = null
  const all = []
  for (let p = 0; p < pages; p++) {
    const res = await getNotifications({ limit: 25, cursor }).catch(() => ({ notifications: [] }))
    all.push(...(res.notifications || []))
    cursor = res.next?.cursor
    if (!cursor) break
  }
  return all
}

export default async function handler(req, res) {
  if (blockedByAuth(req, res)) return
  try {
    const [castsRes, notifs, me, suggestions, storage] = await Promise.all([
      getUserCasts({ limit: 50, includeReplies: false }).catch(() => ({ casts: [] })),
      recentNotifications(4),
      getUser(loadEnv().FID).catch(() => null),
      getFollowSuggestions({ limit: 12 }).catch(() => []),
      getStorageUsage().catch(() => null),
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
    for (const n of notifs) for (const u of actors(n)) {
      if (!u.username || u.username === 'zaal') continue
      const cur = counts.get(u.username) || { username: u.username, fid: u.fid || null, pfp: u.pfp_url || null, n: 0 }
      cur.n++; counts.set(u.username, cur)
    }
    const topEngagers = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 12)
      .map((e, i) => ({ ...e, rank: i + 1 }))

    const suggest = (suggestions || []).map((u) => ({
      username: u.username, display: u.display_name || u.username, pfp: u.pfp_url || null,
      followers: u.follower_count || 0, bio: (u.profile?.bio?.text || '').replace(/\s+/g, ' ').slice(0, 90),
    })).slice(0, 12)

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      followers: me?.follower_count ?? null,
      following: me?.following_count ?? null,
      score: me?.experimental?.neynar_user_score ?? null,
      topCasts, topEngagers, suggest, storage,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'stats failed' })
  }
}
