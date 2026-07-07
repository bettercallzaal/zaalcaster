// voice.js - draft generation in Zaal's voice, shared by engage --drafts and cockpit.
// One batched model call: OpenRouter when ~/.zao/private/openrouter.key exists,
// local claude CLI as the zero-config fallback. Print/return only - never posts.

import fs from 'fs'
import path from 'path'
import { spawnSync } from 'node:child_process'
import { config } from './config.js'

const HOME = process.env.HOME || ''
const OPENROUTER_KEY_PATH = path.join(HOME, '.zao/private/openrouter.key')
// Zaal's real edits from cockpit [e] - the highest-signal voice data. Lives
// outside the repo, never committed. Overridable for tests.
const EXAMPLES_PATH = process.env.VOICE_EXAMPLES_PATH
  || path.join(HOME, '.zao/private/zaal-voice-examples.md')

// process.env wins (Vercel: set OPENROUTER_API_KEY), then the local key file.
function loadOpenRouterKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim()
  try {
    if (!fs.existsSync(OPENROUTER_KEY_PATH)) return null
    const key = fs.readFileSync(OPENROUTER_KEY_PATH, 'utf-8').trim()
    return key || null
  } catch {
    return null
  }
}

// Append one edit pair. Called by cockpit when Zaal sends an [e]dited reply -
// what he actually wrote beats any rule we could write down.
export function saveVoiceExample({ theirText, draftWas, zaalWrote }) {
  try {
    const entry = [
      `## ${new Date().toISOString()}`,
      `them: ${(theirText || '').replace(/\s+/g, ' ').slice(0, 300)}`,
      draftWas ? `draft was: ${draftWas.replace(/\s+/g, ' ').slice(0, 300)}` : null,
      `zaal wrote: ${(zaalWrote || '').replace(/\s+/g, ' ').slice(0, 300)}`,
      '',
    ].filter((l) => l !== null).join('\n')
    fs.appendFileSync(EXAMPLES_PATH, entry + '\n', { mode: 0o600 })
    return true
  } catch {
    return false
  }
}

function loadVoiceExamples(max = 5) {
  try {
    if (!fs.existsSync(EXAMPLES_PATH)) return []
    const blocks = fs.readFileSync(EXAMPLES_PATH, 'utf-8').split(/^## /m).filter((b) => b.trim())
    return blocks.slice(-max).map((b) => {
      const them = b.match(/^them: (.+)$/m)?.[1]
      const wrote = b.match(/^zaal wrote: (.+)$/m)?.[1]
      return them && wrote ? { them, wrote } : null
    }).filter(Boolean)
  } catch {
    return []
  }
}

// Outcome-based learning: Zaal's own highest-engagement casts = "these worked".
// Cached in KV for a week so we don't recompute per draft; falls back to a live
// pull. Best-effort - returns [] if store/API unavailable.
async function loadWinningCasts() {
  try {
    const { storeEnabled, kvGet, kvSet } = await import('./store.js')
    if (storeEnabled()) {
      const cached = await kvGet('zc:wincasts')
      if (cached?.at && Array.isArray(cached.casts) && (Date.now() - Date.parse(cached.at) < 7 * 864e5)) return cached.casts
    }
    const { getTopCasts } = await import('./lib.js')
    const casts = (await getTopCasts(8)).map((c) => c.text).filter(Boolean).slice(0, 8)
    if (storeEnabled() && casts.length) await kvSet('zc:wincasts', { at: new Date().toISOString(), casts })
    return casts
  } catch { return [] }
}

function voicePrompt(winning = []) {
  const u = config.username
  const examples = loadVoiceExamples()
  const exampleBlock = examples.length
    ? `\n\nReal examples of how ${u} actually replies (match this register):\n${examples
        .map((e) => `- them: "${e.them}"\n  ${u}: "${e.wrote}"`)
        .join('\n')}`
    : ''
  const winBlock = winning.length
    ? `\n\nCasts of ${u}'s that landed well with his audience (match this energy/topics, do not copy):\n${winning
        .map((t) => `- "${t}"`)
        .join('\n')}`
    : ''

  return `You draft Farcaster replies for ${u} (@${u}). Voice rules:
${config.voiceRules}

Ground replies in these facts when relevant (do not force them, do not list them, just be accurate):
${config.context}${exampleBlock}${winBlock}`
}

// Render the ancestor chain for the prompt: last 4 casts, 220 chars each,
// so deep threads inform the draft without blowing up the prompt.
function threadBlock(item) {
  const chain = (item.thread && item.thread.length)
    ? item.thread
    : (item.parent ? [item.parent] : [])
  if (!chain.length) return ''
  const lines = chain
    .slice(-4)
    .map((c) => `  @${c.user}: "${c.text.slice(0, 220)}"`)
    .join('\n')
  return `conversation so far (oldest first):\n${lines}\n`
}

export function buildBatchPrompt(items, winning = []) {
  const itemsBlock = items
    .map((item, i) => `ITEM ${i + 1} (@${item.user}, ${item.type}):\n${threadBlock(item)}their message: "${item.text}"`)
    .join('\n\n')

  return `${voicePrompt(winning)}

For each item below output exactly one line in the form:
ITEM <n>: <draft reply text or SKIP>

${itemsBlock}`
}

function parseDraftLines(output, items) {
  const drafts = new Map()
  for (const line of (output || '').split('\n')) {
    const m = line.match(/^ITEM (\d+):\s*(.+)$/)
    if (m) drafts.set(Number(m[1]), m[2].trim())
  }
  items.forEach((item, i) => {
    item.draft = drafts.get(i + 1) || null
  })
  return drafts.size > 0
}

// Fills item.draft on each item. Returns the backend used, or null if drafting
// was unavailable (items keep draft: null and callers degrade gracefully).
export async function generateDrafts(items) {
  if (!items.length) return null
  const openrouterKey = loadOpenRouterKey()
  const winning = await loadWinningCasts() // "these worked" examples (cached)

  if (openrouterKey) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openrouterKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'anthropic/claude-fable-5',
          messages: [{ role: 'user', content: buildBatchPrompt(items, winning) }],
          max_tokens: 120 * items.length,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(60000),
      })
      if (response.ok) {
        const data = await response.json()
        // 200 with empty/garbled content (bad model slug etc) falls through
        if (parseDraftLines(data.choices?.[0]?.message?.content, items)) return 'openrouter'
      }
    } catch {
      // fall through to claude CLI
    }
  }

  const claude = spawnSync('claude', ['-p', buildBatchPrompt(items, winning)], {
    encoding: 'utf8',
    timeout: 120000,
  })
  if (claude.status === 0 && parseDraftLines(claude.stdout, items)) {
    return 'claude-cli'
  }
  return null
}

