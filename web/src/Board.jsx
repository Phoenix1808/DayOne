import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { createWalletClient, formatEther, http, keccak256, parseEther, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { dayOneAbi, friendlyError } from './abi'
import { CONTRACT, connect, explorerTx, monadTestnet, publicClient, rowOf, short } from './chain'

const LOG_CHUNK = 100n
const MAX_CHUNKS = 30

const BATCH = 20
const ROTATE_MS = 30_000

const payoutGas = (n) => BigInt(250_000 + n * 35_000)

const DEMO_KEY = import.meta.env.VITE_DEMO_KEY


const demoAccount = DEMO_KEY ? privateKeyToAccount(DEMO_KEY) : null
const demoWallet = demoAccount
  ? createWalletClient({ account: demoAccount, chain: monadTestnet, transport: http() })
  : null

const randomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase()

async function fetchJoins(registryId, fromBlock, toBlock) {
  const out = []
  let start = fromBlock
  let chunks = 0
  while (start <= toBlock && chunks < MAX_CHUNKS) {
    const end = start + LOG_CHUNK - 1n > toBlock ? toBlock : start + LOG_CHUNK - 1n
    const logs = await publicClient.getContractEvents({
      address: CONTRACT,
      abi: dayOneAbi,
      eventName: 'Joined',
      args: { id: registryId },
      fromBlock: start,
      toBlock: end,
    })
    out.push(...logs)
    start = end + 1n
    chunks++
  }
  return { logs: out, scannedTo: start - 1n }
}

export default function Board() {
  const [id, setId] = useState(
    () =>
      new URLSearchParams(window.location.search).get('id') ||
      localStorage.getItem('dayone.id') ||
      '',
  )
  const [registry, setRegistry] = useState(null)
  const [joins, setJoins] = useState([])
  const [code, setCode] = useState('')
  const [qr, setQr] = useState('')
  const [amount, setAmount] = useState('1')
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('Monad Blitz New Delhi V4')
  const [rotating, setRotating] = useState(false)
  const cursor = useRef(null)
  const handles = useRef(new Map())

  const rid = id ? BigInt(id) : null
  const joinUrl = rid
    ? `${window.location.origin}/?j=${id}&c=${code}`
    : ''
  const deepLink = joinUrl
    ? `https://metamask.app.link/dapp/${joinUrl.replace(/^https?:\/\//, '')}`
    : ''
 //live state tis is
  const refresh = useCallback(async () => {
    if (!rid) return
    try {
      const [reg, head, count, paidTo] = await Promise.all([
        publicClient.readContract({
          address: CONTRACT, abi: dayOneAbi, functionName: 'registries', args: [rid],
        }),
        publicClient.getBlockNumber(),
        publicClient.readContract({
          address: CONTRACT, abi: dayOneAbi, functionName: 'supporterCount', args: [rid],
        }),
        publicClient.readContract({
          address: CONTRACT, abi: dayOneAbi, functionName: 'paidUpTo', args: [rid],
        }),
      ])
      setRegistry({
        owner: reg[0], name: reg[1], open: reg[3], gateEnabled: reg[4],
        pot: reg[7], unit: reg[8], paidOut: reg[9],
      })

      const n = Number(count)
      const paid = Number(paidTo)

      // the array is the source of truth; eth_getLogs here is capped at 100 blocks
      const rows = await Promise.all(
        Array.from({ length: n }, (_, i) =>
          publicClient.readContract({
            address: CONTRACT, abi: dayOneAbi, functionName: 'entries', args: [rid, BigInt(i)],
          }),
        ),
      )

      if (cursor.current === null) {
        const saved = localStorage.getItem(`dayone.block.${id}`)
        cursor.current = saved ? BigInt(saved) : head > 2000n ? head - 2000n : 0n
      }
      const { logs, scannedTo } = await fetchJoins(rid, cursor.current, head)
      cursor.current = scannedTo + 1n
      for (const l of logs) {
        if (l.args.handle) handles.current.set(Number(l.args.rank), l.args.handle)
      }

      setJoins(
        rows.map((e, i) => ({
          rank: i + 1,
          who: e[0],
          at: Number(e[1]),
          handle: handles.current.get(i + 1) || '',
          paid: i + 1 <= paid,
        })),
      )
    } catch (e) {
      //fallback to avoid blank board
      console.warn('refresh', e)
    }
  }, [rid])

  useEffect(() => {
    if (!rid) return
    refresh()
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [rid, refresh])


  const pushCode = useCallback(async (value) => {
    if (!rid || !demoWallet) return
    try {
      await demoWallet.writeContract({
        address: CONTRACT,
        abi: dayOneAbi,
        functionName: 'rotateCode',
        args: [rid, keccak256(toBytes(value))],
        gas: 70_000n,
      })
    } catch (e) {
      console.warn('rotateCode', e)
    }
  }, [rid])

  useEffect(() => {
    if (!rid) return
    const first = randomCode()
    setCode(first)
    pushCode(first)
  }, [rid, pushCode])

  useEffect(() => {
    if (!rid || !rotating) return
    const t = setInterval(() => {
      const next = randomCode()
      setCode(next)
      pushCode(next)
    }, ROTATE_MS)
    return () => clearInterval(t)
  }, [rid, rotating, pushCode])

  useEffect(() => {
    if (!deepLink) return setQr('')
    QRCode.toDataURL(deepLink, {
      width: 560, margin: 1,
      color: { dark: '#0F0E0C', light: '#E8B84B' },
    }).then(setQr).catch(() => setQr(''))
  }, [deepLink])


  async function withWallet(fn) {
    if (demoWallet) return fn(demoWallet, demoAccount.address)
    const { walletClient, address } = await connect()
    return fn(walletClient, address)
  }

  async function createRegistry() {
    setError(''); setBusy('create')
    try {
      await withWallet(async (wallet) => {
        const hash = await wallet.writeContract({
          address: CONTRACT, abi: dayOneAbi, functionName: 'openRegistry',
          args: [newName], gas: 200_000n,
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        const next = await publicClient.readContract({
          address: CONTRACT, abi: dayOneAbi, functionName: 'nextId',
        })
        const created = String(next - 1n)
        localStorage.setItem('dayone.id', created)
        localStorage.setItem(`dayone.block.${created}`, String(receipt.blockNumber))
        cursor.current = receipt.blockNumber
        handles.current = new Map()
        setJoins([])
        setId(created)
      })
    } catch (e) { setError(friendlyError(e)) }
    setBusy('')
  }

  async function fund() {
    setError(''); setBusy('fund')
    try {
      await withWallet(async (wallet, address) => {
        const value = parseEther(amount)
        await publicClient.simulateContract({
          address: CONTRACT, abi: dayOneAbi, functionName: 'fund',
          args: [rid], value, account: address,
        })
        const hash = await wallet.writeContract({
          address: CONTRACT, abi: dayOneAbi, functionName: 'fund',
          args: [rid], value, gas: 80_000n,
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('fund transaction reverted')
      })
      await refresh()
    } catch (e) { setError(friendlyError(e)) }
    setBusy('')
  }

  async function toggleGate() {
    setError(''); setBusy('gate')
    try {
      await withWallet(async (wallet) => {
        const hash = await wallet.writeContract({
          address: CONTRACT, abi: dayOneAbi, functionName: 'setGateEnabled',
          args: [rid, !registry.gateEnabled], gas: 80_000n,
        })
        await publicClient.waitForTransactionReceipt({ hash })
      })
      await refresh()
    } catch (e) { setError(friendlyError(e)) }
    setBusy('')
  }

  async function payEveryone() {
    setError(''); setBusy('pay')
    try {
      const [count, paid] = await Promise.all([
        publicClient.readContract({
          address: CONTRACT, abi: dayOneAbi, functionName: 'supporterCount', args: [rid],
        }),
        publicClient.readContract({
          address: CONTRACT, abi: dayOneAbi, functionName: 'paidUpTo', args: [rid],
        }),
      ])
      const remaining = Number(count) - Number(paid)
      if (remaining <= 0) throw new Error('NothingLeft')
      if (!registry || registry.pot === 0n) throw new Error('NotFunded')

      const batches = Math.ceil(remaining / BATCH)
      setProgress({ done: 0, total: remaining, batches })

      await withWallet(async (wallet, address) => {
        await publicClient.simulateContract({
          address: CONTRACT, abi: dayOneAbi, functionName: 'payout',
          args: [rid, BigInt(BATCH)], account: address,
        })

        // local nonce, otherwise the batches serialise
        const base = await publicClient.getTransactionCount({ address })
        const started = Date.now()

        const sent = await Promise.all(
          Array.from({ length: batches }, (_, k) =>
            wallet
              .writeContract({
                address: CONTRACT, abi: dayOneAbi, functionName: 'payout',
                args: [rid, BigInt(BATCH)],
                nonce: base + k,
                gas: payoutGas(BATCH),
              })
              .catch((e) => { console.warn('batch', k, e); return null }),
          ),
        )

        await Promise.all(
          sent.filter(Boolean).map((hash) =>
            publicClient.waitForTransactionReceipt({ hash }).catch(() => null),
          ),
        )

        // report what the chain actually did, not what we hoped it did
        const after = await publicClient.readContract({
          address: CONTRACT, abi: dayOneAbi, functionName: 'paidUpTo', args: [rid],
        })
        const done = Number(after) - Number(paid)
        setProgress({ done, total: remaining, batches, ms: Date.now() - started })
        if (done < remaining) {
          setError(`Only ${done} of ${remaining} were paid. Is the pot funded?`)
        }
      })

      await refresh()
    } catch (e) { setError(friendlyError(e)) }
    setBusy('')
  }


  if (!rid) {
    return (
      <div className="join-wrap">
        <div className="brand">
          <span className="eyebrow">Monad Testnet</span>
          <h1>DayOne</h1>
          <p>Open a registry to start.</p>
        </div>
        <div className="ticket">
          <div className="ticket-body">
            <label htmlFor="n">Registry name</label>
            <input id="n" type="text" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="btn" onClick={createRegistry} disabled={busy === 'create'}>
              {busy === 'create' ? <><span className="spinner" />Opening…</> : 'Open registry'}
            </button>
            {error && <div className="msg err">{error}</div>}
            {!demoWallet && (
              <p className="hint">
                No demo key set — this will use your wallet and prompt for every batch.
                Add <code>VITE_DEMO_KEY</code> to <code>web/.env</code> for the live demo.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  const rows = { 1: [], 2: [], 3: [] }
  for (const j of joins) rows[rowOf(j.rank)].push(j)

  return (
    <div className="board">
      <header className="board-head">
        <div>
          <span className="eyebrow">DayOne · Registry #{id}</span>
          <h1>{registry?.name || '…'}</h1>
        </div>
        <div className="head-stats">
          <div className="stat">
            <span className="n">{joins.length}</span>
            <span className="l">here</span>
          </div>
          <div className="stat">
            <span className="n">{registry ? Number(formatEther(registry.pot)).toFixed(2) : '0'}</span>
            <span className="l">MON in pot</span>
          </div>
          <div className="stat">
            <span className="n">{registry?.open ? 'OPEN' : 'FROZEN'}</span>
            <span className="l">status</span>
          </div>
        </div>
      </header>

      <div className="board-grid">
        <aside className="qr-panel">
          {qr ? <img src={qr} alt="Scan to join" className="qr" /> : <div className="qr ph" />}
          <div className="code-line">
            <span className="eyebrow">Code</span>
            <strong>{code || '—'}</strong>
          </div>

          <button
            className={`btn btn-ghost small${rotating ? ' on' : ''}`}
            onClick={() => setRotating((v) => !v)}
          >
            {rotating ? '● Rotating every 30s — stop' : 'Start 30s rotation'}
          </button>

          <p className="hint">
            {rotating
              ? 'A screenshot from a minute ago will not work.'
              : 'One fixed code. Turn rotation on for the live demo — each rotation is a transaction.'}
          </p>

          <div className="controls">
            <div className="fund-row">
              <input
                type="text" value={amount} onChange={(e) => setAmount(e.target.value)}
                aria-label="Amount in MON"
              />
              <button className="btn btn-ghost" onClick={fund} disabled={!!busy}>
                {busy === 'fund' ? '…' : 'Fund'}
              </button>
            </div>
            <p className="hint">
              Pot: {registry ? formatEther(registry.pot) : '0'} MON
            </p>

            <button className="btn pay" onClick={payEveryone} disabled={!!busy}>
              {busy === 'pay' ? <><span className="spinner" />Paying…</> : 'Pay everyone'}
            </button>

            <button className="btn btn-ghost small" onClick={toggleGate} disabled={!!busy}>
              {registry?.gateEnabled ? 'Disable code gate' : 'Enable code gate'}
            </button>

            <button
              className="btn btn-ghost small"
              onClick={() => {
                localStorage.removeItem('dayone.id')
                window.location.href = window.location.pathname
              }}
            >
              New registry
            </button>
          </div>

          {progress && (
            <div className="msg info">
              Paid {progress.done}/{progress.total} across {progress.batches} batch
              {progress.batches > 1 ? 'es' : ''}
              {progress.ms ? ` in ${(progress.ms / 1000).toFixed(1)}s` : '…'}
            </div>
          )}
          {error && <div className="msg err">{error}</div>}
        </aside>

        <main className="rows">
          {[1, 2, 3].map((r) => (
            <section key={r} className={`row-block row-${r}`}>
              <div className="row-head">
                <span>Row {r}</span>
                <span className="mult">{r === 1 ? '3×' : r === 2 ? '2×' : '1×'}</span>
                <span className="cnt">{rows[r].length}</span>
              </div>
              <ul className="flaps">
                {rows[r].length === 0 && <li className="flap empty">—</li>}
                {rows[r].map((j) => (
                  <li key={j.rank} className={`flap${j.paid ? ' paid' : ''}`}>
                    <span className="rk">{String(j.rank).padStart(3, '0')}</span>
                    <span className="nm">{j.handle || short(j.who)}</span>
                    <span className="st">{j.paid ? 'PAID' : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </main>
      </div>

      <footer className="board-foot">
        <span>Contract {short(CONTRACT)}</span>
        <span>Chain 10143 · 400ms blocks</span>
        {demoAccount && <span>Payer {short(demoAccount.address)}</span>}
      </footer>
    </div>
  )
}
