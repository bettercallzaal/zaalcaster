// GET /api/stats - the "what's working" growth view: your best casts, who
// engages you most, and follower count. Read-only.

import { blockedByAuth } from '../auth.js'
import { getUserCasts, getNotifications, getUser, getFollowSuggestions, getStorageUsage } from '../lib.js'
import { getEmpiresByOwner, getEmpireLeaderboards, getEmpireBoosters, getEmpireRewardsSummary, getLeaderboardAddressStats, deployTokenlessEmpire, tokenlessEmpireMessage, addBooster, addBoosterMessage, isValidEmpireId, isValidWalletAddress } from '../empire.js'
import { getCoin } from '../zora.js'
import { config } from '../config.js'

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

// Manual validation, matching this repo's dependency-free convention (no
// zod here - see empire.js's own id/address regex checks). The signature
// itself is verified by Empire Builder, not here; this just rejects
// obviously-malformed requests before spending an API call on them, and
// re-derives the expected message server-side so a tampered client can't
// smuggle a different message than what it claims to have signed.
function validateDeployPayload(body) {
  if (body.mode !== 'custom' && body.mode !== 'farcaster') return 'mode must be "custom" or "farcaster"'
  if (typeof body.owner !== 'string' || !isValidWalletAddress(body.owner)) return 'owner must be a wallet address'
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100) return 'name is required, max 100 chars'
  if (body.bio != null && (typeof body.bio !== 'string' || body.bio.length > 2000)) return 'bio must be a string, max 2000 chars'
  if (body.logoUri != null && typeof body.logoUri !== 'string') return 'logoUri must be a string'
  if (body.mode === 'farcaster') {
    if (typeof body.fid !== 'number' || !Number.isFinite(body.fid) || body.fid <= 0) return 'fid is required for farcaster mode'
    if (typeof body.farcasterUsername !== 'string' || !body.farcasterUsername.trim()) return 'farcasterUsername is required for farcaster mode'
  }
  if (typeof body.signature !== 'string' || !/^0x[a-fA-F0-9]+$/.test(body.signature)) return 'signature must be a 0x hex string'
  const expectedMessage = tokenlessEmpireMessage({ mode: body.mode, name: body.name, fid: body.fid })
  if (body.message !== expectedMessage) return `message does not match the expected text for this name/mode (expected: "${expectedMessage}")`
  return null
}

// Same discipline for add-booster (spec: research doc 1094a). minAmount is a
// raw-units integer string (wei-style) - the client converts from human
// amounts, the server only accepts digits.
function validateBoosterPayload(body) {
  if (!isValidEmpireId(body.empireId)) return 'empireId must be a Base token address or tokenless empire id'
  const b = body.booster
  if (!b || typeof b !== 'object') return 'booster object required'
  if (!['ERC20', 'NFT', 'QUOTIENT'].includes(b.type)) return 'booster.type must be ERC20, NFT, or QUOTIENT'
  if (typeof b.contractAddress !== 'string' || !isValidWalletAddress(b.contractAddress)) return 'booster.contractAddress must be a contract address (the zero address for QUOTIENT)'
  if (typeof b.multiplier !== 'number' || !Number.isFinite(b.multiplier) || b.multiplier < 1.1 || b.multiplier > 5) return 'booster.multiplier must be a number between 1.1 and 5.0'
  if (typeof b.requirement?.minAmount !== 'string' || !/^\d{1,78}$/.test(b.requirement.minAmount)) return 'booster.requirement.minAmount must be a raw-units integer string'
  if (b.chainId != null && (!Number.isInteger(b.chainId) || b.chainId <= 0)) return 'booster.chainId must be a positive integer'
  if (b.tokenId != null && !/^\d{1,78}$/.test(String(b.tokenId))) return 'booster.tokenId must be a numeric token id or null'
  const t = body.tokenInfo
  if (!t || typeof t.name !== 'string' || !t.name.trim() || t.name.length > 100) return 'tokenInfo.name required, max 100 chars'
  if (typeof t.symbol !== 'string' || !t.symbol.trim() || t.symbol.length > 20) return 'tokenInfo.symbol required, max 20 chars'
  if (t.logoURI != null && !/^https?:\/\//.test(String(t.logoURI))) return 'tokenInfo.logoURI must be an http(s) url'
  if (typeof body.signer !== 'string' || !isValidWalletAddress(body.signer)) return 'signer must be a wallet address'
  if (typeof body.signature !== 'string' || !/^0x[a-fA-F0-9]+$/.test(body.signature)) return 'signature must be a 0x hex string'
  if (body.message !== addBoosterMessage(body.empireId)) return `message does not match the expected text (expected: "${addBoosterMessage(body.empireId)}")`
  return null
}

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

  const [boards, boosters, rewards] = await Promise.all([
    getEmpireLeaderboards(empireId),
    getEmpireBoosters(empireId),
    getEmpireRewardsSummary(empireId),
  ])

  const slots = boards.ok ? (boards.data?.leaderboards || (Array.isArray(boards.data) ? boards.data : [])) : []
  const topLeaderboardId = slots[0]?.id || null

  // your own rank/points within the first leaderboard slot - the read
  // functions for this existed since PR #89 but were never surfaced
  // anywhere until now (getLeaderboardAddressStats).
  let mine = null
  if (topLeaderboardId) {
    const stats = await getLeaderboardAddressStats(topLeaderboardId, wallet)
    if (stats.ok && stats.data?.entry) {
      mine = {
        leaderboardName: stats.data.leaderboard?.name || slots[0]?.name || null,
        rank: stats.data.entry.rank ?? null,
        points: stats.data.entry.points ?? null,
        totalRewards: stats.data.entry.totalRewards ?? null,
      }
    }
  }

  // recent reward activity - live-verified shape against ZABAL: distinct
  // arrays empire_rewards/burned_rewards/airdrop_rewards (NOT "burned"/
  // "airdrops" as doc 582 originally described - Empire Builder's actual
  // response uses the _rewards suffix consistently). Compact to counts +
  // most-recent amount so the tab stays a summary, not a ledger.
  const recentReward = (arr) => (arr && arr[0]) ? { amount: arr[0].amount ?? arr[0].total_amount ?? null, type: arr[0].type ?? arr[0].distribution_type ?? null } : null
  const rewardsSummary = rewards.ok ? {
    distributedCount: (rewards.data?.empire_rewards || []).length,
    burnedCount: (rewards.data?.burned_rewards || rewards.data?.burned || []).length,
    airdropCount: (rewards.data?.airdrop_rewards || rewards.data?.airdrops || []).length,
    mostRecentDistribution: recentReward(rewards.data?.empire_rewards),
    mostRecentBurn: recentReward(rewards.data?.burned_rewards || rewards.data?.burned),
  } : null

  return {
    id: empireId,
    name: empire.name || null,
    leaderboardCount: slots.length,
    topLeaderboardId,
    boosters: boosters.ok ? (boosters.data?.boosters || boosters.data || []).slice(0, 8) : [],
    rewards: rewardsSummary,
    mine,
  }
}

