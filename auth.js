// auth.js - a simple password gate for the deployed web app, so the site can
// stand on its own (Vercel Deployment Protection optional).
//
// Set APP_PASSWORD in the Vercel env. When it is set, every API route requires
// a valid session cookie; the password is entered once at /api/auth and a
// signed cookie is set. When APP_PASSWORD is UNSET, the gate is OFF (local CLI
// and any deploy that relies only on Vercel login keep working unchanged).
//
// The cookie holds sha256(APP_PASSWORD) - not the password. An attacker can't
// forge it without knowing the password, and the hash reveals nothing usable.
// The actual password never leaves the server.

import crypto from 'node:crypto'

const COOKIE = 'zc_auth'

export function authEnabled() {
  return !!process.env.APP_PASSWORD
}

function expectedToken() {
  return crypto.createHash('sha256').update(process.env.APP_PASSWORD || '').digest('hex')
}

function eq(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

export function verifyPassword(pw) {
  if (!authEnabled()) return true
  return eq(pw || '', process.env.APP_PASSWORD)
}

function readCookie(req, name) {
  const raw = req.headers?.cookie || ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

// True when the request may proceed. Gate off (no APP_PASSWORD) -> always true.
export function checkAuth(req) {
  if (!authEnabled()) return true
  return eq(readCookie(req, COOKIE) || '', expectedToken())
}

// Set-Cookie header value for a successful login (30 days, httpOnly, secure).
export function loginCookie() {
  return `${COOKIE}=${expectedToken()}; Path=/; Max-Age=${60 * 60 * 24 * 30}; HttpOnly; Secure; SameSite=Lax`
}

// Guard helper for API routes: returns true if it already sent a 401.
export function blockedByAuth(req, res) {
  if (checkAuth(req)) return false
  res.status(401).json({ error: 'unauthorized' })
  return true
}
