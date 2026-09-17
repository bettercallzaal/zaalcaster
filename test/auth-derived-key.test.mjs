// node --test test/auth-derived-key.test.mjs
// The gate turns on with NEYNAR_CLIENT_ID alone; the cookie key derives from NEYNAR_API_KEY.
import { test } from 'node:test'
import assert from 'node:assert/strict'

delete process.env.SESSION_SECRET
process.env.NEYNAR_API_KEY = 'test-neynar-key-not-real'
process.env.NEYNAR_CLIENT_ID = 'client-id'
process.env.VERCEL = '1'
const auth = await import('../auth.js')

const reqWith = (cookie) => ({ method: 'GET', headers: { cookie }, cookies: {} })

test('gate on, not locked, not misconfigured, with client id + api key and no SESSION_SECRET', () => {
  assert.equal(auth.authEnabled(), true)
  assert.equal(auth.locked(), false)
  assert.equal(auth.misconfigured(), false)
})
test('a cookie issued for the owner verifies; a tampered fid does not', () => {
  const fid = auth.ownerFid()
  const setCookie = auth.sessionCookie(fid)
  const raw = setCookie.split(';')[0].split('=').slice(1).join('=')
  assert.equal(auth.getSession(reqWith(`zc_session=${raw}`)).role, 'zaal')
  const [f, at, sig] = raw.split('.')
  assert.equal(auth.getSession(reqWith(`zc_session=${Number(f) + 1}.${at}.${sig}`)), null)
})
test('rotating the api key invalidates every existing cookie', () => {
  const raw = auth.sessionCookie(auth.ownerFid()).split(';')[0].split('=').slice(1).join('=')
  process.env.NEYNAR_API_KEY = 'rotated-key'
  assert.equal(auth.getSession(reqWith(`zc_session=${raw}`)), null)
  process.env.NEYNAR_API_KEY = 'test-neynar-key-not-real'
})
test('SESSION_SECRET, when set, still wins', () => {
  process.env.SESSION_SECRET = 'explicit'
  assert.equal(auth.authEnabled(), true)
  const raw = auth.sessionCookie(auth.ownerFid()).split(';')[0].split('=').slice(1).join('=')
  assert.equal(auth.getSession(reqWith(`zc_session=${raw}`)).role, 'zaal')
  delete process.env.SESSION_SECRET
})
test('no client id and no SESSION_SECRET: local CLI stays gate-off, Vercel stays locked', () => {
  delete process.env.NEYNAR_CLIENT_ID
  assert.equal(auth.authEnabled(), false)
  assert.equal(auth.locked(), true)
  delete process.env.VERCEL
  assert.equal(auth.getSession(reqWith('')).role, 'zaal')
  process.env.VERCEL = '1'; process.env.NEYNAR_CLIENT_ID = 'client-id'
})
