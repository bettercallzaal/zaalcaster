#!/usr/bin/env node

// user - profile lookup for triage: who is this person replying to me.
//
// Usage: zaalcaster-user <fid|@username> [--casts n]
//   --casts n   also show their n most recent casts (default off)

import { getUser, getUserCasts, formatCast } from '../lib.js'

async function main() {
  const args = process.argv.slice(2)
  const target = args.find((a) => !a.startsWith('--'))

  if (!target) {
    console.error('Usage: zaalcaster-user <fid|@username> [--casts n]')
    process.exit(1)
  }

  const user = await getUser(target)
  if (!user) {
    console.error(`No user found for ${target}`)
    process.exit(1)
  }

  const score = user.experimental?.neynar_user_score
  console.log(`@${user.username}  (${user.display_name || '-'})  fid ${user.fid}`)
  console.log(`  followers ${user.follower_count} | following ${user.following_count}${typeof score === 'number' ? ` | neynar score ${score}` : ''}`)
  if (user.profile?.bio?.text) console.log(`  bio: ${user.profile.bio.text.replace(/\s+/g, ' ').slice(0, 200)}`)
  const vf = user.viewer_context
  if (vf) console.log(`  you follow them: ${vf.following ? 'yes' : 'no'} | they follow you: ${vf.followed_by ? 'yes' : 'no'}`)
  console.log(`  profile: https://farcaster.xyz/${user.username}`)

  if (args.includes('--casts')) {
    const n = parseInt(args[args.indexOf('--casts') + 1], 10) || 3
    const res = await getUserCasts({ fid: user.fid, limit: n })
    console.log('')
    for (const cast of res.casts || []) {
      const f = formatCast(cast)
      console.log(`  ${f.timestamp}  ${f.text.replace(/\s+/g, ' ').slice(0, 140)}`)
    }
  }
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
