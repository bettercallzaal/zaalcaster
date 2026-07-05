# Contributing to zaalcaster

zaalcaster is a personal, single-user Farcaster client - a CLI + a web app +
a Space DJ extension, dependency-free (Node 20+ built-ins, vanilla JS). It is
built to be **forked** into your own `<username>caster`. Contributions that
make it a better base for everyone are welcome.

## Ways to contribute

- **Fork it into your own** (`ohnahji` -> `ohnahjicaster`). See the "Fork it"
  section of the README. If your fork adds something reusable, PR it back.
- **Fix a bug** in a shared surface (lib, api, the web client, the CLI).
- **Improve forkability** - anything still hardcoded that should read from
  `config.js` or an env var.
- **Docs** - clearer setup, screenshots, a better fork walkthrough.

## Ground rules

- **Dependency-free.** No npm packages - Node 20+ built-ins only. The whole
  point is that it stays tiny and auditable. (A web bundle may add browser
  libs, but the server/CLI stay zero-dep.)
- **No emojis, no em dashes** in code, comments, or commits. Plain hyphens.
- **Never commit secrets.** Keys/signers live in env vars or
  `~/.zao/private/`, never in the repo. `.gitignore` covers `*.env`.
- **Keep it forkable.** New identity/branding/voice goes in `config.js`, not
  sprinkled through the code. New secrets go in env vars (with a line in
  `.env.example`).
- **Vercel Hobby limits.** Keep `api/` at <= 12 serverless functions
  (consolidate with a query param) and no sub-daily `vercel.json` crons -
  exceeding either makes every deploy fail silently.

## Before you PR

1. `node --check` every changed `.js` file.
2. Run the thing you changed once (reads are safe; never post as a test).
3. Verify the web page still parses: extract the inline `<script>` and
   `node --check` it.
4. Open a PR against `main` with a clear title and what you verified.

## Layout

- `config.js` - the fork surface (edit this to make it yours)
- `lib.js` - Neynar v2 wrapper + env loader
- `voice.js` - AI draft generation (OpenRouter or claude CLI)
- `bin/*.js` - CLI commands (cockpit, engage, post, reply, spaces, ...)
- `api/*.js` - Vercel serverless functions (<= 12)
- `public/` - the web client (index.html) + Space DJ mixer (dj.html)
- `extension/` - the Space DJ Chrome extension

Thanks for building. Back music, not memes.
