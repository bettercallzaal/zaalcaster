// POST /api/webhook - Neynar webhook receiver for real-time mentions/replies.
//
// This is the ONE api route that is intentionally NOT behind the password gate:
// Neynar's servers POST here and can't carry our cookie. Instead every request
// is authenticated by an HMAC-SHA512 signature over the raw body, keyed with the
// webhook's shared secret (WEBHOOK_SECRET). No secret set -> every call 401s, so
// the endpoint is inert-but-safe until Zaal wires it up.
//
// Setup (Zaal, one time): in the Neynar dashboard create a webhook -> target URL
// https://z.thezao.xyz/api/webhook, subscribe to cast.created filtered to
// mentioned_fids = [19640] and parent_author_fids = [19640], copy its secret into
// Vercel env WEBHOOK_SECRET. Then new mentions/replies land in KV zc:mentions the
// instant they happen, instead of waiting for the ~5-min inbox poll.

import crypto from 'node:crypto'
import { storeEnabled, kvPush } from '../store.js'

const ME = String(process.env.USER_FID || process.env.ZAAL_FID || '19640')

async function readRaw(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

// Neynar signs the raw request body: X-Neynar-Signature = HMAC-SHA512 hex.
function verify(rawBuf, header, secret) {
  if (!secret || !header) return false
  const expected = crypto.createHmac('sha512', secret).update(rawBuf).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(String(header))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return }
  const secret = process.env.WEBHOOK_SECRET || process.env.NEYNAR_WEBHOOK_SECRET || ''
  const raw = await readRaw(req)

  if (!verify(raw, req.headers['x-neynar-signature'], secret)) {
    res.status(401).json({ error: 'bad signature' })
    return
  }

  let event
  try { event = JSON.parse(raw.toString('utf8')) } catch { res.status(400).json({ error: 'bad json' }); return }

  try {
    if (event?.type === 'cast.created' && event.data) {
      const c = event.data
      const author = c.author || {}
      // ignore my own casts; only keep things actually aimed at me
      const mentioned = (c.mentioned_profiles || []).some((p) => String(p.fid) === ME)
      const replyToMe = String(c.parent_author?.fid || '') === ME
      if (String(author.fid) !== ME && (mentioned || replyToMe)) {
        const item = {
          hash: c.hash,
          user: author.username || '?',
          fid: author.fid || null,
          pfp: author.pfp_url || null,
          text: c.text || '',
          type: replyToMe ? 'reply' : 'mention',
          parentHash: c.parent_hash || null,
          timestamp: c.timestamp || null,
          at: Date.now(),
        }
        if (storeEnabled()) await kvPush('zc:mentions', item, 200)
      }
    }
  } catch { /* never fail the webhook on a store hiccup - Neynar retries otherwise */ }

  res.status(200).json({ ok: true })
}
