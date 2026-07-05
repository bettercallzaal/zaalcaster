// POST /api/send - reply to a cast from the web cockpit.
// Body: { parentHash, parentFid, text }
// Returns: { ok, hash, link } or { error }.
//
// Behind Vercel deployment protection (only Zaal's login reaches it). Still,
// the UI must show exact text + an explicit confirm before calling this - the
// confirm click is the yes. Needs ZAAL_SIGNER_UUID (clean 400 if unset).

import { postCast } from '../lib.js'

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return }
  try {
    const body = await readJsonBody(req)
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const parentHash = typeof body.parentHash === 'string' ? body.parentHash : ''
    const parentFid = body.parentFid ?? null

    if (!text) { res.status(400).json({ error: 'empty text' }); return }
    if (!parentHash) { res.status(400).json({ error: 'missing parentHash' }); return }
    if (text.length > 1024) { res.status(400).json({ error: 'text too long' }); return }

    const response = await postCast(text, { parentHash, parentFid })
    const cast = response.cast
    res.status(200).json({
      ok: true,
      hash: cast.hash,
      link: `https://farcaster.xyz/${cast.author.username}/${cast.hash.slice(0, 10)}`,
    })
  } catch (err) {
    // lib throws a clear message when ZAAL_SIGNER_UUID is missing
    res.status(500).json({ error: err instanceof Error ? err.message : 'send failed' })
  }
}
