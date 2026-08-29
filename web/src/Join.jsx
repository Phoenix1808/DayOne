import { useEffect, useState } from 'react'
import { parseEventLogs } from 'viem'
import { dayOneAbi, friendlyError } from './abi'
import {
  CONTRACT,
  connect,
  explorerTx,
  hasWallet,
  publicClient,
  rowOf,
  short,
} from './chain'

const ROW_LABEL = { 1: 'Row 1 · first ten', 2: 'Row 2 · next fifty', 3: 'Row 3' }


const JOIN_GAS = 220_000n

export default function Join({ registryId, code }) {
  const [registry, setRegistry] = useState(null)
  const [count, setCount] = useState(null)
  const [handle, setHandle] = useState('')
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null) 

  
  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const [reg, n] = await Promise.all([
          publicClient.readContract({
            address: CONTRACT,
            abi: dayOneAbi,
            functionName: 'registries',
            args: [registryId],
          }),
          publicClient.readContract({
            address: CONTRACT,
            abi: dayOneAbi,
            functionName: 'supporterCount',
            args: [registryId],
          }),
        ])
        if (!alive) return
        setRegistry({ name: reg[1], open: reg[3] })
        setCount(Number(n))
      } catch {
       
      }
    }
    load()
    const t = setInterval(load, 4000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [registryId])

  async function onJoin() {
    setError('')
    setPhase('working')
    try {
      const { address, walletClient } = await connect()

      const already = await publicClient.readContract({
        address: CONTRACT,
        abi: dayOneAbi,
        functionName: 'joined',
        args: [registryId, address],
      })
      if (already) {
        setResult({ address })
        setPhase('already')
        return
      }

      const hash = await walletClient.writeContract({
        address: CONTRACT,
        abi: dayOneAbi,
        functionName: 'join',
        args: [registryId, code, handle.trim().slice(0, 20)],
        gas: JOIN_GAS,
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      const [ev] = parseEventLogs({ abi: dayOneAbi, logs: receipt.logs, eventName: 'Joined' })

      setResult({ rank: Number(ev?.args?.rank ?? 0), hash, address })
      setPhase('done')
    } catch (err) {
      setError(friendlyError(err))
      setPhase('idle')
    }
  }

  const row = result?.rank ? rowOf(result.rank) : null

  return (
    <div className="join-wrap">
      <div className="brand">
        <span className="eyebrow">Monad Testnet</span>
        <h1>DayOne</h1>
        <p>Proof you were here first.</p>
      </div>

      <div className="ticket">
        <div className="ticket-head">
          <div>
            <span className="eyebrow">Registry #{String(registryId)}</span>
            <div className="who">{registry?.name || 'Loading…'}</div>
          </div>
          {count !== null && (
            <span className="pill">
              <span className="live-dot" />
              {count} in
            </span>
          )}
        </div>

        <div className="perf" />

        <div className="ticket-body">
          {phase === 'done' && (
            <>
              <div className="stamp">
                <div className="rank">
                  <small>#</small>
                  {result.rank}
                </div>
                <div className={`row-tag row-${row}`}>{ROW_LABEL[row]}</div>
              </div>
              <dl className="kv">
                <dt>Address</dt>
                <dd>{short(result.address)}</dd>
                <dt>Recorded</dt>
                <dd>on chain, permanently</dd>
                <dt>Receipt</dt>
                <dd>
                  <a href={explorerTx(result.hash)} target="_blank" rel="noreferrer">
                    view ↗
                  </a>
                </dd>
              </dl>
              <p className="hint">
                Nothing else to do. If this registry is funded, your share arrives in your
                wallet automatically — there is no claim page.
              </p>
            </>
          )}

          {phase === 'already' && (
            <>
              <div className="msg info">
                You&rsquo;re already on this list with {short(result.address)} — your rank is
                locked in. Nothing more to do.
              </div>
            </>
          )}

          {(phase === 'idle' || phase === 'working') && (
            <>
              <label htmlFor="handle">Your name (optional)</label>
              <input
                id="handle"
                type="text"
                value={handle}
                maxLength={20}
                placeholder="shows on the board"
                onChange={(e) => setHandle(e.target.value)}
                autoComplete="off"
              />

              <button className="btn" onClick={onJoin} disabled={phase === 'working'}>
                {phase === 'working' ? (
                  <>
                    <span className="spinner" />
                    Recording…
                  </>
                ) : (
                  "I'm here"
                )}
              </button>

              {registry && !registry.open && (
                <div className="msg info">
                  This list is closed — ranks are already locked.
                </div>
              )}

              {!hasWallet() && (
                <div className="msg info">
                  No wallet in this browser. Open this page inside the MetaMask app.
                </div>
              )}

              {error && <div className="msg err">{error}</div>}

              <p className="hint">
                One tap writes your address, the exact second, and your position in the queue
                to Monad. First ten count triple, next fifty double.
              </p>
            </>
          )}
        </div>
      </div>

      <p className="footer-note">Chain 10143 · {short(CONTRACT)}</p>
    </div>
  )
}
