// empire.js - Empire Builder client (empirebuilder.world), dependency-free ESM,
// mirrors juke.js's never-throws { ok, ... } style.
//
// Empire Builder (Zaal is a partner, white-label) wraps a Farcaster/Base
// project in leaderboards + boosters + a treasury. Per research doc 991, the
// Triple-A path is: stand up a TOKENLESS empire first, build energy, tokenize
// later.
//
// READS need no key (public, doc 582, verified 2026-05-01). The one WRITE
// call below - deployTokenlessEmpire - needs both an x-api-key (server-only,
// EMPIRE_BUILDER_API_KEY) AND a signature this file never produces itself:
// the empire's `owner` wallet must EIP-191-sign the exact required message
// client-side, in the owner's own wallet. This file only relays an
// already-signed payload - it has no way to sign anything and never holds a
// private key, so it cannot deploy an empire on its own. The human always
// pulls the trigger by signing in their wallet app.

import fs from 'fs'
import path from 'path'

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

// EMPIRE_BUILDER_API_KEY: process.env wins (Vercel), then the local creds
// file, same lookup order as juke.js's loadJukeKey().
export function loadEmpireBuilderKey() {
  if (process.env.EMPIRE_BUILDER_API_KEY) return process.env.EMPIRE_BUILDER_API_KEY.trim()
  try {
    const credsPath = path.join(process.env.HOME || '', '.zao/private/farcaster-zaal.env')
    if (fs.existsSync(credsPath)) {
      for (const line of fs.readFileSync(credsPath, 'utf-8').split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const [k, ...rest] = t.split('=')
        if (k === 'EMPIRE_BUILDER_API_KEY') return rest.join('=').trim()
      }
    }
  } catch {
    // unreadable creds - treated as no key
  }
  return null
}

// Exact message strings Empire Builder requires the owner wallet to sign
// (EIP-191 personal_sign) - client and server must agree on these byte for
// byte, so they live here as the single source of truth for both sides.
export function tokenlessEmpireMessage({ mode, name, fid }) {
  if (mode === 'farcaster') return `I am deploying a tokenless Farcaster Empire with Farcaster ID ${fid} and name ${name}`
  return `I am deploying a custom tokenless Empire named ${name}`
}

// POST /api/deploy-empire-tokenless - the one write call this file makes.
// `payload` must already carry a valid `signature` over `tokenlessEmpireMessage`,
// produced client-side by the owner wallet - see the file header. This
// function does not sign, does not hold a key, and does not decide who is
// allowed to call it (that's the caller's job - see api/stats.js's
// blockedByAuth gate).
export async function deployTokenlessEmpire(payload) {
  const key = loadEmpireBuilderKey()
  if (!key) return { ok: false, status: 401, error: 'EMPIRE_BUILDER_API_KEY not set (env or ~/.zao/private/farcaster-zaal.env)' }

  let res
  try {
    res = await fetch(`${API_ORIGIN}/deploy-empire-tokenless`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return { ok: false, status: 502, error: timedOut ? 'Empire Builder API timed out' : 'Could not reach the Empire Builder API' }
  }

  let data
  try {
    data = await res.json()
  } catch {
    data = null
  }

  if (!res.ok) {
    const detail = data?.error || data?.message || JSON.stringify(data || {}).slice(0, 300)
    return { ok: false, status: res.status, error: `Empire Builder deploy failed (${res.status}): ${detail}` }
  }

  return { ok: true, data }
}
