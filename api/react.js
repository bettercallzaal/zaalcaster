// POST /api/react - every RELATIONSHIP/SIGNAL write: like, recast, follow/
// unfollow, mute/unmute, block/unblock, channel follow/unfollow.
// Body: { type, targetHash?, targetFid?, channelId? }
//
// WHY THESE ARE FOLDED TOGETHER (and kept separate from api/send.js): same
// 12-function-cap grouping-by-trust as send.js, but this file is the
// REVERSIBLE tier - everything here can be undone with the opposite call,
// and nothing publishes words as Zaal. That's also why the UI fires likes/
// recasts on a single click with no confirm (reversible = low ceremony)
// while block keeps a two-step confirm in the UI (reversible, but loud).
// Owner-only via blockedByAuth; needs the signer like any protocol write.

import { postReaction, setFollow, setMuteBlock, setChannelFollow, friendlyPostError } from '../lib.js'
import { blockedByAuth } from '../auth.js'

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

export default async function handler(req, res) {
  if (blockedByAuth(req, res)) return
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return }
  try {
    const body = await readJsonBody(req)

    // follow / unfollow - a relationship write (reversible), fired on click like
    // a reaction. Needs the target fid, not a cast hash.
    if (body.type === 'follow' || body.type === 'unfollow') {
      const fid = parseInt(body.targetFid, 10)
      if (!Number.isFinite(fid)) { res.status(400).json({ error: 'missing targetFid' }); return }
      await setFollow(fid, body.type === 'follow')
      res.status(200).json({ ok: true, type: body.type, following: body.type === 'follow' })
      return
    }

    // channel follow / unfollow - subscribe to a channel's feed
    if (body.type === 'channel_follow' || body.type === 'channel_unfollow') {
      const channelId = (body.channelId || '').trim()
      if (!channelId) { res.status(400).json({ error: 'missing channelId' }); return }
      await setChannelFollow(channelId, body.type === 'channel_follow')
      res.status(200).json({ ok: true, type: body.type, following: body.type === 'channel_follow' })
      return
    }

    // protocol mute / block (and their reverses) - relationship list writes
    if (['mute', 'unmute', 'block', 'unblock'].includes(body.type)) {

      const fid = parseInt(body.targetFid, 10)
      if (!Number.isFinite(fid)) { res.status(400).json({ error: 'missing targetFid' }); return }
      const kind = body.type.includes('block') ? 'block' : 'mute'
      const on = !body.type.startsWith('un')
      await setMuteBlock(fid, kind, on)
      res.status(200).json({ ok: true, type: body.type })
      return
    }

    const type = body.type === 'recast' ? 'recast' : 'like'
    const targetHash = typeof body.targetHash === 'string' ? body.targetHash : ''
    if (!targetHash) { res.status(400).json({ error: 'missing targetHash' }); return }

    await postReaction(type, targetHash, body.targetFid ?? null)
    res.status(200).json({ ok: true, type })
  } catch (err) {
    res.status(500).json({ error: friendlyPostError(err) })
  }
}
