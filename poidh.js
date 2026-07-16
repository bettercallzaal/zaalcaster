// poidh.js - POIDH ("pics or it didn't happen") bounty client, dependency-free
// ESM, mirrors empire.js/juke.js's never-throws { ok, ... } style.
//
// POIDH has no public REST/GraphQL docs. This calls the same tRPC endpoint
// their own frontend (poidh.xyz) uses - proven stable and keyless by
// bettercallzaal/zpoidh's own scripts/refresh-poidh-leaderboard.py, which
// has run this exact call shape in production. Read-only: no write endpoint
// here (claiming/creating a bounty is an on-chain tx via the PoidhV2
// contract, needing a connected wallet - a future slice, not this one).

const TRPC_BASE = 'https://poidh.xyz/api/trpc'
const REQUEST_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 60_000

// Verified deployed contracts (picsoritdidnthappen/poidh-app, src/utils/config.ts).
// mainContract = the PoidhV2 bounty/claim contract; nftContract = claim NFTs.
export const POIDH_CONTRACTS = {
  mainnet: { chainId: 1, mainContract: '0xE731dFadBFf20542E10D09D26Fc71445C70d4232', nftContract: '0x9c5F45D5e1382e4058D334d93C6c01442012a4D9' },
  arbitrum: { chainId: 42161, mainContract: '0x5555fa783936c260f77385b4e153b9725fef1719', nftContract: '0x27E117Cc9A8DA363442e7Bd0618939E3EEEACF6A' },
  base: { chainId: 8453, mainContract: '0x5555fa783936c260f77385b4e153b9725fef1719', nftContract: '0x27E117Cc9A8DA363442e7Bd0618939E3EEEACF6A' },
  degen: { chainId: 666666666, mainContract: '0x18e5585ca7ce31b90bc8bb7aaf84152857ce243f', nftContract: '0x39f04b7897dcaf9dc454e433f43fb1c3bb528e11' },
}

const cache = new Map() // url -> { at, payload }

// Sweep expired entries so the map can't grow unboundedly across warm
// serverless invocations (same fix as empire.js).
function sweepCache() {
  const now = Date.now()
  for (const [k, v] of cache) if (now - v.at >= CACHE_TTL_MS) cache.delete(k)
}

// tRPC's GET convention: /api/trpc/<procedure>?batch=1&input={"0":{"json":<payload>}}
// -> response is an array, [0].result.data.json is the actual payload.
async function trpcGet(proc, payload) {
  const input = encodeURIComponent(JSON.stringify({ 0: { json: payload } }))
  const url = `${TRPC_BASE}/${proc}?batch=1&input=${input}`

  sweepCache()
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload

  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return { ok: false, status: 502, error: timedOut ? 'POIDH API timed out' : 'Could not reach the POIDH API' }
  }

  if (!res.ok) {
    return { ok: false, status: res.status, error: `POIDH API returned ${res.status}` }
  }

  let json
  try {
    json = await res.json()
  } catch {
    return { ok: false, status: 502, error: 'POIDH API returned invalid JSON' }
  }

  const data = json?.[0]?.result?.data?.json
  if (data === undefined) {
    const errMsg = json?.[0]?.error?.json?.message
    return { ok: false, status: 502, error: errMsg || 'POIDH API returned an unexpected shape' }
  }

  const payloadOut = { ok: true, data }
  cache.set(url, { at: Date.now(), payload: payloadOut })
  return payloadOut
}

const BOUNTY_ID_PATTERN = /^\d{1,10}$/
const SUPPORTED_CHAIN_IDS = new Set([1, 42161, 8453, 666666666])

export function isValidBountyId(value) {
  return BOUNTY_ID_PATTERN.test(String(value))
}

// bounties.fetch - a single bounty's title/description/issuer/amount/status.
export async function getBounty(bountyId, chainId = 8453) {
  if (!isValidBountyId(bountyId)) return { ok: false, status: 400, error: 'Invalid bounty id' }
  if (!SUPPORTED_CHAIN_IDS.has(chainId)) return { ok: false, status: 400, error: 'Unsupported chain id' }
  return trpcGet('bounties.fetch', { id: Number(bountyId), chainId })
}

// claims.fetchBountyClaims - submissions against one bounty.
export async function getBountyClaims(bountyId, chainId = 8453, limit = 100) {
  if (!isValidBountyId(bountyId)) return { ok: false, status: 400, error: 'Invalid bounty id' }
  if (!SUPPORTED_CHAIN_IDS.has(chainId)) return { ok: false, status: 400, error: 'Unsupported chain id' }
  return trpcGet('claims.fetchBountyClaims', { bountyId: Number(bountyId), chainId, limit: Math.min(Math.max(1, limit), 100) })
}

// Convenience: bounty + its claims in one call, since the UI almost always
// wants both together.
export async function getBountyWithClaims(bountyId, chainId = 8453) {
  const [bounty, claims] = await Promise.all([getBounty(bountyId, chainId), getBountyClaims(bountyId, chainId)])
  return { bounty, claims }
}
