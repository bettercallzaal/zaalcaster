// auth.js - Sign In With Farcaster (via Neynar's SIWN) session gate.
//
// ============================== WHY THIS DESIGN ==============================
//
// WHY SIWN (Neynar) and not the alternatives, decided 2026-07-14:
//   - @farcaster/auth-kit: official, but it's an npm dependency, and this repo
//     has a hard zero-dependency rule (see package.json - Node builtins only).
//   - The raw relay protocol (relay.farcaster.xyz): no dependency, but it's a
//     channel-create/poll state machine we'd own forever.
//   - SIWN: a hosted widget + one server-side verification call, reusing the
//     NEYNAR_API_KEY the app already requires for everything else. Zero new
//     deps, zero new vendors. Chosen by Zaal from these three options.
//
// WHY THE COOKIE IS NOT THE SIWN signer_uuid:
//   The signer_uuid Neynar hands back on sign-in is WRITE-CAPABLE for the
//   signing user's account (it can post as them). It must live server-side
//   only, and in this app it is used exactly once - to verify identity at
//   sign-in (api/auth.js POST) - then discarded. The cookie is instead
//   `${fid}.${issuedAt}` HMAC-SHA256-signed with SESSION_SECRET: it proves
//   "this server verified this fid at this time" and can do nothing else.
//   Stealing the cookie gets an attacker a read session, never a signer.
//
// WHY ROLES ARE COMPUTED, NOT STORED:
//   role = (fid === ownerFid()) ? 'zaal' : 'guest', derived on every request.
//   There is no roles table to get out of sync, and rotating the owner is a
//   config/env change, not a data migration. The 'zaal' role gates every
//   write route (blockedByAuth); 'guest' gets the public read surface only
//   (blockedByGuestAuth). The server is the boundary - the frontend hiding
//   tabs from guests is UX, not security.
//
// WHY FAIL-CLOSED ON MISCONFIGURATION (added after the 2026-07-15 audit):
//   The original design had one escape hatch: SESSION_SECRET unset = gate off
//   = every request treated as the owner. That is correct for the local CLI
//   and for deploys hidden behind Vercel's own auth - but it becomes a
//   critical hole the moment NEYNAR_CLIENT_ID is set, because then the deploy
//   is ADVERTISING sign-in to strangers while treating all of them as the
//   owner, and any cookie it issued would be signed with an empty key
//   (forgeable). misconfigured() detects exactly that half-configured state
//   and fails closed: no sessions for anyone, POST refuses to issue cookies,
//   the sign-in widget hides. Locked-out-owner beats guests-with-write-access.
//
// WHY 30 DAYS / SameSite=Lax:
//   30d matches how often Zaal actually re-opens the app on a new device -
//   short enough that a stale device ages out, long enough to not nag daily.
//   Lax (not Strict) so that tapping a link INTO the app from a cast or DM
//   arrives with the session attached; Strict would land those taps on the
//   sign-in screen. CSRF exposure is acceptable because every state-changing
//   route requires a JSON body and same-origin fetch (no form posts), and the
//   dangerous actions additionally require a fresh wallet signature.
// =============================================================================

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

// USER_FID is canonical; ZAAL_FID is the legacy name kept so existing deploys
// never break; config.fid is the fork-friendly default. Same three-tier
// resolution lib.js uses for credentials - one convention everywhere.
export function ownerFid() {
  return Number(process.env.USER_FID || process.env.ZAAL_FID || config.fid)
}

function sign(value) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(value).digest('hex')
}

// Constant-time comparison. The early length check is not itself timing-safe,
// but both compared values here are HMAC-SHA256 hex digests (always 64 chars),
// so length never leaks anything about the secret - it only rejects garbage
// cookies cheaply. timingSafeEqual requires equal-length buffers anyway.
function eq(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

// Minimal cookie parse - the only cookie this app reads is its own, so a
// full parser (and its edge cases) would be dead weight.
function readCookie(req, name) {
  const raw = req.headers?.cookie || ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

// Set-Cookie for a verified fid. Only ever call this after independently
// confirming the fid with Neynar (api/auth.js POST) - never from client
// say-so. HttpOnly so page scripts can never read it; Secure because the
// deploy is always HTTPS (locally the gate is off, so the flag never bites).
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
//
// The issuedAt is inside the signed payload, so expiry cannot be extended by
// editing the cookie - changing the timestamp breaks the signature. Expiry is
// checked server-side (not just via Max-Age) because the browser's cookie
// expiry is advisory: a captured cookie value would otherwise never age out.
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

// Guard for owner-only routes (inbox, send, react, digest, state, stats -
// anything that reads private data or can write). Kept as the pre-SIWN
// function name + contract on purpose: when the password gate was replaced
// (2026-07-14), every existing write route stayed correct with ZERO edits
// because this signature didn't change. Returns true if it already sent 401.
export function blockedByAuth(req, res) {
  const session = getSession(req)
  if (session && session.role === 'zaal') return false
  res.status(401).json({ error: 'unauthorized' })
  return true
}

// Guard for the public-but-signed-in surface (feed, search, view, POIDH
// reads) - any verified Farcaster user. Routes that mix public and personal
// data behind one handler (api/feed.js) take this guard at the top and add
// per-branch owner checks inside, because splitting them into separate files
// is not an option under Vercel Hobby's 12-function cap.
export function blockedByGuestAuth(req, res) {
  if (getSession(req)) return false
  res.status(401).json({ error: 'unauthorized' })
  return true
}
