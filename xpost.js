// xpost.js - cross-post a cast's text to X (Twitter) via API v2 POST /2/tweets.
// OAuth 1.0a user-context, signed with node crypto (no SDK, keeps zaalcaster
// dependency-free). Single-user: uses Zaal's own app + access tokens from env.
//
// Needs four env vars (from developer.x.com -> your app -> Keys and tokens):
//   X_API_KEY           (API Key / consumer key)
//   X_API_SECRET        (API Secret / consumer secret)
//   X_ACCESS_TOKEN      (Access Token for @bettercallzaal)
//   X_ACCESS_SECRET     (Access Token Secret)
// The app must have Read+Write permission. If any are unset, xEnabled() is false
// and postToX no-ops with a clear reason (the whole feature stays optional).

import crypto from 'node:crypto'

// RFC-3986 percent-encoding (stricter than encodeURIComponent).
const pct = (s) => encodeURIComponent(String(s)).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())

function creds() {
  return {
    ck: process.env.X_API_KEY || '',
    cs: process.env.X_API_SECRET || '',
    tk: process.env.X_ACCESS_TOKEN || '',
    ts: process.env.X_ACCESS_SECRET || '',
  }
}

export function xEnabled() {
  const { ck, cs, tk, ts } = creds()
  return !!(ck && cs && tk && ts)
}

export async function postToX(text, { inReplyTo = null } = {}) {
  const { ck, cs, tk, ts } = creds()
  if (!(ck && cs && tk && ts)) {
    return { ok: false, reason: 'X not connected - set X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET' }
  }
  const body = (text || '').trim()
  if (!body) return { ok: false, reason: 'empty text' }

  const url = 'https://api.twitter.com/2/tweets'
  const oauth = {
    oauth_consumer_key: ck,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: tk,
    oauth_version: '1.0',
  }
  // POST /2/tweets sends a JSON body, so only the oauth_* params are signed.
  const paramStr = Object.keys(oauth).sort().map((k) => `${pct(k)}=${pct(oauth[k])}`).join('&')
  const base = ['POST', pct(url), pct(paramStr)].join('&')
  const signingKey = `${pct(cs)}&${pct(ts)}`
  oauth.oauth_signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64')
  const authHeader = 'OAuth ' + Object.keys(oauth).sort().map((k) => `${pct(k)}="${pct(oauth[k])}"`).join(', ')

  const payload = { text: body }
  if (inReplyTo) payload.reply = { in_reply_to_tweet_id: inReplyTo }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d?.data?.id) return { ok: true, id: d.data.id, url: `https://x.com/i/web/status/${d.data.id}` }
    return { ok: false, reason: d?.detail || d?.title || (d?.errors?.[0]?.message) || `X error ${res.status}` }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'X request failed' }
  }
}

// Post an array of casts as an X thread (each replies to the previous).
export async function postThreadToX(parts) {
  if (!xEnabled()) return { ok: false, reason: 'X not connected' }
  let inReplyTo = null, firstUrl = null, posted = 0
  for (const p of parts) {
    const r = await postToX(p, { inReplyTo })
    if (!r.ok) return posted ? { ok: true, url: firstUrl, count: posted, partial: r.reason } : r
    inReplyTo = r.id; posted++
    if (!firstUrl) firstUrl = r.url
  }
  return { ok: true, url: firstUrl, count: posted }
}
