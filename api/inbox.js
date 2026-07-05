// GET /api/inbox - unanswered inbound as JSON for the web cockpit.
// Read-only. Query: ?limit=15  ?all=1 (include likes/recasts/follows).
//
// Reuses the same lib the CLI uses. Credentials come from Vercel env
// (NEYNAR_API_KEY, ZAAL_FID); no secrets in the repo or the response.

import { getUnansweredInbound } from '../lib.js'

export default async function handler(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 15, 50)
    const includeAll = req.query.all === '1' || req.query.all === 'true'

    const items = await getUnansweredInbound({ limit, includeAll })

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
    }))

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ count: safe.length, items: safe })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'inbox failed' })
  }
}
