// /api/auth - Sign In With Farcaster (Neynar SIWN) + public branding config.
//   GET    -> { enabled, authed, role, misconfigured, neynarClientId, config }
//   POST   { action: 'siwf_start' } -> { channelToken, url, ticket }   (Sign In With Farcaster, relay)
//   POST   { action: 'siwf_poll', channelToken, ticket } -> { state } | sets the session cookie
//   POST { fid, signer_uuid } from the client's SIWN success callback ->
//     independently re-verifies the signer with Neynar (never trusts the
//     client-asserted fid alone), then sets the session cookie. 401 on any
//     mismatch or unapproved signer.
//   DELETE -> sign out (clears the cookie)
//
// WHY GET also carries the app's branding config: the frontend needs
// (appName, channels, brands, daily seed) before it can render anything, and
// it needs the auth state at the same moment to decide gate-vs-app. One
// request instead of two on every boot - and it means config.js stays the
// single fork-customization file with no client-side duplicate.
//
// WHY the POST re-verifies instead of trusting the widget: the SIWN success
// callback runs in the browser, so everything it passes up is attacker-
// controllable. The ONLY thing that makes a sign-in real is that Neynar's
// GET /farcaster/signer (called with OUR api key, server-side) says this
// signer_uuid exists, is approved, and belongs to the claimed fid. A signer
// minted under a different app's key 404s here - which is also why this
// check implicitly binds sign-ins to this app.
//
// When SESSION_SECRET is unset the gate is off (enabled:false, authed:true,
// role:'zaal') - local CLI / Vercel-auth-only deploys unchanged. The one
// exception: NEYNAR_CLIENT_ID set without SESSION_SECRET fails closed
// instead (see auth.js misconfigured()).

import { authEnabled, misconfigured, getSession, sessionCookie, clearSessionCookie, ownerFid, locked, siwfTicket, readSiwfTicket } from '../auth.js'
import { createChannel, channelStatus, completedIsValid } from '../siwf.js'
import { config } from '../config.js'

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

// siwf_start limiter: 10 per ip and 100 total per 10 minutes, per instance.
const START_WINDOW_MS = 10 * 60_000
const starts = new Map() // ip -> [timestamps]
export function allowStart(ip, now = Date.now(), limits = { perIp: 10, total: 100 }) {
  for (const [k, arr] of starts) { const keep = arr.filter((ts) => now - ts < START_WINDOW_MS); if (keep.length) starts.set(k, keep); else starts.delete(k) }
  let total = 0; for (const arr of starts.values()) total += arr.length
  const mine = starts.get(ip) || []
  if (mine.length >= limits.perIp || total >= limits.total) return false
  mine.push(now); starts.set(ip, mine)
  return true
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const session = getSession(req)
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      // locked(): Vercel with no SESSION_SECRET - the gate shows, nobody is authed.
      enabled: authEnabled() || misconfigured() || locked(),
      authed: !!session,
      role: session?.role || null,
      // Sign-in cannot work while misconfigured (see auth.js) - hide the
      // widget so the gate shows the not-configured message instead.
      misconfigured: misconfigured(),
      // Vercel with no SESSION_SECRET: every guarded route is 401 (auth.js locked()).
      locked: locked(),
      writesLocked: locked(),
      // Public identifier for Neynar's "Sign In With Neynar" widget - not a
      // secret (Neynar's own docs show it directly in page HTML). Unset until
      // Zaal registers an app + sets NEYNAR_CLIENT_ID in Vercel.
      neynarClientId: misconfigured() ? null : (process.env.NEYNAR_CLIENT_ID || null),
      config: {
        appName: config.appName,
        username: config.username,
        fid: config.fid,
        homeChannels: config.homeChannels,
        quickReplies: config.quickReplies || [],
        brands: config.brands || [],
        socials: config.socials || [],
        daily: config.daily,
        productName: config.productName,
      },
    })
    return
  }

  if (req.method === 'POST') {
    // Never issue a cookie signed with an empty key (forgeable).
    if (misconfigured()) {
      res.status(500).json({ error: 'server misconfigured: NEYNAR_API_KEY (or SESSION_SECRET) must be set' })
      return
    }
    const body = await readJsonBody(req)
    const action = String(body.action || '')
    // The domain the user's wallet will see and sign for. Taken from the
    // request host so z.thezao.xyz and zaalcaster.vercel.app both work; the
    // relay refuses to complete a channel whose message names another domain.
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase()
    if (!/^[a-z0-9.-]+(:\d+)?$/.test(host)) { res.status(400).json({ error: 'bad host' }); return }
    const domain = host.replace(/:\d+$/, '')

    // Sign In With Farcaster via the relay (siwf.js). Two steps, stateless:
    //   start -> we open a channel, hand back the deep link + an HMAC ticket
    //   poll  -> the browser sends token + ticket; when the relay says
    //            completed and nonce/domain/fid check out, we set the cookie.
    if (action === 'siwf_start') {
      // Rate limit (hardening 2026-09-17): this is the app's only
      // unauthenticated route that makes an outbound call, so an anonymous
      // loop could open unbounded channels against the relay. Per-instance
      // memory - warm serverless instances share it, cold ones start fresh -
      // so it bounds the damage rather than counting exactly.
      const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
      if (!allowStart(ip)) { res.status(429).json({ error: 'too many sign-in attempts - wait a few minutes' }); return }
      const ch = await createChannel({ domain, siweUri: `https://${domain}/` })
      if (!ch.ok) { res.status(ch.status || 502).json({ error: ch.error }); return }
      res.status(200).json({ channelToken: ch.channelToken, url: ch.url, ticket: siwfTicket(ch.channelToken, ch.nonce, domain) })
      return
    }
    if (action === 'siwf_poll') {
      const channelToken = String(body.channelToken || '')
      const t = readSiwfTicket(body.ticket, channelToken)
      if (!t) { res.status(400).json({ error: 'sign-in ticket invalid or expired - start again' }); return }
      const st = await channelStatus(channelToken)
      if (!st.ok) { res.status(st.status || 502).json({ error: st.error }); return }
      if (st.data.state !== 'completed') { res.status(200).json({ state: 'pending' }); return }
      const v = completedIsValid(st.data, { nonce: t.nonce, domain: t.domain }) // domain bound at start, not this request's header
      if (!v.ok) {
        await new Promise((r) => setTimeout(r, 400))
        res.status(401).json({ error: `sign-in rejected: ${v.error}` })
        return
      }
      res.setHeader('Set-Cookie', sessionCookie(v.fid))
      res.status(200).json({ state: 'completed', ok: true, fid: v.fid, username: v.username, role: v.fid === ownerFid() ? 'zaal' : 'guest' })
      return
    }
    // Sign In With Neynar (signer_uuid) was retired by Neynar on or before
    // 2026-09-17; its path is gone rather than left as a dead door.
    res.status(400).json({ error: 'unknown action' })
    return
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearSessionCookie())
    res.status(200).json({ ok: true })
    return
  }

  res.status(405).json({ error: 'method not allowed' })
}
