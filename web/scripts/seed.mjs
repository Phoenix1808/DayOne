// Fills a registry with throwaway wallets so the payout demo works even if
// nobody in the room scans. Run from web/:
//
//   node scripts/seed.mjs <registryId> <count>

import { createPublicClient, createWalletClient, formatEther, http, parseEther, parseAbi } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'node:fs'

const [, , idArg, countArg] = process.argv
if (!idArg) {
  console.error('usage: node scripts/seed.mjs <registryId> [count]')
  process.exit(1)
}
const REGISTRY = BigInt(idArg)
const COUNT = Number(countArg || 100)

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const CONTRACT = env.VITE_CONTRACT
const GAS_PER_WALLET = parseEther('0.02')

const chain = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
}

const abi = parseAbi([
  'function join(uint256 id, string code, string handle)',
  'function setGateEnabled(uint256 id, bool enabled)',
  'function supporterCount(uint256 id) view returns (uint256)',
  'function registries(uint256) view returns (address owner, string name, uint64 openedAt, bool open, bool gateEnabled, bytes32 codeHash, bytes32 prevCodeHash, uint256 pot, uint256 unit, uint256 paidOut)',
])

const publicClient = createPublicClient({ chain, transport: http() })
const payer = privateKeyToAccount(env.VITE_DEMO_KEY)
const payerWallet = createWalletClient({ account: payer, chain, transport: http() })

const NAMES = [
  'aarav', 'diya', 'vihaan', 'ananya', 'arjun', 'ishita', 'kabir', 'meera',
  'rohan', 'saanvi', 'dev', 'tara', 'yash', 'nikita', 'aman', 'priya',
  'raghav', 'zoya', 'kunal', 'riya',
]
const handleFor = (i) => `${NAMES[i % NAMES.length]}${Math.floor(i / NAMES.length) || ''}`

const reg = await publicClient.readContract({ address: CONTRACT, abi, functionName: 'registries', args: [REGISTRY] })
if (reg[0].toLowerCase() !== payer.address.toLowerCase()) {
  console.error(`registry #${REGISTRY} is owned by ${reg[0]}, not the demo wallet`)
  process.exit(1)
}
if (!reg[3]) {
  console.error(`registry #${REGISTRY} is already frozen`)
  process.exit(1)
}

const balance = await publicClient.getBalance({ address: payer.address })
const needed = GAS_PER_WALLET * BigInt(COUNT) + parseEther('0.5')
console.log(`payer     ${payer.address}`)
console.log(`balance   ${formatEther(balance)} MON`)
console.log(`needed    ~${formatEther(needed)} MON for ${COUNT} wallets`)
if (balance < needed) {
  console.error('not enough MON in the demo wallet')
  process.exit(1)
}

if (reg[4]) {
  console.log('\ndisabling the code gate for seeding…')
  const h = await payerWallet.writeContract({
    address: CONTRACT, abi, functionName: 'setGateEnabled', args: [REGISTRY, false], gas: 80_000n,
  })
  await publicClient.waitForTransactionReceipt({ hash: h })
}

const wallets = Array.from({ length: COUNT }, () => {
  const pk = generatePrivateKey()
  const account = privateKeyToAccount(pk)
  return { account, client: createWalletClient({ account, chain, transport: http() }) }
})

console.log(`\nfunding ${COUNT} wallets…`)
let t0 = Date.now()
let nonce = await publicClient.getTransactionCount({ address: payer.address })
const funding = await Promise.all(
  wallets.map((w, i) =>
    payerWallet
      .sendTransaction({ to: w.account.address, value: GAS_PER_WALLET, nonce: nonce + i, gas: 21_000n })
      .catch((e) => { console.warn(`  fund ${i} failed:`, e.shortMessage || e.message); return null }),
  ),
)
await Promise.all(funding.filter(Boolean).map((hash) => publicClient.waitForTransactionReceipt({ hash }).catch(() => null)))
console.log(`  funded in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

console.log(`\njoining ${COUNT} wallets…`)
t0 = Date.now()
const joins = await Promise.all(
  wallets.map((w, i) =>
    w.client
      .writeContract({
        address: CONTRACT, abi, functionName: 'join',
        args: [REGISTRY, '', handleFor(i)], nonce: 0, gas: 200_000n,
      })
      .catch((e) => { console.warn(`  join ${i} failed:`, e.shortMessage || e.message); return null }),
  ),
)
await Promise.all(joins.filter(Boolean).map((hash) => publicClient.waitForTransactionReceipt({ hash }).catch(() => null)))
console.log(`  joined in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

const total = await publicClient.readContract({ address: CONTRACT, abi, functionName: 'supporterCount', args: [REGISTRY] })
const left = await publicClient.getBalance({ address: payer.address })
console.log(`\nregistry #${REGISTRY} now has ${total} supporters`)
console.log(`payer has ${formatEther(left)} MON left`)
