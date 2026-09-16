// node --test test/zaorepos.test.mjs - pure filtering, never touches the network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterRepos, brandCounts, compactRepo } from '../zaorepos.js'

const repos = [
  { name: 'wwtracker', brand: 'WaveWarZ', topics: [], pushedAt: '2026-09-01', stars: 3, commits30: 5, archived: false, hygiene: { score: 71, checks: { topics: false, license: true } } },
  { name: 'zaalcaster', brand: 'Personal', topics: ['brand-zao'], pushedAt: '2026-09-13', stars: 1, commits30: 1, archived: false, hygiene: { score: 71, checks: {} } },
  { name: 'oldww', brand: 'WaveWarZ', topics: [], pushedAt: '2025-01-01', stars: 9, commits30: 0, archived: true },
  { name: 'zlank', brand: 'Zlank', topics: [], pushedAt: '2026-08-01', stars: 2, commits30: 2, archived: false, description: 'snap builder', language: 'TypeScript' },
]

test('archived repos drop out by default', () => {
  assert.deepEqual(filterRepos(repos).map((r) => r.name), ['zaalcaster', 'wwtracker', 'zlank'])
  assert.equal(filterRepos(repos, { archived: true }).length, 4)
})
test('brand filter matches the dashboard label case-insensitively', () => {
  assert.deepEqual(filterRepos(repos, { brand: 'wavewarz' }).map((r) => r.name), ['wwtracker'])
})
test('a brand-* topic overrides the regex label', () => {
  assert.deepEqual(filterRepos(repos, { brand: 'ZAO' }).map((r) => r.name), ['zaalcaster'])
  assert.equal(compactRepo(repos[1]).brand, 'zao')
  assert.equal(brandCounts(repos).find((b) => b.brand === 'zao').count, 1)
})
test('q searches name, description, language and topics', () => {
  assert.deepEqual(filterRepos(repos, { q: 'typescript' }).map((r) => r.name), ['zlank'])
  assert.deepEqual(filterRepos(repos, { q: 'brand-zao' }).map((r) => r.name), ['zaalcaster'])
})
test('sorts: stars desc, hygiene asc (worst first), name', () => {
  assert.equal(filterRepos(repos, { sort: 'stars' })[0].name, 'wwtracker')
  assert.equal(filterRepos(repos, { sort: 'name' })[0].name, 'wwtracker')
  assert.equal(filterRepos(repos, { sort: 'bogus' })[0].name, 'zaalcaster')
})
test('compactRepo lists failing hygiene checks and never throws on sparse rows', () => {
  assert.deepEqual(compactRepo(repos[0]).hygieneMissing, ['topics'])
  assert.equal(compactRepo({ name: 'x' }).hygiene, null)
})
