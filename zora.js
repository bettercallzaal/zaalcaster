// zora.js - Zora Creator Coin read client, dependency-free ESM, mirrors
// empire.js/poidh.js's never-throws { ok, ... } style.
//
// Public REST endpoint (docs.zora.co/coins/sdk/public-rest-api), no auth
// needed, no npm SDK required - confirmed live 2026-07-15 against Zaal's
// own Creator Coin (found via an Empire Builder booster entry on the ZABAL
// leaderboard: contractAddress 0x2275c5e507f1d01a0c043a4f888ec58f8215c285,
// Base). An optional API key exists for higher rate limits but reads work
// fine without one.

const API_ORIGIN = 'https://api-sdk.zora.engineering'
const REQUEST_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 60_000

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/

export function isValidCoinAddress(value) {
  return typeof value === 'string' && ADDRESS_PATTERN.test(value)
}

const cache = new Map() // url -> { at, payload }

// Sweep expired entries so the map can't grow unboundedly across warm
// serverless invocations (same fix as empire.js).
function sweepCache() {
  const now = Date.now()
  for (const [k, v] of cache) if (now - v.at >= CACHE_TTL_MS) cache.delete(k)
}

// GET /coin?address=&chain= -> { zora20Token: {...} }
export async function getCoin(address, chainId = 8453) {
  if (!isValidCoinAddress(address)) return { ok: false, status: 400, error: 'Invalid coin contract address' }

  const url = `${API_ORIGIN}/coin?address=${address}&chain=${chainId}`
  sweepCache()
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload

  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return { ok: false, status: 502, error: timedOut ? 'Zora API timed out' : 'Could not reach the Zora API' }
  }

  if (!res.ok) {
    return { ok: false, status: res.status, error: `Zora API returned ${res.status}` }
  }

  let json
  try {
    json = await res.json()
  } catch {
    return { ok: false, status: 502, error: 'Zora API returned invalid JSON' }
  }

  const token = json?.zora20Token
  if (!token) return { ok: false, status: 502, error: 'Zora API returned no token data for this address' }

  const payload = { ok: true, data: token }
  cache.set(url, { at: Date.now(), payload })
  return payload
}
