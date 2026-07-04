#!/usr/bin/env node
// morning - one screen to start the day: what needs a reply (with drafts) +
// top of the timeline. Read-only, never posts. Usage: node bin/morning.js
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = path.dirname(fileURLToPath(import.meta.url))
function run(script, args) {
  const r = spawnSync('node', [path.join(dir, script), ...args], { encoding: 'utf-8' })
  return (r.stdout || '') + (r.stderr || '')
}
const line = '='.repeat(56)
console.log('\n' + line + '\n  GM. what needs you on farcaster\n' + line + '\n')
console.log(run('engage.js', ['--drafts', '--limit', '8']).trim() || 'inbox zero.')
console.log('\n' + line + '\n  top of your timeline\n' + line + '\n')
console.log(run('timeline.js', ['--limit', '8']).trim())
console.log('\n(reads only - nothing was posted)\n')
