# CLAUDE.md - zaalcaster

Minimal personal Farcaster CLI for Zaal (@zaal, fid 19640). Reads + posts via Neynar v2.

## Rules (non-negotiable)
- NEVER post, reply, or like without showing Zaal the exact text first and getting a yes, unless he says "autopost" for that item.
- NEVER commit secrets. Creds live at ~/.zao/private/farcaster-zaal.env (NEYNAR_API_KEY, ZAAL_FID, ZAAL_SIGNER_UUID). Never print their values.
- No emojis, no em dashes anywhere (code, commits, casts). Plain hyphens.
- Zaal's cast voice: short, plain, direct. "ppl", "u", "imho" are fine. No hype adjectives.
- Boot-verify before every commit: node --check on every changed file, plus run the command once live (reads are safe to run).
- Branch + PR for multi-file changes; direct commits to main are OK for single-file fixes Zaal asked for.

## Map
- lib.js - env loader + Neynar wrapper. Endpoints are /v2/farcaster/* (verified live 2026-07-04). Signer only required at post time; reads need only API key. resolveCast() takes hash or farcaster.xyz URL.
- bin/engage.js - unanswered inbound (replies/mentions/quotes) with thread context; --json for draft workflows; --all for likes etc (the daily driver)
- bin/morning.js - one-shot: engage + channels + timeline
- bin/channels.js - /zao /wavewarz /zabal (or any channel id)
- bin/mint-signer.js - full signer mint flow (see Known state)
- bin/timeline.js, notifs.js, search.js, post.js, reply.js (reply takes hash OR farcaster.xyz link)
- Farcaster link format: https://farcaster.xyz/<username>/<0x + first 8 hash chars>

## Known state (2026-07-04, end of session)
- Reads WORK. Posting still blocked on ZAAL_SIGNER_UUID.
- Signer mint investigated end to end. Facts: the SignedKeyRequest must be signed by the custody wallet of an app FID. ZAO OS vercel env APP_FID=19640 is unusable for this (the app wallet 0x6CCA6f93F38298a6d319d6D64d9f1597278dB3ca is NOT custody of 19640 - Neynar rejects with 400, verified live). The app wallet owns no FID and has 0 ETH on Optimism. Old ZAO_OFFICIAL/WAVEWARZ signer uuids in vercel env are dead (404 under both API keys). ZAO OS's own /api/auth/signer route has the same bug.
- UNBLOCK (one manual step): send ~2 USD of ETH on Optimism to 0x6CCA6f93F38298a6d319d6D64d9f1597278dB3ca, then `npm run mint-signer -- --register-app-fid` and tap the approval URL on the phone. Registration price ~0.00012 ETH; script verified up to the funding wall.
- Roadmap done this session: engage v2 (context/json/filter), reply-by-URL, channels, morning. Next ideas: --drafts generation loop in a Claude session on top of engage --json, likes command once signer works.
