// GET /api/feed - every FEED-SHAPED read: following/for-you/trending/channel
// casts, trending channels, frames, notifications, own-activity, best
// friends, Empire top-list, ZOE tasks. Consolidated under the 12-function
// cap.
//   ?type=following|trending|foryou|channel|list   cast feeds
//   ?trending=1 | ?frames=1 | ?notifs=1 | ?myactivity=1 | ?bestfriends=1
//   ?empire=1 | ?zoe=1
//
// WHY THIS FILE HAS TWO AUTH TIERS INSIDE ONE HANDLER: it is guest-readable
// at the top (blockedByGuestAuth) because public feeds/channels/frames are
// exactly what guests are for - but notifications, own-activity, best
// friends, custom lists, and ZOE tasks are the owner's private data, so
// those branches re-check with blockedByOwner. Splitting into two files
// would spend a function slot to express what four inline checks express
// here. The compact() mappers exist so responses carry a stable, minimal
// cast shape - the frontend never sees raw Neynar objects, which is what
// made the API-drift fallbacks a server-side-only concern.

import { getFollowingFeed, getForYouFeed, getTrendingFeed, getChannelFeed, getTrendingChannels, getFeedByFids, getBestFriends, getNotifications, getChannelNotifications, getMyActivityToday, getFrameCatalog, searchFrames } from '../lib.js'
import { blockedByGuestAuth, getSession } from '../auth.js'
import { getEmpires } from '../empire.js'
import { getOpenTasks } from '../zoe.js'
import { config } from '../config.js'

// modes below that are Zaal-only even though this route is otherwise guest-
// readable (own activity, own notifications, own close-friends seed, a
// custom fid list) - everything else (following/trending/foryou/channel,
// trending channels, frames, Empire reads) is fine for any signed-in guest.
function blockedByOwner(session, res) {
  if (session.role === 'zaal') return false
  res.status(403).json({ error: 'zaal only' })
  return true
}

// flatten a Neynar notification (any shape) into a compact row for the UI
function compactNotif(n) {
  const actors = []
  for (const r of n.reactions || []) if (r.user) actors.push(r.user)
  for (const f of n.follows || []) if (f.user) actors.push(f.user)
  if (n.cast?.author && ['reply', 'mention', 'quote'].includes(n.type)) actors.push(n.cast.author)
  const a0 = actors[0] || {}
  const cast = n.cast || (n.reactions?.[0]?.cast) || null
  return {
    type: n.type || '?',
    actor: a0.username || null,
    actorDisplay: a0.display_name || a0.username || null,
    actorPfp: a0.pfp_url || null,
    actorFid: a0.fid || null,
    others: Math.max(0, actors.length - 1),
    text: (cast?.text || '').replace(/\s+/g, ' ').slice(0, 140),
    hash: cast?.hash || null,
    channel: cast?.channel?.id || null,
    timestamp: n.most_recent_timestamp || null,
    link: cast && a0.username ? `https://farcaster.xyz/${a0.username}/${(cast.hash || '').slice(0, 10)}` : null,
  }
}

function compact(cast) {
  const a = cast.author || {}
  const rawScore = a.experimental?.neynar_user_score ?? a.score ?? null
  return {
    hash: cast.hash,
    author: a.username || '?',
    display: a.display_name || a.username || '?',
    pfp: a.pfp_url || null,
    fid: a.fid || null,
    power: !!a.power_badge,
    score: rawScore != null ? Math.round(rawScore * 100) / 100 : null,
    text: cast.text || '',
    timestamp: cast.timestamp || null,
    channel: cast.channel?.id || null,
    likes: cast.reactions?.likes_count || 0,
    recasts: cast.reactions?.recasts_count || 0,
    replies: cast.replies?.count || 0,
    embeds: embedList(cast),
    link: `https://farcaster.xyz/${a.username || '?'}/${(cast.hash || '').slice(0, 10)}`,
  }
}

// normalize cast embeds to { url, img } so the client can render images inline
function embedList(cast) {
  return (cast.embeds || []).map((e) => {
    const url = e.url
    if (!url) return null
    const ct = e.metadata?.content_type || ''
    const img = ct.startsWith('image/') || !!e.metadata?.image || /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url)
    return { url, img }
  }).filter(Boolean)
}

