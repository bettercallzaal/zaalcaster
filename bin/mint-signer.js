#!/usr/bin/env node

// Mint a Neynar managed signer for @zaal and store ZAAL_SIGNER_UUID in the creds file.
//
// Flow (Neynar managed signers):
//   0. Preflight: the app wallet (APP_SIGNER_PRIVATE_KEY) must own its own app FID on
//      Optimism - the SignedKeyRequest signature is verified against the custody address
//      of app_fid. Note the ZAO OS vercel env sets APP_FID=19640 (Zaal's fid), which the
//      app wallet does NOT custody, so that value is ignored; the real app fid is read
//      from IdRegistry.idOf(appWallet). If the wallet has no FID yet, fund it with ~$3
//      ETH on Optimism and run with --register-app-fid (one-time onchain registration).
//   1. POST /v2/farcaster/signer                -> signer_uuid + ed25519 public_key
//   2. Sign EIP-712 SignedKeyRequest with the app wallet
//   3. POST /v2/farcaster/signer/signed_key     -> signer_approval_url
//   4. Zaal taps the approval URL in the Farcaster app
//   5. Poll GET /v2/farcaster/signer            -> status approved
//   6. Write ZAAL_SIGNER_UUID into ~/.zao/private/farcaster-zaal.env (value never printed)
//
// Env sources:
//   ~/.zao/private/farcaster-zaal.env           NEYNAR_API_KEY (+ existing ZAAL_* keys)
//   $ZAO_OS_DIR/.env.local                      APP_SIGNER_PRIVATE_KEY
//     (default ZAO_OS_DIR: ~/Documents/ZAO OS V1; refresh with `vercel env pull .env.local`)
//
// viem is borrowed from ZAO OS V1's node_modules so zaalcaster stays dependency-free.
//
// A pending mint is resumable: the signer_uuid is parked in
// ~/.zao/private/farcaster-zaal-signer-pending until approval, so rerunning after a
// timeout polls the same signer instead of minting a new one.
//
// Contract addresses verified against docs.farcaster.xyz/reference/contracts/deployments
// on 2026-07-04.
//
// Usage: node bin/mint-signer.js [--dry-run] [--register-app-fid]
//   --dry-run           validate env files + viem + app wallet + onchain fid, no writes
//   --register-app-fid  spend gas once to register an app FID for the app wallet

import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'

const HOME = process.env.HOME
const CREDS_PATH = path.join(HOME, '.zao/private/farcaster-zaal.env')
const PENDING_PATH = path.join(HOME, '.zao/private/farcaster-zaal-signer-pending')
const ZAO_OS_DIR = process.env.ZAO_OS_DIR || path.join(HOME, 'Documents', 'ZAO OS V1')
const NEYNAR_BASE = 'https://api.neynar.com/v2/farcaster'
const OP_RPC_URL = process.env.OP_RPC_URL || 'https://mainnet.optimism.io'
const SIGNED_KEY_REQUEST_VALIDATOR = '0x00000000FC700472606ED4fA22623Acf62c60553'
const ID_REGISTRY = '0x00000000Fc6c5F01Fc30151999387Bb99A9f489b'
const ID_GATEWAY = '0x00000000Fc25870C6eD6b6c7E41Fb078b7656f69'
const POLL_INTERVAL_MS = 5000
const POLL_TIMEOUT_MS = 15 * 60 * 1000

const ID_REGISTRY_ABI = [
  { type: 'function', name: 'idOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: 'fid', type: 'uint256' }] },
]
const ID_GATEWAY_ABI = [
  { type: 'function', name: 'price', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'register', stateMutability: 'payable', inputs: [{ name: 'recovery', type: 'address' }], outputs: [{ name: 'fid', type: 'uint256' }, { name: 'overpayment', type: 'uint256' }] },
]

function fail(msg) {
  console.error(`Error: ${msg}`)
  process.exit(1)
}

function parseEnvFile(filePath, label) {
  if (!fs.existsSync(filePath)) fail(`missing ${label} at ${filePath}`)
  const env = {}
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const [key, ...rest] = trimmed.split('=')
    // vercel env pull quotes values; strip one layer of quotes
    env[key] = rest.join('=').replace(/^"(.*)"$/, '$1')
  }
  return env
}

