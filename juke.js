// juke.js - Juke Audio (Farcaster live spaces) client, ported from ZAODEVZ/Zuke
// (src/lib/spaces/juke-api.ts + juke.ts) into dependency-free ESM for zaalcaster.
//
// Historical note: this file is the ORIGIN of the never-throws { ok, ... }
// client pattern every later integration copied (empire.js documents the
// full rationale under "THE CLIENT PATTERN"). It predates the 60s-cache rule
// (spaces are created, not polled, so caching would be wrong here anyway).
//
// Two paths, per juke.audio/llms.txt:
//   - Read/embed: no key. GET /v1/rooms/{id}, embed at juke.audio/embed/{id}.
//   - Create/manage: server-only, key-only. POST /v1/developer/spaces with
//     header X-Juke-Api-Key. The room owner is the key's app owner_fid; never
//     send a host id or a bearer JWT.
//
// The key never lives in the repo. It loads from JUKE_API_KEY (process.env,
// e.g. Vercel) or a JUKE_API_KEY line in ~/.zao/private/farcaster-zaal.env.

import fs from 'fs'
import path from 'path'

const API_ORIGIN = 'https://api.juke.audio'
const EMBED_ORIGIN = 'https://juke.audio'
const CREATE_PATH = '/v1/developer/spaces'
const REQUEST_TIMEOUT_MS = 10_000
const CREDS_PATH = path.join(process.env.HOME || '', '.zao/private/farcaster-zaal.env')

// A space id is interpolated into iframe src / URLs - restrict to URL-safe
// tokens so a crafted id cannot smuggle a query string or a second origin.
const SPACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function isValidJukeSpaceId(value) {
  return typeof value === 'string' && SPACE_ID_PATTERN.test(value)
}

export function jukeEmbedUrl(spaceId, { audioOff = false, partnerToken = null } = {}) {
  if (!isValidJukeSpaceId(spaceId)) throw new Error('Invalid Juke space id')
  const base = `${EMBED_ORIGIN}/embed/${encodeURIComponent(spaceId)}`
  const params = new URLSearchParams()
  if (audioOff) params.set('audio', 'off')
  if (partnerToken) params.set('token', partnerToken)
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

// Canonical share/permalink URL and native "Open in Juke" universal link.
export function jukeSpaceUrl(spaceId) {
  if (!isValidJukeSpaceId(spaceId)) throw new Error('Invalid Juke space id')
  return `${EMBED_ORIGIN}/space/${encodeURIComponent(spaceId)}`
}

// JUKE_API_KEY: process.env wins (Vercel), then the local creds file.
export function loadJukeKey() {
  if (process.env.JUKE_API_KEY) return process.env.JUKE_API_KEY.trim()
  try {
    if (fs.existsSync(CREDS_PATH)) {
      for (const line of fs.readFileSync(CREDS_PATH, 'utf-8').split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const [k, ...rest] = t.split('=')
        if (k === 'JUKE_API_KEY') return rest.join('=').trim()
      }
    }
  } catch {
    // unreadable creds - treated as no key
  }
  return null
}

// Pull a space id out of the (undocumented, beta) create-space response.
const ID_KEYS = ['id', 'space_id', 'spaceId', 'room_id', 'roomId']
const NESTED_KEYS = ['space', 'room', 'data']
export function extractSpaceId(payload) {
  if (typeof payload !== 'object' || payload === null) return null
  for (const key of ID_KEYS) {
    if (isValidJukeSpaceId(payload[key])) return payload[key]
  }
  for (const nk of NESTED_KEYS) {
    const nested = payload[nk]
    if (typeof nested === 'object' && nested !== null) {
      for (const key of ID_KEYS) {
        if (isValidJukeSpaceId(nested[key])) return nested[key]
      }
    }
  }
  return null
}

// Create a Juke space. Never throws - returns { ok, space } or { ok:false }.
export async function createJukeSpace(input, apiKey) {
  const key = apiKey || loadJukeKey()
  if (!key) {
    return { ok: false, status: 401, error: 'JUKE_API_KEY not set (env or ~/.zao/private/farcaster-zaal.env). Get one at juke.audio/developers.' }
  }

  const body = JSON.stringify({
    title: input.title,
    description: input.description ?? undefined,
    scheduled_at: input.scheduledAt ?? null,
    announce_cast: input.announceCast ?? false,
    allow_agents: input.allowAgents ?? false,
    record: input.record ?? false,
  })

  let response
  try {
    response = await fetch(`${API_ORIGIN}${CREATE_PATH}`, {
      method: 'POST',
      headers: { 'X-Juke-Api-Key': key, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return { ok: false, status: 502, error: timedOut ? 'Juke API timed out' : 'Could not reach the Juke API' }
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return { ok: false, status: response.status, error: `Juke API returned ${response.status}${detail ? ': ' + detail.slice(0, 200) : ''}` }
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    return { ok: false, status: 502, error: 'Juke API returned invalid JSON' }
  }

  const spaceId = extractSpaceId(payload)
  if (!spaceId) return { ok: false, status: 502, error: 'Juke API response had no usable space id' }

  return { ok: true, space: { id: spaceId, embedUrl: jukeEmbedUrl(spaceId), spaceUrl: jukeSpaceUrl(spaceId), raw: payload } }
}

// Public room metadata + live participant list (no key needed).
export async function getJukeSpace(spaceId) {
  if (!isValidJukeSpaceId(spaceId)) return { ok: false, status: 400, error: 'Invalid Juke space id' }
  let res
  try {
    res = await fetch(`${API_ORIGIN}/v1/rooms/${encodeURIComponent(spaceId)}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return { ok: false, status: 502, error: 'Could not reach the Juke API' }
  }
  if (!res.ok) return { ok: false, status: res.status, error: `Juke API returned ${res.status}` }
  try {
    return { ok: true, data: await res.json() }
  } catch {
    return { ok: false, status: 502, error: 'Juke API returned invalid JSON' }
  }
}
