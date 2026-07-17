// wavewarz.js - WaveWarZ on-chain analytics card, dependency-free
// ESM. Follows the shared client pattern - see empire.js's "THE CLIENT
// PATTERN" header for the never-throws / validate-first / cache+sweep /
// no-SDK rationale.
//
// WHY BAKED SNAPSHOT, NOT LIVE: WaveWarZ's program is readable on-chain via
// Helius, but the API key lives in ~/.zao/zao.env - not wired into the Vercel
// deploy. The Dune analytics snapshot (scripts/ww-gen.py -> wwtracker/lib/
// wwData.ts) is the stable source until the key is added to Vercel. Until
// then getSnapshotStats() returns the baked data with an explicit snapshotAt
// field. wavewarz.info is the live dashboard for anything fresher.
//
// Read-only BY SCOPE: trading/claiming is an on-chain tx against the WaveWarZ
// program, requires wallet-signing - deliberately out of scope for this module.

export const PROGRAM_ID = '9TUfEHvk5fN5vogtQyrefgNqzKy2Bqb4nWVhSFUg2fYo'
export const TREASURY_WALLET = 'GhostTreasury1111111111111111111111111111111'

// Per-trade fee model (verified from program discriminators):
//   artist: 1.0% | platform: 0.5% | pool remainder: 98.5%
// At settlement: winning traders 40%, losing traders 50%, winning artist 5%,
//   losing artist 2%, platform 3%. See research doc 1237 for verification.
export const FEE_MODEL = {
  perTrade: { artist: 0.01, platform: 0.005, pool: 0.985 },
  atSettlement: { winTraders: 0.40, loseTraders: 0.50, winArtist: 0.05, loseArtist: 0.02, platform: 0.03 },
}

// Baked Dune snapshot (generated 2026-06-14T20:56Z by scripts/ww-gen.py).
// wavewarz.info is the live dashboard for fresher data.
const SNAPSHOT_AT = '2026-06-14'

const PLATFORM = {
  battles: 1200,
  trades: 9045,
  uniqueTraders: 122,
  buyVolumeSol: 498.88,
  treasuryNetSol: 3.51,
  artistPayoutsSol: 8.82,
  platformRevenueSol: 16.81,
}

// Zaal's personal trader stats (FID 19640, Solana wallet via Dialect).
const ZAAL_TRADER = {
  txs: 518,
  netSol: -2.96,
  biggestWinSol: 0.60,
  biggestLossSol: -0.90,
  winRate: 0.357,
  winTxs: 185,
  lossTxs: 333,
}

// getSnapshotStats - returns baked platform + personal trader stats.
// Always succeeds (no network). The ok=true shape is intentional - callers
// can treat this uniformly with live clients that may fail.
export function getSnapshotStats() {
  return {
    ok: true,
    snapshotAt: SNAPSHOT_AT,
    liveUrl: 'https://wavewarz.info',
    platform: { ...PLATFORM },
    zaalTrader: { ...ZAAL_TRADER },
  }
}
