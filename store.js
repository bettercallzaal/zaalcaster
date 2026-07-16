// store.js - a tiny persistent key/value store over Upstash Redis / Vercel KV's
// REST API. No SDK, just fetch - keeps zaalcaster dependency-free.
//
// WHY REST AND NOT A REDIS CLIENT: a TCP Redis client is a connection pool to
// manage inside serverless functions (cold starts, connection limits) plus an
// npm dependency. Upstash's REST form is one stateless HTTPS call per
// command - slower per-op, but this store handles a handful of small blobs
// per session, not a hot path. Correctness and zero deps beat latency here.
//
// WHY OPTIONAL-BY-DESIGN: enabled only when KV_REST_API_URL + KV_REST_API_TOKEN
// (or UPSTASH_/STORAGE_ prefixed equivalents) are set. When unset, every
// caller degrades: frontend state falls back to per-browser localStorage,
// the action ledger skips, scheduled posts are disabled. A fork gets a fully
// working client with NO infra, and adding the KV store upgrades sync/
// scheduling without touching code. The prefix-agnostic resolve() exists
// because Vercel's KV integration has renamed its env vars across versions -
// scanning for *_REST_API_URL survives their next rename too.

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
// Resolve lazily (at call time), not at import time, so store works regardless
// of whether env/creds were loaded before or after this module was imported.
export function storeEnabled() {
  const { url, token } = resolve()
  return !!(url && token)
}

// Run one Redis command via the Upstash REST command-array form.
async function cmd(args) {
  const { url, token } = resolve()
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
