#!/usr/bin/env node

// spam - manage the personal spam filter. Filtered users/fids drop out of the
// inbound work list (engage, cockpit, web) automatically. The list lives at
// ~/.zao/private/zaalcaster-spam.txt - outside the repo, never committed.
//
//   zaalcaster-spam list                 show the filter
//   zaalcaster-spam add <user|fid> ...   add one or more (username or fid)
//   zaalcaster-spam remove <user|fid>    remove one
//
// Username is stored lowercase without a leading @.

import fs from 'node:fs'
import { SPAM_PATH, loadSpamSet } from '../lib.js'

function readLines() {
  if (!fs.existsSync(SPAM_PATH)) return []
  return fs.readFileSync(SPAM_PATH, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean)
}

function writeEntries(entries) {
  const body = entries.join('\n') + (entries.length ? '\n' : '')
  fs.writeFileSync(SPAM_PATH, body, { mode: 0o600 })
}

function norm(x) {
  return String(x || '').trim().replace(/^@/, '').toLowerCase()
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)

  if (!cmd || cmd === 'list') {
    const set = [...loadSpamSet()].sort()
    if (!set.length) {
      console.log('Spam filter is empty.')
      console.log(`(list lives at ${SPAM_PATH})`)
      return
    }
    console.log(`Filtering ${set.length} entr${set.length === 1 ? 'y' : 'ies'}:`)
    for (const e of set) console.log(`  ${e}`)
    return
  }

  if (cmd === 'add') {
    const toAdd = rest.map(norm).filter((v) => v && !v.startsWith('#'))
    if (!toAdd.length) {
      console.error('Usage: zaalcaster-spam add <user|fid> [...]')
      process.exit(1)
    }
    // keep comments/formatting, dedupe on normalized value
    const existing = readLines()
    const have = new Set(existing.map(norm))
    const added = []
    for (const v of toAdd) {
      if (!have.has(v)) { existing.push(v); have.add(v); added.push(v) }
    }
    writeEntries(existing)
    console.log(added.length ? `Added: ${added.join(', ')}` : 'Already filtered - nothing to add.')
    return
  }

  if (cmd === 'remove' || cmd === 'rm') {
    const targets = new Set(rest.map(norm))
    if (!targets.size) {
      console.error('Usage: zaalcaster-spam remove <user|fid>')
      process.exit(1)
    }
    const existing = readLines()
    const kept = existing.filter((l) => l.startsWith('#') || !targets.has(norm(l)))
    writeEntries(kept)
    console.log(`Removed: ${[...targets].join(', ')}`)
    return
  }

  console.error(`Unknown command '${cmd}'. Use: list | add <user> | remove <user>`)
  process.exit(1)
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
