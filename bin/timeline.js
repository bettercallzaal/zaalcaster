#!/usr/bin/env node

import { getFollowingFeed, formatCast } from '../lib.js'

async function main() {
  const args = process.argv.slice(2)
  let limit = 20

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10)
      i++
    }
  }

  try {
    const response = await getFollowingFeed({ limit })
    const casts = response.casts || []

    if (casts.length === 0) {
      console.log('No casts in timeline.')
      return
    }

    for (const cast of casts) {
      const formatted = formatCast(cast)
      console.log(`
${formatted.author} (@${cast.author.username})
${formatted.timestamp}

${formatted.text}

Hash: ${formatted.hash}
Replies: ${formatted.replies} | Recasts: ${formatted.recasts} | Likes: ${formatted.likes}
---`)
    }
  } catch (error) {
    console.error('Error fetching timeline:', error.message)
    process.exit(1)
  }
}

main()
