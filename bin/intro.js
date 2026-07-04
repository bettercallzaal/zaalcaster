#!/usr/bin/env node
// intro - draft a tailored self-intro for a community Zaal is joining, in his
// voice, grounded in ZAO context. Print-only - he pastes it in their
// introduce-yourself channel himself.
// Usage: node bin/intro.js "Gnars" ["one line on what they are"]
import fs from 'node:fs'
import os from 'node:os'
import { ZAO_CONTEXT } from '../context.js'

function orKey() {
  try { return fs.readFileSync(os.homedir() + '/.zao/private/openrouter.key', 'utf8').trim() } catch { return null }
}

async function main() {
  const args = process.argv.slice(2)
  const community = args.find((a) => !a.startsWith('--'))
  if (!community) { console.error('Usage: zaalcaster-intro "Community Name" ["one line about them"]'); process.exit(1) }
  const about = args.filter((a) => a !== community && !a.startsWith('--')).join(' ')

  const key = orKey()
  if (!key) { console.error('needs ~/.zao/private/openrouter.key'); process.exit(1) }

  const sys = [
    'You write a short self-introduction for Zaal (@zaal) to post in a community he just joined or is active in, in their introduce-yourself channel.',
    'VOICE: lowercase casual, plain, direct. no emojis, no hashtags, no em dashes (hyphens only). never the words excited thrilled or amazing.',
    'STRUCTURE: a warm greeting to that community by name, one line on who Zaal is, then the SPECIFIC overlap between The ZAO and this community (why he genuinely belongs here / what they share), then a light open-ended connection (would love to find where X overlaps). Under 500 characters. Be specific to THIS community, not generic.',
    'Who Zaal is (facts, use accurately, do not dump all):',
    ZAO_CONTEXT,
  ].join('\n')
  const user = about
    ? `Community: ${community}. What they are: ${about}. Write his intro.`
    : `Community: ${community}. Write his intro, drawing on what this community is known for. If you are unsure what they do, keep the overlap about shared values (independent creators, community ownership, contribution over capital).`

  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENROUTER_MODEL || 'anthropic/claude-fable-5', messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], max_tokens: 260, temperature: 0.75 }),
    signal: AbortSignal.timeout(45000),
  }).then((x) => x.json())
  let t = r.choices?.[0]?.message?.content
  if (!t) { console.error('no draft from model'); process.exit(1) }
  t = t.trim().replace(/[—–]/g, '-')
  console.log('\nintro for ' + community + ' (edit + paste into their introduce-yourself, never auto-posted):\n')
  console.log(t + '\n')
}
main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
