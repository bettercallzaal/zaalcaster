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
- lib.js - env loader + Neynar wrapper. Endpoints are /v2/farcaster/* (verified live 2026-07-04). Env loads from process.env FIRST (Vercel), then ~/.zao/private/farcaster-zaal.env (local CLI); throws (never process.exit) so serverless handlers can catch. Signer only required at post time; reads need only API key. resolveCast() takes hash or farcaster.xyz URL. getAnsweredParents() paginates Zaal's replies (3 pages / 150 casts). getUnansweredInbound() is the shared engage/cockpit/web work list.
- api/inbox.js + public/index.html + vercel.json - WEB COCKPIT (Vercel target so Zaal has a main client on any device). api/* are serverless functions reusing lib.js; frontend is dependency-free vanilla JS. Deploy: set NEYNAR_API_KEY, ZAAL_FID, ZAAL_SIGNER_UUID (+ OPENROUTER_API_KEY for drafts) in Vercel env vars, then push. Loop 1 shipped read-only inbox; drafts + send land next loops.
- voice.js - draft generation in Zaal's voice (shared): one batched call, OpenRouter if ~/.zao/private/openrouter.key exists else claude CLI, grounded in context.js. Never posts.
- bin/cockpit.js - THE FLAGSHIP: single-screen keyboard walk of unanswered inbound. [a] send draft (the press is the confirmation), [e] edit+confirm+send, [s] skip, [n] later, [q] quit. --dry disables sends entirely; no TTY degrades to read-only listing.
- bin/engage.js - print version of the same list; --context, --json, --all, --drafts (copy-ready reply commands, never posts)
- bin/morning.js - one-shot: engage + channels + timeline
- bin/thread.js - full conversation view (ancestors + nested replies) from hash or link
- bin/user.js - profile lookup (mutual follows, neynar score, --casts n)
- bin/channels.js - /zao /wavewarz /zabal (or any channel id)
- bin/mint-signer.js - full signer mint flow (see Known state)
- bin/timeline.js, notifs.js, search.js, post.js, reply.js (reply takes hash OR farcaster.xyz link)
- Farcaster link format: https://farcaster.xyz/<username>/<0x + first 8 hash chars>

## Known state (2026-07-04, afternoon)
- Reads WORK. POSTING UNBLOCKED: ZAAL_SIGNER_UUID approved for fid 19640 (minted via the zolbot account as app FID by the assistant terminal; no ETH was needed). No cast has been posted yet - first post still needs Zaal's yes on exact text.
- mint-signer supports APP_SIGNER_PRIVATE_KEY/APP_SIGNER_MNEMONIC process-env overrides (how zolbot minted). The ZAO OS app wallet path (fund + --register-app-fid) remains as fallback documentation; ZAO OS's own /api/auth/signer route still has the custody-mismatch bug (APP_FID=19640 vs generated wallet).
- TWO terminals sometimes work this repo simultaneously (this one + the zolbot/assistant terminal). Always git pull + git status before branching; expect uncommitted drift.
- Commands: cockpit (flagship TUI), engage (context/json/filter/pagination/--drafts), channels (channel is an alias), reply-by-URL, thread, user, like/recast, morning, mint-signer, timeline, notifs, search, post (preview by default, --yes to send), reply (same).
- Flagship roadmap (Zaal 2026-07-04): COMPLETE. 1 cockpit TUI (#14), 2 thread-context drafts (#16), 3 channel dedupe (#12), 4 polish: cockpit --dry + voice examples - every [e]dited send appends (them -> zaal wrote) to ~/.zao/private/zaal-voice-examples.md (0600, never committed, VOICE_EXAMPLES_PATH overridable for tests); voice.js feeds the last 5 into the draft prompt so drafts learn his corrections.
- WEB roadmap (Zaal 2026-07-05, "main client he can push to vercel"): 1 foundation DONE - lib/voice env now process.env-compatible, api/inbox.js read endpoint + public/index.html shell + vercel.json, verified via mock handler (200, clean, no leak). NEXT: 2 /api/draft (OpenRouter drafts into the web view), 3 /api/send (reply with an explicit confirm step, never auto-post - the button press is Zaal's yes), 4 voice-example capture on web edits, 5 mobile polish. STILL UNPROVEN across both CLI and web: a real send has never fired - first live post is the key validation.