// One model call over recent feed casts -> a short "what I missed" digest for
// Zaal. OpenRouter first (Vercel), claude CLI fallback (local). Returns the
// digest string or null if unavailable.
async function callModel(prompt, maxTokens) {
  const key = loadOpenRouterKey()
  if (key) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'anthropic/claude-fable-5', messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.4 }),
        signal: AbortSignal.timeout(60000),
      })
      if (r.ok) {
        const d = await r.json()
        const t = d.choices?.[0]?.message?.content?.trim()
        if (t) return t
      }
    } catch { /* fall through */ }
  }
  const c = spawnSync('claude', ['-p', prompt], { encoding: 'utf8', timeout: 120000 })
  if (c.status === 0 && c.stdout.trim()) return c.stdout.trim()
  return null
}

// Draft a LinkedIn post about something the user built. Build-in-public voice,
// 2026 best practice (hook first, specific, no hashtags, link in comments).
export async function linkedinPost(topic, facts = '') {
  const prompt = `Write a LinkedIn post for ${config.username}, a founder building onchain tools so independent artists own their profit, data and IP (projects: The ZAO, WaveWarZ, ZABAL, and zaalcaster - his open-source Farcaster client).

Topic to post about: ${topic}
${facts ? `Facts to ground it (use the real specifics):\n${facts}\n` : ''}
Write it like a real founder building in public, not a corporate announcement. Rules (2026 LinkedIn best practice):
- Open with a strong, SPECIFIC first line that earns the "see more" click: a real result, a lesson, or a contrarian take. Never "excited to announce".
- First person, plain, honest, specific. Real detail and real numbers beat hype.
- NO hashtags. NO emojis. No engagement bait ("comment YES"). No manufactured vulnerability.
- 600-1200 characters, short paragraphs, one idea per few lines, skimmable.
- Build-in-public: what you built, why, what you learned or what surprised you. Tie to the mission (artists owning their tools) only when it genuinely fits.
- Do NOT put a URL in the body (LinkedIn throttles link posts). If a link is relevant, end the post with a separate final line exactly: "link in the comments".
- End with a light, genuine invitation to reply (a real question), not a hard pitch.
Output ONLY the post text.`
  return callModel(prompt, 500)
}

// Due-diligence read on a Farcaster user: who they are + alignment with the
// user's world (config.context) + how to engage. Returns a short brief or null.
export async function researchUser({ username, display, bio, casts, followers, score, youFollow, followsYou } = {}) {
  const block = (casts || []).slice(0, 20)
    .map((c) => `"${(c.text || '').replace(/\s+/g, ' ').slice(0, 200)}"`).filter((s) => s.length > 3).join('\n')
  const rel = [youFollow ? 'you follow them' : '', followsYou ? 'they follow you' : ''].filter(Boolean).join(', ')
  const prompt = `You are helping ${config.username} (@${config.username}) size up @${username} on Farcaster - who they are and whether they align with his world.

${config.username}'s world and values:
${config.context}

The person: @${username}${display ? ` (${display})` : ''}${followers != null ? `, ${followers} followers` : ''}${score != null ? `, neynar score ${score}` : ''}${rel ? `, ${rel}` : ''}.
Bio: ${bio || '(none)'}
Recent casts:
${block || '(none)'}

Write a tight due-diligence read for ${config.username}. Plain text, no emojis, no em dashes, lowercase ok, under 90 words:
- who they are + what they focus on (1-2 lines)
- alignment with his world (artists / onchain / ZAO / WaveWarZ / building): rate high, medium, or low, and why in one line
- one concrete way to engage them if aligned, or "probably skip" if not`
  return callModel(prompt, 400)
}

export async function digestFeed(casts) {
  if (!casts.length) return null
  const block = casts.slice(0, 40)
    .map((c) => `@${c.author}: "${(c.text || '').replace(/\s+/g, ' ').slice(0, 240)}"${c.channel ? ` [/${c.channel}]` : ''}`)
    .join('\n')
  const prompt = `You are briefing ${config.username} (@${config.username}) on what he missed on Farcaster. Below are recent casts from people he follows.

Write a tight digest: 4-7 bullet points grouping the important themes, launches, questions aimed at him, and anything relevant. Each bullet one line, plain, lowercase ok, no emojis, no em dashes. Name the people (@handle). Skip pure noise/gm. End with a one-line "worth a reply:" naming 1-2 casts if any deserve his response.

Casts:
${block}`
  return callModel(prompt, 700)
}
