// chat.js - cross-post a cast's text to Telegram and Discord. Same shape as
// bsky.js / xpost.js: no SDK, just fetch, env-gated, never throws.
//
// WHY THESE TWO TOGETHER: both are "a bot drops a message in a room" - one POST
// with a token/URL, no OAuth dance, no session. They earn one small file rather
// than two nearly-identical ones.
//
// Telegram needs (BotFather -> /newbot, then add the bot to the chat):
//   TG_BOT_TOKEN     the bot token
//   TG_CHAT_ID       the target chat/channel id (e.g. -1001234567890 or @channel)
// Discord needs (Server Settings -> Integrations -> Webhooks -> New Webhook):
//   DISCORD_WEBHOOK_URL
// If unset, the *Enabled() check is false and the poster no-ops with a reason -
// exactly like Bluesky, so a missing config can never fail a cast.

const TG_API = 'https://api.telegram.org'
const TG_LIMIT = 4096
const DISCORD_LIMIT = 2000

function tgCreds() {
  return { token: process.env.TG_BOT_TOKEN || '', chat: process.env.TG_CHAT_ID || '' }
}

export function telegramEnabled() {
  const { token, chat } = tgCreds()
  return !!(token && chat)
}

export function discordEnabled() {
  return !!(process.env.DISCORD_WEBHOOK_URL || '')
}

// Post one message to the configured Telegram chat. Optionally appends a link
// back to the Farcaster cast (so the chat can jump to the original).
export async function postToTelegram(text, { castUrl = null } = {}) {
  if (!telegramEnabled()) {
    return { ok: false, reason: 'Telegram not connected - set TG_BOT_TOKEN + TG_CHAT_ID' }
  }
  const base = (text || '').trim()
  if (!base) return { ok: false, reason: 'empty text' }
  const suffix = castUrl ? `\n\n${castUrl}` : ''
  const body = (base + suffix).slice(0, TG_LIMIT)
  try {
    const { token, chat } = tgCreds()
    const r = await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: body, disable_web_page_preview: false }),
      signal: AbortSignal.timeout(15000),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || !d.ok) return { ok: false, reason: d.description || `telegram ${r.status}` }
    return { ok: true, messageId: d.result?.message_id ?? null }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'telegram request failed' }
  }
}

// Post one message to the configured Discord webhook.
export async function postToDiscord(text, { castUrl = null } = {}) {
  if (!discordEnabled()) {
    return { ok: false, reason: 'Discord not connected - set DISCORD_WEBHOOK_URL' }
  }
  const base = (text || '').trim()
  if (!base) return { ok: false, reason: 'empty text' }
  const suffix = castUrl ? `\n\n${castUrl}` : ''
  const content = (base + suffix).slice(0, DISCORD_LIMIT)
  try {
    const r = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(15000),
    })
    // Discord webhooks return 204 No Content on success (no JSON body).
    if (r.status === 204 || r.ok) return { ok: true }
    const d = await r.json().catch(() => ({}))
    return { ok: false, reason: d.message || `discord ${r.status}` }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'discord request failed' }
  }
}
