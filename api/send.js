// POST /api/send - post a cast from the web cockpit. Reply or top-level.
// Body: { text, parentHash?, parentFid?, channelId? }
//   parentHash present -> reply; absent -> new top-level cast.
//   channelId optional -> post into a channel.
// Returns: { ok, hash, link } or { error }.
//
// Behind Vercel deployment protection (only Zaal's login reaches it). Still,
// the UI must show exact text + an explicit confirm before calling this - the
// confirm click is the yes. Needs ZAAL_SIGNER_UUID (clean 500 if unset).

import { postCast, friendlyPostError, getPostingHealth } from '../lib.js'
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
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const parentHash = typeof body.parentHash === 'string' && body.parentHash ? body.parentHash : null
    const parentFid = body.parentFid ?? null
    const channelId = typeof body.channelId === 'string' && body.channelId ? body.channelId : null
    const quoteHash = typeof body.quoteHash === 'string' && body.quoteHash ? body.quoteHash : null
    const quoteFid = body.quoteFid ?? null

    if (!text) { res.status(400).json({ error: 'empty text' }); return }
    if (text.length > 1024) { res.status(400).json({ error: 'text too long' }); return }

    // parentHash -> reply; quoteHash -> quote cast; else top-level (Compose)
    const response = await postCast(text, { parentHash, parentFid, channelId, quoteHash, quoteFid })
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
