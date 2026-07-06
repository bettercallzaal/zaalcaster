// POST /api/send - post a cast from the web cockpit. Reply or top-level.
// Body: { text, parentHash?, parentFid?, channelId? }
//   parentHash present -> reply; absent -> new top-level cast.
//   channelId optional -> post into a channel.
// Returns: { ok, hash, link } or { error }.
//
// Behind Vercel deployment protection (only Zaal's login reaches it). Still,
// the UI must show exact text + an explicit confirm before calling this - the
// confirm click is the yes. Needs ZAAL_SIGNER_UUID (clean 500 if unset).

import { postCast, friendlyPostError, getPostingHealth, loadEnv } from '../lib.js'
import { blockedByAuth } from '../auth.js'

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

export default async function handler(req, res) {
  if (blockedByAuth(req, res)) return
  // GET -> posting health check (is the signer wired up under the key?)
  if (req.method === 'GET') {
    const h = await getPostingHealth().catch(() => ({ ready: false, reason: 'error' }))
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json(h)
    return
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return }
  try {
    const body = await readJsonBody(req)

    // image upload: browser sends a base64 data URL, we push it to Imgur and
    // hand back a public URL to attach as an embed. Needs IMGUR_CLIENT_ID.
    if (typeof body.upload === 'string' && body.upload.startsWith('data:')) {
      const clientId = process.env.IMGUR_CLIENT_ID
      if (!clientId) { res.status(200).json({ ok: false, reason: 'no image host - set IMGUR_CLIENT_ID in Vercel' }); return }
      const b64 = body.upload.split(',')[1] || ''
      if (!b64) { res.status(400).json({ error: 'empty image' }); return }
      if (b64.length > 12 * 1024 * 1024) { res.status(400).json({ error: 'image too large' }); return }
      const up = await fetch('https://api.imgur.com/3/image', {
        method: 'POST',
        headers: { Authorization: `Client-ID ${clientId}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: b64, type: 'base64' }),
      })
      const ud = await up.json().catch(() => ({}))
      const url = ud?.data?.link
      if (!url) { res.status(200).json({ ok: false, reason: 'upload failed' }); return }
      res.status(200).json({ ok: true, url })
      return
    }

    // thread mode: post an array of casts, each replying to the previous
    if (Array.isArray(body.casts)) {
      const parts = body.casts.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 25)
      if (!parts.length) { res.status(400).json({ error: 'empty thread' }); return }
      if (parts.some((p) => p.length > 1024)) { res.status(400).json({ error: 'a cast is too long' }); return }
      const myFid = loadEnv().FID
      const channelId = typeof body.channelId === 'string' && body.channelId ? body.channelId : null
      let parentHash = null, firstLink = null, posted = 0
      for (let i = 0; i < parts.length; i++) {
        const opts = i === 0 ? { channelId } : { parentHash, parentFid: myFid }
        const resp = await postCast(parts[i], opts)
        const cast = resp.cast
        parentHash = cast.hash; posted++
        if (i === 0) firstLink = `https://farcaster.xyz/${cast.author.username}/${cast.hash.slice(0, 10)}`
      }
      res.status(200).json({ ok: true, link: firstLink, count: posted })
      return
    }

    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const intOrNull = (v) => (typeof v === 'number' && Number.isInteger(v)) ? v : (/^\d+$/.test(String(v)) ? parseInt(v, 10) : null)
    const parentHash = typeof body.parentHash === 'string' && body.parentHash ? body.parentHash : null
    const parentFid = intOrNull(body.parentFid)
    const channelId = typeof body.channelId === 'string' && body.channelId ? body.channelId : null
    const embedUrl = typeof body.embedUrl === 'string' && /^https?:\/\//.test(body.embedUrl) ? body.embedUrl : null
    const quoteHash = typeof body.quoteHash === 'string' && body.quoteHash ? body.quoteHash : null
    const quoteFid = intOrNull(body.quoteFid)

    if (!text) { res.status(400).json({ error: 'empty text' }); return }
    if (text.length > 1024) { res.status(400).json({ error: 'text too long' }); return }

    // parentHash -> reply; quoteHash -> quote cast; else top-level (Compose)
    const response = await postCast(text, { parentHash, parentFid, channelId, quoteHash, quoteFid, embedUrl })
    const cast = response.cast
    res.status(200).json({
      ok: true,
      hash: cast.hash,
      link: `https://farcaster.xyz/${cast.author.username}/${cast.hash.slice(0, 10)}`,
    })
  } catch (err) {
    // lib throws a clear message when ZAAL_SIGNER_UUID is missing
    res.status(500).json({ error: friendlyPostError(err) })
  }
}
