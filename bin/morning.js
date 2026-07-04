#!/usr/bin/env node

// morning - the daily one-shot: unanswered inbound first (the work), then
// home channels, then a slice of the following timeline. One command, one read.
//
// Usage: zaalcaster-morning [--limit n]   (n = casts per section, default 5)

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const bin = path.dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const limit = args.includes('--limit') ? args[args.indexOf('--limit') + 1] : '5'

const sections = [
  ['UNANSWERED INBOUND', 'engage.js', ['--context', '--limit', '15']],
  ['HOME CHANNELS', 'channels.js', ['--limit', limit]],
  ['TIMELINE', 'timeline.js', ['--limit', limit]],
]

for (const [title, script, scriptArgs] of sections) {
  console.log(`==== ${title} ====\n`)
  const res = spawnSync('node', [path.join(bin, script), ...scriptArgs], {
    stdio: 'inherit',
  })
  if (res.status !== 0) console.log(`(${script} failed - see above)`)
  console.log('')
}
