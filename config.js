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

  // Empire Builder (empirebuilder.world) rank card on the Grow tab. Blank =
  // no card shown. Set this to the Base wallet that owns your Empire (Zaal
  // already has a live tokenless one - "ZABAL GAMEZ", owner
  // 0x7234c36a71ec237c2ae7698e8916e0735001e9af, per research doc 991) - left
  // blank here since this is Zaal's call, not a default. This app only reads
  // Empire Builder back; it never creates, funds, or writes to one.
  empireOwnerWallet: '',

  // Zora Creator Coin card on the Grow tab. Blank = no card shown. Set to
  // your coin's contract address on Base - Zaal's is already known:
  // 0x2275c5e507f1d01a0c043a4f888ec58f8215c285 (found live as a booster
  // entry on the ZABAL Empire leaderboard) - left blank here for the same
  // reason as empireOwnerWallet above, it's Zaal's call to set it.
  zoraCoinAddress: '',

  // ZOE / cowork tracker: which team_members.name owns the tasks shown on
  // the Daily tab's ZOE card. Needs ZAO_TRACKER_URL + ZAO_TRACKER_KEY env
  // vars (or the local ~/.zao/cowork-tracker.env) - card hides itself when
  // they're unset.
  trackerOwner: 'Zaal',

  // Booster engagement queue (Empire tab): phrases that mark someone as
  // giving the project energy when they cast them. Anyone who likes your
  // recent casts also qualifies. Detection only - every engagement back is
  // still your tap (doc 1088's booster idea, built confirm-first).
  boosterPhrases: ['zabal gamez', 'zabal games'],

  // Your brands - each gets a page (channel feed + links) in the Brands hub.
  brands: [
    { name: 'The ZAO', channel: 'zao', tagline: 'decentralized impact network for artists', links: [{ label: 'thezao.xyz', url: 'https://thezao.xyz' }, { label: 'papers', url: 'https://thezao.xyz/papers' }] },
    { name: 'WaveWarZ', channel: 'wavewarz', tagline: 'live-traded music battles - back music, not memes', links: [{ label: 'wavewarz.com', url: 'https://www.wavewarz.com' }] },
    { name: 'ZABAL', channel: 'zabal', tagline: 'ZABAL Gamez build-a-thon + art', links: [{ label: 'zabal.art', url: 'https://zabal.art' }, { label: 'zabalgamez.com', url: 'https://zabalgamez.com' }] },
    { name: 'ZLANK', channel: 'zabal', tagline: 'no-code Farcaster snap builder', links: [{ label: 'zlank.online', url: 'https://zlank.online' }] },
    { name: 'zaalcaster', channel: 'zao', tagline: 'this app - gamified personal Farcaster client', links: [{ label: 'z.thezao.xyz', url: 'https://z.thezao.xyz' }, { label: 'github', url: 'https://github.com/bettercallzaal/zaalcaster' }] },
  ],

  // One-tap quick replies (tap a chip to fill the reply box, then confirm).
  quickReplies: ['GM', 'Lfg', 'love this', 'so cool', 'congrats', 'based', 'ZM'],

  // Your social profiles - associate your Farcaster with the rest. Editable in
  // the app (My links), seeds from here. Blank ones are hidden until you add them.
  socials: [
    { label: 'Farcaster', url: 'https://farcaster.xyz/zaal' },
    { label: 'X', url: 'https://x.com/bettercallzaal' },
    { label: 'GitHub', url: 'https://github.com/bettercallzaal' },
    { label: 'LinkedIn', url: '' },
    { label: 'Bluesky', url: '' },
    { label: 'Website', url: 'https://thezao.xyz' },
  ],

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
      { label: 'Claude Code', url: 'https://claude.ai/code' },
      { label: 'Empire snap', url: 'https://empiresnap.vercel.app/' },
    ],
    communities: ['zao', 'wavewarz', 'zabal', 'gmfarcaster', 'farcaster', 'founders'],
    groups: [
      { label: 'Farcaster DMs / group chats', url: 'https://farcaster.xyz/~/inbox' },
    ],
  },
}
