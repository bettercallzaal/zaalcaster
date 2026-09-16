// research.js - read client for the ZAO research library, dependency-free ESM.
//
// The library is research/<topic>/NNNN-slug/README.md in bettercallzaal/ZAOOS,
// which is PUBLIC (verified 2026-09-15), so raw.githubusercontent.com serves
// every file with access-control-allow-origin: * and a 5-minute cache. The
// index we read is each topic's README.md table - a repo guard fails any PR
// that adds a doc without its row, so the 22 tables are the one index that is
// complete today (research/search-index.json is 202 stale rows from April and
// does not parse). Doc 2489 update block has the measurements.
//
// Nothing here writes. Paths are validated against the library's own shape
// before they touch a URL, so a crafted ?path= can only ever fetch a README
// under research/ on main.

const RAW = 'https://raw.githubusercontent.com/bettercallzaal/ZAOOS/main/research'
const GH = 'https://github.com/bettercallzaal/ZAOOS/tree/main/research'
const REQUEST_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 5 * 60_000

export const TOPICS = [
  'farcaster', 'agents', 'music', 'dev-workflows', 'infrastructure', 'governance', 'community',
  'cross-platform', 'identity', 'business', 'events', 'wavewarz', 'security', 'technology',
]

const TOPIC_RE = /^[a-z][a-z0-9_-]{1,40}$/
const DOC_RE = /^([a-z][a-z0-9_-]{1,40})\/(\d{3,4}[a-z]?-[a-z0-9][a-z0-9._-]{0,120})$/
export function isValidTopic(t) { return typeof t === 'string' && TOPIC_RE.test(t) }
export function isValidDocPath(p) { return typeof p === 'string' && DOC_RE.test(p) && !p.includes('..') }

const cache = new Map() // url -> { at, payload }
function sweepCache() { const now = Date.now(); for (const [k, v] of cache) if (now - v.at >= CACHE_TTL_MS) cache.delete(k) }

async function fetchText(url) {
  sweepCache()
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return { ok: false, status: 502, error: timedOut ? 'research library timed out' : 'could not reach the research library' }
  }
  if (!res.ok) return { ok: false, status: res.status, error: res.status === 404 ? 'not found in the library' : `library returned ${res.status}` }
  const payload = { ok: true, text: await res.text() }
  cache.set(url, { at: Date.now(), payload })
  return payload
}

// Pure: parse a topic README's table into rows. Row shape in every topic file:
//   | 1094 | [Title](./1094-slug/) | TYPE | Summary... |
// Cells may contain pipes inside links rarely; we split on ' | ' boundaries
// after trimming the outer pipes, which the guard-generated rows respect.
export function parseIndexTable(md, topic) {
  const rows = []
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim())
    if (cells.length < 2) continue
    const num = cells[0]
    if (!/^\d{3,4}[a-z]?$/.test(num)) continue
    const m = /^\[(.+?)\]\(\.\/([^)]+?)\/?\)/.exec(cells[1])
    const title = m ? m[1] : cells[1].replace(/\[|\]/g, '')
    const slug = m ? m[2] : ''
    if (!slug) continue
    rows.push({
      num, title, slug, topic, path: `${topic}/${slug}`,
      type: cells[2] || '', summary: (cells[3] || '').slice(0, 400),
      url: `${GH}/${topic}/${slug}/`,
    })
  }
  return rows
}

export async function getTopicIndex(topic) {
  if (!isValidTopic(topic)) return { ok: false, status: 400, error: 'invalid topic' }
  const r = await fetchText(`${RAW}/${topic}/README.md`)
  if (!r.ok) return r
  return { ok: true, topic, docs: parseIndexTable(r.text, topic) }
}

// Search the whole library: 14 topic tables in parallel (about 1 MB cold,
// then cached 5 min). Substring match over num/title/summary/type.
export async function searchLibrary(q, { topic = '', limit = 60 } = {}) {
  const topics = topic ? [topic] : TOPICS
  const results = await Promise.all(topics.map((t) => getTopicIndex(t)))
  const needle = String(q || '').toLowerCase().trim()
  let docs = []
  const failed = []
  results.forEach((r, i) => { if (r.ok) docs.push(...r.docs); else failed.push(topics[i]) })
  if (needle) docs = docs.filter((d) => [d.num, d.title, d.summary, d.type].some((f) => String(f).toLowerCase().includes(needle)))
  docs.sort((a, b) => Number(String(b.num).replace(/\D/g, '')) - Number(String(a.num).replace(/\D/g, '')))
  return { ok: true, docs: docs.slice(0, Math.max(1, Math.min(200, limit))), total: docs.length, failed }
}

export async function getDoc(path) {
  if (!isValidDocPath(path)) return { ok: false, status: 400, error: 'invalid doc path' }
  const r = await fetchText(`${RAW}/${path}/README.md`)
  if (!r.ok) return r
  const text = r.text
  const fm = {}
  const fmMatch = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (fmMatch) for (const line of fmMatch[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '') }
  const body = fmMatch ? text.slice(fmMatch[0].length) : text
  const titleMatch = /^#\s+(.+)$/m.exec(body)
  return {
    ok: true, path, url: `${GH}/${path}/`, rawUrl: `${RAW}/${path}/README.md`,
    title: titleMatch ? titleMatch[1].trim() : path, frontmatter: fm,
    body: body.length > 120_000 ? body.slice(0, 120_000) + '\n\n[truncated - open on GitHub for the rest]' : body,
  }
}
