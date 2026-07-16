// auth.js - Sign In With Farcaster (via Neynar's SIWN) session gate.
//
// Any real Farcaster user can sign in; the app grants one of two roles:
//   - 'zaal'  - the owner (fid matches USER_FID/ZAAL_FID/config.fid) - full
//               read+write access, unchanged from the old password gate.
//   - 'guest' - any other signed-in Farcaster user - read-only access to the
//               public-safe surface (Feed/Channels/Search/Empire data).
//               Every write-capable or personal route (react/send/digest/
//               state/inbox/stats) stays behind blockedByAuth, Zaal-only.
//
// The session cookie is NOT the SIWN signer_uuid (that's write-capable for
// its owner's account and must never leave the server) - it is
// `${fid}.${issuedAt}` HMAC-signed with SESSION_SECRET, so a client can prove
// "the server independently verified I am fid X" without holding anything
// that could post on anyone's behalf. See api/auth.js for the verification
// step (confirms the signer_uuid with Neynar before ever issuing this cookie).
//
// Gate is OFF (authEnabled() false) when SESSION_SECRET is unset - the same
// escape hatch the old password gate had, for local CLI / Vercel-auth-only
// deploys: every request is treated as Zaal.

import crypto from 'node:crypto'
import { config } from './config.js'

const COOKIE = 'zc_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export function authEnabled() {
  return !!process.env.SESSION_SECRET
}

// The one dangerous config: NEYNAR_CLIENT_ID set (guest sign-in advertised to
// the world) but SESSION_SECRET unset. Without this check, the gate-off
// escape hatch below would treat EVERY visitor - including signed-in guests -
// as the owner with full write access, and any cookie issued would be signed
// with an empty key (forgeable). Fail closed instead: nobody gets a session
// until SESSION_SECRET is set. (Security audit finding, 2026-07-15.)
export function misconfigured() {
  return !!process.env.NEYNAR_CLIENT_ID && !process.env.SESSION_SECRET
}

export function ownerFid() {
  return Number(process.env.USER_FID || process.env.ZAAL_FID || config.fid)
}

function sign(value) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(value).digest('hex')
}

function eq(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

function readCookie(req, name) {
  const raw = req.headers?.cookie || ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

// Set-Cookie for a verified fid. Only ever call this after independently
// confirming the fid with Neynar (api/auth.js POST) - never from client say-so.
export function sessionCookie(fid) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload = `${fid}.${issuedAt}`
  const value = `${payload}.${sign(payload)}`
  return `${COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
}

// null (no/invalid/expired session) | { fid, role: 'zaal' | 'guest' }
export function getSession(req) {
  if (misconfigured()) return null // fail closed - see misconfigured() above
  if (!authEnabled()) return { fid: ownerFid(), role: 'zaal' } // gate off = full local access
  const raw = readCookie(req, COOKIE)
  if (!raw) return null
  const parts = raw.split('.')
  if (parts.length !== 3) return null
  const [fidStr, issuedAtStr, sig] = parts
  if (!eq(sig, sign(`${fidStr}.${issuedAtStr}`))) return null
  const issuedAt = Number(issuedAtStr)
  if (!Number.isFinite(issuedAt) || Date.now() / 1000 - issuedAt > MAX_AGE_SECONDS) return null
  const fid = Number(fidStr)
  if (!Number.isFinite(fid)) return null
  return { fid, role: fid === ownerFid() ? 'zaal' : 'guest' }
}

// Guard for Zaal-only routes (Inbox, Post/send, react, digest, state, stats).
// Returns true if it already sent a 401.
export function blockedByAuth(req, res) {
  const session = getSession(req)
  if (session && session.role === 'zaal') return false
  res.status(401).json({ error: 'unauthorized' })
  return true
}

// Guard for the public-but-signed-in surface (Feed, Channels, Search, profile
// + thread overlays, Empire reads) - any verified Farcaster user, guest or
// Zaal. Individual handlers still gate their own Zaal-only branches (e.g.
// feed.js's notifications/best-friends modes) with getSession + role check.
export function blockedByGuestAuth(req, res) {
  if (getSession(req)) return false
  res.status(401).json({ error: 'unauthorized' })
  return true
}