export default async function handler(req, res) {
  if (blockedByGuestAuth(req, res)) return
  const session = getSession(req)
  try {
    if (req.query.trending === '1') {
      const channels = await getTrendingChannels({ limit: 10 })
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ trending: channels })
      return
    }

    // Frame / mini-app discovery (catalog, or search with ?q=)
    if (req.query.frames === '1') {
      const q = (req.query.q || '').trim()
      const frames = q ? await searchFrames(q, 20) : await getFrameCatalog(24)
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ frames })
      return
    }

    // Today's own activity - drives auto-quests (gm posted? cast? replied?)
    if (req.query.myactivity === '1') {
      if (blockedByOwner(session, res)) return
      const a = await getMyActivityToday()
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ activity: a })
      return
    }

    // Notifications feed (all activity, or scoped to a channel for /zao mentions)
    if (req.query.notifs === '1') {
      if (blockedByOwner(session, res)) return
      const limit = Math.min(Number(req.query.limit) || 25, 25)
      const cursor = req.query.cursor || null
      const channel = (req.query.channel || '').replace(/[^a-zA-Z0-9_,-]/g, '')
      const data = channel
        ? await getChannelNotifications(channel, { limit, cursor })
        : await getNotifications({ limit, cursor })
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ notifs: (data.notifications || []).map(compactNotif), cursor: data.next?.cursor || null })
      return
    }

    // Empire Builder read-only leaderboard (keyless public API, proxied here to
    // dodge browser CORS). Shares empire.js's client (retry/timeout/60s cache)
    // instead of a one-off fetch. Never writes / touches a wallet.
    if (req.query.empire === '1') {
      const type = ['top', 'native', 'recent'].includes(req.query.etype) ? req.query.etype : 'top'
      const r = await getEmpires({ type, limit: 15 })
      const empires = r.ok ? (r.data?.empires || []).map((e) => ({
        id: e.id, name: e.name || e.token_name || e.token_symbol || '?', symbol: e.token_symbol || '',
        rank: e.rank != null ? Math.round(e.rank * 100) / 100 : null,
        treasury: e.treasury || 0, distributed: e.total_distributed || 0,
        logo: e.logo_uri || e.farcaster_pfp || null, native: e.native === 'yes',
        warpcast: e.warpcast_url || null, website: e.website_url || null,
      })) : []
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ empires })
      return
    }

    // seed a "close friends" list from Neynar best-friends (mutual affinity)
    if (req.query.bestfriends === '1') {
      if (blockedByOwner(session, res)) return
      const friends = await getBestFriends({ limit: 20 })
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ friends })
      return
    }

    // ZOE: open tasks from the unified cowork tracker (Zaal-only - private
    // team data). Returns enabled:false when the tracker creds aren't set so
    // the Daily card hides itself instead of erroring.
    if (req.query.zoe === '1') {
      if (blockedByOwner(session, res)) return
      const r = await getOpenTasks(config.trackerOwner || 'Zaal', 8)
      res.setHeader('Cache-Control', 'no-store')
      if (!r.ok) {
        res.status(200).json({ enabled: r.status !== 501, error: r.status === 501 ? null : r.error, tasks: [] })
        return
      }
      res.status(200).json({ enabled: true, error: null, tasks: r.data || [] })
      return
    }

    const limit = Math.min(Number(req.query.limit) || 25, 50)
    const cursor = req.query.cursor || null
    const type = ['trending', 'channel', 'foryou', 'list'].includes(req.query.type) ? req.query.type : 'following'

    let data
    if (type === 'channel') {
      const id = (req.query.id || 'zao,wavewarz,zabal').replace(/[^a-zA-Z0-9,_-]/g, '')
      data = await getChannelFeed(id, { limit, cursor })
    } else if (type === 'trending') {
      data = await getTrendingFeed({ limit, cursor })
    } else if (type === 'foryou') {
      data = await getForYouFeed({ limit, cursor })
    } else if (type === 'list') {
      if (blockedByOwner(session, res)) return
      const fids = String(req.query.fids || '').split(',').filter((f) => /^\d+$/.test(f.trim()))
      data = await getFeedByFids(fids, { limit, cursor })
    } else {
      data = await getFollowingFeed({ limit, cursor })
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ type, casts: (data.casts || []).map(compact), cursor: data.next?.cursor || null })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'feed failed' })
  }
}
