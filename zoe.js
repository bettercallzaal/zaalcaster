// zoe.js - ZOE ecosystem client: the unified cowork tracker (Supabase REST)
// + the ZABAL Bonfire knowledge graph. Dependency-free ESM, never-throws
// { ok, ... } style like empire.js/poidh.js/zora.js.
//
// ZOE itself (the assistant agent) is a Telegram bot with NO HTTP API - per
// the hub-and-spoke architecture (ZAOOS research doc 989) you integrate the
// HUB, not the bot: the tracker's tasks table is where ZOE's work lives, and
// Bonfire is its institutional memory. Both surfaces live-verified
// 2026-07-15 against real data (Zaal's open tasks; a delve query returning
// 41 real episodes).
//
// Writes here are TRACKER writes (mark a task done, log a decision) - plain
// database rows Zaal already owns, not on-chain actions and not posts. They
// are still gated Zaal-only at the API layer (blockedByAuth).

import fs from 'fs'
import path from 'path'

const BONFIRE_ORIGIN = 'https://tnt-v2.api.bonfires.ai'
const REQUEST_TIMEOUT_MS = 10_000
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

// Env first (Vercel), then the local creds files the rest of the ZAO stack
// already uses (~/.zao/cowork-tracker.env, ~/.zao/zao.env). Same pattern as
// juke.js/empire.js key loading.
function readEnvFile(file, keys) {
  const out = {}
  try {
    const p = path.join(process.env.HOME || '', file)
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const [k, ...rest] = t.split('=')
        if (keys.includes(k)) out[k] = rest.join('=').trim().replace(/^["']|["']$/g, '')
      }
    }
  } catch { /* unreadable - treated as unset */ }
  return out
}

export function loadTrackerCreds() {
  if (process.env.ZAO_TRACKER_URL && process.env.ZAO_TRACKER_KEY) {
    return { url: process.env.ZAO_TRACKER_URL.replace(/\/$/, ''), key: process.env.ZAO_TRACKER_KEY }
  }
  const f = readEnvFile('.zao/cowork-tracker.env', ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'])
  if (f.SUPABASE_URL && f.SUPABASE_SERVICE_KEY) return { url: f.SUPABASE_URL.replace(/\/$/, ''), key: f.SUPABASE_SERVICE_KEY }
  return null
}

export function loadBonfireCreds() {
  if (process.env.BONFIRE_API_KEY && process.env.BONFIRE_ID) {
    return { key: process.env.BONFIRE_API_KEY, id: process.env.BONFIRE_ID }
  }
  const f = readEnvFile('.zao/zao.env', ['BONFIRE_API_KEY', 'BONFIRE_ID'])
  if (f.BONFIRE_API_KEY && f.BONFIRE_ID) return { key: f.BONFIRE_API_KEY, id: f.BONFIRE_ID }
  return null
}

async function trackerFetch(pathAndQuery, options = {}) {
  const creds = loadTrackerCreds()
  if (!creds) return { ok: false, status: 501, error: 'tracker not configured (set ZAO_TRACKER_URL + ZAO_TRACKER_KEY)' }

  let res
  try {
    res = await fetch(`${creds.url}/rest/v1/${pathAndQuery}`, {
      ...options,
      headers: {
        apikey: creds.key,
        Authorization: `Bearer ${creds.key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...options.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return { ok: false, status: 502, error: timedOut ? 'tracker timed out' : 'could not reach the tracker' }
  }

  let data
  try { data = await res.json() } catch { data = null }

  if (!res.ok) {
    const detail = data?.message || JSON.stringify(data || {}).slice(0, 200)
    return { ok: false, status: res.status, error: `tracker returned ${res.status}: ${detail}` }
  }
  return { ok: true, data }
}

// Resolve the tracker owner row (team_members) by name, cached per instance.
let ownerCache = null // { name, id }
export async function getOwnerId(ownerName) {
  if (ownerCache && ownerCache.name === ownerName) return { ok: true, data: ownerCache.id }
  const r = await trackerFetch(`team_members?select=id&name=eq.${encodeURIComponent(ownerName)}&limit=1`)
  if (!r.ok) return r
  const id = r.data?.[0]?.id
  if (!id) return { ok: false, status: 404, error: `no tracker member named ${ownerName}` }
  ownerCache = { name: ownerName, id }
  return { ok: true, data: id }
}

// Open (todo) tasks for the owner, soonest due first.
export async function getOpenTasks(ownerName, limit = 8) {
  const owner = await getOwnerId(ownerName)
  if (!owner.ok) return owner
  const lim = Math.min(Math.max(1, limit), 25)
  return trackerFetch(`tasks?select=id,title,status,due,priority,category,kind&owner_id=eq.${owner.data}&status=eq.todo&order=due.asc.nullslast&limit=${lim}`)
}

// Mark a task done. completed_by = the owner's member id so ZOE's board
// shows who closed it.
export async function markTaskDone(taskId, ownerName) {
  if (!UUID_PATTERN.test(String(taskId))) return { ok: false, status: 400, error: 'invalid task id' }
  const owner = await getOwnerId(ownerName)
  if (!owner.ok) return owner
  return trackerFetch(`tasks?id=eq.${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'done', completed_at: new Date().toISOString(), completed_by: owner.data }),
  })
}

// Log a decision: a done-status row of kind 'decision', so it lands in the
// tracker (and ZOE's Bonfire mirror loop) without cluttering the todo board.
export async function logDecision(text, ownerName) {
  const t = String(text || '').trim()
  if (!t || t.length > 2000) return { ok: false, status: 400, error: 'decision text required, max 2000 chars' }
  const owner = await getOwnerId(ownerName)
  if (!owner.ok) return owner
  return trackerFetch('tasks', {
    method: 'POST',
    body: JSON.stringify({
      project: 'zaodevz', kind: 'decision', title: t.slice(0, 200),
      notes: t.length > 200 ? t : null, status: 'done', owner_id: owner.data,
      completed_at: new Date().toISOString(), completed_by: owner.data,
      category: 'Other', legacy_source: 'zaalcaster',
    }),
  })
}

// Search the Bonfire knowledge graph ("what did we decide about X?").
// Same POST /delve call ZOE's own recall loop uses - live-verified.
export async function delve(query) {
  const creds = loadBonfireCreds()
  if (!creds) return { ok: false, status: 501, error: 'Bonfire not configured (set BONFIRE_API_KEY + BONFIRE_ID)' }
  const q = String(query || '').trim()
  if (!q || q.length > 500) return { ok: false, status: 400, error: 'query required, max 500 chars' }

  let res
  try {
    res = await fetch(`${BONFIRE_ORIGIN}/delve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bonfire_id: creds.id, query: q }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return { ok: false, status: 502, error: timedOut ? 'Bonfire timed out' : 'could not reach Bonfire' }
  }

  let data
  try { data = await res.json() } catch { data = null }
  if (!res.ok || !data?.success) {
    return { ok: false, status: res.status, error: `Bonfire returned ${res.status}` }
  }
  return { ok: true, data }
}
