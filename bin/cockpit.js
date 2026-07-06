#!/usr/bin/env node

// cockpit - the single-screen interactive inbox. Scroll your inbound with the
// arrow keys, one item per screen, each answerable item carrying a draft in
// Zaal's voice. Dependency-free (node readline raw mode).
//
//   [right] / [n]  next item        [left] / [p]  previous item
//   [a] approve + send the draft    (pressing a IS the confirmation)
//   [e] edit the draft, then y/N confirm + send
//   [s] mark skip (no reply needed)
//   [q] quit + summary
//
// Modes:
//   default          unanswered replies/mentions/quotes (the work list)
//   --notifs         ALL notifications incl likes/recasts/follows - browse
//                    everything; likes etc are view-only (no draft, no send)
//   --limit n        notifications to scan (default 15, notifs mode 25)
//   --dry            eyeball mode: keys work but NOTHING is ever sent
//
// Without a TTY (piped/CI) it degrades to a read-only listing and never posts.

import readline from 'node:readline'
import { getUnansweredInbound, postCast, addSnooze } from '../lib.js'
import { generateDrafts, saveVoiceExample } from '../voice.js'

const line = '-'.repeat(60)
const ANSWERABLE = new Set(['reply', 'mention', 'quote'])

function statusTag(item) {
  if (item.status === 'sent') return ' [SENT]'
  if (item.status === 'skipped') return ' [SKIPPED]'
  if (item.status === 'later') return ' [LATER - back in 24h]'
  return ''
}

function renderItem(items, i, dry, notifsMode) {
  const item = items[i]
  const done = items.filter((x) => x.status).length
  console.clear()
  console.log(`cockpit${notifsMode ? ' [notifications]' : ''}${dry ? ' [DRY RUN - sends disabled]' : ''} - item ${i + 1} of ${items.length} (${done} handled)`)
  console.log(line)
  console.log(`[${item.type}]${statusTag(item)} @${item.user}`)
  console.log(`${item.link}`)
  const chain = (item.thread && item.thread.length) ? item.thread : (item.parent ? [item.parent] : [])
  if (chain.length) {
    console.log('\nthread:')
    for (const c of chain.slice(-3)) console.log(`  @${c.user}: ${c.text.slice(0, 160)}`)
  }
  console.log(`\nthem: ${item.text || '(no text - reaction/follow)'}`)
  console.log(line)
  if (!ANSWERABLE.has(item.type)) {
    console.log('view-only (like/recast/follow - nothing to reply to)')
  } else if (item.draft === 'SKIP') {
    console.log('draft: (model says no reply needed)')
  } else if (item.draft) {
    console.log(`draft: ${item.draft}`)
  } else {
    console.log('draft: (none - drafting unavailable)')
  }
  console.log(line)
  console.log('[<] prev  [>] next  [a] send draft  [e] edit+send  [s] skip  [l] later (24h)  [q] quit')
}

// Reads one key; arrow keys arrive as 3-byte escape sequences.
function askKey() {
  return new Promise((resolve) => {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    const onData = (buf) => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.off('data', onData)
      const s = buf.toString()
      if (s === '') return resolve('q') // ctrl-c
      if (s === '[C' || s === '[B') return resolve('next')  // right/down
      if (s === '[D' || s === '[A') return resolve('prev')  // left/up
      resolve(s.toLowerCase())
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

function printSummary(items, dry) {
  const sent = items.filter((x) => x.status === 'sent').length
  const skipped = items.filter((x) => x.status === 'skipped').length
  const open = items.length - sent - skipped
  console.log(`sent ${sent} | skipped ${skipped} | still open ${open}${dry ? ' (dry run - nothing actually sent)' : ''}`)
}

async function main() {
  const args = process.argv.slice(2)
  const notifsMode = args.includes('--notifs')
  const limit = args.includes('--limit')
    ? Number(args[args.indexOf('--limit') + 1])
    : (notifsMode ? 25 : 15)
  const dry = args.includes('--dry')

  console.log('loading inbound...')
  const items = await getUnansweredInbound({ limit, includeAll: notifsMode })

  if (!items.length) {
    console.log(notifsMode ? 'No notifications in range.' : 'Inbox zero - everything answered.')
    return
  }

  const draftable = items.filter((x) => ANSWERABLE.has(x.type))
  if (draftable.length) {
    console.log(`drafting replies for ${draftable.length} answerable item(s)...`)
    await generateDrafts(draftable)
  }

  if (!process.stdin.isTTY) {
    // no keyboard - degrade to read-only listing, never post
    for (const [i, item] of items.entries()) {
      console.log(`\n[${i + 1}/${items.length}] [${item.type}] @${item.user}  ${item.link}`)
      console.log(`  them: ${(item.text || '(no text)').slice(0, 140)}`)
      if (ANSWERABLE.has(item.type)) console.log(`  draft: ${item.draft || '(none)'}`)
    }
    console.log('\n(no TTY - read-only mode, nothing sent. run in a terminal for keys.)')
    return
  }

  let i = 0
  while (true) {
    renderItem(items, i, dry, notifsMode)
    const item = items[i]
    const key = await askKey()

    if (key === 'q') {
      console.log('\nquit.')
      break
    } else if (key === 'next' || key === 'n') {
      if (i < items.length - 1) i++
      else {
        console.log('\nend of list. [q] to quit, [<] to scroll back.')
        await askLine('enter to continue...')
      }
    } else if (key === 'prev' || key === 'p') {
      if (i > 0) i--
    } else if (key === 's') {
      // skip = never show again (persisted, so it doesn't come back next session)
      if (!item.status) { item.status = 'skipped'; if (!dry) await addSnooze(item.hash).catch(() => {}) }
      if (i < items.length - 1) i++
    } else if (key === 'l') {
      // later = hide for 24h, then it resurfaces
      item.status = 'later'; if (!dry) await addSnooze(item.hash, 24).catch(() => {})
      if (i < items.length - 1) i++
    } else if (key === 'a') {
      if (!ANSWERABLE.has(item.type)) continue
      if (item.status === 'sent') continue
      if (!item.draft || item.draft === 'SKIP') {
        console.log('\nno draft to send - use [e] to write one, or [s] to skip.')
        await askLine('enter to continue...')
        continue
      }
      const result = await sendReply(item, item.draft, dry)
      if (result === 'sent') item.status = 'sent'
      await askLine('enter to continue...')
      if (i < items.length - 1) i++
    } else if (key === 'e') {
      if (!ANSWERABLE.has(item.type) || item.status === 'sent') continue
      console.log('')
      const edited = (await askLine('your reply (empty cancels): ')).trim()
      if (!edited) continue
      console.log(`\nwill send exactly: ${edited}`)
      const confirm = (await askLine('send? [y/N]: ')).trim().toLowerCase()
      if (confirm === 'y') {
        const result = await sendReply(item, edited, dry)
        if (result === 'sent') {
          item.status = 'sent'
          // his edit is the best voice data there is - feed future drafts
          saveVoiceExample({ theirText: item.text, draftWas: item.draft, zaalWrote: edited })
        }
        await askLine('enter to continue...')
        if (i < items.length - 1) i++
      }
    }
    // any other key: rerender and keep going
  }

  console.clear()
  console.log('cockpit closed.')
  printSummary(items, dry)
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
