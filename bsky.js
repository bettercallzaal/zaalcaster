// bsky.js - cross-post a cast's text to Bluesky via the AT Protocol XRPC REST
// API (createSession -> createRecord). No SDK, just fetch. Single-user: uses
// Zaal's handle + an app password from env.
//
// Needs two env vars (Bluesky -> Settings -> App Passwords -> add):
//   BSKY_HANDLE          e.g. bettercallzaal.bsky.social (or your custom domain)
//   BSKY_APP_PASSWORD    an app password (NOT your main password)
// If unset, bskyEnabled() is false and postToBluesky no-ops with a reason.

const SERVICE = 'https://bsky.social'

function creds() {
  return { handle: process.env.BSKY_HANDLE || '', pw: process.env.BSKY_APP_PASSWORD || '' }
}

export function bskyEnabled() {
  const { handle, pw } = creds()
  return !!(handle && pw)
}

async function session() {
  const { handle, pw } = creds()
  const r = await fetch(`${SERVICE}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password: pw }),
    signal: AbortSignal.timeout(15000),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.accessJwt) throw new Error(d.message || `bsky auth ${r.status}`)
  return { jwt: d.accessJwt, did: d.did }
}

// Post one skeet. Bluesky's limit is 300 graphemes; longer text is truncated.
// Optional reply threads under a { root, parent } ref (from a prior post).
export async function postToBluesky(text, { reply = null } = {}) {
  if (!bskyEnabled()) return { ok: false, reason: 'Bluesky not connected - set BSKY_HANDLE + BSKY_APP_PASSWORD' }
  const body = (text || '').trim()
  if (!body) return { ok: false, reason: 'empty text' }
  try {
    const { jwt, did } = await session()
    const record = { $type: 'app.bsky.feed.post', text: body.slice(0, 300), createdAt: new Date().toISOString() }
    if (reply) record.reply = reply
    const r = await fetch(`${SERVICE}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ repo: did, collection: 'app.bsky.feed.post', record }),
      signal: AbortSignal.timeout(15000),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || !d.uri) return { ok: false, reason: d.message || `bsky post ${r.status}` }
    const rkey = String(d.uri).split('/').pop()
    const handle = creds().handle
    return { ok: true, uri: d.uri, cid: d.cid, did, url: `https://bsky.app/profile/${handle}/post/${rkey}` }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'bsky request failed' }
  }
}

// Post an array of casts as a Bluesky thread (each replies to the previous).
export async function postThreadToBluesky(parts) {
  if (!bskyEnabled()) return { ok: false, reason: 'Bluesky not connected' }
  let root = null, parent = null, firstUrl = null, posted = 0
  for (const p of parts) {
    const reply = root ? { root, parent } : null
    const r = await postToBluesky(p, { reply })
    if (!r.ok) return posted ? { ok: true, url: firstUrl, count: posted, partial: r.reason } : r
    const ref = { uri: r.uri, cid: r.cid }
    if (!root) { root = ref; firstUrl = r.url }
    parent = ref; posted++
  }
  return { ok: true, url: firstUrl, count: posted }
}