async function loadViem() {
  const req = createRequire(path.join(ZAO_OS_DIR, 'package.json'))
  const resolve = (spec) => {
    try {
      return pathToFileURL(req.resolve(spec)).href
    } catch {
      fail(`cannot resolve ${spec} from ${ZAO_OS_DIR}/node_modules - run npm install there or set ZAO_OS_DIR`)
    }
  }
  const [core, accounts, chains] = await Promise.all([
    import(resolve('viem')),
    import(resolve('viem/accounts')),
    import(resolve('viem/chains')),
  ])
  return { ...core, ...accounts, optimism: chains.optimism }
}

async function neynar(apiKey, endpoint, options = {}) {
  const res = await fetch(`${NEYNAR_BASE}${endpoint}`, {
    ...options,
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(15000),
  })
  const body = await res.text()
  if (!res.ok) fail(`Neynar ${endpoint} returned ${res.status}: ${body.slice(0, 300)}`)
  return JSON.parse(body)
}

function saveSignerUuid(uuid) {
  const content = fs.readFileSync(CREDS_PATH, 'utf-8')
  const line = `ZAAL_SIGNER_UUID=${uuid}`
  let updated
  if (/^ZAAL_SIGNER_UUID=/m.test(content)) {
    updated = content.replace(/^ZAAL_SIGNER_UUID=.*$/m, line)
  } else {
    updated = content.replace(/\n*$/, '\n') + line + '\n'
  }
  fs.writeFileSync(CREDS_PATH, updated, { mode: 0o600 })
}

async function pollUntilApproved(apiKey, signerUuid) {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const status = await neynar(apiKey, `/signer?signer_uuid=${signerUuid}`)
    if (status.status === 'approved') return status
    process.stderr.write('.')
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  return null
}

