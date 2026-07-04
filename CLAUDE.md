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
- lib.js - env loader + Neynar wrapper. Endpoints are /v2/farcaster/* (verified live 2026-07-04). Signer only required at post time; reads need only API key.
- bin/engage.js - unanswered inbound with farcaster.xyz links (the daily driver)
- bin/timeline.js, notifs.js, search.js, post.js, reply.js
- Farcaster link format: https://farcaster.xyz/<username>/<0x + first 8 hash chars>

## Known state (2026-07-04)
- Reads WORK. Posting blocked on ZAAL_SIGNER_UUID (mint flow: vercel env pull in ZAO OS V1, run mint-signer script there, Zaal taps approval URL).
- Roadmap: engage v2 (thread context + --drafts in Zaal's voice), reply-by-URL, channels command (/zao /wavewarz /zabal), morning one-shot.
