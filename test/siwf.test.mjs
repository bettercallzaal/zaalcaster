// node --test test/siwf.test.mjs - ticket round trip + completed-channel checks, no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.NEYNAR_API_KEY = 'test-key'; process.env.VERCEL = '1'; delete process.env.SESSION_SECRET
const { siwfTicket, readSiwfTicket, authEnabled } = await import('../auth.js')
const { completedIsValid } = await import('../siwf.js')

test('gate on for a Vercel deploy with an api key, no client id needed', () => { assert.equal(authEnabled(), true) })
test('ticket round-trips with the domain and rejects a swapped token or tampered payload', () => {
  const tk = siwfTicket('ABC123', 'nonce-xyz', 'z.thezao.xyz')
  assert.deepEqual(readSiwfTicket(tk, 'ABC123'), { channelToken: 'ABC123', nonce: 'nonce-xyz', domain: 'z.thezao.xyz' })
  assert.equal(readSiwfTicket(tk, 'OTHER'), null)
  const [payload, sig] = tk.split('.')
  const evil = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), d: 'evil.example' })).toString('base64url')
  assert.equal(readSiwfTicket(`${evil}.${sig}`, 'ABC123'), null)
})
test('siwf_start limiter: 10 per ip, then 429; other ips unaffected until the total cap', async () => {
  const { allowStart } = await import('../api/auth.js')
  const now = 1_000_000
  for (let i = 0; i < 10; i++) assert.equal(allowStart('1.1.1.1', now), true)
  assert.equal(allowStart('1.1.1.1', now), false)
  assert.equal(allowStart('2.2.2.2', now), true)
  assert.equal(allowStart('1.1.1.1', now + 11 * 60_000), true)
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
