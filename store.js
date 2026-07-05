// store.js - a tiny persistent key/value store over Upstash Redis / Vercel KV's
// REST API. No SDK, just fetch - keeps zaalcaster dependency-free.
//
// Enabled when KV_REST_API_URL + KV_REST_API_TOKEN are set (Vercel KV), or the
// UPSTASH_REDIS_REST_* equivalents. When unset, the store is OFF and callers
// fall back to per-browser localStorage. This is what makes the Daily
// dashboard, bookmarks, and the scheduled-post queue sync across devices.

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || ''
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''

export function storeEnabled() {
  return !!(URL && TOKEN)
}

// Run one Redis command via the Upstash REST command-array form.
async function cmd(args) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`kv ${res.status}`)
  const data = await res.json()
  return data.result
}

export async function kvGet(key) {
  if (!storeEnabled()) return null
  const v = await cmd(['GET', key])
  if (v == null) return null
  try { return JSON.parse(v) } catch { return v }
}

export async function kvSet(key, value) {
  if (!storeEnabled()) return false
  await cmd(['SET', key, JSON.stringify(value)])
  return true
}
