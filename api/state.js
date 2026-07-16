// /api/state - cross-device sync for the Daily dashboard, bookmarks, muted
// words, lists, saved searches, and the scheduled-post queue.
//   GET  -> { enabled, state }
//   POST { state } -> saves it (whole blob), returns { ok }
//
// WHY ONE WHOLE-BLOB, LAST-WRITE-WINS: this is a single-user app - the only
// concurrent writers are Zaal's own devices, and the client both debounces
// writes and pulls fresh state on every boot, so the realistic conflict
// window is near zero. Per-key merging would add real complexity to protect
// against a conflict pattern this app can't meaningfully have. If it ever
// goes multi-user (explicitly declined 2026-07-06, see CLAUDE.md), this is
// the first thing to revisit.
//
// Owner-only via blockedByAuth (the blob contains the private daily/inbox
// state). Client falls back to localStorage when the store is off (no KV
// env) - sync is an upgrade, never a requirement.

import { blockedByAuth } from '../auth.js'
import { storeEnabled, kvGet, kvSet } from '../store.js'

const KEY = 'zc:state'

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
    if (req.method === 'GET') {
      const state = storeEnabled() ? (await kvGet(KEY)) : null
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ enabled: storeEnabled(), state: state || null })
      return
    }
    if (req.method === 'POST') {
      if (!storeEnabled()) { res.status(200).json({ ok: false, enabled: false }); return }
      const body = await readJsonBody(req)
      if (!body.state || typeof body.state !== 'object') { res.status(400).json({ error: 'missing state' }); return }
      await kvSet(KEY, body.state)
      res.status(200).json({ ok: true, enabled: true })
      return
    }
    res.status(405).json({ error: 'method not allowed' })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'state failed' })
  }
}
