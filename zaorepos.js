// zaorepos.js - read client for the ZAO repo dashboard's published data.json,
// dependency-free ESM. Follows the shared client pattern (see empire.js).
//
// WHY data.json and not the GitHub API: bettercallzaal/zao-repos is an hourly
// GitHub Action (cron 17 * * * *) that already walks every PUBLIC repo on
// bettercallzaal + ZAODEVZ + ZAO-DEVZ and publishes one file with stars, commit
// counts, topics, hygiene score, staleness label, a homepage liveness probe and
// a brand label. One fetch, no token, no rate limit to manage (research doc
// 2489, update block). Verified 2026-09-15: 281 KB, 130 repos,
// access-control-allow-origin: *, cache-control max-age=600.
//
// Private repos never appear in that file by construction (the workflow runs
// with the default GITHUB_TOKEN and pins privacy:PUBLIC), so nothing here can
// leak one either.

const DATA_URL = 'https://bettercallzaal.github.io/zao-repos/data.json'
const REQUEST_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 10 * 60_000 // the source itself only changes hourly

let cache = null // { at, payload }

export async function getRepoData() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.payload
  let res
  try {
    res = await fetch(DATA_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return { ok: false, status: 502, error: timedOut ? 'repo dashboard timed out' : 'could not reach the repo dashboard' }
  }
  if (!res.ok) return { ok: false, status: res.status, error: `repo dashboard returned ${res.status}` }
  let json
  try { json = await res.json() } catch { return { ok: false, status: 502, error: 'repo dashboard returned invalid JSON' } }
  if (!Array.isArray(json?.repos)) return { ok: false, status: 502, error: 'repo dashboard data has no repos array' }
  const payload = { ok: true, data: json }
  cache = { at: Date.now(), payload }
  return payload
}

const SORTS = {
  pushed: (a, b) => String(b.pushedAt || '').localeCompare(String(a.pushedAt || '')),
  stars: (a, b) => (b.stars || 0) - (a.stars || 0) || SORTS.pushed(a, b),
  commits: (a, b) => (b.commits30 || 0) - (a.commits30 || 0) || SORTS.pushed(a, b),
  hygiene: (a, b) => ((a.hygiene && a.hygiene.score) || 0) - ((b.hygiene && b.hygiene.score) || 0) || SORTS.pushed(a, b),
  name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
}
export const SORT_KEYS = Object.keys(SORTS)

// A brand-* topic wins over the dashboard's name-regex label once Zaal tags
// repos (doc 2489 decision 2). 'brand-wavewarz' -> 'wavewarz' for matching.
function brandOf(repo) {
  const t = (repo.topics || []).find((x) => /^brand-/.test(x))
  return t ? t.slice(6) : String(repo.brand || '')
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

// Pure: filter + sort the repos array. filter.brand matches the brand label
// (case/punctuation-insensitive) OR a brand-* topic; filter.name matches one
// repo exactly; filter.q is a substring over name/description/topics/language.
export function filterRepos(repos, { brand = '', name = '', q = '', sort = 'pushed', limit = 60, archived = false } = {}) {
  let out = Array.isArray(repos) ? repos.slice() : []
  if (!archived) out = out.filter((r) => !r.archived)
  if (name) out = out.filter((r) => norm(r.name) === norm(name))
  if (brand) out = out.filter((r) => norm(brandOf(r)) === norm(brand) || norm(r.brand) === norm(brand))
  if (q) {
    const needle = q.toLowerCase()
    out = out.filter((r) => [r.name, r.description, r.language, ...(r.topics || [])].some((f) => String(f || '').toLowerCase().includes(needle)))
  }
  out.sort(SORTS[sort] || SORTS.pushed)
  return out.slice(0, Math.max(1, Math.min(200, limit)))
}

export function compactRepo(r) {
  return {
    name: r.name, owner: r.account, fullName: r.nameWithOwner, url: r.url,
    description: r.description || '', homepage: r.homepage || null,
    brand: brandOf(r), topics: r.topics || [], language: r.language || null,
    stars: r.stars || 0, forks: r.forks || 0, openIssues: r.openIssues || 0, openPRs: r.openPRs || 0,
    commits30: r.commits30 || 0, commits365: r.commits365 || 0,
    pushedAt: r.pushedAt || null, staleness: r.staleness || null, archived: !!r.archived, fork: !!r.fork,
    hygiene: r.hygiene ? r.hygiene.score : null, hygieneMissing: r.hygiene ? Object.keys(r.hygiene.checks || {}).filter((k) => !r.hygiene.checks[k]) : [],
    deploy: r.deploy ? { status: r.deploy.status, url: r.deploy.finalUrl || null } : null,
    lastCommit: r.lastCommit ? String(r.lastCommit).slice(0, 100) : null,
  }
}

// Brand labels present in the data, most repos first - drives the chip row.
export function brandCounts(repos) {
  const m = new Map()
  for (const r of repos || []) { if (r.archived) continue; const b = brandOf(r) || 'Other'; m.set(b, (m.get(b) || 0) + 1) }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([brand, count]) => ({ brand, count }))
}
