# Zaalcaster

A lightweight personal Farcaster client for Zaal (@zaal, FID 19640). Read your timeline and post/reply directly from your machine. Open source. Now with token-powered reply ranking via $zaalcaster.

## What Is Zaalcaster?

Zaalcaster is a view-only client where only Zaal posts; everyone else can read. It's his daily cockpit for:

- **Unanswered inbound** - replies, mentions, quotes you haven't answered yet (daily driver)
- **Channel feeds** - curated channels (/zao, /wavewarz, /zabal) without main-feed noise
- **Thread view** - read the full conversation before replying
- **Reply drafts** - AI suggestions grounded in ZAO context and Zaal's personal voice (never posts without approval)
- **Timeline** - home feed with simple CLI or web UI

Plus now: **$zaalcaster token** - a mechanism for signaling which replies deserve attention, backed by stake (hold) and tips (spend). Two dials, human judgment stays in the loop.

## Quick Start (2 minutes)

### Prerequisites

- Node 20+
- Free Neynar API key (dev.neynar.com)

### Setup

```bash
# 1. Clone and install
git clone https://github.com/bettercallzaal/zaalcaster.git
cd zaalcaster
npm install

# 2. Get Neynar key
# Visit https://dev.neynar.com, create app, copy key

# 3. Mint a managed signer (for posting)
npm run mint-signer
# Walks the flow: signs KeyRequest, registers with Neynar, opens phone-approval URL,
# polls until approved, writes ZAAL_SIGNER_UUID to creds file.

# 4. Create credentials file
mkdir -p ~/.zao/private
cat > ~/.zao/private/farcaster-zaal.env << 'INNER_EOF'
NEYNAR_API_KEY=your_key_here
ZAAL_SIGNER_UUID=your_signer_uuid
ZAAL_FID=19640
INNER_EOF
chmod 600 ~/.zao/private/farcaster-zaal.env

# 5. Test
npm run timeline -- --limit 5
```

You should see your last 5 casts from people you follow.

## CLI Usage

All commands post to the real Farcaster network. Be intentional.

### Read

```bash
# Timeline (home feed)
npm run timeline -- --limit 20
zaalcaster-timeline --limit 10

# Notifications (mentions, replies, likes, recasts)
npm run notifs -- --limit 20

# Unanswered inbound (the daily driver)
npm run engage
node bin/engage.js --context       # show parent cast of each reply
node bin/engage.js --json          # structured output
node bin/engage.js --drafts        # AI-suggested replies

# Channels
npm run channels                   # /zao, /wavewarz, /zabal interleaved
node bin/channels.js zao           # single channel

# Morning cockpit (in one screen)
npm run morning
node bin/morning.js --limit 5

# Search
npm run search -- "music" --limit 10

# User lookup
npm run user -- @someone
node bin/user.js 19640 --casts 3

# Thread view
npm run thread -- "https://farcaster.xyz/user/0x12345678"
node bin/thread.js 0xabcd... --depth 3
```

### Write

Post (preview by default; use `--yes` to actually post):

```bash
npm run post -- "Hello Farcaster"
npm run post -- "Hello Farcaster" --yes          # actually posts
npm run post -- "Check this" --embed "https://example.com"
zaalcaster-post "Hello ZAO" --channel "zao"     # to a channel
```

Reply (preview by default):

```bash
npm run reply -- "0xabcd..." "Great post!"
npm run reply -- "https://farcaster.xyz/user/0x12345678" "Nice!" --yes
zaalcaster-reply "0xabcd..." "Love it" --embed "https://example.com"
```

### Drafts

Generate suggested replies in Zaal's voice (uses OpenRouter if ~/.zao/private/openrouter.key exists, otherwise falls back to local claude CLI):

```bash
node bin/engage.js --drafts
```

## Web App

Deploy to Vercel for a browser-based UI:

```bash
npm run dev                        # local dev
vercel deploy                      # production
```

Once running, you get 9 tabs:

- **Daily** - cockpit view (unanswered inbound + drafts)
- **Feed** - home timeline
- **Inbox** - all notifications (replies, mentions, likes, recasts, follows)
- **Channels** - /zao, /wavewarz, /zabal
- **Search** - cast search
- **Compose** - draft new posts
- **Grow** - your Farcaster stats (followers, engagement, Neynar score)
- **Empire** - Empire Builder leaderboards, boosters, create a tokenless empire
- **POIDH** - bounty reader

