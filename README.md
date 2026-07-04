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

A managed signer is Neynar's way of signing your casts server-side, so you don't handle keys locally.

```bash
curl -X POST https://api.neynar.com/v2/signers \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "signer_uuid": "generated-uuid"
  }'
```

This returns a `signer_uuid`. Or visit https://dev.neynar.com/signers in your dashboard.

Alternatively, register a signer via the Neynar UI and approve the transaction that appears in your wallet. Either way, you end up with a `signer_uuid` string.

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

First, find the cast hash from timeline or search:

```bash
npm run reply -- "0xabcd..." "Great post!"
zaalcaster-reply "0xabcd..." "Great post!"
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

## One-liner daily commands

Read timeline once per day:

```bash
zaalcaster-timeline --limit 30
```

Check notifications:

```bash
zaalcaster-notifs --limit 15
```

Post a thought:

```bash
zaalcaster-post "Building in public today"
```

## Architecture

- **lib.js** - Neynar v2 REST API wrapper, env loader
- **bin/*.js** - CLI commands for timeline, notifs, post, reply, search
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
