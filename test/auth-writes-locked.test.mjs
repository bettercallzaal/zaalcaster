// node --test test/auth-writes-locked.test.mjs
// On Vercel with no signing key (no SESSION_SECRET, no NEYNAR_API_KEY) nobody has a session: every guarded route is 401.
import { test } from 'node:test'
import assert from 'node:assert/strict'

delete process.env.SESSION_SECRET
delete process.env.NEYNAR_CLIENT_ID
delete process.env.NEYNAR_API_KEY
process.env.VERCEL = '1'
const { blockedByAuth, blockedByGuestAuth, getSession, locked, writesLocked } = await import('../auth.js')

const res = () => { const r = { code: null, body: null, status(c) { r.code = c; return r }, json(b) { r.body = b; return r } }; return r }
const req = (method = 'GET') => ({ method, headers: {}, cookies: {} })

test('locked on Vercel without SESSION_SECRET; alias kept', () => {
  assert.equal(locked(), true)
  assert.equal(writesLocked(), true)
  assert.equal(getSession(req()), null)
})
test('owner routes refuse every method with a message naming the fix', () => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
    const r = res()
    assert.equal(blockedByAuth(req(method), r), true)
    assert.equal(r.code, 401)
    assert.match(r.body.error, /NEYNAR_API_KEY/)
  }
})
test('guest routes refuse too', () => {
  const r = res()
  assert.equal(blockedByGuestAuth(req(), r), true)
  assert.equal(r.code, 401)
})
test('off Vercel with no gate: nobody has a session unless ZAALCASTER_LOCAL=1 opts in', () => {
  delete process.env.VERCEL
  assert.equal(locked(), false)
  assert.equal(blockedByAuth(req('POST'), res()), true)
  process.env.ZAALCASTER_LOCAL = '1'
  assert.equal(blockedByAuth(req('POST'), res()), false)
  delete process.env.ZAALCASTER_LOCAL
  process.env.VERCEL = '1'
})
