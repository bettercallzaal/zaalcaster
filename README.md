# Zaalcaster

A lightweight personal Farcaster client for Zaal (@zaal, FID 19640). Read your timeline and post/reply directly from your machine.

## Setup (2 minutes)

### 1. Create config directory

```bash
mkdir -p ~/.zao/private
```

### 2. Get your Neynar API key

Visit https://dev.neynar.com and sign up for free.

1. Create a new application (or use an existing one)
2. Copy your API key from the dashboard
3. Keep it private

### 3. Create a managed signer (first time only)

A managed signer is Neynar's way of signing your casts server-side, so you don't handle keys locally. Reads work without one; only posting needs it.

```bash
npm run mint-signer
```

The script walks the whole flow: it signs a SignedKeyRequest with the app wallet, registers the key with Neynar, prints an approval URL to open on your phone (Farcaster app), polls until approved, and writes `ZAAL_SIGNER_UUID` into the creds file itself. See the header of `bin/mint-signer.js` for the app-FID prerequisite (one-time, ~0.0002 ETH on Optimism via `--register-app-fid`).

### 4. Create config file

Create `~/.zao/private/farcaster-zaal.env`:

```bash
cat > ~/.zao/private/farcaster-zaal.env << 'EOF'
NEYNAR_API_KEY=your_api_key_from_step_2
ZAAL_SIGNER_UUID=your_signer_uuid_from_step_3
ZAAL_FID=19640
EOF

chmod 600 ~/.zao/private/farcaster-zaal.env
```

### 5. Install and test

```bash
npm install
node bin/timeline.js --limit 5
```

You should see your last 5 casts from people you follow. If you see errors, check that your API key and signer UUID are correct.

## Usage

All commands post to the real Farcaster network. Be intentional.

### Read your timeline

```bash
npm run timeline -- --limit 20
zaalcaster-timeline --limit 10
```

### Check notifications (mentions, replies, likes, recasts)

```bash
npm run notifs -- --limit 20
zaalcaster-notifs --limit 10
```

### Post a cast

```bash
npm run post -- "Hello Farcaster from Zaalcaster"
zaalcaster-post "Hello Farcaster"
```

With an embed:

```bash
npm run post -- "Check this out" --embed "https://example.com"
zaalcaster-post "Check this" --embed "https://example.com"
```

To a channel (e.g., /zao):

```bash
npm run post -- "Hello ZAO" --channel "zao"
zaalcaster-post "Hello ZAO" --channel "zao"
```

### Reply to a cast

Pass either a cast hash or a farcaster.xyz link (exactly what engage/channels print):

```bash
npm run reply -- "0xabcd..." "Great post!"
zaalcaster-reply "https://farcaster.xyz/user/0x12345678" "Great post!"
```

With an embed:

```bash
npm run reply -- "0xabcd..." "Love it" --embed "https://example.com"
zaalcaster-reply "0xabcd..." "Love it" --embed "https://example.com"
```

### Search casts

```bash
npm run search -- "music" --limit 20
zaalcaster-search "music" --limit 10
```

### Unanswered inbound (the daily driver)

Replies/mentions/quotes you have not answered yet, with thread context and one-tap links:

```bash
npm run engage
node bin/engage.js --context          # show what each reply was responding to
node bin/engage.js --json             # structured output for drafting replies
node bin/engage.js --all              # include likes/recasts/follows too
```

### Home channels

```bash
npm run channels                      # /zao /wavewarz /zabal interleaved
node bin/channels.js farcaster        # any single channel
```

### Morning one-shot

Engage + channels + timeline in one read:

```bash
npm run morning
node bin/morning.js --limit 5
```

### Thread view

Full conversation around a cast (ancestors above, replies below) - read before replying:

```bash
npm run thread -- "https://farcaster.xyz/user/0x12345678"
node bin/thread.js 0xabcd... --depth 3
```

### Reply drafts in Zaal's voice

One batched model call over the unanswered inbound, grounded in the ZAO/WaveWarZ facts from context.js. Prints each draft plus a copy-ready reply command. Never posts anything. Uses OpenRouter when ~/.zao/private/openrouter.key exists, otherwise falls back to the local claude CLI:

```bash
node bin/engage.js --drafts
```

### User lookup

Who is this person - follower counts, neynar score, bio, mutual-follow state:

```bash
npm run user -- @someone
node bin/user.js 19640 --casts 3
```

## Architecture

- **lib.js** - Neynar v2 REST API wrapper, env loader
- **bin/*.js** - CLI commands: engage, morning, thread, user, like, channels, timeline, notifs, post, reply, search, mint-signer
- **Signing** - Neynar managed signer (server-side). Your key never leaves Neynar's servers.

## Config location

All credentials stored in `~/.zao/private/farcaster-zaal.env`. Never committed to git.

Env file format:

```
NEYNAR_API_KEY=...
ZAAL_SIGNER_UUID=...
ZAAL_FID=19640
```

Missing or invalid env? The CLI will tell you.

## Neynar API Reference

- Docs: https://docs.neynar.com
- REST v2: https://docs.neynar.com/reference/list-feed-channel-casts
- Managed signers: https://docs.neynar.com/reference/signer-operations

## No dependencies

Zaalcaster uses only Node 20+ built-ins. No npm packages needed.

## License

MIT. Use freely. Farcaster is a public network.

## Daily cockpit

- `npm run morning` - one screen: what needs a reply (with drafts in your voice) + top of your timeline. Reads only.
- `node bin/engage.js --drafts` - unanswered inbound, each with a suggested reply grounded in the ZAO/WaveWarZ context. Never posts.
- `node bin/channels.js zao` (or wavewarz, zabal; no arg = all three) - read channel feeds.
- `node bin/reply.js <hash-or-url> "text"` - reply. `node bin/post.js "text"` - post. Both need your call on the text.
