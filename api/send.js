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

import { postCast, friendlyPostError, getPostingHealth, loadEnv, deleteCast, updateProfile, rateHeadroom } from '../lib.js'
import { postToX, postThreadToX, xEnabled } from '../xpost.js'
import { postToBluesky, postThreadToBluesky, bskyEnabled } from '../bsky.js'
import { postToTelegram, postToDiscord, telegramEnabled, discordEnabled } from '../chat.js'
import { blockedByAuth } from '../auth.js'
import { storeEnabled, kvGet } from '../store.js'

// The agent SKILL doc - Austin Griffith's ethskills pattern (publish fetchable
// docs so an agent learns the API at runtime instead of hallucinating it).
// Served from this route because it documents WRITE endpoints, so it sits
// behind the same owner gate as everything else here. Kept next to the code it
// describes so it cannot drift.
const SKILL_DOC = `# zaalcaster - agent skill

Zaal's personal Farcaster cockpit (@zaal, fid 19640). Casts as Zaal, cross-posts
to X / Bluesky / Telegram / Discord, and can cast as other configured accounts.

## THE CONFIRM RULE (non-negotiable)

NEVER post, reply, or react without showing Zaal the EXACT text first and getting
an explicit yes. No exceptions, no "I assumed", no posting a paraphrase of what he
approved. If you are an agent driving this API: draft, show, wait, then send.
The UI enforces a two-step confirm for the same reason - do not route around it.

## Know the state before you act

GET /api/send
  -> { ready, fid, rails: {x, bluesky, telegram, discord}, accounts: [keys],
       scheduled: {store, pending, nextAt}, summary, checkedAt }
  \`summary\` is a plain-English line - read it instead of guessing what is wired.
  A rail that is false is NOT configured: do not offer it.
  scheduled.pending === null means UNKNOWN (a read failed), not zero.

## Send (owner only)

POST /api/send
  { text, channelId?, embedUrl?, account?, alsoX?, alsoBsky?, alsoTelegram?, alsoDiscord? }
    top-level cast. \`account\` is a KEY from GET /api/send accounts (omit = cast
    as Zaal). Cross-post flags only apply to top-level casts.
  { text, parentHash, parentFid }        reply
  { text, quoteHash, quoteFid }          quote cast
  { casts: [ ... ] }                     thread (each cast replies to the previous)
  { action: 'delete', hash }             delete a cast
  { upload: '<data url>' }               upload an image, returns a URL for embedUrl
  -> { ok, hash, link, x, bsky, telegram, discord }
  A cross-post failure NEVER fails the cast - the cast is the primary act.

## Read

GET /api/feed?mode=zaal|trending|foryou|channel|list
GET /api/view?kind=profile|thread|summary|reactions|followers|following|channel_info|channel_search|link_preview|poidh_bounty|empire_leaderboard|empire_distribution
GET /api/inbox            unanswered inbound (replies, mentions, quotes)
GET /api/state            synced client state (bookmarks, scheduled queue, lists)

## Auth

Sign In With Farcaster (Neynar SIWN) sets a signed session cookie.
  role owner (fid 19640) - everything, including every write above
  role guest             - public reads only; inbox/send/state/daily are refused
Writes are owner-only server-side. The client is never trusted with a signer:
you send an account KEY, the server maps it to a signer it holds.

## Example agent turn

  1. GET /api/send                       -> read summary, confirm casting is ready
  2. draft the text, SHOW IT TO ZAAL     -> wait for an explicit yes
  3. POST /api/send { text, alsoX: true } -> only after the yes
  4. report back the returned link
`


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
    // ?skill=1 -> the agent-facing API doc (owner-gated with the rest of this route)
    if (req.query?.skill || (req.url || '').includes('skill=1')) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).send(SKILL_DOC)
      return
    }
    const h = await getPostingHealth().catch(() => ({ ready: false, reason: 'error' }))
    const rails = {
      x: xEnabled(),
      bluesky: bskyEnabled(),
      telegram: telegramEnabled(),
      discord: discordEnabled(),
    }
    const accounts = accountKeys()

    // scheduled-queue depth - best effort, never fails the health read
    let scheduled = { store: storeEnabled(), pending: null, nextAt: null }
    if (storeEnabled()) {
      try {
        const state = (await kvGet('zc:state')) || {}
        const q = Array.isArray(state.scheduled) ? state.scheduled : []
        const pending = q.filter((s) => !s.sent && s.at)
        scheduled.pending = pending.length
        scheduled.nextAt = pending
          .map((s) => s.at)
          .sort()
          .find(Boolean) || null
      } catch {
        scheduled.pending = null // unknown, not zero - never claim empty on a read failure
      }
    }

    // A plain-language line an AGENT can read without parsing the object.
    // This is clawd's tools/self ("know yourself by reading, not remembering")
    // applied to a web cockpit: the app reports its own capability so a caller
    // never has to guess what will work.
    const live = Object.entries(rails).filter(([, on]) => on).map(([k]) => k)
    const off = Object.entries(rails).filter(([, on]) => !on).map(([k]) => k)
    const parts = [
      h.ready ? `casting is ready as fid ${h.fid}` : `casting NOT ready (${h.reason})`,
      live.length ? `cross-post live: ${live.join(', ')}` : 'no cross-post rails configured',
    ]
    if (off.length) parts.push(`not configured: ${off.join(', ')}`)
    if (accounts.length) parts.push(`extra accounts: ${accounts.join(', ')}`)
    if (scheduled.pending !== null && scheduled.pending > 0) {
      parts.push(`${scheduled.pending} scheduled cast(s) pending${scheduled.nextAt ? `, next ${scheduled.nextAt}` : ''}`)
    }

    const headroom = rateHeadroom()
    // Only speak up when there is something to say. "unknown" is silent rather
    // than reassuring - an absent header is not the same as room to spare.
    if (headroom.remaining !== null && headroom.limit !== null) {
      parts.push(`api headroom ${headroom.remaining}/${headroom.limit}`)
    }
    if (headroom.lastLimitedAt) parts.push(`rate limited at ${headroom.lastLimitedAt}`)

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      ...h,
      headroom,
      // kept flat for the existing UI (postingHealth.xEnabled etc)
      xEnabled: rails.x,
      bskyEnabled: rails.bluesky,
      telegramEnabled: rails.telegram,
      discordEnabled: rails.discord,
      accounts,
      // self-state additions
      rails,
      scheduled,
      summary: parts.join('; '),
      checkedAt: new Date().toISOString(),
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
