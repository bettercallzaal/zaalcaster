// GET /api/feed - reading feeds for the web client (following, trending,
// channel). Consolidated to stay under Vercel Hobby's 12-function limit.
//   ?type=following|trending       following / trending casts
//   ?type=channel&id=zao,wavewarz  a channel feed
//   ?trending=1                    list of hot channels (chip row)
//   ?limit=25 ?cursor=...
// Read-only, compact safe cast shape.

import { getFollowingFeed, getForYouFeed, getTrendingFeed, getChannelFeed, getTrendingChannels, getFeedByFids, getBestFriends, getNotifications, getChannelNotifications } from '../lib.js'
import { blockedByAuth } from '../auth.js'

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
    embeds: (cast.embeds || []).map((e) => e.url).filter(Boolean),
    link: `https://farcaster.xyz/${a.username || '?'}/${(cast.hash || '').slice(0, 10)}`,
  }
}

export default async function handler(req, res) {
  if (blockedByAuth(req, res)) return
  try {
    if (req.query.trending === '1') {
      const channels = await getTrendingChannels({ limit: 10 })
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ trending: channels })
      return
    }

    // Notifications feed (all activity, or scoped to a channel for /zao mentions)
    if (req.query.notifs === '1') {
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
    // dodge browser CORS). Never writes / touches a wallet.
    if (req.query.empire === '1') {
      const type = ['top', 'native', 'recent'].includes(req.query.etype) ? req.query.etype : 'top'
      const r = await fetch(`https://empirebuilder.world/api/empires?type=${type}&page=1&limit=15`, {
        headers: { accept: 'application/json' },
      })
      const d = await r.json().catch(() => ({}))
      const empires = (d.empires || []).map((e) => ({
        id: e.id, name: e.name || e.token_name || e.token_symbol || '?', symbol: e.token_symbol || '',
        rank: e.rank != null ? Math.round(e.rank * 100) / 100 : null,
        treasury: e.treasury || 0, distributed: e.total_distributed || 0,
        logo: e.logo_uri || e.farcaster_pfp || null, native: e.native === 'yes',
        warpcast: e.warpcast_url || null, website: e.website_url || null,
      }))
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ empires })
      return
    }

    // seed a "close friends" list from Neynar best-friends (mutual affinity)
    if (req.query.bestfriends === '1') {
      const friends = await getBestFriends({ limit: 20 })
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ friends })
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
