// voice.js - draft generation in Zaal's voice, shared by engage --drafts and cockpit.
// One batched model call: OpenRouter when ~/.zao/private/openrouter.key exists,
// local claude CLI as the zero-config fallback. Print/return only - never posts.

import fs from 'fs'
import path from 'path'
import { spawnSync } from 'node:child_process'
import { ZAO_CONTEXT } from './context.js'

const OPENROUTER_KEY_PATH = path.join(process.env.HOME, '.zao/private/openrouter.key')

function loadOpenRouterKey() {
  try {
    if (!fs.existsSync(OPENROUTER_KEY_PATH)) return null
    const key = fs.readFileSync(OPENROUTER_KEY_PATH, 'utf-8').trim()
    return key || null
  } catch {
    return null
  }
}

export const VOICE_PROMPT = `You draft Farcaster replies for Zaal (@zaal). Voice rules:
- short, plain, direct. one or two sentences max. lowercase is fine.
- "ppl", "u", "imho" are fine. no hype adjectives, no exclamation stacking.
- no emojis, no em dashes (plain hyphens only).
- answer the actual thing they asked or said; add one concrete detail when it helps.
- keep it under 280 chars.
- if an item really does not need a reply, output SKIP for it.

Ground replies in these facts when relevant (do not force them, do not list them, just be accurate):
${ZAO_CONTEXT}`

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

function buildBatchPrompt(items) {
  const itemsBlock = items
    .map((item, i) => `ITEM ${i + 1} (@${item.user}, ${item.type}):\n${threadBlock(item)}their message: "${item.text}"`)
    .join('\n\n')

  return `${VOICE_PROMPT}

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
          messages: [{ role: 'user', content: buildBatchPrompt(items) }],
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

  const claude = spawnSync('claude', ['-p', buildBatchPrompt(items)], {
    encoding: 'utf8',
    timeout: 120000,
  })
  if (claude.status === 0 && parseDraftLines(claude.stdout, items)) {
    return 'claude-cli'
  }
  return null
}
