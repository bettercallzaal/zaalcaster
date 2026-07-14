// GET /api/stats - the "what's working" growth view: your best casts, who
// engages you most, and follower count. Read-only.

import { blockedByAuth } from '../auth.js'
import { getUserCasts, getNotifications, getUser, getFollowSuggestions, getStorageUsage } from '../lib.js'
import { getEmpiresByOwner, getEmpireLeaderboards, getEmpireBoosters } from '../empire.js'
import { config } from '../config.js'

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

// Empire Builder rank card (research doc 991/1088). Inert until
// config.empireOwnerWallet is set - that only happens once Zaal has stood up
// a tokenless empire in the Empire Builder UI himself (his manual step, not
// this code's). Live-verified shape (2026-07-14, Zaal's own "ZABAL GAMEZ"
// tokenless empire): GET /empires/owner/<wallet> -> { empires: [...] }, and
// the usable id for leaderboards/boosters is base_token, NOT the numeric
// row id - the row `id` (e.g. 6098) 404s against those endpoints.
async function empireSummary() {
  const wallet = config.empireOwnerWallet
  if (!wallet) return null

  const owned = await getEmpiresByOwner(wallet)
  if (!owned.ok) return { error: owned.error }

  const list = owned.data?.empires || owned.data?.data || (Array.isArray(owned.data) ? owned.data : [])
  const empire = list[0]
  if (!empire) return { error: 'no empire found for configured owner wallet' }

  const empireId = empire.base_token || empire.token_address || empire.address
  if (!empireId) return { name: empire.name || null, error: 'empire found but had no usable id' }

  const [boards, boosters] = await Promise.all([
    getEmpireLeaderboards(empireId),
    getEmpireBoosters(empireId),
  ])

  return {
    id: empireId,
    name: empire.name || null,
    leaderboardCount: boards.ok ? (boards.data?.leaderboards?.length ?? boards.data?.length ?? 0) : 0,
    boosters: boosters.ok ? (boosters.data?.boosters || boosters.data || []).slice(0, 8) : [],
  }
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
    const [castsRes, notifs, me, suggestions, storage, empire] = await Promise.all([
      getUserCasts({ limit: 50, includeReplies: false }).catch(() => ({ casts: [] })),
      recentNotifications(4),
      getUser(process.env.FID || '19640').catch(() => null),
      getFollowSuggestions({ limit: 12 }).catch(() => []),
      getStorageUsage().catch(() => null),
      empireSummary().catch(() => null),
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
      topCasts, topEngagers, suggest, storage, empire,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'stats failed' })
  }
}
