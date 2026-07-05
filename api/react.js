// POST /api/react - like or recast from the web client.
// Body: { type: 'like'|'recast', targetHash, targetFid? }
// Behind Vercel login. A like/recast is a low-stakes, reversible signal, so
// the UI fires it on click (no confirm) - but it still needs the signer.

import { postReaction, friendlyPostError } from '../lib.js'
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
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return }
  try {
    const body = await readJsonBody(req)
    const type = body.type === 'recast' ? 'recast' : 'like'
    const targetHash = typeof body.targetHash === 'string' ? body.targetHash : ''
    if (!targetHash) { res.status(400).json({ error: 'missing targetHash' }); return }

    await postReaction(type, targetHash, body.targetFid ?? null)
    res.status(200).json({ ok: true, type })
  } catch (err) {
    res.status(500).json({ error: friendlyPostError(err) })
  }
}
