# $zaalcaster Token Configuration Proposal

## Status

Decision document. Awaiting Zaal confirmation. NO on-chain deployment until confirmed.

## Token Basics

| Parameter | Value | Notes |
|-----------|-------|-------|
| Name | zaalcaster | |
| Symbol | $ZAALCASTER | |
| Decimals | 18 | Standard ERC-20 |
| Chain | Base (8453) | Primary chain; Clanker v5 default |
| Standard | ERC-20 + Burnable | Supports tip burn mechanism |

## Supply & Distribution

| Recipient | Amount | % | Vesting | Notes |
|-----------|--------|---|---------|-------|
| Zaal | 50% | 50% | Linear over 30 days | Signals alignment. No cliff dump. |
| Liquidity Pool | 35% | 35% | Immediate | Clanker DEX (0.5% fee default) |
| Airdrop / Early Access | 10% | 10% | On claim | TBD: who qualifies? |
| Reserved | 5% | 5% | Discretionary | Contributor rewards, partnerships |

**Total Initial Supply:** TBD on Zaal's call. Recommend 100M (easy math for price discovery).

## Tip Mechanics

| Parameter | Proposed | Notes |
|-----------|----------|-------|
| **Tip Split** | 50% burn / 50% to Zaal | Deflationary + revenue |
| **Minimum Tip** | 0.1 $ZAALCASTER | Prevents dust/spam. Confirm if higher is needed. |
| **Tip Submission** | Via zaalcaster web UI | User provides: Farcaster link + tip amount |
| **Tip Execution** | App-side (no on-chain per-tip) | Batch burns/sends weekly to avoid gas overhead |
| **Burn Process** | Weekly batch at Sunday 00:00 UTC | Transaction to dead address |
| **Payout Process** | Weekly batch at Sunday 06:00 UTC | Transfer 50% to Zaal's wallet |

## Stake Mechanics

| Parameter | Proposed | Notes |
|-----------|----------|-------|
| **Stake Token** | $zaalcaster (same token) | Holder balance at submission time |
| **Minimum Stake** | 0 | No minimum to hold, but larger holders rank higher (ties broken by tip) |
| **Stake Read** | On-chain via viem + RPC | Read at time of reply submission |
| **Stake Ranking Weight** | 0.6x | Stake counts 60% in priority; tip counts 40% |

**Proposal:** Zaal's judgment overrides the algorithm entirely. Stake + tip are INPUT signals, not automation.

## Ranking Algorithm (Frontend Priority Calculation)

```
priority = base_intent_score + (stake_value * 0.6) + (tip_amount * 0.4) + neynar_score_bonus + follow_bonus

Where:
  base_intent_score   = 2 (reply/mention) or 0 (quote)
  stake_value         = user's $zaalcaster balance in wei, normalized to 0-100
  tip_amount          = submitted tip in wei, normalized to 0-100
  neynar_score_bonus  = sender's neynar score * 3 (0-3 range)
  follow_bonus        = 2 (mutual follow) or 1 (followed by user) or 0
```

**Override:** Zaal can manually reorder the queue at any time. The algorithm is a suggestion, not law.

## Launch Rail

| Component | Status | Timeline |
|-----------|--------|----------|
| **Clanker v5 Token** | Pending | Deploy once v5 is live (Adrian's timeline ~Jul 28). OR deploy on current Clanker (v4) if v5 delays. |
| **Empire Builder Empire** | Documented | Leaderboards for stake tracking (already integrated via doc 1094a). |
| **zaalcaster Client** | Ready | Reply-list UI (stake + tip ranking, tip submission form) ships with token. |
| **Tip KV Store** | Development | Vercel KV or Upstash Redis for storing tips. Will be live at launch. |

**Decision: Launch on Monday (2026-07-13) if Clanker v5 not yet live, OR wait for v5 if it launches Friday/Saturday?**

Recommend: Launch Monday on current Clanker. Migrate to v5 when v5 is live (migration path TBD).

## Anti-Spam / Safety Guards

| Guard | Mechanism | Notes |
|-------|-----------|-------|
| **Min Tip Floor** | 0.1 $ZAALCASTER | Adjust up if dust submissions appear |
| **Rate Limiting** | 1 tip per reply per user per 10 min | Prevents double-tip accidents |
| **Zaal's Judgment** | Manual override always available | The human stays in control |
| **No Promises** | Clearly documented: tips ≠ guarantee reply | People stake/tip at their own judgment |
| **Burn Irreversible** | 50% of tips burned to 0x000...dead | Supply reduction is permanent |

## Contract Addresses (Awaiting Deployment)

| Name | Address | Network | Notes |
|------|---------|---------|-------|
| $zaalcaster Token | TBD | Base | Deployed via Clanker v4 or v5 |
| Burn Address | 0x000...000 | Base | Weekly burn batches sent here |
| Zaal Wallet | TBD | Base | Receives 50% of tips weekly |

## Governance & Changes

**Who decides changes to this config?**

Zaal (single founder, no DAO initially). No voting. Config changes documented in zaalcaster PRs + research docs.

**When can config change?**

- Anti-spam thresholds (min tip, rate limits) - anytime, no notice
- Tip split (50/50 current) - after 30 days, review with community
- Vesting schedule - locked for month 1, reviewable after
- Ranking algorithm weights - may adjust based on spam patterns

**No breaking changes without notice.** If tip split changes from 50/50, Zaal announces it 2 weeks before.

## Success Metrics

At launch + 30 days post-launch, track:

| Metric | Target | Notes |
|--------|--------|-------|
| Token holders | 50+ | Initial community |
| Weekly tips submitted | 20+ | Activity signal |
| $zaalcaster burned | 10-50k tokens | Deflation + revenue |
| Zaal's vested amount | ~50% of total supply | On-track for month 1 vest |
| Reply queue signal/noise ratio | Qualitative | Are tips highlighting good content? |

## Honest Unknowns

1. **Clanker v5 fee hook support** - if v5 has native 50/50 burn/send on fee logic, use it. Otherwise, implement app-side (less efficient but simpler to audit).
2. **Tip data permanence** - are tips queryable on-chain or only in app logs? Affects transparency.
3. **Treasury wallet permissions** - who can initiate the weekly burn/payout batches? Recommend a trusted multisig or Zaal's solo key (lowest latency).
4. **Airdrop mechanics** - which addresses qualify for the 10% airdrop? ZAO members? Farcaster follower list snapshot? TBD.

## Next Actions

| Action | Owner | Type | By When |
|--------|-------|------|---------|
| **Confirm supply & vesting** | Zaal | Decision | 2026-07-16 |
| **Confirm tip split & floors** | Zaal | Decision | 2026-07-16 |
| **Confirm launch timing (v4 vs v5)** | Zaal + Adrian | Decision | 2026-07-17 |
| **Lock contract addresses** | Zaal | Deployment | 2026-07-17 |
| **Deploy token on-chain** | Zaal | Deployment | 2026-07-17 |
| **Update zaalcaster .env.example** | @zaal | Config | 2026-07-17 |

## Appendix: Source Docs

- [Doc 988 - Token Launch Plan](./research/business/988-zaalcaster-token-launch-plan/)
- [Doc 1094a - Empire Builder API](./research/farcaster/1094-empire-builder-clanker-farcaster-deep-dive-jul14/1094a-empire-builder-write-api-catalog/)
- [Clanker Docs](https://clanker.world)
- [Empire Builder Leaderboards](https://empire-builder.gitbook.io)
