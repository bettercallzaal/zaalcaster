// GET /api/digest - "what I missed": an AI summary of the recent following feed.
// Read-only. Needs OPENROUTER_API_KEY on Vercel (claude CLI locally).

import { getFollowingFeed } from '../lib.js'
import { blockedByAuth } from '../auth.js'
import { digestFeed, researchUser } from '../voice.js'

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
  try {
    // POST = research/alignment read on a specific user (client sends the profile)
    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      if (!body.username) { res.status(400).json({ error: 'missing username' }); return }
      const brief = await researchUser(body)
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ available: brief !== null, brief })
      return
    }
    const feed = await getFollowingFeed({ limit: 40 })
    const casts = (feed.casts || []).map((c) => ({
      author: c.author?.username || '?', text: c.text || '', channel: c.channel?.id || null,
    }))
    if (!casts.length) { res.status(200).json({ available: true, digest: null, note: 'feed empty' }); return }

    const digest = await digestFeed(casts)
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ available: digest !== null, digest, count: casts.length })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'digest failed' })
  }
}
