// /api/auth - Sign In With Farcaster (Neynar SIWN) + public branding config.
//   GET    -> { enabled, authed, role, misconfigured, neynarClientId, config }
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

import { authEnabled, misconfigured, getSession, sessionCookie, clearSessionCookie, ownerFid } from '../auth.js'
import { getSignerInfo } from '../lib.js'
import { config } from '../config.js'

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const session = getSession(req)
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      enabled: authEnabled() || misconfigured(),
      authed: !!session,
      role: session?.role || null,
      // Sign-in cannot work while misconfigured (see auth.js) - hide the
      // widget so the gate shows the not-configured message instead.
      misconfigured: misconfigured(),
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
      res.status(500).json({ error: 'server misconfigured: SESSION_SECRET must be set when NEYNAR_CLIENT_ID is set' })
      return
    }
    const body = await readJsonBody(req)
    const claimedFid = Number(body.fid)
    const signerUuid = String(body.signer_uuid || '').trim()

    if (!Number.isFinite(claimedFid) || claimedFid <= 0 || !signerUuid) {
      res.status(400).json({ error: 'fid and signer_uuid required' })
      return
    }

    // Never trust the client's word for who they are - independently confirm
    // the signer_uuid is real, approved, and belongs to the claimed fid.
    let signer
    try {
      signer = await getSignerInfo(signerUuid)
    } catch {
      signer = null
    }
    if (!signer || signer.status !== 'approved' || Number(signer.fid) !== claimedFid) {
      // Constant 400ms delay on every rejection so response time doesn't
      // reveal WHICH check failed (unknown uuid vs unapproved vs fid
      // mismatch) - cheap probing deterrent, not a rate limiter.
      await new Promise((r) => setTimeout(r, 400))
      res.status(401).json({ error: 'signer not approved or fid mismatch' })
      return
    }

    res.setHeader('Set-Cookie', sessionCookie(claimedFid))
    res.status(200).json({ ok: true, fid: claimedFid, role: claimedFid === ownerFid() ? 'zaal' : 'guest' })
    return
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearSessionCookie())
    res.status(200).json({ ok: true })
    return
  }

  res.status(405).json({ error: 'method not allowed' })
}
