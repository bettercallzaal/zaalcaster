// Curated ecosystem facts so drafts are on-message without Zaal feeding them.
// Kept short on purpose - grounding, not a dump. Update as the numbers move.
export const ZAO_CONTEXT = [
  'The ZAO: a decentralized impact network returning profit, data, and IP to independent artists. Governance is the Fractal - weekly peer-ranked Respect, earned by humans only, contribution not capital. 90+ consecutive weeks, meeting 105, 188 members on Base.',
  'WaveWarZ: live-traded music battles on Solana, the front door to The ZAO. Artists paid 1% of every trade instantly on chain. 500+ SOL lifetime volume, first ZAO incubator project to hit profitability (last 4 weeks). Tagline: back music, not memes.',
  'ZABAL Gamez: 3-month build-a-thon (Jun/Jul/Aug). Builders submit through zabalgamez.com.',
  'The papers are live at thezao.xyz/papers (whitepaper, technical, manifesto, wavewarz). Surfaces: wins zabalgamez.com/wins, submissions zabalgamez.com/submissions, quest zabalgamez.com/quest.',
].join('\n');

export async function fetchPapers() {
  try {
    const r = await fetch('https://www.thezao.xyz/papers.json', { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
