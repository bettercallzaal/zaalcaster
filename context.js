// context.js - kept as a thin shim over config.js for backward compatibility.
// The grounding facts now live in config.js (config.context). Edit them there.

import { config } from './config.js'

export const ZAO_CONTEXT = config.context

export async function fetchPapers() {
  try {
    const r = await fetch('https://www.thezao.xyz/papers.json', { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}
