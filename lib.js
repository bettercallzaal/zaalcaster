import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const ENV_PATH = path.join(process.env.HOME, '.zao/private/farcaster-zaal.env')
const NEYNAR_BASE_URL = 'https://api.neynar.com/v2'

let env = null

export function loadEnv() {
  if (env) return env

  if (!fs.existsSync(ENV_PATH)) {
    console.error(`Error: Missing env file at ${ENV_PATH}`)
    console.error('Create ~/.zao/private/farcaster-zaal.env with:')
    console.error('  NEYNAR_API_KEY=your_key_here')
    console.error('  ZAAL_SIGNER_UUID=your_signer_uuid_here')
    console.error('  ZAAL_FID=19640')
    process.exit(1)
  }

  env = {}
  const content = fs.readFileSync(ENV_PATH, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const [key, ...rest] = trimmed.split('=')
    env[key] = rest.join('=')
  }

  // Reads only need the API key + fid. The signer is checked at post time so
  // timeline/notifs/search/engage work before the signer is set up.
  const required = ['NEYNAR_API_KEY', 'ZAAL_FID']
  for (const key of required) {
    if (!env[key]) {
      console.error(`Error: Missing ${key} in ${ENV_PATH}`)
      process.exit(1)
    }
  }

  return env
}

async function fetchNeynar(endpoint, options = {}) {
  const env = loadEnv()
  const url = `${NEYNAR_BASE_URL}${endpoint}`
  const headers = {
    'X-API-Key': env.NEYNAR_API_KEY,
    'Content-Type': 'application/json',
    ...options.headers,
  }

  const res = await fetch(url, { ...options, headers })
  const json = await res.json()

  if (!res.ok) {
    console.error(`Neynar API error: ${res.status}`)
    console.error(json)
    process.exit(1)
  }

  return json
}

export async function getFollowingFeed(options = {}) {
  const { limit = 20, cursor = null } = options
  const env = loadEnv()

  const params = new URLSearchParams({
    fid: env.ZAAL_FID,
    limit: String(limit),
  })

  if (cursor) params.append('cursor', cursor)

  const response = await fetchNeynar(`/farcaster/feed/following?${params}`)
  return response
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

export async function getNotifications(options = {}) {
  const { limit = 20, cursor = null } = options
  const env = loadEnv()

  const params = new URLSearchParams({
    fid: env.ZAAL_FID,
    limit: String(limit),
  })

  if (cursor) params.append('cursor', cursor)

  const response = await fetchNeynar(`/farcaster/notifications?${params}`)
  return response
}

export async function searchCasts(query, options = {}) {
  const { limit = 20 } = options

  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  })

  const response = await fetchNeynar(`/farcaster/cast/search?${params}`)
  return response
}

// Look up a user by fid (number) or username (with or without @).
// viewer_fid is Zaal so the result includes follow relationship both ways.
export async function getUser(fidOrUsername) {
  const env = loadEnv()
  const raw = String(fidOrUsername).replace(/^@/, '')

  if (/^\d+$/.test(raw)) {
    const params = new URLSearchParams({ fids: raw, viewer_fid: env.ZAAL_FID })
    const response = await fetchNeynar(`/farcaster/user/bulk?${params}`)
    return response.users?.[0] || null
  }

  const params = new URLSearchParams({ username: raw, viewer_fid: env.ZAAL_FID })
  const response = await fetchNeynar(`/farcaster/user/by_username?${params}`)
  return response.user || null
}

function requireSigner(env) {
  if (!env.ZAAL_SIGNER_UUID) {
    console.error('Error: ZAAL_SIGNER_UUID missing - run npm run mint-signer first. Reads work without it.')
    process.exit(1)
  }
  return env.ZAAL_SIGNER_UUID
}

export async function postCast(text, options = {}) {
  const { embedUrl = null, parentHash = null, parentFid = null, channelId = null } = options
  const env = loadEnv()

  const payload = {
    signer_uuid: requireSigner(env),
    text,
  }

  if (embedUrl) {
    payload.embeds = [{ url: embedUrl }]
  }

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

  return response
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

  return response
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
    fid: String(fid || env.ZAAL_FID),
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
export async function getUnansweredInbound(options = {}) {
  const { limit = 15, includeAll = false, withContext = true } = options
  const answerable = new Set(['reply', 'mention', 'quote'])

  const [notifs, answered] = await Promise.all([
    getNotifications({ limit }),
    getAnsweredParents(),
  ])

  const items = []
  for (const n of notifs.notifications || []) {
    const c = n.cast || {}
    if (!includeAll && !answerable.has(n.type)) continue
    if (!c.hash || answered.has(c.hash)) continue
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
