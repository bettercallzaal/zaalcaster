#!/usr/bin/env node

import { searchCasts, formatCast } from '../lib.js'

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.error('Usage: zaalcaster-search "query" [--limit N]')
    process.exit(1)
  }

  let query = args[0]
  let limit = 20

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10)
      i++
    }
  }

  try {
    console.log(`Searching for: ${query}`)
    const response = await searchCasts(query, { limit })
    const casts = response.casts || []

    if (casts.length === 0) {
      console.log('No results.')
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
    console.error('Error searching casts:', error.message)
    process.exit(1)
  }
}

main()
