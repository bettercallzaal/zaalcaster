// node --test test/publish-preview.test.mjs
// The preview must mirror the rails' real limits AND must never touch the network.
import { test } from 'node:test'
// The send handler is exercised directly; without a gate that needs the explicit local opt-in (auth.js getSession).
process.env.ZAALCASTER_LOCAL = '1'
import assert from 'node:assert/strict'
import { previewSend, LIMITS } from '../publish-preview.js'

const allOn = { x: true, bluesky: true, telegram: true, discord: true }
const rail = (p, name) => p.rails.find((r) => r.rail === name)

test('plain cast, no cross-posts: only farcaster sends', () => {
  const p = previewSend({ text: 'gm ppl' }, allOn)
  assert.equal(p.ok, true)
  assert.equal(p.dryRun, true)
  assert.equal(rail(p, 'farcaster').willSend, true)
  for (const r of ['x', 'bluesky', 'telegram', 'discord']) {
    assert.equal(rail(p, r).willSend, false)
    assert.equal(rail(p, r).items.length, 0)
  }
})

test('X over 280 is reported as a reject, not trimmed', () => {
  const p = previewSend({ text: 'a'.repeat(300), alsoX: true }, allOn)
  const x = rail(p, 'x')
  assert.equal(x.willSend, false)
  assert.equal(x.items[0].overLimit, true)
  assert.equal(x.items[0].text.length, 300)
  assert.match(x.note, /reject/)
})

test('X counts a URL as 23', () => {
  const url = 'https://example.com/' + 'p'.repeat(200)
  const p = previewSend({ text: 'look ' + url, alsoX: true }, allOn)
  assert.equal(rail(p, 'x').items[0].chars, 5 + 23)
  assert.equal(rail(p, 'x').willSend, true)
})

test('Bluesky trims to 300 like bsky.js', () => {
  const p = previewSend({ text: 'b'.repeat(400), alsoBsky: true }, allOn)
  const b = rail(p, 'bluesky')
  assert.equal(b.willSend, true)
  assert.equal(b.items[0].text.length, LIMITS.bluesky)
  assert.equal(b.items[0].truncated, true)
})

test('chat rails get joined text plus the cast link', () => {
  const p = previewSend({ casts: ['one', 'two'], alsoTelegram: true, alsoDiscord: true }, allOn)
  assert.equal(p.kind, 'thread')
  const tg = rail(p, 'telegram')
  assert.equal(tg.items.length, 1)
  assert.match(tg.items[0].text, /^one\n\ntwo\n\nhttps:\/\/farcaster\.xyz\/zaal\/0x/)
})

test('unconfigured rail never claims it will send', () => {
  const p = previewSend({ text: 'hi', alsoX: true }, { x: false })
  assert.equal(rail(p, 'x').willSend, false)
  assert.match(rail(p, 'x').note, /not configured/)
})

test('replies are not cross-posted', () => {
  const p = previewSend({ text: 'hi', parentHash: '0xabc', alsoX: true }, allOn)
  assert.equal(p.kind, 'reply')
  assert.equal(rail(p, 'x').willSend, false)
})

test('cast over 1024 is blocked', () => {
  const p = previewSend({ text: 'c'.repeat(1025) }, allOn)
  assert.equal(p.castBlocked, true)
})

test('empty text is an error', () => {
  assert.equal(previewSend({ text: '   ' }, allOn).ok, false)
})

test('api/send preview branch makes zero network calls with every rail configured', async () => {
  // Fake creds so every rail reports configured - if any path tried to post, fetch would be hit.
  Object.assign(process.env, {
    X_API_KEY: 'k', X_API_SECRET: 's', X_ACCESS_TOKEN: 't', X_ACCESS_SECRET: 'ts',
    BSKY_HANDLE: 'h.bsky.social', BSKY_APP_PASSWORD: 'p',
    TG_BOT_TOKEN: 'tg', TG_CHAT_ID: '1', DISCORD_WEBHOOK_URL: 'https://discord.invalid/hook',
  })
  delete process.env.SESSION_SECRET // gate off = owner, as in local dev
  delete process.env.APP_PASSWORD
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (...a) => { calls.push(String(a[0])); throw new Error('network blocked in test') }
  try {
    const { default: handler } = await import('../api/send.js')
    const out = {}
    const res = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v },
      status(c) { out.status = c; return this },
      json(b) { out.body = b; return this },
      send(b) { out.body = b; return this },
    }
    const req = {
      method: 'POST', headers: {}, url: '/api/send',
      body: { action: 'preview', text: 'test preview', alsoX: true, alsoBsky: true, alsoTelegram: true, alsoDiscord: true },
    }
    await handler(req, res)
    assert.equal(out.status, 200, JSON.stringify(out.body))
    assert.equal(out.body.dryRun, true)
    assert.equal(out.body.rails.filter((r) => r.willSend).length, 5)
    assert.deepEqual(calls, [])
  } finally {
    globalThis.fetch = realFetch
  }
})
