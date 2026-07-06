// /api/cron/post-due - fire any scheduled casts whose time has arrived.
// Called on a schedule (Vercel Cron on Pro, or an external cron / GitHub
// Action every ~5 min on Hobby). Reads the scheduled queue from the store,
// posts due items via the signer, marks them sent, saves the queue back.
//
// Protected by CRON_SECRET: the caller must send Authorization: Bearer
// <CRON_SECRET> (Vercel Cron adds this automatically when CRON_SECRET is set).
// If CRON_SECRET is unset, the endpoint refuses to run (fail closed) so it
// can never post publicly by accident.

import crypto from 'node:crypto'
import { storeEnabled, kvGet, kvSet } from '../../store.js'
import { postCast } from '../../lib.js'

const KEY = 'zc:state'

function authorized(req) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // fail closed - no secret, no posting
  const hdr = req.headers?.authorization || ''
  // constant-time compare so the secret can't be brute-forced via timing
  const a = Buffer.from(hdr), b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export default async function handler(req, res) {
  if (!authorized(req)) { res.status(401).json({ error: 'unauthorized' }); return }
  if (!storeEnabled()) { res.status(200).json({ ok: true, note: 'store disabled', posted: 0 }); return }

  try {
    const state = (await kvGet(KEY)) || {}
    const queue = Array.isArray(state.scheduled) ? state.scheduled : []
    const nowMs = Date.now()

    const due = queue.filter((s) => !s.sent && s.at && Date.parse(s.at) <= nowMs)
    const results = []
    for (const s of due) {
      try {
        const r = await postCast(String(s.text || ''), {
          channelId: s.channelId || null,
          quoteHash: s.quoteHash || null,
          quoteFid: s.quoteFid || null,
        })
        s.sent = true
        s.hash = r.cast?.hash || null
        s.sentAt = new Date(nowMs).toISOString()
        results.push({ id: s.id, ok: true, hash: s.hash })
      } catch (e) {
        s.error = e instanceof Error ? e.message : 'post failed'
        results.push({ id: s.id, ok: false, error: s.error })
      }
    }

    if (due.length) {
      // keep the last 50 (sent + pending) so the client can show recent history
      state.scheduled = queue.slice(-50)
      await kvSet(KEY, state)
    }

    // record that the cron actually ran - the self-monitor checks this freshness
    const posted = results.filter((r) => r.ok).length
    await kvSet('zc:cron:last', { at: new Date(nowMs).toISOString(), checked: queue.length, posted }).catch(() => {})

    res.status(200).json({ ok: true, checked: queue.length, posted, results })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'cron failed' })
  }
}
