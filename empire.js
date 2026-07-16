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
//
// ========================= THE CLIENT PATTERN (why) =========================
// Every external-API client in this repo (juke.js first, then this file,
// poidh.js, zora.js, zoe.js) follows the same four rules:
//
// 1. NEVER THROWS - always returns { ok, status, error } or { ok, data }.
//    These run inside Vercel serverless handlers where an uncaught throw is
//    an opaque 500 with no useful message. Returning a shaped error lets the
//    handler pick the right HTTP status and lets the UI say what actually
//    happened ("Empire Builder API timed out" vs a blank card).
// 2. VALIDATE BEFORE FETCH - every id/address that gets interpolated into a
//    URL path is regex-constrained first. This is simultaneously the
//    path-injection guard (a crafted id can't smuggle "../" or a query
//    string), the quota-saver (garbage never spends an API call), and the
//    fast client-side 400.
// 3. CACHE 60s + SWEEP - none of these APIs document rate limits, so we cache
//    politely rather than guess a budget. Module-level Map survives warm
//    serverless invocations (that's the point), and sweepCache() deletes
//    expired entries because skip-on-read alone grows the map forever
//    (2026-07-15 audit finding). Only 2xx responses are cached - errors must
//    stay retryable.
// 4. NO SDKs - the repo is dependency-free (Node builtins only). Every one of
//    these APIs turned out to be callable with plain fetch(); when one isn't
//    (0xSplits needs their SDK + an API key), the verdict is skip, not "add
//    the dependency" - see CLAUDE.md's integration decisions.
// ============================================================================

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

// Expired entries were only ever skipped on read, never deleted - on warm
// Vercel invocations the map grows forever. Sweep on each call (n is tiny).
function sweepCache() {
  const now = Date.now()
  for (const [k, v] of cache) if (now - v.at >= CACHE_TTL_MS) cache.delete(k)
}

async function getJson(path) {
  const url = `${API_ORIGIN}${path}`

  sweepCache()
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

// GET /api/empire-rewards/[empire_id] - reward summary: empire_rewards,
// burned, and airdrops arrays (3 most recent each per doc 582).
export async function getEmpireRewardsSummary(empireId) {
  if (!isValidEmpireId(empireId)) return { ok: false, status: 400, error: 'Invalid empire id (expected a Base token address)' }
  return getJson(`/empire-rewards/${empireId}`)
}

// GET /api/empire-rewards/[empire_id]/[type] - full history for one type.
export async function getEmpireRewardsByType(empireId, type) {
  if (!isValidEmpireId(empireId)) return { ok: false, status: 400, error: 'Invalid empire id (expected a Base token address)' }
  if (!['distribute', 'burned', 'airdrop'].includes(type)) return { ok: false, status: 400, error: 'type must be distribute, burned, or airdrop' }
  return getJson(`/empire-rewards/${empireId}/${type}`)
}

// GET /api/rewards/recipients/[transactionHash] - who got paid in one
// distribution transaction.
const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/
export async function getDistributionRecipients(transactionHash) {
  if (typeof transactionHash !== 'string' || !TX_HASH_PATTERN.test(transactionHash)) return { ok: false, status: 400, error: 'Invalid transaction hash' }
  return getJson(`/rewards/recipients/${transactionHash}`)
}

// GET /api/distribution-records/[empireAddress] - lifetime USD received per
// recipient address, with last-update timestamps. Note: keyed by the
// empire's SmartVault/treasury address, not the base_token id used above.
export async function getDistributionRecords(empireAddress) {
  if (!isValidWalletAddress(empireAddress)) return { ok: false, status: 400, error: 'Invalid empire address' }
  return getJson(`/distribution-records/${empireAddress}`)
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

// The docs' recommended message for add-booster (doc 1094a). remove-booster's
// message format is NOT pinned down in their docs - that call is deliberately
// not implemented until Adrian confirms the contract.
export function addBoosterMessage(empireId) {
  return `Add booster for empire id ${empireId}`
}

// Staking messages, exact per doc 1094a. Note activate-staking is the ONE
// Empire Builder write whose signed message embeds a millisecond timestamp
// (server rejects >5 min old) - their own replay-protection pattern, worth
// copying if we ever design our own signed flows.
export function addStakingBoosterMessage(empireId) {
  return `Add staking booster for empire id ${empireId}`
}
export function activateStakingMessage(empireId, timestampMs) {
  return `Activate staking for empire ${String(empireId).toLowerCase()} at ${timestampMs}`
}

// Shared relay for the Empire Builder authenticated writes - same contract
// as deployTokenlessEmpire/addBooster: the payload already carries the owner
// wallet's signature, this only forwards it with the server-side key.
async function postAuthed(path, payload) {
  const key = loadEmpireBuilderKey()
  if (!key) return { ok: false, status: 401, error: 'EMPIRE_BUILDER_API_KEY not set (env or ~/.zao/private/farcaster-zaal.env)' }

  let res
  try {
    res = await fetch(`${API_ORIGIN}${path}`, {
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
  try { data = await res.json() } catch { data = null }
  if (!res.ok) {
    const detail = data?.error || data?.message || JSON.stringify(data || {}).slice(0, 300)
    return { ok: false, status: res.status, error: `Empire Builder write failed (${res.status}): ${detail}` }
  }
  return { ok: true, data }
}

// POST /api/staking-boosters/[empire_id] - a multiplier for LOCKING tokens a
// minimum duration (vs add-booster's hold-only check). minStake is a raw
// wei-style integer string; minLockupSeconds 0..315,360,000 (10 years) per
// the docs' documented bounds.
export async function addStakingBooster(empireId, payload) {
  if (!isValidEmpireId(empireId)) return { ok: false, status: 400, error: 'Invalid empire id' }
  return postAuthed(`/staking-boosters/${empireId}`, payload)
}

// POST /api/empires/activate-staking - turns staking on for an empire and
// auto-creates a stakers leaderboard (the response's leaderboardId). Their
// docs show it deploying/returning a stakingToken - which implies it expects
// a TOKEN empire; behavior on a tokenless empire is undocumented, so the UI
// labels this as a token-empire feature and surfaces whatever error comes
// back rather than guessing.
export async function activateStaking(payload) {
  return postAuthed('/empires/activate-staking', payload)
}

// GET /api/empires/activate-staking?tokenAddress= - staking status read
// (documented alongside the POST as its public companion).
export async function getStakingStatus(empireId) {
  if (!isValidEmpireId(empireId)) return { ok: false, status: 400, error: 'Invalid empire id' }
  return getJson(`/empires/activate-staking?tokenAddress=${empireId}`)
}

// POST /api/boosters/[empire_id] - add a score-multiplier booster (ERC20 /
// NFT / QUOTIENT). Same trust model as deployTokenlessEmpire above: `payload`
// must already carry the owner wallet's EIP-191 signature over
// addBoosterMessage(empireId); this function only relays.
export async function addBooster(empireId, payload) {
  if (!isValidEmpireId(empireId)) return { ok: false, status: 400, error: 'Invalid empire id' }
  const key = loadEmpireBuilderKey()
  if (!key) return { ok: false, status: 401, error: 'EMPIRE_BUILDER_API_KEY not set (env or ~/.zao/private/farcaster-zaal.env)' }

  let res
  try {
    res = await fetch(`${API_ORIGIN}/boosters/${empireId}`, {
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
    return { ok: false, status: res.status, error: `Empire Builder add-booster failed (${res.status}): ${detail}` }
  }

  return { ok: true, data }
}
