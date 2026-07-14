#!/usr/bin/env node

// empire - Empire Builder read lookups (empirebuilder.world). Read-only, no
// key needed. Zaal creates the actual empire in the Empire Builder UI (a
// manual step, see research doc 991); this CLI just reads it back.
//
// Usage:
//   zaalcaster-empire search <name>              free-text / farcaster-name search
//   zaalcaster-empire owner <walletAddress>       empires owned by a wallet
//   zaalcaster-empire get <empireId>              single empire (empireId = Base token address)
//   zaalcaster-empire boosters <empireId>         active boosters for an empire
//   zaalcaster-empire leaderboards <empireId>     discover leaderboard slots for an empire
//   zaalcaster-empire leaderboard <leaderboardId> ranked entries for one leaderboard
//   zaalcaster-empire top [--limit n]             top empires by total distributed

import {
  searchEmpires, getEmpiresByOwner, getEmpireById, getEmpireBoosters,
  getEmpireLeaderboards, getLeaderboardEntries, getTopEmpires,
} from '../empire.js'

function printResult(result) {
  if (!result.ok) {
    console.error(`Error (${result.status}): ${result.error}`)
    process.exit(1)
  }
  console.log(JSON.stringify(result.data, null, 2))
}

async function main() {
  const args = process.argv.slice(2)
  const [cmd, target] = args

  switch (cmd) {
    case 'search':
      if (!target) { console.error('Usage: zaalcaster-empire search <name>'); process.exit(1) }
      printResult(await searchEmpires({ farcasterName: target }))
      break
    case 'owner':
      if (!target) { console.error('Usage: zaalcaster-empire owner <walletAddress>'); process.exit(1) }
      printResult(await getEmpiresByOwner(target))
      break
    case 'get':
      if (!target) { console.error('Usage: zaalcaster-empire get <empireId>'); process.exit(1) }
      printResult(await getEmpireById(target))
      break
    case 'boosters':
      if (!target) { console.error('Usage: zaalcaster-empire boosters <empireId>'); process.exit(1) }
      printResult(await getEmpireBoosters(target))
      break
    case 'leaderboards':
      if (!target) { console.error('Usage: zaalcaster-empire leaderboards <empireId>'); process.exit(1) }
      printResult(await getEmpireLeaderboards(target))
      break
    case 'leaderboard':
      if (!target) { console.error('Usage: zaalcaster-empire leaderboard <leaderboardId>'); process.exit(1) }
      printResult(await getLeaderboardEntries(target))
      break
    case 'top': {
      const limitIdx = args.indexOf('--limit')
      const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 20
      printResult(await getTopEmpires({ limit }))
      break
    }
    default:
      console.error('Usage: zaalcaster-empire <search|owner|get|boosters|leaderboards|leaderboard|top> [arg]')
      process.exit(1)
  }
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
