// store.js - a tiny persistent key/value store over Upstash Redis / Vercel KV's
// REST API. No SDK, just fetch - keeps zaalcaster dependency-free.
//
// Enabled when KV_REST_API_URL + KV_REST_API_TOKEN are set (Vercel KV), or the
// UPSTASH_REDIS_REST_* equivalents. When unset, the store is OFF and callers
// fall back to per-browser localStorage. This is what makes the Daily
// dashboard, bookmarks, and the scheduled-post queue sync across devices.

// Resolve the REST url/token from whatever names the Vercel integration used
// (KV_*, UPSTASH_REDIS_*, STORAGE_*, or any custom prefix ending in
// _REST_API_URL / _REST_API_TOKEN). Makes the store work regardless of prefix.
function resolve() {
  const e = process.env
  let url = e.KV_REST_API_URL || e.UPSTASH_REDIS_REST_URL || e.STORAGE_REST_API_URL || ''
  let token = e.KV_REST_API_TOKEN || e.UPSTASH_REDIS_REST_TOKEN || e.STORAGE_REST_API_TOKEN || ''
  if (!url) { const k = Object.keys(e).find((x) => x.endsWith('_REST_API_URL')); if (k) url = e[k] }
  if (!token) { const k = Object.keys(e).find((x) => x.endsWith('_REST_API_TOKEN') && !x.includes('READ_ONLY')); if (k) token = e[k] }
  return { url, token }
}
const URL = resolve().url
const TOKEN = resolve().token

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

// Append to a capped list (newest-first) - used for the action ledger. Atomic
// via LPUSH + LTRIM. Best-effort: never throws, so logging can't break a post.
export async function kvPush(key, item, cap = 500) {
  if (!storeEnabled()) return false
  try {
    await cmd(['LPUSH', key, JSON.stringify(item)])
    await cmd(['LTRIM', key, '0', String(cap - 1)])
    return true
  } catch { return false }
}

export async function kvList(key, limit = 100) {
  if (!storeEnabled()) return []
  try {
    const arr = await cmd(['LRANGE', key, '0', String(limit - 1)])
    return (arr || []).map((s) => { try { return JSON.parse(s) } catch { return s } })
  } catch { return [] }
}
