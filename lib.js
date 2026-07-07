import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const ENV_PATH = path.join(process.env.HOME || '', '.zao/private/farcaster-zaal.env')
// Personal spam list - usernames and/or fids to drop from the inbound work
// list. Lives outside the repo (never committed). One entry per line, '#'
// comments allowed; a bare username (no @) or a numeric fid.
export const SPAM_PATH = path.join(process.env.HOME || '', '.zao/private/zaalcaster-spam.txt')
const NEYNAR_BASE_URL = 'https://api.neynar.com/v2'

let env = null

// Env resolves from two places so the same lib runs as a local CLI and as a
// Vercel serverless function. Generic names (USER_FID / SIGNER_UUID) are
// canonical; the ZAAL_* names are kept as backward-compatible fallbacks so an
// existing deploy keeps working. Internally we expose env.FID / env.SIGNER.
//   1. process.env - Vercel (set NEYNAR_API_KEY / USER_FID / SIGNER_UUID).
//   2. ~/.zao/private/farcaster-zaal.env - the local CLI creds file.
// Throws (never process.exit) so serverless handlers can catch and return 500.
export function loadEnv() {
  if (env) return env

  if (process.env.NEYNAR_API_KEY) {
    env = {
      NEYNAR_API_KEY: process.env.NEYNAR_API_KEY,
      FID: process.env.USER_FID || process.env.ZAAL_FID || config.fid,
      SIGNER: process.env.SIGNER_UUID || process.env.ZAAL_SIGNER_UUID || '',
    }
    return env
  }

  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(
      `Missing credentials. Set NEYNAR_API_KEY (+ USER_FID, SIGNER_UUID) in the ` +
      `environment, or create ${ENV_PATH} with NEYNAR_API_KEY / SIGNER_UUID / USER_FID.`,
    )
  }

  const parsed = {}
  const content = fs.readFileSync(ENV_PATH, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const [key, ...rest] = trimmed.split('=')
    parsed[key] = rest.join('=')
    // export KV/store creds to process.env so store.js works in CLI tools too
    // (cockpit snooze, action ledger, health check) - Vercel already sets these.
    // Trim + strip quotes so a stray \r / quote from the file can't break fetch.
    if (/_REST_API_(URL|TOKEN)$/.test(key) && !process.env[key]) process.env[key] = parsed[key].trim().replace(/^["']|["']$/g, '')
  }

  if (!parsed.NEYNAR_API_KEY) throw new Error(`Missing NEYNAR_API_KEY in ${ENV_PATH}`)

  env = {
    NEYNAR_API_KEY: parsed.NEYNAR_API_KEY,
    FID: parsed.USER_FID || parsed.ZAAL_FID || config.fid,
    SIGNER: parsed.SIGNER_UUID || parsed.ZAAL_SIGNER_UUID || '',
  }
  if (!env.FID) throw new Error(`Missing USER_FID (or ZAAL_FID) in ${ENV_PATH}`)
  return env
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchNeynar(endpoint, options = {}) {
  const env = loadEnv()
  const url = `${NEYNAR_BASE_URL}${endpoint}`
  const headers = {
    'X-API-Key': env.NEYNAR_API_KEY,
    'Content-Type': 'application/json',
    ...options.headers,
  }

  // rate-limit guard: on 429, honor Retry-After (or back off) and retry twice
  // so a busy day / live Space degrades gracefully instead of silently failing.
  let res
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, { ...options, headers })
    if (res.status !== 429) break
    const ra = Number(res.headers.get('retry-after'))
    const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 400 * (attempt + 1)
    if (attempt < 2) await sleep(Math.min(wait, 3000))
  }

  const json = await res.json().catch(() => ({}))

  if (!res.ok) {
    const detail = json?.message || JSON.stringify(json).slice(0, 200)
    throw new Error(`Neynar API error ${res.status}: ${detail}`)
  }

  return json
}

// Append-only action ledger: a local record of every write the tool actually
// made (cast/reply/like/recast/delete/scheduled), so a bad post is auditable
// without depending on Farcaster. Best-effort - never blocks or breaks a post.
export async function logAction(type, detail = {}) {
  try {
    const { kvPush } = await import('./store.js')
    await kvPush('zc:actions', { type, at: new Date().toISOString(), ...detail }, 1000)
  } catch { /* store off / unreachable - skip logging */ }
}

