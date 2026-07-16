// /api/digest - every AI-GENERATION surface: the "what I missed" feed digest
// (GET), batch reply drafts, user research briefs, and LinkedIn post drafts
// (POST modes).
//
// WHY drafts live here and not in their own api/draft.js: they used to -
// api/draft.js was consolidated INTO this file (2026-07-07) to free a slot
// under the 12-function cap when the webhook receiver needed one. The
// grouping still holds by trust level: everything here CALLS A MODEL and
// RETURNS TEXT, never posts - generation and sending are different tiers
// (sending is api/send.js, with its own confirm contract).
// Owner-only (drafts/digest read the private inbox + feed). Needs
// OPENROUTER_API_KEY on Vercel (falls back to the local claude CLI on mac).

import { getFollowingFeed } from '../lib.js'
import { blockedByAuth } from '../auth.js'
import { digestFeed, researchUser, linkedinPost, generateDrafts } from '../voice.js'

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
    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      // reply drafts for a batch of inbound items (was api/draft.js, folded here
      // to stay under Vercel's 12-function cap). Drafting only - never posts.
      if (Array.isArray(body.items)) {
        const answerable = new Set(['reply', 'mention', 'quote'])
        const items = body.items.slice(0, 25)
          .filter((it) => answerable.has(it.type))
          .map((it) => ({
            hash: it.hash, user: it.user, type: it.type, text: String(it.text || ''),
            thread: Array.isArray(it.thread) ? it.thread : [], parent: it.parent || null, draft: null,
          }))
        if (!items.length) { res.status(200).json({ available: true, backend: null, drafts: {} }); return }
        const backend = await generateDrafts(items)
        const drafts = {}
        for (const it of items) if (it.draft) drafts[it.hash] = it.draft
        res.setHeader('Cache-Control', 'no-store')
        res.status(200).json({ available: backend !== null, backend, drafts })
        return
      }
      // LinkedIn post draft about something we built
      if (body.mode === 'linkedin') {
        if (!body.topic) { res.status(400).json({ error: 'missing topic' }); return }
        const post = await linkedinPost(String(body.topic).slice(0, 300), String(body.facts || '').slice(0, 1200))
        res.setHeader('Cache-Control', 'no-store')
        res.status(200).json({ available: post !== null, post })
        return
      }
      // research/alignment read on a specific user (client sends the profile)
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