// Zora Creator Coin card. Inert until config.zoraCoinAddress is set.
async function zoraSummary() {
  const address = config.zoraCoinAddress
  if (!address) return null
  const coin = await getCoin(address)
  if (!coin.ok) return { error: coin.error }
  return {
    name: coin.data.name,
    symbol: coin.data.symbol,
    priceUsdc: coin.data.tokenPrice?.priceInUsdc ? Number(coin.data.tokenPrice.priceInUsdc) : null,
    marketCap: coin.data.marketCap ? Number(coin.data.marketCap) : null,
    marketCapDelta24h: coin.data.marketCapDelta24h ? Number(coin.data.marketCapDelta24h) : null,
    totalVolume: coin.data.totalVolume ? Number(coin.data.totalVolume) : null,
    url: `https://zora.co/coin/base:${address}`,
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

  // POST = deploy a tokenless empire. The client has already connected a
  // wallet and signed tokenlessEmpireMessage() in it - this endpoint never
  // signs anything, it only relays the already-signed payload to Empire
  // Builder with the server-side API key. Zaal-only (blockedByAuth above),
  // same as every other write route in this app.
  if (req.method === 'POST') {
    const body = await readJsonBody(req)

    // add a booster to an existing empire (same wallet-signed relay model
    // as deploy below - the browser signed, this only forwards)
    if (body.action === 'add_booster') {
      const berr = validateBoosterPayload(body)
      if (berr) { res.status(400).json({ error: berr }); return }
      const result = await addBooster(body.empireId, {
        booster: {
          type: body.booster.type,
          contractAddress: body.booster.contractAddress,
          multiplier: body.booster.multiplier,
          requirement: { minAmount: body.booster.requirement.minAmount },
          chainId: body.booster.chainId ?? 8453,
          tokenId: body.booster.tokenId ?? null,
        },
        signer: body.signer,
        signature: body.signature,
        message: body.message,
        tokenInfo: { name: body.tokenInfo.name.trim(), symbol: body.tokenInfo.symbol.trim(), ...(body.tokenInfo.logoURI ? { logoURI: body.tokenInfo.logoURI } : {}) },
      })
      if (!result.ok) { res.status(502).json({ error: result.error }); return }
      res.status(200).json({ ok: true, boosters: result.data?.boosters || [] })
      return
    }

    const err = validateDeployPayload(body)
    if (err) { res.status(400).json({ error: err }); return }

    const result = await deployTokenlessEmpire({
      mode: body.mode,
      owner: body.owner,
      name: body.name.trim(),
      ...(body.mode === 'farcaster' ? { fid: body.fid, farcasterUsername: body.farcasterUsername } : {}),
      ...(body.bio ? { bio: body.bio } : {}),
      ...(body.logoUri ? { logoUri: body.logoUri } : {}),
      signature: body.signature,
      message: body.message,
    })

    if (!result.ok) { res.status(502).json({ error: result.error }); return }
    res.status(200).json({ ok: true, empire: result.data })
    return
  }

  try {
    const [castsRes, notifs, me, suggestions, storage, empire, zora] = await Promise.all([
      getUserCasts({ limit: 50, includeReplies: false }).catch(() => ({ casts: [] })),
      recentNotifications(4),
      getUser(process.env.FID || '19640').catch(() => null),
      getFollowSuggestions({ limit: 12 }).catch(() => []),
      getStorageUsage().catch(() => null),
      empireSummary().catch(() => null),
      zoraSummary().catch(() => null),
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
      topCasts, topEngagers, suggest, storage, empire, zora,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'stats failed' })
  }
}
