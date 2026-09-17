// node --test test/siwf.test.mjs - ticket round trip + completed-channel checks, no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.NEYNAR_API_KEY = 'test-key'; process.env.VERCEL = '1'; delete process.env.SESSION_SECRET
const { siwfTicket, readSiwfTicket, authEnabled } = await import('../auth.js')
const { completedIsValid } = await import('../siwf.js')

test('gate on for a Vercel deploy with an api key, no client id needed', () => { assert.equal(authEnabled(), true) })
test('ticket round-trips and rejects a swapped token or tampered nonce', () => {
  const tk = siwfTicket('ABC123', 'nonce-xyz')
  assert.deepEqual(readSiwfTicket(tk, 'ABC123'), { channelToken: 'ABC123', nonce: 'nonce-xyz' })
  assert.equal(readSiwfTicket(tk, 'OTHER'), null)
  const [tok, , exp, sig] = tk.split('.')
  assert.equal(readSiwfTicket(`${tok}.evil.${exp}.${sig}`, 'ABC123'), null)
})
const good = { state: 'completed', nonce: 'n1', fid: 19640, username: 'zaal', message: 'z.thezao.xyz wants you to sign in\nNonce: n1', signature: '0xabc', signatureParams: { domain: 'z.thezao.xyz' } }
test('completed channel passes with matching nonce + domain', () => {
  const v = completedIsValid(good, { nonce: 'n1', domain: 'z.thezao.xyz' })
  assert.equal(v.ok, true); assert.equal(v.fid, 19640)
})
test('rejects pending, nonce mismatch, domain mismatch, missing fid, missing signature', () => {
  assert.equal(completedIsValid({ ...good, state: 'pending' }, { nonce: 'n1', domain: 'z.thezao.xyz' }).ok, false)
  assert.equal(completedIsValid(good, { nonce: 'n2', domain: 'z.thezao.xyz' }).error, 'nonce mismatch')
  assert.equal(completedIsValid(good, { nonce: 'n1', domain: 'evil.example' }).error, 'domain mismatch')
  assert.equal(completedIsValid({ ...good, fid: 0 }, { nonce: 'n1', domain: 'z.thezao.xyz' }).error, 'no fid')
  assert.equal(completedIsValid({ ...good, signature: '' }, { nonce: 'n1', domain: 'z.thezao.xyz' }).error, 'no signed message')
})