async function ensureAppFid(viem, appAccount, registerRequested, dryRun) {
  const client = viem.createPublicClient({ chain: viem.optimism, transport: viem.http(OP_RPC_URL) })
  const fid = await client.readContract({
    address: ID_REGISTRY,
    abi: ID_REGISTRY_ABI,
    functionName: 'idOf',
    args: [appAccount.address],
  })
  if (fid > 0n) return Number(fid)

  const [price, balance] = await Promise.all([
    client.readContract({ address: ID_GATEWAY, abi: ID_GATEWAY_ABI, functionName: 'price' }),
    client.getBalance({ address: appAccount.address }),
  ])
  const fmt = (wei) => `${Number(wei) / 1e18} ETH`
  console.log(`App wallet ${appAccount.address} owns no FID on Optimism.`)
  console.log(`  registration price: ${fmt(price)}, wallet balance: ${fmt(balance)}`)

  if (dryRun) return null
  if (!registerRequested) {
    fail(
      'app wallet needs its own FID before it can sign key requests.\n' +
      `Fund ${appAccount.address} with ~$3 ETH on Optimism, then rerun with --register-app-fid`,
    )
  }
  // register costs price + gas; leave 20% headroom for gas
  if (balance < (price * 12n) / 10n) {
    fail(`insufficient balance. Fund ${appAccount.address} on Optimism (need ~${fmt((price * 12n) / 10n)}), then rerun.`)
  }

  console.log('Registering app FID via IdGateway.register (one-time gas spend)...')
  const wallet = viem.createWalletClient({ account: appAccount, chain: viem.optimism, transport: viem.http(OP_RPC_URL) })
  const hash = await wallet.writeContract({
    address: ID_GATEWAY,
    abi: ID_GATEWAY_ABI,
    functionName: 'register',
    args: [appAccount.address],
    value: price,
  })
  console.log(`  tx: ${hash}`)
  await client.waitForTransactionReceipt({ hash })
  const newFid = await client.readContract({
    address: ID_REGISTRY,
    abi: ID_REGISTRY_ABI,
    functionName: 'idOf',
    args: [appAccount.address],
  })
  if (newFid === 0n) fail('registration tx confirmed but idOf still 0 - investigate before retrying')
  console.log(`  registered app FID ${newFid}`)
  return Number(newFid)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const registerRequested = process.argv.includes('--register-app-fid')

  const creds = parseEnvFile(CREDS_PATH, 'zaalcaster creds file')
  if (!creds.NEYNAR_API_KEY) fail(`NEYNAR_API_KEY missing in ${CREDS_PATH}`)
  if (!creds.ZAAL_FID) fail(`ZAAL_FID missing in ${CREDS_PATH}`)

  const zaoEnv = parseEnvFile(path.join(ZAO_OS_DIR, '.env.local'), 'ZAO OS V1 .env.local (run: vercel env pull .env.local)')
  if (!zaoEnv.APP_SIGNER_PRIVATE_KEY) fail('APP_SIGNER_PRIVATE_KEY missing in ZAO OS V1 .env.local')

  const viem = await loadViem()
  const appAccount = viem.privateKeyToAccount(zaoEnv.APP_SIGNER_PRIVATE_KEY)
  const appFid = await ensureAppFid(viem, appAccount, registerRequested, dryRun)

  if (dryRun) {
    console.log('Dry run OK:')
    console.log(`  creds file: ${CREDS_PATH} (NEYNAR_API_KEY present, ZAAL_FID=${creds.ZAAL_FID})`)
    console.log(`  signer already set: ${creds.ZAAL_SIGNER_UUID ? 'yes' : 'no'}`)
    console.log(`  app wallet: ${appAccount.address}, app fid: ${appFid ?? 'NONE - fund wallet + --register-app-fid'}`)
    console.log('  viem resolved from ZAO OS V1')
    return
  }

  // Already approved? Nothing to do.
  if (creds.ZAAL_SIGNER_UUID) {
    const status = await neynar(creds.NEYNAR_API_KEY, `/signer?signer_uuid=${creds.ZAAL_SIGNER_UUID}`)
    if (status.status === 'approved') {
      console.log('ZAAL_SIGNER_UUID already set and approved. Nothing to do.')
      return
    }
    console.log(`Existing signer status: ${status.status} - minting fresh one.`)
  }

  // Get or create the signer, then drive it to pending_approval regardless of the
  // state a previous run left it in (generated = created but signed_key not yet done).
  let signerUuid
  let status
  if (fs.existsSync(PENDING_PATH)) {
    signerUuid = fs.readFileSync(PENDING_PATH, 'utf-8').trim()
    console.log('Resuming pending signer (uuid on file, not shown).')
    status = await neynar(creds.NEYNAR_API_KEY, `/signer?signer_uuid=${signerUuid}`)
  } else {
    console.log('Creating managed signer...')
    status = await neynar(creds.NEYNAR_API_KEY, '/signer', { method: 'POST' })
    if (!status.signer_uuid || !status.public_key) fail('signer create returned incomplete data')
    signerUuid = status.signer_uuid
    fs.writeFileSync(PENDING_PATH, signerUuid + '\n', { mode: 0o600 })
  }

  if (status.status === 'generated') {
    const deadline = Math.floor(Date.now() / 1000) + 86400
    const signature = await appAccount.signTypedData({
      domain: {
        name: 'Farcaster SignedKeyRequestValidator',
        version: '1',
        chainId: 10,
        verifyingContract: SIGNED_KEY_REQUEST_VALIDATOR,
      },
      types: {
        SignedKeyRequest: [
          { name: 'requestFid', type: 'uint256' },
          { name: 'key', type: 'bytes' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'SignedKeyRequest',
      message: {
        requestFid: BigInt(appFid),
        key: status.public_key,
        deadline: BigInt(deadline),
      },
    })

    console.log('Registering signed key...')
    status = await neynar(creds.NEYNAR_API_KEY, '/signer/signed_key', {
      method: 'POST',
      body: JSON.stringify({
        signer_uuid: signerUuid,
        app_fid: appFid,
        deadline,
        signature,
      }),
    })
  }

  if (status.status !== 'approved') {
    if (!status.signer_approval_url) fail(`signer in state '${status.status}' with no approval URL - delete ${PENDING_PATH} to start over`)
    console.log(`Approval URL (open on phone with @zaal account):\n\n  ${status.signer_approval_url}\n`)
  }

  console.log('Polling for approval (up to 15 min, rerun to resume)...')
  const approved = await pollUntilApproved(creds.NEYNAR_API_KEY, signerUuid)
  if (!approved) {
    console.log('\nNot approved yet. Rerun this script after tapping the URL - it resumes the same signer.')
    process.exit(2)
  }

  saveSignerUuid(signerUuid)
  fs.rmSync(PENDING_PATH, { force: true })
  console.log(`\nApproved (fid ${approved.fid}). ZAAL_SIGNER_UUID saved to ${CREDS_PATH} (value not shown).`)
  console.log('Posting is now unblocked. Test with: npm run post -- "text" (after Zaal approves the text).')
}

main().catch((e) => {
  console.error('mint-signer failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
