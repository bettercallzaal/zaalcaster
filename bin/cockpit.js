#!/usr/bin/env node

// cockpit - the single-screen interactive inbox. Walks unanswered inbound one
// item at a time with a draft in Zaal's voice. Dependency-free (node readline).
//
//   [a] approve + send the draft   (pressing a IS the confirmation)
//   [e] edit the draft, then confirm + send
//   [s] skip (no reply needed)
//   [n] next (come back later)
//   [q] quit
//
// Flags:
//   --limit n   notifications to scan (default 15)
//   --dry       eyeball mode: keys work but NOTHING is ever sent
//
// Without a TTY (piped/CI) it degrades to a read-only listing and never posts.

import readline from 'node:readline'
import { getUnansweredInbound, postCast } from '../lib.js'
import { generateDrafts } from '../voice.js'

const line = '-'.repeat(60)

function renderItem(item, index, total, dry) {
  console.clear()
  console.log(`cockpit ${dry ? '[DRY RUN - sends disabled] ' : ''}- item ${index + 1} of ${total}`)
  console.log(line)
  console.log(`[${item.type}] @${item.user}`)
  console.log(`${item.link}`)
  const chain = (item.thread && item.thread.length) ? item.thread : (item.parent ? [item.parent] : [])
  if (chain.length) {
    console.log('\nthread:')
    for (const c of chain.slice(-3)) console.log(`  @${c.user}: ${c.text.slice(0, 160)}`)
  }
  console.log(`\nthem: ${item.text}`)
  console.log(line)
  if (item.draft === 'SKIP') {
    console.log('draft: (model says no reply needed)')
  } else if (item.draft) {
    console.log(`draft: ${item.draft}`)
  } else {
    console.log('draft: (none - drafting unavailable)')
  }
  console.log(line)
  console.log('[a] send draft  [e] edit+send  [s] skip  [n] next  [q] quit')
}

function askKey() {
  return new Promise((resolve) => {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    const onData = (buf) => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.off('data', onData)
      const key = buf.toString()
      if (key === '') resolve('q') // ctrl-c
      else resolve(key.toLowerCase())
    }
    process.stdin.on('data', onData)
  })
}

function askLine(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(promptText, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function sendReply(item, text, dry) {
  console.log('')
  console.log(`sending to @${item.user}: ${text}`)
  if (dry) {
    console.log('DRY RUN - not sent.')
    return 'dry'
  }
  const response = await postCast(text, {
    parentHash: item.hash,
    parentFid: item.fid,
  })
  console.log(`sent: https://farcaster.xyz/${response.cast.author.username}/${response.cast.hash.slice(0, 10)}`)
  return 'sent'
}

async function main() {
  const args = process.argv.slice(2)
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 15
  const dry = args.includes('--dry')

  console.log('loading unanswered inbound...')
  const items = await getUnansweredInbound({ limit })

  if (!items.length) {
    console.log('Inbox zero - everything answered.')
    return
  }

  console.log(`drafting replies for ${items.length} item(s)...`)
  await generateDrafts(items)

  if (!process.stdin.isTTY) {
    // no keyboard - degrade to read-only listing, never post
    for (const [i, item] of items.entries()) {
      console.log(`\n[${i + 1}/${items.length}] [${item.type}] @${item.user}  ${item.link}`)
      console.log(`  them: ${item.text.slice(0, 140)}`)
      console.log(`  draft: ${item.draft || '(none)'}`)
    }
    console.log('\n(no TTY - read-only mode, nothing sent. run in a terminal for keys.)')
    return
  }

  const summary = { sent: 0, skipped: 0, later: 0 }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    renderItem(item, i, items.length, dry)

    let acted = false
    while (!acted) {
      const key = await askKey()

      if (key === 'q') {
        console.log('\nquit.')
        printSummary(summary, dry)
        return
      } else if (key === 'n') {
        summary.later++
        acted = true
      } else if (key === 's') {
        summary.skipped++
        acted = true
      } else if (key === 'a') {
        if (!item.draft || item.draft === 'SKIP') {
          console.log('\nno draft to send - use [e] to write one, or [s]/[n].')
          continue
        }
        const result = await sendReply(item, item.draft, dry)
        if (result === 'sent') summary.sent++
        await askLine('enter to continue...')
        acted = true
      } else if (key === 'e') {
        console.log('')
        const edited = (await askLine('your reply (empty cancels): ')).trim()
        if (!edited) {
          renderItem(item, i, items.length, dry)
          continue
        }
        console.log(`\nwill send exactly: ${edited}`)
        const confirm = (await askLine('send? [y/N]: ')).trim().toLowerCase()
        if (confirm === 'y') {
          const result = await sendReply(item, edited, dry)
          if (result === 'sent') summary.sent++
          await askLine('enter to continue...')
          acted = true
        } else {
          renderItem(item, i, items.length, dry)
        }
      }
      // any other key: ignore, keep waiting
    }
  }

  console.clear()
  console.log('inbox walked.')
  printSummary(summary, dry)
}

function printSummary(summary, dry) {
  console.log(`sent ${summary.sent} | skipped ${summary.skipped} | later ${summary.later}${dry ? ' (dry run - nothing actually sent)' : ''}`)
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
