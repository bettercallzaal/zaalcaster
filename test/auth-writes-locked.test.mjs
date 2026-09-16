// node --test test/auth-writes-locked.test.mjs
// On Vercel with no SESSION_SECRET, owner routes refuse writes and keep reads.
import { test } from 'node:test'
import assert from 'node:assert/strict'

delete process.env.SESSION_SECRET
delete process.env.NEYNAR_CLIENT_ID
process.env.VERCEL = '1'
const { blockedByAuth, writesLocked } = await import('../auth.js')

const res = () => { const r = { code: null, body: null, status(c) { r.code = c; return r }, json(b) { r.body = b; return r } }; return r }

test('writesLocked is true on Vercel without SESSION_SECRET', () => {
  assert.equal(writesLocked(), true)
})
test('POST / PUT / DELETE to an owner route are refused with a message that names the fix', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const r = res()
    assert.equal(blockedByAuth({ method, headers: {}, cookies: {} }, r), true)
    assert.equal(r.code, 401)
    assert.match(r.body.error, /SESSION_SECRET/)
  }
})
test('GET on an owner route keeps the gate-off behaviour (reads still work)', () => {
  const r = res()
  assert.equal(blockedByAuth({ method: 'GET', headers: {}, cookies: {} }, r), false)
  assert.equal(r.code, null)
})
test('off Vercel (local CLI) nothing changes', () => {
  delete process.env.VERCEL
  assert.equal(writesLocked(), false)
  const r = res()
  assert.equal(blockedByAuth({ method: 'POST', headers: {}, cookies: {} }, r), false)
  process.env.VERCEL = '1'
})
