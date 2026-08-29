# DayOne

**Proof of who backed you first — and payouts that actually reach them.**

Built at Monad Blitz New Delhi V4.

---

## The problem

Being early to something is worth a lot, and right now it is worth nothing.

You followed the creator at 400 followers. You were in the Discord before the token. You showed up to the first meetup. All you have is a screenshot — unverifiable, and worth nothing to anyone.

Crypto's answer is the airdrop, and airdrops are structurally broken: **they make you come and claim.** A team snapshots who was early, builds a Merkle tree, deploys a claim page — and most recipients never show up. Money sits unclaimed indefinitely.

That is not a UX failure. It is an economics one. **Paying 500 people directly on Ethereum costs more than the payout**, so pull-based distribution was the only affordable design. Every claim page in existence is a workaround for expensive settlement.

## What DayOne does

1. A creator, project or event **opens a registry**.
2. People **tap one link** — their address, the exact moment they arrived, and their rank are written on chain.
3. The owner **funds the registry** and presses one button.
4. The contract **splits the pot by cohort** and sends it directly to every supporter's wallet.

Cohorts are seat rows:

| Cohort | Ranks | Weight |
|---|---|---|
| Row 1 | 1 – 10 | 3× |
| Row 2 | 11 – 60 | 2× |
| Row 3 | 61+ | 1× |

Nobody claims anything. Nobody has to be online. The money simply arrives.

## Why this needs Monad

On Ethereum, paying 500 people individually costs more than the payout — which is the **only** reason airdrops are claim-based.

At 400 ms blocks and near-zero fees, hundreds of direct transfers cost cents and land in seconds. **The claim step stops existing.** That is a change in product design, not a benchmark number.

## Live

| | |
|---|---|
| **Contract** | `0x...` *(Monad Testnet, chain ID 10143)* |
| **App** | `https://...` |
| **Explorer** | `https://testnet.monadvision.com/address/0x...` |

## How the contract works

```
openRegistry(name)              → create a registry
rotateCode(id, hash)            → set the current join code (rotates every 30s)
join(id, code, handle)          → record address + timestamp + rank
fund(id) payable                → move money into the contract
freeze(id)                      → lock ranks, fix each cohort's share
payout(id, batchSize)           → pay the next batch directly
claimOwed()                     → fallback for addresses that could not receive
```

### Design decisions

**Freeze before paying.** If people could keep joining mid-payout, everyone's share would shift while the contract was spending. `freeze` locks the ranks and computes the per-weight unit once — the same reason a snapshot block exists in an airdrop. `payout` auto-freezes if the owner forgets.

**Batched payouts.** A block has a gas limit, so one transaction cannot pay unlimited people. `payout(id, batchSize)` walks a cursor, so batches can be fired concurrently and a failed batch resumes exactly where it stopped — nobody is paid twice.

**Push by default, pull as a fallback.** Transfers use a 2300 gas stipend so a recipient cannot re-enter the contract, and a failed transfer is recorded in `owed` instead of reverting. One address that cannot receive never blocks the other 199, and their money is still theirs via `claimOwed()`.

**Handles live in events, not storage.** The rank lives in contract state because the payout math needs it. The display name is emitted in the `Joined` event — permanently on chain, but without paying for storage the contract never computes on.

**A rotating join code.** Without a gate, anyone anywhere can take rank 1. The dashboard generates a new random code every 30 seconds and stores only its hash on chain; `join` requires the matching preimage. The contract accepts the current **and** previous hash, so a transaction submitted near a rotation boundary does not fail.

## Known limitations

Stated plainly, because they are real:

- **Sybil resistance.** One person with fifty wallets and fifty valid codes joins fifty times. The rotating code buys presence and blocks bots; it does not establish personhood. The right answer is one device, one join — and Monad has a native P256 precompile at `0x0100` (EIP-7951, 6900 gas), so a passkey signature from a Secure Enclave verifies on chain with no verifier library. That is the next version.
- **Codes are visible once used.** After the first join in a window, the plain code appears in that transaction's calldata. The window is short for exactly this reason. The proper fix is a creator-signed attestation bound to each joiner's address, verified with `ecrecover`.
- **Handles are self-declared.** Anyone can type any name. Identity is the address; the handle is only a label.
- **Rank is confirmation order.** Inside a single 400 ms block, ordering is the chain's, not the user's. This is why rewards are cohort-based rather than a continuous curve — you need to be in the right row, not win a millisecond race.
- **Demo signing key.** The dashboard signs with a local testnet key so payout batches can be fired concurrently without wallet popups. Testnet only, never a key holding real assets.
- **Dust.** Integer division leaves a remainder in the pot, recoverable by the owner after all batches complete.

## Next steps

- Passkey-gated joins via the P256 precompile — one device, one rank
- Creator-signed attestations instead of a shared rotating code
- Gasless joins through a relayer, so a supporter needs no balance
- Embedded wallets so someone without a wallet can still be on the list

## Stack

Solidity · Monad Testnet · React · Vite · viem

## Local development

```bash
git clone https://github.com/Phoenix1808/DayOne.git
cd DayOne/web
npm install
npm run dev
```

Create `web/.env`:

```
VITE_CONTRACT=0x...
VITE_DEMO_KEY=0x...      # testnet-only signing key for the dashboard
```

## Network

| | |
|---|---|
| Network | Monad Testnet |
| Chain ID | 10143 |
| RPC | `https://testnet-rpc.monad.xyz` |
| Explorer | `https://testnet.monadvision.com` |
| Faucet | `https://faucet.monad.xyz` |

## License

MIT
