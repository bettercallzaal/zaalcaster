// POST /api/draft - drafts in Zaal's voice for a batch of inbound items.
// Body: { items: [{ hash, user, type, text, thread, parent }, ...] }
// Returns: { available: bool, backend, drafts: { <hash>: "<draft or SKIP>" } }
//
// Drafting only - never posts. On Vercel the claude CLI is absent, so this
// needs OPENROUTER_API_KEY in the env; without it, available is false and the
// UI just shows items without a suggestion.

import { generateDrafts } from '../voice.js'
import { blockedByAuth } from '../auth.js'

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export default async function handler(req, res) {
  if (blockedByAuth(req, res)) return
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' })
    return
  }
  try {
    const body = await readJsonBody(req)
    const input = Array.isArray(body.items) ? body.items.slice(0, 25) : []
    if (!input.length) {
      res.status(400).json({ error: 'no items' })
      return
    }

    // Only answerable types get a draft; carry hash through for keying back.
    const answerable = new Set(['reply', 'mention', 'quote'])
    const items = input
      .filter((it) => answerable.has(it.type))
      .map((it) => ({
        hash: it.hash,
        user: it.user,
        type: it.type,
        text: String(it.text || ''),
        thread: Array.isArray(it.thread) ? it.thread : [],
        parent: it.parent || null,
        draft: null,
      }))

    if (!items.length) {
      res.status(200).json({ available: true, backend: null, drafts: {} })
      return
    }

    const backend = await generateDrafts(items) // fills item.draft, OpenRouter on Vercel

    const drafts = {}
    for (const it of items) {
      if (it.draft) drafts[it.hash] = it.draft
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ available: backend !== null, backend, drafts })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'draft failed' })
  }
}