// System self-check: is posting wired up, and did the scheduled-post cron run
// recently? Surfaces the exact two failures that silently broke automation
// before (deploy rate-limit killing cron, signer/api-key mismatch).
export async function getSystemHealth() {
  const posting = await getPostingHealth().catch(() => ({ ready: false, reason: 'error' }))
  let cronLast = null, cronStaleHours = null
  try {
    const { kvGet } = await import('./store.js')
    const c = await kvGet('zc:cron:last')
    if (c?.at) { cronLast = c.at; cronStaleHours = Math.round((Date.now() - Date.parse(c.at)) / 36e5 * 10) / 10 }
  } catch { /* store off */ }
  return { posting, cronLast, cronStaleHours, ok: !!posting.ready && (cronStaleHours == null || cronStaleHours < 1) }
}

export async function getFollowingFeed(options = {}) {
  const { limit = 20, cursor = null } = options
  const env = loadEnv()

  const params = new URLSearchParams({
    fid: env.FID,
    limit: String(limit),
  })

  if (cursor) params.append('cursor', cursor)

  const response = await fetchNeynar(`/farcaster/feed/following?${params}`)
  return response
}

// Neynar's algorithmic "for you" feed - ranked casts it thinks Zaal will like,
// beyond just who he follows. A discovery + growth surface.
export async function getForYouFeed(options = {}) {
  const { limit = 20, cursor = null } = options
  const env = loadEnv()

  const params = new URLSearchParams({
    fid: env.FID,
    viewer_fid: env.FID,
    limit: String(limit),
  })

  if (cursor) params.append('cursor', cursor)

  const response = await fetchNeynar(`/farcaster/feed/for_you?${params}`)
  return response
}

// Feed of just the fids in a list - a curated timeline. Neynar filter feed.
export async function getFeedByFids(fids, options = {}) {
  const { limit = 25, cursor = null } = options
  const env = loadEnv()
  const clean = (Array.isArray(fids) ? fids : String(fids).split(','))
    .map((f) => String(f).trim()).filter((f) => /^\d+$/.test(f)).slice(0, 100)
  if (!clean.length) return { casts: [] }

  const params = new URLSearchParams({
    feed_type: 'filter',
    filter_type: 'fids',
    fids: clean.join(','),
    viewer_fid: env.FID,
    limit: String(limit),
  })
  if (cursor) params.append('cursor', cursor)

  const response = await fetchNeynar(`/farcaster/feed?${params}`)
  return response
}

// Best friends - people Zaal has the highest mutual affinity with (real back
// and forth). One call to seed a "close friends" list.
export async function getBestFriends(options = {}) {
  const { limit = 20 } = options
  const env = loadEnv()
  const params = new URLSearchParams({ fid: env.FID, limit: String(limit) })
  const response = await fetchNeynar(`/farcaster/user/best_friends?${params}`)
  return (response.users || response || []).map((u) => ({
    fid: u.fid, username: u.username, score: u.mutual_affinity_score ?? null,
  })).filter((u) => u.fid)
}

export async function getChannelFeed(channelId, options = {}) {
  const { limit = 20, cursor = null } = options

  const params = new URLSearchParams({
    channel_ids: channelId,
    limit: String(limit),
  })

  if (cursor) params.append('cursor', cursor)

  const response = await fetchNeynar(`/farcaster/feed/channels?${params}`)
  return response
}

// Trending channels right now - where the action is, so Zaal can jump in.
export async function getTrendingChannels(options = {}) {
  const { limit = 10, timeWindow = '1d' } = options
  const params = new URLSearchParams({ limit: String(limit), time_window: timeWindow })
  const response = await fetchNeynar(`/farcaster/channel/trending?${params}`)
  return (response.channels || []).map((a) => {
    const c = a.channel || a
    return { id: c.id, name: c.name || c.id, image: c.image_url || null, casts1d: Number(a.cast_count_1d || 0) }
  }).filter((c) => c.id)
}

// Suggested accounts to follow/engage - people Neynar thinks are relevant to
// Zaal but that he is not already deep with. A growth surface.
export async function getFollowSuggestions(options = {}) {
  const { limit = 12 } = options
  const env = loadEnv()
  const params = new URLSearchParams({ fid: env.FID, limit: String(limit) })
  const response = await fetchNeynar(`/farcaster/following/suggested?${params}`)
  return response.users || []
}

