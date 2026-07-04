#!/usr/bin/env node

import { getNotifications, formatNotification } from '../lib.js'

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
    const response = await getNotifications({ limit })
    const notifications = response.notifications || []

    if (notifications.length === 0) {
      console.log('No notifications.')
      return
    }

    for (const notif of notifications) {
      const formatted = formatNotification(notif)
      if (!formatted) continue

      let typeLabel = notif.type
      if (notif.type === 'mention') typeLabel = 'MENTION'
      if (notif.type === 'reply') typeLabel = 'REPLY'
      if (notif.type === 'like') typeLabel = 'LIKE'
      if (notif.type === 'recast') typeLabel = 'RECAST'

      console.log(`
[${typeLabel}] ${formatted.author}
${formatted.timestamp}

${formatted.text}

Hash: ${formatted.hash}
---`)
    }
  } catch (error) {
    console.error('Error fetching notifications:', error.message)
    process.exit(1)
  }
}

main()
