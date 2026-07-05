// GET /api/inbox - unanswered inbound as JSON for the web cockpit.
// Read-only. Query: ?limit=15  ?all=1 (include likes/recasts/follows).
//
// Reuses the same lib the CLI uses. Credentials come from Vercel env
// (NEYNAR_API_KEY, ZAAL_FID); no secrets in the repo or the response.

import { getUnansweredInbound, getUsersByFids } from '../lib.js'
import { blockedByAuth } from '../auth.js'

// Rank inbound by how much it deserves Zaal's attention: intent (mentions +
// quotes over generic replies), the sender's neynar score, and mutual-follow.
async function attachPriority(items) {
  const fids = [...new Set(items.map((i) => i.fid).filter(Boolean))]
  let byFid = new Map()
  try {
    const users = await getUsersByFids(fids)
    byFid = new Map(users.map((u) => [u.fid, u]))
  } catch { /* no scores - fall back to intent only */ }
  const intent = (t) => (t === 'mention' || t === 'quote') ? 2 : 0
  for (const it of items) {
    const u = byFid.get(it.fid)
    const score = u?.experimental?.neynar_user_score ?? 0
    const vc = u?.viewer_context || {}
    const mutual = (vc.following && vc.followed_by) ? 2 : (vc.followed_by ? 1 : 0)
    it.priority = intent(it.type) + score * 3 + mutual
  }
  items.sort((a, b) => b.priority - a.priority)
}

export default async function handler(req, res) {
  if (blockedByAuth(req, res)) return
  try {
    const limit = Math.min(Number(req.query.limit) || 15, 50)
    const includeAll = req.query.all === '1' || req.query.all === 'true'
    const priority = req.query.priority === '1' || req.query.priority === 'true'

    const items = await getUnansweredInbound({ limit, includeAll })
    if (priority && items.length) await attachPriority(items)

    // never leak internals - hand the client only what it renders
    const safe = items.map((it) => ({
      type: it.type,
      user: it.user,
      fid: it.fid,
      hash: it.hash,
      link: it.link,
      text: it.text,
      thread: it.thread || [],
      parent: it.parent,
      priority: it.priority ?? null,
    }))

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ count: safe.length, items: safe, sorted: priority })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'inbox failed' })
  }
}