export async function getTrendingFeed(options = {}) {
  const { limit = 20, cursor = null, timeWindow = '24h' } = options

  const params = new URLSearchParams({
    limit: String(limit),
    time_window: timeWindow,
  })

  if (cursor) params.append('cursor', cursor)

  const response = await fetchNeynar(`/farcaster/feed/trending?${params}`)
  return response
}

export async function getNotifications(options = {}) {
  const { limit = 20, cursor = null } = options
  const env = loadEnv()

  const params = new URLSearchParams({
    fid: env.FID,
    limit: String(limit),
  })

  if (cursor) params.append('cursor', cursor)

  const response = await fetchNeynar(`/farcaster/notifications?${params}`)
  return response
}

// Notifications scoped to specific channels (e.g. just your /zao mentions).
export async function getChannelNotifications(channelIds, options = {}) {
  const { limit = 20, cursor = null } = options
  const env = loadEnv()
  const params = new URLSearchParams({
    fid: env.FID,
    channel_ids: Array.isArray(channelIds) ? channelIds.join(',') : channelIds,
    limit: String(Math.min(limit, 25)),
  })
  if (cursor) params.append('cursor', cursor)
  const response = await fetchNeynar(`/farcaster/notifications/channel?${params}`)
  return response
}

export async function searchCasts(query, options = {}) {
  const { limit = 20, channelId = null, authorFid = null } = options

  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  })
  if (channelId) params.append('channel_id', channelId)
  if (authorFid) params.append('author_fid', String(authorFid))

  const response = await fetchNeynar(`/farcaster/cast/search?${params}`)
  return response
}

export async function searchUsers(query, options = {}) {
  const { limit = 8 } = options
  const env = loadEnv()
  const params = new URLSearchParams({ q: query, limit: String(limit), viewer_fid: env.FID })
  const response = await fetchNeynar(`/farcaster/user/search?${params}`)
  return response
}

// Bulk user lookup (with Zaal as viewer, for scores + follow context).
export async function getUsersByFids(fids) {
  if (!fids.length) return []
  const env = loadEnv()
  const params = new URLSearchParams({ fids: fids.join(','), viewer_fid: env.FID })
  const response = await fetchNeynar(`/farcaster/user/bulk?${params}`)
  return response.users || []
}

// Farcaster frames / mini-apps to discover. compactFrame normalizes the shape.
function compactFrame(f) {
  const name = f.manifest?.frame?.name || f.metadata?.html?.ogTitle || f.author?.username || 'frame'
  return {
    name,
    image: f.image || f.manifest?.frame?.imageUrl || f.metadata?.html?.ogImage?.[0]?.url || null,
    url: f.frames_url || f.manifest?.frame?.homeUrl || null,
    author: f.author?.username || null,
  }
}
export async function getFrameCatalog(limit = 24) {
  const response = await fetchNeynar(`/farcaster/frame/catalog?limit=${limit}`)
  return (response.frames || []).map(compactFrame).filter((f) => f.url)
}
export async function searchFrames(query, limit = 20) {
  const response = await fetchNeynar(`/farcaster/frame/search?q=${encodeURIComponent(query)}&limit=${limit}`)
  return (response.frames || []).map(compactFrame).filter((f) => f.url)
}

