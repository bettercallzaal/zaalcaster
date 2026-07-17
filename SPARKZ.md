# SPARKZ

Energy-first creator coins on Farcaster. The coin is the last step, not the first.

## The idea in one paragraph

Every creator-coin platform today starts with the token and hopes a community shows up. SPARKZ inverts it: a creator starts with an idea and a tokenless empire - a leaderboard of real supporters doing real things (engaging, contributing, backing the work). That activity is energy, and it is measurable before a single token exists. Only when the energy is real does the token launch - and by then it is not a bet on hype, it is a receipt for a community that already showed up. We call the pitch to a fan "back the album," never "buy a coin."

## How it works (the stages)

**Stage 1 - Spark (live today, dogfooding on zaalcaster).** A creator walks a guided flow: capture the idea, name it, create a tokenless empire on Empire Builder, watch the energy checklist fill (supporters, engagement streaks, contributions), and prep - but never auto-fire - the launch. Rewards flow to early supporters WITHOUT a token: USDC boosts, bounties, recognition on the board. The ZABAL Gamez community is pilot zero.

**Stage 2 - Shared app (the unlock).** Other creators run the same flow through the SPARKZ app. Their empires, their communities, their energy - deploys relayed through the app's trusted-partner key. This is where SPARKZ becomes infrastructure instead of one person's tool.

**Stage 3 - Launch rail.** When a creator's energy sustains past threshold, the token launches through Clanker with the split the creator chose (a configurable launcher with smart defaults: community treasury, production fund, contributor rewards - an AI advisor suggests, the creator decides). Utility from day one: gated work, requests, recognition - never a promise of price.

## Why energy-first wins

- No dead coins: launch follows proof, so tokens arrive with holders who are already participants.
- No extraction optics: supporters earned in before there was anything to speculate on.
- Legally saner: nothing is promised to holders before or after launch except access and belonging (counsel-reviewed framing).
- It fits how Farcaster actually behaves: the network punishes pumps and rewards genuine communities.

## What SPARKZ runs on

Empire Builder is the engine room: tokenless empires, leaderboards, boosters, staking, and the launch relay. SPARKZ is a flow and a philosophy built on top of those rails. The pieces that matter most as this scales: multi-creator deploy relaying under a trusted-partner key model, attaching a launched token to an existing tokenless empire, and full booster lifecycle (add and remove) under documented signed-message contracts.

## The launch rail: 0xSplits-first

Clanker v4's fee split is immutable at launch. A split that must change later - add a collaborator, grow the leaderboard recipients, re-balance the treasury cut - needs to route through a 0xSplits contract whose controller can be updated, not through Clanker's native rewardBps directly.

Decision rule (from doc 1094b + doc 1098):
- **Fixed split, <= 7 recipients, only wallet swaps expected** - use Clanker native recipients (simpler, one contract, wallets are changeable, percentages are not).
- **Split must change** (re-balance %, add/remove collaborator, growing recipient set like a leaderboard) - deploy a 0xSplits contract first, set it as Clanker's sole rewardBps recipient, then update the Splits controller whenever the split evolves.

The Stage 1 wizard defaults to 0xSplits-first (it is always safe for a configurable product). The "energy checklist" framing for launch: "back the album, not a coin" - supporters backed this before the token existed, the coin is their receipt.

## Music-collab multi-split

A creator launching a collab track (multiple artists) uses the same Splits-first pattern: one Splits contract with all artists as recipients (percentages set at deploy), each artist's wallet admin-changeable, the total % locked. Clanker points at the single Splits address. Adding a late collaborator = update the Splits contract via its controller; no token redeploy, no lost adjustability.

The wizard's Step 5 should ask the creator: fixed solo split or collab (growing)? If collab, it explains the Splits-first path.

## Status

- Stage 1 wizard: built and live in this repo. 5 steps: idea -> name -> create empire -> build energy -> launch prep. Product-name-agnostic (config.productName = 'SPARKZ').
- Pilot zero: ZABAL Gamez tokenless empire + the Zooster supporter leaderboard (boostr by cashlessman.eth) - real supporters earning USDC for backing the community, no token anywhere.
- First creator cohort: musicians launching albums, not memecoins. The pitch is "back the album" - you backed this before the token existed.
- 0xSplits-first checklist: added to the launch prep overlay in Step 5 (doc 1098 + 1094b verified mechanics).
- AI advisor: not yet built. Intended to surface "enough energy" signal from the energy checklist (leaderboard count, booster queue size, streak length) and suggest a launch window. Zaal's trigger regardless.
- Boostr campaign as pilot zero: Boostr (cashlessman.eth) is the first booster - real on-chain USDC to ZABAL Gamez supporters before any token exists. This is the proof-of-concept for the whole energy-first model.

Built in public by BetterCallZaal in The ZAO ecosystem. The thesis in one line: contribution over capital - measure the energy, reward the people, and let the coin be the consequence.
