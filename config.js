// config.js - EDIT THIS to make the app yours. This file + your env vars is
// all a fork needs. See the "Fork it" section of the README.
//
// Fork naming rule: name your fork <your-farcaster-username>caster
//   ohnahji -> ohnahjicaster
//
// Secrets (Neynar key, your signer) live in env vars, never here.

const username = 'zaal' // <-- your Farcaster username, no @

export const config = {
  username,
  appName: `${username}caster`,

  // Your Farcaster FID. Env USER_FID (or ZAAL_FID) overrides this at runtime.
  fid: '19640',

  // Channels shown on the Channels tab + Post picker.
  homeChannels: ['zao', 'wavewarz', 'zabal'],

  // One-tap quick replies (tap a chip to fill the reply box, then confirm).
  quickReplies: ['GM', 'Lfg', 'love this', 'so cool', 'congrats', 'based', 'ZM'],

  // How the AI drafts replies in your voice (one rule per line).
  voiceRules: [
    '- short, plain, direct. one or two sentences max. lowercase is fine.',
    '- "ppl", "u", "imho" are fine. no hype adjectives, no exclamation stacking.',
    '- no emojis, no em dashes (plain hyphens only).',
    '- answer the actual thing they asked or said; add one concrete detail when it helps.',
    '- keep it under 280 chars.',
    '- if an item really does not need a reply, output SKIP for it.',
  ].join('\n'),

  // Facts that ground AI drafts + the "what I missed" digest. Keep short, or ''.
  context: [
    'The ZAO: a decentralized impact network returning profit, data, and IP to independent artists. Governance is the Fractal - weekly peer-ranked Respect, earned by humans only, contribution not capital. 90+ consecutive weeks, meeting 105, 188 members on Base.',
    'WaveWarZ: live-traded music battles on Solana, the front door to The ZAO. Artists paid 1% of every trade instantly on chain. 500+ SOL lifetime volume, first ZAO incubator project to hit profitability (last 4 weeks). Tagline: back music, not memes.',
    'ZABAL Gamez: 3-month build-a-thon (Jun/Jul/Aug). Builders submit through zabalgamez.com.',
    'The papers are live at thezao.xyz/papers (whitepaper, technical, manifesto, wavewarz).',
  ].join('\n'),

  // Daily dashboard seed (also editable live in the app + synced).
  daily: {
    tasks: [
      { t: 'post a GM', done: false },
      { t: 'clear inbox - reply or skip', done: false },
      { t: 'catch GM Farcaster', done: false },
      { t: 'engage 3 new people (Grow tab)', done: false },
      { t: 'check /zao + /wavewarz', done: false },
      { t: 'quote or boost 1 good cast', done: false },
    ],
    apps: [
      { label: 'GM Farcaster', url: 'https://gmfarcaster.com' },
      { label: 'Bountycaster', url: 'https://www.bountycaster.xyz' },
      { label: 'Paragraph', url: 'https://paragraph.xyz' },
      { label: 'Degen', url: 'https://www.degen.tips' },
      { label: 'Rounds', url: 'https://rounds.wtf' },
    ],
    communities: ['zao', 'wavewarz', 'zabal', 'gmfarcaster', 'farcaster', 'founders'],
    groups: [
      { label: 'Farcaster DMs / group chats', url: 'https://farcaster.xyz/~/inbox' },
    ],
  },
}
