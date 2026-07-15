// /api/auth - Sign In With Farcaster (Neynar SIWN) + public branding config.
//   GET    -> { enabled, authed, role, config }
//   POST { fid, signer_uuid } from the client's SIWN success callback ->
//     independently re-verifies the signer with Neynar (never trusts the
//     client-asserted fid alone), then sets the session cookie. 401 on any
//     mismatch or unapproved signer.
//   DELETE -> sign out (clears the cookie)
//
// When SESSION_SECRET is unset the gate is off (enabled:false, authed:true,
// role:'zaal') - local CLI / Vercel-auth-only deploys unchanged.

import { authEnabled, getSession, sessionCookie, clearSessionCookie, ownerFid } from '../auth.js'
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
      enabled: authEnabled(),
      authed: !!session,
      role: session?.role || null,
      // Public identifier for Neynar's "Sign In With Neynar" widget - not a
      // secret (Neynar's own docs show it directly in page HTML). Unset until
      // Zaal registers an app + sets NEYNAR_CLIENT_ID in Vercel.
      neynarClientId: process.env.NEYNAR_CLIENT_ID || null,
      config: {
        appName: config.appName,
        username: config.username,
        fid: config.fid,
        homeChannels: config.homeChannels,
        quickReplies: config.quickReplies || [],
        brands: config.brands || [],
        socials: config.socials || [],
        daily: config.daily,
      },
    })
    return
  }

  if (req.method === 'POST') {
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
      // small constant delay to blunt probing
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