// Neynar's AI summary of a whole conversation/thread - one call, no LLM of ours.
export async function getConversationSummary(hashOrUrl) {
  let hash = hashOrUrl
  if (/^https?:\/\//.test(String(hashOrUrl))) { const c = await resolveCast(hashOrUrl).catch(() => null); if (c?.hash) hash = c.hash }
  const params = new URLSearchParams({ identifier: hash, type: 'hash' })
  const response = await fetchNeynar(`/farcaster/cast/conversation/summary?${params}`)
  return response?.summary?.text || null
}

// Zaal's own highest-engagement casts - the "these worked" signal for voice
// learning (replies/recasts weigh more than likes - they spread you).
export async function getTopCasts(limit = 8) {
  const res = await getUserCasts({ limit: 50, includeReplies: false }).catch(() => ({ casts: [] }))
  return (res.casts || [])
    .map((c) => ({
      text: (c.text || '').replace(/\s+/g, ' ').trim(),
      score: (c.reactions?.likes_count || 0) + 2 * (c.reactions?.recasts_count || 0) + 1.5 * (c.replies?.count || 0),
    }))
    .filter((c) => c.text.length > 12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

// A user's most-engaged (popular) casts - the highlight reel for a profile.
export async function getUserPopular(fid) {
  const response = await fetchNeynar(`/farcaster/feed/user/popular?fid=${fid}`)
  return response.casts || []
}

// Which external accounts a user has verified (x / github / etc). Farcaster
// protocol endpoint (no Neynar key needed).
export async function getAccountVerifications(fid) {
  try {
    const r = await fetch(`https://api.farcaster.xyz/fc/account-verifications?fid=${fid}`)
    const d = await r.json().catch(() => ({}))
    return (d?.result?.verifications || []).map((v) => ({ platform: v.platform, id: v.platformId }))
  } catch { return [] }
}

// Delete one of Zaal's own casts (irreversible). The UI must confirm first.
export async function deleteCast(targetHash) {
  const env = loadEnv()
  const response = await fetchNeynar('/farcaster/cast', {
    method: 'DELETE',
    body: JSON.stringify({ signer_uuid: requireSigner(env), target_hash: targetHash }),
  })
  await logAction('delete', { hash: targetHash })
  return response
}

// Mutual-follower social proof: people Zaal follows who ALSO follow the target.
// "followed by alice, bob + 3 more you follow". Returns { names, count }.
export async function getRelevantFollowers(targetFid) {
  const env = loadEnv()
  const params = new URLSearchParams({ target_fid: String(targetFid), viewer_fid: env.FID })
  const response = await fetchNeynar(`/farcaster/followers/relevant?${params}`)
  const hydrated = response.top_relevant_followers_hydrated || []
  const names = hydrated.map((h) => (h.user || h).username).filter(Boolean)
  const all = response.all_relevant_followers_dehydrated || hydrated
  return { names, count: all.length || names.length }
}

// Look up a user by fid (number) or username (with or without @).
// viewer_fid is Zaal so the result includes follow relationship both ways.
export async function getUser(fidOrUsername) {
  const env = loadEnv()
  const raw = String(fidOrUsername).replace(/^@/, '')

  if (/^\d+$/.test(raw)) {
    const params = new URLSearchParams({ fids: raw, viewer_fid: env.FID })
    const response = await fetchNeynar(`/farcaster/user/bulk?${params}`)
    return response.users?.[0] || null
  }

  const params = new URLSearchParams({ username: raw, viewer_fid: env.FID })
  const response = await fetchNeynar(`/farcaster/user/by_username?${params}`)
  return response.user || null
}

// Is posting actually wired up? Checks the signer resolves under the API key.
// Returns { ready, reason }: ok | no-signer | mismatch | error.
export async function getPostingHealth() {
  const env = loadEnv()
  if (!env.SIGNER) return { ready: false, reason: 'no-signer' }
  try {
    const res = await fetch(`${NEYNAR_BASE_URL}/farcaster/signer?signer_uuid=${env.SIGNER}`, {
      headers: { 'X-API-Key': env.NEYNAR_API_KEY },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 404) return { ready: false, reason: 'mismatch' }
    if (!res.ok) return { ready: false, reason: 'error' }
    const d = await res.json()
    return d.status === 'approved' ? { ready: true, reason: 'ok', fid: d.fid } : { ready: false, reason: d.status || 'not-approved' }
  } catch {
    return { ready: false, reason: 'error' }
  }
}

function requireSigner(env) {
  if (!env.SIGNER) {
    throw new Error('SIGNER_UUID missing - run npm run mint-signer (or set it in the env). Reads work without it.')
  }
  return env.SIGNER
}

// Map raw Neynar/post errors to something the user can act on.
export function friendlyPostError(err) {
  const m = err instanceof Error ? err.message : String(err || 'post failed')
  if (/signer not found/i.test(m)) {
    return "Posting isn't set up: your Neynar API key and signer don't match. Re-copy BOTH NEYNAR_API_KEY and SIGNER_UUID from your creds file into the env (they must be the same pair)."
  }
  if (/SIGNER_UUID missing/i.test(m)) {
    return 'Posting is off: no signer set. Run npm run mint-signer, then set SIGNER_UUID in the env.'
  }
  return m
}

export async function postCast(text, options = {}) {
  const { embedUrl = null, parentHash = null, parentFid = null, channelId = null,
    quoteHash = null, quoteFid = null } = options
  const env = loadEnv()

  const payload = {
    signer_uuid: requireSigner(env),
    text,
  }

  const embeds = []
  if (embedUrl) embeds.push({ url: embedUrl })
  // quote cast: embed another cast by id (needs both hash + author fid)
  if (quoteHash && quoteFid) embeds.push({ cast_id: { hash: quoteHash, fid: parseInt(quoteFid, 10) } })
  if (embeds.length) payload.embeds = embeds

  if (parentHash) {
    payload.parent = parentHash
    if (parentFid) payload.parent_author_fid = parseInt(parentFid, 10)
  }

  if (channelId) {
    payload.channel_id = channelId
  }

  const response = await fetchNeynar('/farcaster/cast', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  await logAction(parentHash ? 'reply' : (quoteHash ? 'quote' : 'cast'), {
    hash: response?.cast?.hash || null, text: (text || '').slice(0, 100), channel: channelId || null,
  })
  return response
}

// What Zaal actually did today - used to auto-tick quests. Read-only, from his
// own recent casts. { gm, posts, replies, total }.
export async function getMyActivityToday() {
  const res = await getUserCasts({ limit: 40, includeReplies: true }).catch(() => ({ casts: [] }))
  const today = new Date().toISOString().slice(0, 10)
  let gm = false, posts = 0, replies = 0
  for (const c of res.casts || []) {
    if (!(c.timestamp || '').startsWith(today)) continue
    const isReply = !!(c.parent_hash || c.parent_author?.fid)
    if (isReply) replies++; else posts++
    if (/(^|\s)g\s?m($|\s|,|!|\.)/i.test(c.text || '')) gm = true
  }
  return { gm, posts, replies, total: posts + replies }
}

// reaction_type: 'like' or 'recast'. Zaal running the command is the approval.
export async function postReaction(reactionType, targetHash, targetAuthorFid = null) {
  const env = loadEnv()

  const payload = {
    signer_uuid: requireSigner(env),
    reaction_type: reactionType,
    target: targetHash,
  }
  if (targetAuthorFid) payload.target_author_fid = parseInt(targetAuthorFid, 10)

  const response = await fetchNeynar('/farcaster/reaction', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  await logAction(reactionType, { hash: targetHash })
  return response
}

// Follow / unfollow a user by fid. Protocol link add/remove - reversible, needs
// the signer. follow=true adds, false removes. Logs to the action ledger.
export async function setFollow(targetFid, follow = true) {
  const env = loadEnv()
  const fid = parseInt(targetFid, 10)
  if (!Number.isFinite(fid)) throw new Error('invalid target fid')
  const response = await fetchNeynar('/farcaster/user/follow', {
    method: follow ? 'POST' : 'DELETE',
    body: JSON.stringify({ signer_uuid: requireSigner(env), target_fids: [fid] }),
  })
  await logAction(follow ? 'follow' : 'unfollow', { fid })
  return response
}

// Read-only onchain token balances (Base) for a fid. Returns the top holdings by
// USD so a profile can show "what they hold" - context, never a money move.
export async function getTokenBalances(fid = null) {
  const env = loadEnv()
  const f = String(fid || env.FID)
  const data = await fetchNeynar(`/farcaster/user/balance?fid=${f}&networks=base`)
  const out = []
  for (const ab of (data.user_balance?.address_balances || [])) {
    for (const t of (ab.token_balances || [])) {
      const usd = Number(t.balance?.in_usdc) || 0
      out.push({ symbol: t.token?.symbol || '?', amount: Number(t.balance?.in_token) || 0, usd })
    }
  }
  return out.sort((a, b) => b.usd - a.usd).slice(0, 6)
}

// Protocol mute / block a user (or reverse it). Personal, reversible list writes
// that sync to your Farcaster app - unlike the app's local keyword mute. Uses the
// api key + your fid (Neynar-managed lists), not the signer.
export async function setMuteBlock(targetFid, kind, on = true) {
  const env = loadEnv()
  const target = parseInt(targetFid, 10)
  if (!Number.isFinite(target)) throw new Error('invalid target fid')
  const me = parseInt(env.FID, 10)
  const path = kind === 'block' ? '/farcaster/block' : '/farcaster/mute'
  const body = kind === 'block'
    ? { blocker_fid: me, blocked_fid: target }
    : { fid: me, muted_fid: target }
  const response = await fetchNeynar(path, { method: on ? 'POST' : 'DELETE', body: JSON.stringify(body) })
  await logAction(`${on ? '' : 'un'}${kind}`, { fid: target })
  return response
}

// Update your own Farcaster profile (bio / display name / pfp / url). A UserData
// write - public, needs the signer. Only sends fields you pass. Logs the change.
export async function updateProfile(fields = {}) {
  const env = loadEnv()
  const allowed = ['bio', 'display_name', 'pfp_url', 'url', 'username', 'location']
  const payload = { signer_uuid: requireSigner(env) }
  for (const k of allowed) if (typeof fields[k] === 'string' && fields[k].length) payload[k] = fields[k]
  if (Object.keys(payload).length === 1) throw new Error('no profile fields to update')
  const response = await fetchNeynar('/farcaster/user', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  await logAction('profile-update', { fields: Object.keys(payload).filter((k) => k !== 'signer_uuid') })
  return response
}

// Read-only storage usage for a fid (defaults to you). Returns per-store used /
// capacity so the UI can warn when old casts are about to get pruned.
export async function getStorageUsage(fid = null) {
  const env = loadEnv()
  const f = String(fid || env.FID)
  const data = await fetchNeynar(`/farcaster/storage/usage?fid=${f}`)
  const pick = (o) => (o && typeof o.used === 'number') ? { used: o.used, capacity: o.capacity || 0 } : null
  return {
    units: data.total_active_units ?? null,
    casts: pick(data.casts),
    reactions: pick(data.reactions),
    links: pick(data.links),
  }
}

export async function getCastDetails(castHash) {
  const response = await fetchNeynar(`/farcaster/cast?identifier=${castHash}&type=hash`)
  return response
}

// Resolve a cast from either a full/short hash or a farcaster.xyz URL
// (https://farcaster.xyz/<username>/<0x + first 8 hash chars> - the link
// format engage/channels print). Neynar accepts the URL as identifier.
export async function resolveCast(hashOrUrl) {
  const isUrl = hashOrUrl.startsWith('http')
  const params = new URLSearchParams({
    identifier: hashOrUrl,
    type: isUrl ? 'url' : 'hash',
  })
  const response = await fetchNeynar(`/farcaster/cast?${params}`)
  return response.cast
}

// Recent casts for a fid (defaults to Zaal) - engage uses it to filter answered
export async function getUserCasts(options = {}) {
  const { fid = null, limit = 50, includeReplies = true, cursor = null } = options
  const env = loadEnv()

  const params = new URLSearchParams({
    fid: String(fid || env.FID),
    limit: String(limit),
    include_replies: String(includeReplies),
  })
  if (cursor) params.append('cursor', cursor)

  const response = await fetchNeynar(`/farcaster/feed/user/casts?${params}`)
  return response
}

// The set of parent hashes Zaal has already replied to, paginated so heavy
// reply days do not push answered items past the window (Neynar caps
// feed/user/casts at 50 per page; pages = 3 covers the last 150 casts).
export async function getAnsweredParents(pages = 3) {
  const answered = new Set()
  let cursor = null
  for (let i = 0; i < pages; i++) {
    const res = await getUserCasts({ limit: 50, includeReplies: true, cursor })
    for (const c of res.casts || []) {
      if (c.parent_hash) answered.add(c.parent_hash)
    }
    cursor = res.next?.cursor
    if (!cursor) break
  }
  return answered
}

// Unanswered inbound items (the engage/cockpit work list): notifications Zaal
// has not replied to yet, newest first, with parent-cast context attached.
// Spam set: lowercased usernames + fid strings to filter out of inbound.
// Sources: SPAM_LIST env var (comma-separated, for Vercel) + the local file.
export function loadSpamSet() {
  const set = new Set()
  const add = (raw) => {
    const v = String(raw || '').trim().replace(/^@/, '').toLowerCase()
    if (v && !v.startsWith('#')) set.add(v)
  }
  if (process.env.SPAM_LIST) {
    for (const part of process.env.SPAM_LIST.split(',')) add(part)
  }
  try {
    if (fs.existsSync(SPAM_PATH)) {
      for (const line of fs.readFileSync(SPAM_PATH, 'utf-8').split('\n')) add(line)
    }
  } catch {
    // unreadable list - fail open (show everything) rather than hide inbound
  }
  return set
}

// Snoozed/skipped inbound, persisted in KV so items don't reappear next session
// (cockpit [s]/[l], web inbox both respect it). { hash: untilMs }, 0 = forever.
export async function getSnoozeSet() {
  try { const { storeEnabled, kvGet } = await import('./store.js'); if (!storeEnabled()) return {}; return (await kvGet('zc:snoozed')) || {} } catch { return {} }
}
export async function addSnooze(hash, hours = 0) {
  try {
    const { storeEnabled, kvGet, kvSet } = await import('./store.js'); if (!storeEnabled()) return false
    const s = (await kvGet('zc:snoozed')) || {}
    s[hash] = hours > 0 ? Date.now() + hours * 36e5 : 0
    const now = Date.now(); for (const k of Object.keys(s)) if (s[k] && s[k] < now) delete s[k]
    await kvSet('zc:snoozed', s); return true
  } catch { return false }
}
const snoozedActive = (hash, s) => { const v = s[hash]; return v !== undefined && (v === 0 || v > Date.now()) }

export async function getUnansweredInbound(options = {}) {
  const { limit = 15, includeAll = false, withContext = true } = options
  const answerable = new Set(['reply', 'mention', 'quote'])
  const spam = loadSpamSet()

  const [notifs, answered, snoozes] = await Promise.all([
    getNotifications({ limit }),
    getAnsweredParents(),
    getSnoozeSet(),
  ])

  const items = []
  for (const n of notifs.notifications || []) {
    const c = n.cast || {}
    if (!includeAll && !answerable.has(n.type)) continue
    if (!c.hash || answered.has(c.hash) || snoozedActive(c.hash, snoozes)) continue
    const uname = (c.author?.username || '').toLowerCase()
    if (spam.has(uname) || (c.author?.fid && spam.has(String(c.author.fid)))) continue
    items.push({
      type: n.type,
      user: c.author?.username || '?',
      fid: c.author?.fid || null,
      hash: c.hash,
      link: `https://farcaster.xyz/${c.author?.username || '?'}/${c.hash.slice(0, 10)}`,
      text: (c.text || '').replace(/\s+/g, ' '),
      parentHash: c.parent_hash || null,
      parent: null,
      thread: [],
      draft: null,
    })
  }

  if (withContext && items.length) {
    // full ancestor chain per item (root -> direct parent) so drafts fit the
    // whole conversation, not just the one cast above. One conversation call
    // per item, in parallel.
    await Promise.all(items.map(async (item) => {
      if (!item.parentHash) return
      try {
        const res = await getConversation(item.hash, { replyDepth: 0 })
        const ancestors = res.conversation?.chronological_parent_casts || []
        item.thread = ancestors.map((a) => ({
          user: a.author?.username || '?',
          text: (a.text || '').replace(/\s+/g, ' '),
        }))
        // direct parent = last ancestor (kept for display compat)
        item.parent = item.thread[item.thread.length - 1] || null
      } catch {
        // thread unfetchable - item shows without context
      }
    }))
  }

  return items
}

// Full conversation around a cast (hash or farcaster.xyz URL): ancestors + replies
export async function getConversation(hashOrUrl, options = {}) {
  const { replyDepth = 2, limit = 20 } = options
  const isUrl = hashOrUrl.startsWith('http')

  const params = new URLSearchParams({
    identifier: hashOrUrl,
    type: isUrl ? 'url' : 'hash',
    reply_depth: String(replyDepth),
    include_chronological_parent_casts: 'true',
    limit: String(limit),
  })

  const response = await fetchNeynar(`/farcaster/cast/conversation?${params}`)
  return response
}

export function formatCast(cast) {
  const author = cast.author.display_name || cast.author.username
  const timestamp = new Date(cast.timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  let text = cast.text
  if (cast.embeds && cast.embeds.length > 0) {
    text += '\n'
    for (const embed of cast.embeds) {
      if (embed.url) text += `\n[${embed.url}]`
    }
  }

  return {
    hash: cast.hash,
    fid: cast.author.fid,
    author,
    timestamp,
    text,
    replies: cast.replies?.count || 0,
    recasts: cast.recasts?.count || 0,
    likes: cast.reactions?.likes_count || 0,
  }
}

export function formatNotification(notif) {
  const cast = notif.cast || (notif.casts && notif.casts[0])
  if (!cast) return null
  return {
    hash: cast.hash,
    fid: cast.author.fid,
    author: cast.author.display_name || cast.author.username,
    type: notif.type,
    text: cast.text,
    timestamp: new Date(cast.timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
  }
}
