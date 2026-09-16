// node --test test/research.test.mjs - pure parsing + path validation, no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIndexTable, isValidDocPath, isValidTopic } from '../research.js'

const md = `# Farcaster

| # | Title | Type | Summary |
|---|-------|------|---------|
| 1095 | [Farcaster Dead, Revival, and Sparkz Timing](./1095-farcaster-dead-revival-sparkz-timing/) | STANDALONE | Farcaster "is dead" cycles vs revivals. |
| 1094 | [Empire Builder write API + Clanker v5](./1094-empire-builder-clanker-farcaster-deep-dive-jul14/) | DISPATCH | Hub: 15-endpoint catalog |
| 002 | [Farcaster Hub API](./002-farcaster-hub-api/) | STANDALONE | Hub monorepo packages |
| x | not a row | | |
`

test('parses guard-shaped rows and skips headers and junk', () => {
  const rows = parseIndexTable(md, 'farcaster')
  assert.equal(rows.length, 3)
  assert.equal(rows[0].num, '1095')
  assert.equal(rows[0].slug, '1095-farcaster-dead-revival-sparkz-timing')
  assert.equal(rows[0].path, 'farcaster/1095-farcaster-dead-revival-sparkz-timing')
  assert.equal(rows[1].type, 'DISPATCH')
  assert.equal(rows[2].summary, 'Hub monorepo packages')
  assert.match(rows[0].url, /^https:\/\/github\.com\/bettercallzaal\/ZAOOS\/tree\/main\/research\/farcaster\//)
})
test('doc path validation only admits topic/NNNN-slug', () => {
  assert.equal(isValidDocPath('farcaster/2489-zaalcaster-repos-research-surface'), true)
  assert.equal(isValidDocPath('agents/1094a-empire-write-api'), true)
  assert.equal(isValidDocPath('../../.github/workflows'), false)
  assert.equal(isValidDocPath('farcaster/README'), false)
  assert.equal(isValidDocPath('farcaster/2489-x/../../secret'), false)
  assert.equal(isValidTopic('farcaster'), true)
  assert.equal(isValidTopic('Farcaster/..'), false)
})
