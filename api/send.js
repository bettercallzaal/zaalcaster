// POST /api/send - THE "speak as Zaal" route: casting (reply / quote /
// top-level / thread), delete, profile edit, image upload, and X + Bluesky
// cross-posting all live in this one file.
//
// WHY ONE FILE: Vercel Hobby caps the repo at 12 serverless functions, so
// routes are grouped by TRUST LEVEL, not by feature. Everything here can
// publish or mutate as Zaal, so it all sits behind the same blockedByAuth
// gate (owner-only via the SIWF session; guests can never reach any branch)
// and shares one signer requirement.
//
// THE UI CONTRACT (the confirm rule): the server can verify a session but
// cannot verify a human read the text - so the non-negotiable rule that
// exact text is shown + explicitly confirmed before this route is called
// lives in the frontends (two-step confirm everywhere) and in CLAUDE.md.
// Cross-posts additionally require their toggle ON at confirm time, and a
// cross-post failure never fails the cast (the cast is the primary act).
//
// Body: { text, parentHash?, parentFid?, channelId?, ... } - parentHash
// present -> reply; quoteHash -> quote; casts[] -> thread; action ->
// profile/delete. Needs the signer (clean 500 with a friendly message if
// unset - reads elsewhere work without one by design).

import { postCast, friendlyPostError, getPostingHealth, loadEnv, deleteCast, updateProfile } from '../lib.js'
import { postToX, postThreadToX, xEnabled } from '../xpost.js'
import { postToBluesky, postThreadToBluesky, bskyEnabled } from '../bsky.js'
import { postToTelegram, postToDiscord, telegramEnabled, discordEnabled } from '../chat.js'
import { blockedByAuth } from '../auth.js'

// MULTI-ACCOUNT: cast as another ZAO account without ever trusting the client.
// The browser sends a short account KEY ("thezao"); the server maps it to a
// signer from env - SIGNER_UUID_<KEY uppercased>. A raw signer_uuid from the
// client is never honoured, so a tampered page cannot cast as an account the
// server has no key for. Discovery mirrors the bus's BUS_GUEST_TOKEN_<NAME>
// pattern: scan env, A-Z0-9 only.
function accountSigners() {
  const out = {}
  for (const [k, v] of Object.entries(process.env)) {
    const m = /^SIGNER_UUID_([A-Z0-9]+)$/.exec(k)
    if (m && v) out[m[1].toLowerCase()] = v
  }
  return out
}

// Public list for the UI - KEYS ONLY, never the uuids.
export function accountKeys() {
  return Object.keys(accountSigners())
}

