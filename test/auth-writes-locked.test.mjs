// node --test test/auth-writes-locked.test.mjs
// On Vercel with no SESSION_SECRET nobody has a session: every guarded route is 401.
import { test } from 'node:test'
import assert from 'node:assert/strict'

delete process.env.SESSION_SECRET
delete process.env.NEYNAR_CLIENT_ID
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
    assert.match(r.body.error, /NEYNAR_CLIENT_ID/)
  }
})
test('guest routes refuse too', () => {
  const r = res()
  assert.equal(blockedByGuestAuth(req(), r), true)
  assert.equal(r.code, 401)
})
test('off Vercel (local CLI / dev) the gate-off hatch is unchanged', () => {
  delete process.env.VERCEL
  assert.equal(locked(), false)
  assert.equal(getSession(req()).role, 'zaal')
  assert.equal(blockedByAuth(req('POST'), res()), false)
  assert.equal(blockedByGuestAuth(req(), res()), false)
  process.env.VERCEL = '1'
})