Guest sign-ins get read-only access to Feed, Channels, Search, POIDH. Owner (FID matching `USER_FID` env var) gets write access to everything.

## Environment Variables

### Required (reads + timeline)

- `NEYNAR_API_KEY` - free from dev.neynar.com

### For CLI Posting

- `ZAAL_SIGNER_UUID` - managed signer (from `npm run mint-signer`)
- `ZAAL_FID` - your Farcaster ID (default: 19640)

### For Web App (optional)

- `SESSION_SECRET` - sign-in sessions (any random string)
- `NEYNAR_CLIENT_ID` - Sign In With Farcaster via Neynar (optional)
- `USER_FID` - owner FID for write access (default: 19640)
- `OPENROUTER_API_KEY` - for AI reply drafts (optional)
- `EMPIRE_BUILDER_API_KEY` - for creating tokenless empires (optional)

### For Syncing + Scheduling (optional)

- `KV_REST_API_URL` + `KV_REST_API_TOKEN` - Vercel KV for cross-device sync

See `.env.example` for all options.

## Architecture

- **lib.js** - Neynar v2 REST API wrapper. All the heavy lifting.
- **bin/*.js** - CLI commands (engage, morning, thread, user, etc.)
- **public/index.html** - web UI (9 tabs)
- **api/*.js** - serverless backend routes (auth, inbox, tips, etc.)
- **empire.js** - Empire Builder integration (tokenless empires, leaderboards, boosters)
- **voice.js** - Zaal's reply drafting rules (you customize this for your own voice)
- **context.js** - ZAO facts grounding the drafts (replace with your context)

## No Dependencies

Zaalcaster uses only Node 20+ built-ins. No npm packages. Smaller attack surface, simpler deployment.

## Forking: Make Your Own `<username>caster`

Zaalcaster is one person's daily driver. Fork it and make it yours.

### Naming Rule (Required)

Your fork must be named your Farcaster username + `caster`, all lowercase:

- `alice` → `alicecaster`
- `dwr.eth` → `dwrcaster` (drop the `.eth`)

This applies to: repo name, Vercel project, page title, CLI binary.

### Customization Checklist

1. **Wordmark + title** - `public/index.html`: change `<title>` and `zaal<span>caster</span>` header
2. **Your FID** - `ZAAL_FID` env var (or customize the hardcoded references)
3. **Your voice** - `voice.js`: change `@zaal` to your handle, adjust reply rules
4. **Your context** - `context.js`: replace ZAO/WaveWarZ facts with facts about you/your project
5. **Your channels** - `HOME_CHANNELS` in `public/index.html` and `bin/channels.js`
6. **Your daily defaults** - `DAILY_DEFAULT` block in `public/index.html` (edit live later too)

### Deploy Your Fork

```bash
git push
vercel deploy
# Set env vars in Vercel project dashboard
```

Read-only public access is free. Owner-only write access is controlled by `USER_FID` + `SESSION_SECRET`.

## The $zaalcaster Token

Zaalcaster now includes $zaalcaster - a token for signaling which replies deserve Zaal's attention.

### How It Works

- **Stake** - Hold $zaalcaster to show alignment. Your balance is visible in the reply queue.
- **Tip** - Attach a tip to a specific Farcaster link. 50% burned (deflationary), 50% to Zaal.
- **Rank** - Your reply enters Zaal's queue ranked by (stake + tip), but Zaal's judgment is the final ranker. Two parameters, not automation.

### Token Economics

- Zaal keeps ~50%, vested over month one (signals alignment, no dump).
- Contributor rewards: PRs that add value earn tokens at Zaal's judgment.
- Anti-spam floor on tips.
- Burn (from tip split) is ongoing deflation.

**See [ONE-PAGER.md](./ONE-PAGER.md) for full details.**

## License

MIT. Use freely. Farcaster is a public network. Fork it. Make it yours.

## Learn More

- [Neynar v2 API Docs](https://docs.neynar.com)
- [Farcaster Protocol](https://docs.farcaster.xyz)
- [Empire Builder Docs](https://empire-builder.gitbook.io)
- [Clanker](https://clanker.world)

## Support

Questions? Open an issue on GitHub or ping [@zaal](https://warpcast.com/zaal) on Farcaster.

---

Built in the open. No bullshit. Let's go.
