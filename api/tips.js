// GET /api/tips - fetch tips for a list of cast hashes
// Query: ?hashes=hash1,hash2,hash3
// Response: { tips: { [hash]: { amount, count, totalTipped } } }
//
// POST /api/tips - submit a tip on a cast
// Body: { hash: string, amount: number (wei) }
// Response: { ok: true, newBalance?: number, burn?: number, payout?: number }
//
// Tips are stored in KV as:
//   tips:<hash> -> { amount, fid, at } (individual tip entry, append to a list)
//   tips:stats:<hash> -> { totalTipped, count, lastUpdated } (aggregate stats)
// Weekly batch burn/payout handled by cron (api/cron/*.js).

import { kvList, kvPush, kvGet, kvSet, storeEnabled } from '../store.js'
import { blockedByAuth } from '../auth.js'

// Minimum tip to prevent dust submissions (in wei). 0.1 ZAALCASTER (10^17 wei).
const MIN_TIP_WEI = BigInt('100000000000000000')

// Rate limiting: max 1 tip per hash per user per 10 minutes.
async function checkRateLimit(fid, hash) {
  if (!storeEnabled()) return true // pass through if store disabled
  const key = `ratelimit:tips:${fid}:${hash}`
  const lastTip = await kvGet(key)
  if (lastTip && Date.now() - lastTip < 600000) {
    return false // already tipped this cast within 10 min
  }
  return true
}

async function recordRateLimit(fid, hash) {
  if (!storeEnabled()) return
  const key = `ratelimit:tips:${fid}:${hash}`
  await kvSet(key, Date.now())
}

// Fetch aggregate stats for a single hash
async function getTipStats(hash) {
  if (!storeEnabled()) return { totalTipped: 0n, count: 0, lastUpdated: null }
  const stats = await kvGet(`tips:stats:${hash}`)
  if (!stats) return { totalTipped: 0n, count: 0, lastUpdated: null }
  return {
    totalTipped: BigInt(stats.totalTipped || '0'),
    count: stats.count || 0,
    lastUpdated: stats.lastUpdated,
  }
}

// Fetch all tips for a hash (for debugging / transparency)
async function getTipsForHash(hash) {
  if (!storeEnabled()) return []
  return kvList(`tips:${hash}`, 100)
}

export default async function handler(req, res) {
  if (blockedByAuth(req, res)) return

  res.setHeader('Cache-Control', 'no-store')

  // GET /api/tips?hashes=hash1,hash2,hash3
  if (req.method === 'GET') {
    try {
      const hashes = (req.query.hashes || '').split(',').filter(Boolean)
      if (!hashes.length) {
        res.status(400).json({ error: 'no hashes provided' })
        return
      }

      const tips = {}
      for (const hash of hashes) {
        const stats = await getTipStats(hash)
        tips[hash] = {
          totalTipped: stats.totalTipped.toString(),
          count: stats.count,
          lastUpdated: stats.lastUpdated,
        }
      }

      res.status(200).json({ tips, timestamp: Date.now() })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'fetch tips failed' })
    }
    return
  }

  // POST /api/tips - submit a tip
  if (req.method === 'POST') {
    try {
      const { hash, amount } = req.body
      if (!hash || !amount) {
        res.status(400).json({ error: 'missing hash or amount' })
        return
      }

      const fid = req.query.fid || req.body.fid || null // Can be passed by client or looked up from session
      if (!fid) {
        res.status(400).json({ error: 'missing fid (who is tipping?)' })
        return
      }

      const amountWei = BigInt(amount)
      if (amountWei < MIN_TIP_WEI) {
        res.status(400).json({ error: `tip too small; minimum ${MIN_TIP_WEI.toString()} wei` })
        return
      }

      // Rate limit check
      const canTip = await checkRateLimit(fid, hash)
      if (!canTip) {
        res.status(429).json({ error: 'rate limited; max 1 tip per cast per 10 min' })
        return
      }

      // Record the tip
      const tipEntry = { amount: amountWei.toString(), fid, at: Date.now() }
      await kvPush(`tips:${hash}`, tipEntry, 1000)
      await recordRateLimit(fid, hash)

      // Update stats
      const stats = await getTipStats(hash)
      const newStats = {
        totalTipped: (stats.totalTipped + amountWei).toString(),
        count: stats.count + 1,
        lastUpdated: Date.now(),
      }
      await kvSet(`tips:stats:${hash}`, newStats)

      res.status(200).json({
        ok: true,
        hash,
        tipAmount: amountWei.toString(),
        newTotal: newStats.totalTipped,
        count: newStats.count,
      })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'submit tip failed' })
    }
    return
  }

  res.status(405).json({ error: 'method not allowed' })
}
