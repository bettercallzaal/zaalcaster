#!/usr/bin/env node

// spaces - create and inspect Juke live audio spaces (Farcaster).
// Ported integration of ZAODEVZ/Zuke's Juke developer API into zaalcaster.
//
//   zaalcaster-spaces create "Title" [--at <iso>] [--record] [--agents]
//                            [--announce] [--yes]
//        Preview by default (prints exactly what will be created); --yes
//        actually creates the room. Needs JUKE_API_KEY (env or creds file).
//   zaalcaster-spaces info <spaceId>     public metadata + who is in the room
//   zaalcaster-spaces embed <spaceId>    print the embed + share URLs
//
// Creating a room is outward-facing (owned by the app fid, optionally
// announces a cast), so it follows the same show-first / --yes rule as posting.

import { createJukeSpace, getJukeSpace, jukeEmbedUrl, jukeSpaceUrl, loadJukeKey, isValidJukeSpaceId } from '../juke.js'

function arg(args, flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}

async function main() {
  const args = process.argv.slice(2)
  const cmd = args[0]

  if (cmd === 'info') {
    const id = args[1]
    if (!id) { console.error('Usage: zaalcaster-spaces info <spaceId>'); process.exit(1) }
    const res = await getJukeSpace(id)
    if (!res.ok) { console.error(`Error: ${res.error}`); process.exit(1) }
    const r = res.data.room || {}
    console.log(`${r.title || '(untitled)'}  [${r.status || '?'}]`)
    console.log(`  host: @${r.host?.username || r.host_fid || '?'}`)
    console.log(`  listeners: ${r.listener_count ?? '?'} | speakers: ${r.speaker_count ?? '?'} | recording: ${r.recording ? 'on' : 'off'}`)
    console.log(`  share: ${jukeSpaceUrl(id)}`)
    for (const p of res.data.participants || []) {
      console.log(`    ${p.role.padEnd(8)} @${p.display_name || p.fid}${p.hand_raised ? '  (hand up)' : ''}`)
    }
    return
  }

  if (cmd === 'embed') {
    const id = args[1]
    if (!isValidJukeSpaceId(id)) { console.error('Usage: zaalcaster-spaces embed <spaceId>'); process.exit(1) }
    console.log(`embed:  ${jukeEmbedUrl(id)}`)
    console.log(`share:  ${jukeSpaceUrl(id)}`)
    return
  }

  if (cmd === 'create') {
    const title = args.slice(1).find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--at')
    if (!title) {
      console.error('Usage: zaalcaster-spaces create "Title" [--at <iso>] [--record] [--agents] [--announce] [--yes]')
      process.exit(1)
    }
    const input = {
      title,
      scheduledAt: arg(args, '--at'),
      record: args.includes('--record'),
      allowAgents: args.includes('--agents'),
      announceCast: args.includes('--announce'),
    }
    const send = args.includes('--yes')

    console.log('Space to create:')
    console.log(`  title:    ${input.title}`)
    console.log(`  when:     ${input.scheduledAt || 'open immediately'}`)
    console.log(`  record:   ${input.record ? 'yes' : 'no'}`)
    console.log(`  agents:   ${input.allowAgents ? 'allowed' : 'no'}`)
    console.log(`  announce: ${input.announceCast ? 'YES - posts a cast' : 'no'}`)
    console.log(`  key:      ${loadJukeKey() ? 'present' : 'MISSING - set JUKE_API_KEY'}`)
    console.log('')

    if (!send) {
      console.log('NOT CREATED. Rerun with --yes to create exactly the above.')
      return
    }

    const res = await createJukeSpace(input)
    if (!res.ok) { console.error(`Error: ${res.error}`); process.exit(1) }
    console.log('Space created.')
    console.log(`  id:    ${res.space.id}`)
    console.log(`  embed: ${res.space.embedUrl}`)
    console.log(`  share: ${res.space.spaceUrl}`)
    return
  }

  console.error('Usage: zaalcaster-spaces <create|info|embed> ...')
  process.exit(1)
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
