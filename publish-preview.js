// publish-preview.js - what a send WOULD do, rail by rail, without sending.
//
// Ports the CONTRACT of ZAOOS's /api/publish/compose (dryRun by default, a
// per-platform report before anything goes out) onto zaalcaster's own
// zero-dep rails. Posting stays sovereign (vault decision 2026-08-07); this
// file only mirrors what api/send.js + xpost.js + bsky.js + chat.js already do,
// so the preview and the real send cannot disagree about the text.
//
// PURE: no fetch, no env reads except the *Enabled() checks passed in. That is
// the guarantee a preview can never publish - there is nothing here to publish
// with.

// Mirrors of the limits the rails actually enforce. Keep in step with:
//   api/send.js  1024 per cast (rejects, does not trim)
//   xpost.js     no trim - X itself rejects over 280
//   bsky.js      body.slice(0, 300)
//   chat.js      (text + '\n\n' + castUrl).slice(0, 4096 / 2000)
export const LIMITS = { farcaster: 1024, x: 280, bluesky: 300, telegram: 4096, discord: 2000 }

// The cast link does not exist until the cast does. Chat rails append it, so
// the preview uses a same-length placeholder: farcaster.xyz/<user>/0x + 8 hex.
export function castLinkPlaceholder(username = 'zaal') {
  return `https://farcaster.xyz/${username}/0x????????`
}

// X counts code points, and every URL as 23. This matches that for the common
// case; emoji/CJK weighting is not modelled, so `approx` is flagged.
function xLength(s) {
  const urls = s.match(/https?:\/\/\S+/g) || []
  const stripped = urls.reduce((acc, u) => acc.replace(u, ''), s)
  return [...stripped].length + urls.length * 23
}

function railResult(rail, { selected, configured, parts, limit, trims, rejects, note, approx }) {
  const items = parts.map((p) => {
    const sent = trims ? p.slice(0, limit) : p
    const chars = rail === 'x' ? xLength(p) : p.length
    return { text: sent, chars, truncated: trims && p.length > limit, overLimit: !trims && chars > limit }
  })
  const willSend = selected && configured
  const blocked = rejects && items.some((i) => i.overLimit)
  return {
    rail,
    selected,
    configured,
    willSend: willSend && !blocked,
    limit,
    items,
    ...(approx ? { approx: true } : {}),
    note: !selected ? 'off'
      : !configured ? 'not configured - nothing would send'
        : blocked ? `over ${limit} - ${rail} would reject this`
          : items.some((i) => i.truncated) ? `trimmed to ${limit}`
            : note || 'ok',
  }
}

// input: the same body api/send.js accepts, plus rails = { x, bluesky, telegram, discord } booleans.
export function previewSend(body = {}, rails = {}, { username = 'zaal' } = {}) {
  const isThread = Array.isArray(body.casts)
  const parts = isThread
    ? body.casts.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 25)
    : [typeof body.text === 'string' ? body.text.trim() : ''].filter(Boolean)
  if (!parts.length) return { ok: false, error: isThread ? 'empty thread' : 'empty text' }

  const isReply = !isThread && typeof body.parentHash === 'string' && !!body.parentHash
  const kind = isThread ? 'thread' : isReply ? 'reply' : body.quoteHash ? 'quote' : 'cast'
  const link = castLinkPlaceholder(username)

  const farcaster = railResult('farcaster', {
    selected: true, configured: true, parts, limit: LIMITS.farcaster, trims: false, rejects: true,
  })

  // send.js only cross-posts top-level casts and threads, never replies.
  const cross = !isReply
  const skipNote = (rail) => ({ rail, selected: true, configured: !!rails[rail], willSend: false, items: [], note: 'replies are not cross-posted' })
  const pick = (flag, rail, opts) => {
    if (!body[flag]) return railResult(rail, { ...opts, selected: false, configured: !!rails[rail], parts: [], limit: LIMITS[rail] })
    if (!cross) return skipNote(rail)
    return railResult(rail, { selected: true, configured: !!rails[rail], limit: LIMITS[rail], ...opts })
  }

  // Chat rooms get the whole thread as ONE message with the cast link appended.
  const chatText = `${parts.join('\n\n')}\n\n${link}`

  const out = [
    farcaster,
    pick('alsoX', 'x', { parts, trims: false, rejects: true, approx: true, note: isThread ? `thread of ${parts.length}` : null }),
    pick('alsoBsky', 'bluesky', { parts, trims: true, note: isThread ? `thread of ${parts.length}` : null }),
    pick('alsoTelegram', 'telegram', { parts: [chatText], trims: true, note: 'cast link appended after send' }),
    pick('alsoDiscord', 'discord', { parts: [chatText], trims: true, note: 'cast link appended after send' }),
  ]

  return {
    ok: true,
    dryRun: true,
    kind,
    account: body.account && body.account !== 'me' ? String(body.account).toLowerCase() : 'me',
    channelId: typeof body.channelId === 'string' && body.channelId ? body.channelId : null,
    castBlocked: farcaster.items.some((i) => i.overLimit),
    rails: out,
  }
}
