// GET /api/digest - "what I missed": an AI summary of the recent following feed.
// Read-only. Needs OPENROUTER_API_KEY on Vercel (claude CLI locally).

import { getFollowingFeed } from '../lib.js'
import { digestFeed } from '../voice.js'

export default async function handler(req, res) {
  try {
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
