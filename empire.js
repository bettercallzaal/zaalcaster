// empire.js - Empire Builder read client (empirebuilder.world), dependency-free
// ESM, mirrors juke.js's never-throws { ok, ... } style.
//
// Empire Builder (Zaal is a partner, white-label) wraps a Farcaster/Base
// project in leaderboards + boosters + a treasury. Per research doc 991, the
// Triple-A path is: stand up a TOKENLESS empire first (Zaal's own manual step
// in the Empire Builder UI - not this file), build energy, tokenize later.
//
// This file is READ-ONLY. Empire Builder's public API (doc 582, verified
// 2026-05-01) documents 8 read endpoints and zero write endpoints - create,
// distribute, and burn are partner-whitelisted and undocumented, so this file
// does not attempt them. No API key is required for any call below.

const API_ORIGIN = 'https://empirebuilder.world/api'
const REQUEST_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 60_000 // doc 583: rate limits unverified, cache politely

// empire_id is normally a Base token address, EXCEPT a tokenless empire
// (research doc 991's Triple-A path - no token yet) gets a synthetic id
// instead: live-verified against Zaal's own "ZABAL GAMEZ" empire, id
// "zabalgamez01e9af" (token_type: "tokenless"), not a 0x-address at all.
// So this accepts either shape - restricted to URL-safe characters, since
// both get interpolated into request paths. leaderboardId is a UUID.
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/
const TOKENLESS_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function isValidEmpireId(value) {
  return typeof value === 'string' && (ADDRESS_PATTERN.test(value) || TOKENLESS_ID_PATTERN.test(value))
}

// A wallet address is always a real 0x-address, unlike empire_id above.
export function isValidWalletAddress(value) {
  return typeof value === 'string' && ADDRESS_PATTERN.test(value)
}

export function isValidLeaderboardId(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

const cache = new Map() // url -> { at, payload }

async function getJson(path) {
  const url = `${API_ORIGIN}${path}`

  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload

  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return { ok: false, status: 502, error: timedOut ? 'Empire Builder API timed out' : 'Could not reach the Empire Builder API' }
  }

  if (!res.ok) {
    return { ok: false, status: res.status, error: `Empire Builder API returned ${res.status}` }
  }

  let data
  try {
    data = await res.json()
  } catch {
    return { ok: false, status: 502, error: 'Empire Builder API returned invalid JSON' }
  }

  const payload = { ok: true, data }
  cache.set(url, { at: Date.now(), payload })
  return payload
}

// GET /api/empires?type=top|native|recent&page=&limit=
export async function getEmpires({ type, page = 1, limit = 7 } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (type) params.set('type', type)
  return getJson(`/empires?${params.toString()}`)
}

// GET /api/empires/search?q=&farcaster_name=&page=&limit=
export async function searchEmpires({ q, farcasterName, page = 1, limit = 7 } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (q) params.set('q', q)
  if (farcasterName) params.set('farcaster_name', farcasterName)
  return getJson(`/empires/search?${params.toString()}`)
}

// GET /api/empires/[empire_id] - empire_id is the empire's Base token address.
export async function getEmpireById(empireId) {
  if (!isValidEmpireId(empireId)) return { ok: false, status: 400, error: 'Invalid empire id (expected a Base token address)' }
  return getJson(`/empires/${empireId}`)
}

// GET /api/empires/owner/[wallet_address]
export async function getEmpiresByOwner(walletAddress) {
  if (!isValidWalletAddress(walletAddress)) return { ok: false, status: 400, error: 'Invalid wallet address' }
  return getJson(`/empires/owner/${walletAddress}`)
}

// GET /api/top-empires?page=&limit=
export async function getTopEmpires({ page = 1, limit = 20 } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  return getJson(`/top-empires?${params.toString()}`)
}

// GET /api/leaderboards?tokenAddress=<empire_id> - discover an empire's
// leaderboard slots (1-20, pinned first) and their UUIDs.
export async function getEmpireLeaderboards(empireId) {
  if (!isValidEmpireId(empireId)) return { ok: false, status: 400, error: 'Invalid empire id (expected a Base token address)' }
  return getJson(`/leaderboards?tokenAddress=${empireId}`)
}

// GET /api/leaderboards/[leaderboardId] - ranked entries for one leaderboard.
export async function getLeaderboardEntries(leaderboardId) {
  if (!isValidLeaderboardId(leaderboardId)) return { ok: false, status: 400, error: 'Invalid leaderboard id (expected a UUID)' }
  return getJson(`/leaderboards/${leaderboardId}`)
}

// GET /api/leaderboards/[leaderboardId]/address/[walletAddress] - one
// address's rank, points, and active boosters within a leaderboard.
export async function getLeaderboardAddressStats(leaderboardId, walletAddress) {
  if (!isValidLeaderboardId(leaderboardId)) return { ok: false, status: 400, error: 'Invalid leaderboard id (expected a UUID)' }
  if (!isValidWalletAddress(walletAddress)) return { ok: false, status: 400, error: 'Invalid wallet address' }
  return getJson(`/leaderboards/${leaderboardId}/address/${walletAddress}`)
}

// GET /api/boosters/[empire_id]
export async function getEmpireBoosters(empireId) {
  if (!isValidEmpireId(empireId)) return { ok: false, status: 400, error: 'Invalid empire id (expected a Base token address)' }
  return getJson(`/boosters/${empireId}`)
}
