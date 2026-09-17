// siwf.js - Sign In With Farcaster over Farcaster's own relay, dependency-free.
//
// WHY (2026-09-17): Neynar retired Sign In With Neynar. The first sign-in
// attempt on z.thezao.xyz showed "Sign In With Neynar has been retired. This
// app's developer needs to migrate to Neynar-managed signers." A managed
// signer is a WRITE key for the user, which a read-only guest never needs and
// which would put a second app-FID private key on the server. The relay is
// Farcaster's own sign-in (FIP-11): our server opens a channel, the user
// approves in their Farcaster app, the relay hands back the fid. No SDK.
//
// Probed live 2026-09-17: POST /v1/channel -> 201 { channelToken, url:
// https://farcaster.xyz/~/siwf?channelToken=..., nonce }; GET
// /v1/channel/status needs "Authorization: Bearer <channelToken>" (401
// without) and returns { state: 'pending' | 'completed', nonce, fid,
// username, custody, message, signature, signatureParams: { domain, ... } }.
//
// TRUST BOUNDARY, stated: we verify the nonce we issued, the domain, and
// that the relay says completed - over TLS to relay.farcaster.xyz. We do
// NOT recover the custody address from the SIWE signature (that needs
// secp256k1 recovery, which Node's crypto does not expose without a
// dependency). The relay only marks a channel completed after the user's
// wallet signed the exact message it generated, and the channelToken that
// reads that result is handed only to the browser that started the channel
// (bound by an HMAC ticket, see api/auth.js). Sessions are still role-split:
// only fid === owner gets write access; anyone else is read-only.

const RELAY = 'https://relay.farcaster.xyz/v1'
const TIMEOUT_MS = 10_000

export async function createChannel({ domain, siweUri }) {
  let res
  try {
    res = await fetch(`${RELAY}/channel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, siweUri }), signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    return { ok: false, status: 502, error: error?.name === 'TimeoutError' ? 'sign-in relay timed out' : 'could not reach the sign-in relay' }
  }
  if (!res.ok) return { ok: false, status: 502, error: `sign-in relay returned ${res.status}` }
  let json
  try { json = await res.json() } catch { return { ok: false, status: 502, error: 'sign-in relay returned invalid JSON' } }
  if (!json?.channelToken || !json?.url || !json?.nonce) return { ok: false, status: 502, error: 'sign-in relay response incomplete' }
  return { ok: true, channelToken: String(json.channelToken), url: String(json.url), nonce: String(json.nonce) }
}

export async function channelStatus(channelToken) {
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(String(channelToken || ''))) return { ok: false, status: 400, error: 'bad channel token' }
  let res
  try {
    res = await fetch(`${RELAY}/channel/status`, {
      headers: { Authorization: `Bearer ${channelToken}` }, signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    return { ok: false, status: 502, error: error?.name === 'TimeoutError' ? 'sign-in relay timed out' : 'could not reach the sign-in relay' }
  }
  if (res.status === 401) return { ok: false, status: 410, error: 'sign-in channel expired - start again' }
  if (!res.ok) return { ok: false, status: 502, error: `sign-in relay returned ${res.status}` }
  let json
  try { json = await res.json() } catch { return { ok: false, status: 502, error: 'sign-in relay returned invalid JSON' } }
  return { ok: true, data: json }
}

// Pure: the checks a completed channel must pass before a cookie is issued.
export function completedIsValid(data, { nonce, domain }) {
  if (!data || data.state !== 'completed') return { ok: false, error: 'not completed' }
  if (String(data.nonce || '') !== String(nonce)) return { ok: false, error: 'nonce mismatch' }
  const d = data.signatureParams?.domain
  if (String(d || '') !== String(domain)) return { ok: false, error: 'domain mismatch' }
  const fid = Number(data.fid)
  if (!Number.isFinite(fid) || fid <= 0) return { ok: false, error: 'no fid' }
  if (!data.message || !data.signature) return { ok: false, error: 'no signed message' }
  if (!String(data.message).includes(String(nonce)) || !String(data.message).includes(String(domain))) return { ok: false, error: 'message does not carry nonce + domain' }
  return { ok: true, fid, username: data.username || null }
}