// null = post as Zaal (the default signer). A key with no env entry is an
// explicit error, never a silent fallback to Zaal's account - casting as the
// wrong identity is exactly the failure worth being loud about.
function resolveSigner(accountKey) {
  if (!accountKey || accountKey === 'me') return { ok: true, signerUuid: null }
  const key = String(accountKey).toLowerCase()
  const found = accountSigners()[key]
  if (!found) return { ok: false, error: `unknown account "${key}" - set SIGNER_UUID_${key.toUpperCase()} in the env` }
  return { ok: true, signerUuid: found }
}

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
  // GET -> posting health check (is the signer wired up under the key?)
  if (req.method === 'GET') {
    const h = await getPostingHealth().catch(() => ({ ready: false, reason: 'error' }))
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      ...h,
      xEnabled: xEnabled(),
      bskyEnabled: bskyEnabled(),
      telegramEnabled: telegramEnabled(),
      discordEnabled: discordEnabled(),
      accounts: accountKeys(),
    })
    return
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return }
  try {
    const body = await readJsonBody(req)

    // update your own profile (bio / display / pfp / url). Public change - the
    // UI shows the diff and confirms before calling this.
    if (body.action === 'profile') {
      const fields = {}
      for (const k of ['bio', 'display_name', 'pfp_url', 'url']) {
        if (typeof body[k] === 'string') fields[k] = body[k].trim()
      }
      await updateProfile(fields)
      res.status(200).json({ ok: true, updated: Object.keys(fields).filter((k) => fields[k]) })
      return
    }

    // delete one of your own casts (the UI confirms first)
    if (body.action === 'delete') {
      const hash = typeof body.hash === 'string' && /^0x[0-9a-fA-F]+$/.test(body.hash) ? body.hash : null
      if (!hash) { res.status(400).json({ error: 'bad hash' }); return }
      await deleteCast(hash)
      res.status(200).json({ ok: true, deleted: hash })
      return
    }

    // image upload: browser sends a base64 data URL, we push it to Imgur and
    // hand back a public URL to attach as an embed. Needs IMGUR_CLIENT_ID.
    if (typeof body.upload === 'string' && body.upload.startsWith('data:')) {
      const clientId = process.env.IMGUR_CLIENT_ID
      if (!clientId) { res.status(200).json({ ok: false, reason: 'no image host - set IMGUR_CLIENT_ID in Vercel' }); return }
      const b64 = body.upload.split(',')[1] || ''
      if (!b64) { res.status(400).json({ error: 'empty image' }); return }
      if (b64.length > 12 * 1024 * 1024) { res.status(400).json({ error: 'image too large' }); return }
      const up = await fetch('https://api.imgur.com/3/image', {
        method: 'POST',
        headers: { Authorization: `Client-ID ${clientId}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: b64, type: 'base64' }),
      })
      const ud = await up.json().catch(() => ({}))
      const url = ud?.data?.link
      if (!url) { res.status(200).json({ ok: false, reason: 'upload failed' }); return }
      res.status(200).json({ ok: true, url })
      return
    }

    // thread mode: post an array of casts, each replying to the previous
    if (Array.isArray(body.casts)) {
      const parts = body.casts.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 25)
      if (!parts.length) { res.status(400).json({ error: 'empty thread' }); return }
      if (parts.some((p) => p.length > 1024)) { res.status(400).json({ error: 'a cast is too long' }); return }
      const myFid = loadEnv().FID
      const channelId = typeof body.channelId === 'string' && body.channelId ? body.channelId : null
      let parentHash = null, firstLink = null, posted = 0
      for (let i = 0; i < parts.length; i++) {
        const opts = i === 0 ? { channelId } : { parentHash, parentFid: myFid }
        const resp = await postCast(parts[i], opts)
        const cast = resp.cast
        parentHash = cast.hash; posted++
        if (i === 0) firstLink = `https://farcaster.xyz/${cast.author.username}/${cast.hash.slice(0, 10)}`
      }
      // optional cross-post of the whole thread (toggled + confirmed). X and
      // Bluesky get a real thread; the chat rooms get the joined text as ONE
      // message - a 12-message burst in a chat room is spam, not a thread.
      let x = null, bsky = null, telegram = null, discord = null
      if (body.alsoX) x = await postThreadToX(parts).catch((e) => ({ ok: false, reason: e?.message || 'x failed' }))
      if (body.alsoBsky) bsky = await postThreadToBluesky(parts).catch((e) => ({ ok: false, reason: e?.message || 'bsky failed' }))
      const joined = parts.join('\n\n')
      if (body.alsoTelegram) telegram = await postToTelegram(joined, { castUrl: firstLink }).catch((e) => ({ ok: false, reason: e?.message || 'telegram failed' }))
      if (body.alsoDiscord) discord = await postToDiscord(joined, { castUrl: firstLink }).catch((e) => ({ ok: false, reason: e?.message || 'discord failed' }))
      res.status(200).json({ ok: true, link: firstLink, count: posted, x, bsky, telegram, discord })
      return
    }

    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const intOrNull = (v) => (typeof v === 'number' && Number.isInteger(v)) ? v : (/^\d+$/.test(String(v)) ? parseInt(v, 10) : null)
    const parentHash = typeof body.parentHash === 'string' && body.parentHash ? body.parentHash : null
    const parentFid = intOrNull(body.parentFid)
    const channelId = typeof body.channelId === 'string' && body.channelId ? body.channelId : null
    const embedUrl = typeof body.embedUrl === 'string' && /^https?:\/\//.test(body.embedUrl) ? body.embedUrl : null
    const quoteHash = typeof body.quoteHash === 'string' && body.quoteHash ? body.quoteHash : null
    const quoteFid = intOrNull(body.quoteFid)

    if (!text) { res.status(400).json({ error: 'empty text' }); return }
    if (text.length > 1024) { res.status(400).json({ error: 'text too long' }); return }

    // parentHash -> reply; quoteHash -> quote cast; else top-level (Compose)
    const acct = resolveSigner(body.account)
    if (!acct.ok) { res.status(400).json({ error: acct.error }); return }
    const response = await postCast(text, { parentHash, parentFid, channelId, quoteHash, quoteFid, embedUrl, signerUuid: acct.signerUuid })
    const cast = response.cast

    // optional cross-post to X / Bluesky / Telegram / Discord - only when toggled
    // on (confirm is the yes) and only for top-level casts. Never blocks the cast:
    // a cross-post failure still returns the successful cast.
    const castLink = `https://farcaster.xyz/${cast.author.username}/${cast.hash.slice(0, 10)}`
    let x = null, bsky = null, telegram = null, discord = null
    if (!parentHash) {
      if (body.alsoX) x = await postToX(text).catch((e) => ({ ok: false, reason: e?.message || 'x failed' }))
      if (body.alsoBsky) bsky = await postToBluesky(text).catch((e) => ({ ok: false, reason: e?.message || 'bsky failed' }))
      // chat rooms get the cast link appended so readers can jump to the original
      if (body.alsoTelegram) telegram = await postToTelegram(text, { castUrl: castLink }).catch((e) => ({ ok: false, reason: e?.message || 'telegram failed' }))
      if (body.alsoDiscord) discord = await postToDiscord(text, { castUrl: castLink }).catch((e) => ({ ok: false, reason: e?.message || 'discord failed' }))
    }

    res.status(200).json({
      ok: true,
      hash: cast.hash,
      link: castLink,
      x, bsky, telegram, discord,
    })
  } catch (err) {
    // lib throws a clear message when ZAAL_SIGNER_UUID is missing
    res.status(500).json({ error: friendlyPostError(err) })
  }
}
