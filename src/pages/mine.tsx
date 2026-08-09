/**
 * Mine: one page, one signed-in account, and every chain this deployment can actually mine.
 *
 * micro-org#289. The owner's request was "a user can mine native EMBER — he should from the same
 * interface choose non-native coins and mine them from the browser through the pool", and the whole
 * design follows from taking "the same interface" literally. One picker, one Start, one hashrate,
 * one set of numbers. The two paths behind it could hardly be less alike — EMBER is Homefire against
 * the node with a signature this page holds the key for, and LTC is scrypt over Stratum with a
 * ticket this page must not keep — and none of that difference is the reader's problem.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── WHAT THIS PAGE PROMISES, AND WHAT IT REFUSES TO IMPLY ─────────────────────────────────────
 *
 * **Pool payouts do not exist.** `GET /v1/pool` says `payoutsImplemented: false` and this page says
 * it in words, at the top of the pool panel, before any number. Shares are counted, workers are
 * credited to an account, and NOTHING SPENDABLE ACCRUES FROM EITHER. A share count next to a
 * balance-shaped number would be read as money by everyone who saw it, and it would be false.
 *
 * **EMBER pays a key this tab holds, not the account's custodial balance.** This is the one place
 * the port could have quietly become a lie. `/mining/template` issues work to a public key and
 * `hearth/node/src/chain/header.js` `verifyPow` recovers the signer from a 65-byte signature over
 * the winning digest — so the coinbase can only be an address whose PRIVATE KEY is in this page.
 * The EMBER address on this account is custodial: micro-custody holds the key and releases it only
 * through a 24-hour ceremony with a second factor. There is therefore no way to mine EMBER into the
 * account balance from a browser, and pretending otherwise would send someone's electricity to an
 * address they cannot spend from. So the mining key is generated here, held in memory, shown, and
 * the reader is told to save it BEFORE the Start button, exactly as
 * `network-site/src/components/browsermine.tsx` does. Nothing is written to storage.
 *
 * **Every number on screen carries its unit and its window.** Hashes per second, shares, difficulty
 * as a bare ratio, seconds. The projection panel exists so the arithmetic is on the page rather
 * than in a footnote: what was measured, what it was divided by, and what that makes — so a reader
 * can check it against their own arithmetic and catch us being wrong.
 *
 * ── AND THE ONE URL IT WILL NOT CONSTRUCT ─────────────────────────────────────────────────────
 *
 * A pool chain is mineable if and only if `websocketEndpoint` is a string, and that string is used
 * verbatim. A chain without one is LISTED — the pool really does mine it and hiding it would be its
 * own small lie — with a plain sentence saying browser mining has not been published on this
 * deployment, and no Start button at all. Not a disabled one that looks broken, not one that opens
 * a socket to a guess. micro-org#285 is the defect where a plausible endpoint was derived from
 * `window.location` and published, and it cost somebody a day of debugging their own machine.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { emberMiningBase } from '../lib/hosts.ts'
import { loadPool, loadShares, loadWorkers, miningBlocker, type PoolChain, type PoolShare, type PoolSummary, type PoolWorker } from '../lib/pool.ts'
import { useResource } from '../lib/resource.ts'
import { hashesPerDifficulty } from '../lib/stratum.ts'
import { PoolMiner, type PoolMinerSnapshot } from '../mining/pool-miner.ts'

/** EMBER is not one of the pool's chains, so it gets an id that cannot collide with one. */
const EMBER = 'ember'

/** How often the credited-work panel re-reads the pool. See the comment on the effect. */
const CREDIT_POLL_MS = 30_000

export function MinePage() {
  const load = useCallback((signal: AbortSignal) => loadPool(signal), [])
  const { state, data, error, reload } = useResource(
    load,
    // One, always: EMBER is mineable whether or not the pool answered with any chains, so this
    // page is never the empty state. A pool that returned nothing is a pool panel that says so.
    () => 1,
    'We could not read what this deployment can mine.',
  )
  const [selected, setSelected] = useState<string>(EMBER)

  if (state === 'forbidden') return <Forbidden notice={error ?? undefined} />
  if (state === 'failed' && error) return <Failed notice={error} onRetry={reload} />
  if (state === 'loading' || !data) return <Loading label="Reading what this deployment can mine" />

  const chain = data.chains.find((candidate) => candidate.chain === selected) ?? null

  return (
    <>
      <header className="wt-page__head">
        <h1 className="wt-page__title">Mine</h1>
        <p className="wt-page__lede">
          Your browser does the proof-of-work, in this tab, on the cores you allow it. EMBER is
          mined directly against the network. Every other chain here is mined through the
          CloudsForge pool, which hands out work and counts the shares you return.
        </p>
      </header>

      <ChainPicker summary={data} selected={selected} onSelect={setSelected} />

      {selected === EMBER ? <EmberPanel /> : chain ? <PoolPanel chain={chain} summary={data} /> : null}
    </>
  )
}

/* ══════════════════════════════ the picker ══════════════════════════════ */

function ChainPicker({
  summary,
  selected,
  onSelect,
}: {
  summary: PoolSummary
  selected: string
  onSelect: (chain: string) => void
}) {
  return (
    <section className="wt-panel">
      <h2 className="wt-panel__title">Choose a chain</h2>
      <ul className="wt-rows wt-rows--choices" role="radiogroup" aria-label="Chain to mine">
        <li>
          <button
            type="button"
            role="radio"
            aria-checked={selected === EMBER}
            className={`wt-choice${selected === EMBER ? ' wt-choice--on' : ''}`}
            onClick={() => onSelect(EMBER)}
          >
            <span className="wt-choice__title">EMBER</span>
            <span className="wt-choice__sub">
              Mined directly against the CloudsForge network. No pool involved.
            </span>
          </button>
        </li>
        {summary.chains.map((chain) => (
          <li key={chain.chain}>
            <button
              type="button"
              role="radio"
              aria-checked={selected === chain.chain}
              className={`wt-choice${selected === chain.chain ? ' wt-choice--on' : ''}`}
              onClick={() => onSelect(chain.chain)}
            >
              <span className="wt-choice__title">
                {chain.name} <span className="cf-num">({chain.asset})</span>
              </span>
              <span className="wt-choice__sub">
                {chain.algorithm} through the pool
                {/*
                  Listed and honestly labelled rather than hidden, and labelled with WHICH of the
                  two reasons applies: one of them is an operator decision and the other is a node
                  catching up, and a reader deciding whether to come back tomorrow needs to know
                  which they are looking at.
                */}
                {miningBlocker(chain) === 'unpublished' ? ' · not available in a browser here' : ''}
                {miningBlocker(chain) === 'not-ready' ? ' · no work right now' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {summary.chains.length === 0 && (
        <p className="wt-note">
          The pool answered with no chains at all, so there is nothing to mine through it from here.
          EMBER above is unaffected — it does not go through the pool.
        </p>
      )}
    </section>
  )
}

/* ══════════════════════════════ pool mining ══════════════════════════════ */

function PoolPanel({ chain, summary }: { chain: PoolChain; summary: PoolSummary }) {
  const miner = useRef<PoolMiner | null>(null)
  const [snapshot, setSnapshot] = useState<PoolMinerSnapshot | null>(null)
  const [duty, setDuty] = useState(0.6)
  const [pauseOnBattery, setPauseOnBattery] = useState(true)
  const blocker = miningBlocker(chain)

  // A worker pool left running in a detached component keeps every core busy and there is no longer
  // anything on screen to turn it off. Switching chains unmounts this, so this is the stop.
  useEffect(() => () => miner.current?.stop(), [])
  useEffect(() => {
    miner.current?.stop()
    miner.current = null
    setSnapshot(null)
  }, [chain.chain])

  const toggle = useCallback(() => {
    if (miner.current?.running) {
      miner.current.stop()
      return
    }
    const instance = new PoolMiner({ chain, duty, pauseOnBattery, onChange: setSnapshot })
    miner.current = instance
    void instance.start()
  }, [chain, duty, pauseOnBattery])

  if (blocker !== null) {
    return (
      <section className="wt-panel">
        <h2 className="wt-panel__title">{chain.name}</h2>
        {/*
          The whole of the blocked state, in both of its flavours. NO Start control exists in either
          branch — a disabled button says "not now" and never says why, one pointed at an
          unpublished chain would have to invent an address, and one pointed at a chain with no
          template would spend a real ticket to earn a 503 on the upgrade.
        */}
        {blocker === 'unpublished' ? (
          <p className="wt-note">
            Browser mining has not been published on this deployment for {chain.name}. The pool mines{' '}
            {chain.name} and accepts shares for it, but the operator has not published a WebSocket
            address a browser can reach, so there is nothing for this page to connect to. This is a
            deployment setting, not a fault on your machine, and nothing here will start until it
            changes.
          </p>
        ) : (
          <p className="wt-note">
            The pool has no work for {chain.name} right now. Its {chain.name} node holds no block
            template — usually because the node is still downloading the chain and will not build on
            a history it has not finished reading. Nothing is wrong with your machine or your
            account, and this page will offer a Start button for {chain.asset} as soon as the pool
            has work to hand out.
          </p>
        )}
        <PoolFacts chain={chain} summary={summary} />
      </section>
    )
  }

  const running = snapshot !== null && snapshot.status !== 'stopped' && snapshot.status !== 'idle'

  return (
    <section className="wt-panel">
      <h2 className="wt-panel__title">{chain.name} through the pool</h2>

      {/*
        Before any number, in the contract's own words. A share count rendered next to a balance is
        read as money by everybody who sees it, and it would not be true.
      */}
      <p className={`wt-note${summary.payoutsImplemented ? '' : ' wt-note--caveat'}`}>
        {summary.payoutsImplemented
          ? 'This pool pays out. Shares you return are credited to your pool account.'
          : 'Payouts are not implemented. Shares and workers are credited to your account, and nothing spendable accrues yet — no balance, no payout, no claim. What you get from mining here today is a share count you can check, and nothing else.'}
      </p>

      <div className="wt-form__actions">
        <button type="button" className="cf-btn cf-btn--ember" onClick={toggle}>
          {running ? 'Stop mining' : `Start mining ${chain.asset}`}
        </button>
      </div>

      <Politeness
        duty={duty}
        onDuty={(value) => {
          setDuty(value)
          miner.current?.setDuty(value)
        }}
        pauseOnBattery={pauseOnBattery}
        onPauseOnBattery={(value) => {
          setPauseOnBattery(value)
          miner.current?.setPauseOnBattery(value)
        }}
        snapshot={snapshot}
      />

      {snapshot && <PoolNumbers chain={chain} snapshot={snapshot} summary={summary} />}
      <PoolFacts chain={chain} summary={summary} />
      {snapshot?.account && <Credited chain={chain.chain} account={snapshot.account} />}
    </section>
  )
}

/**
 * The measured numbers, each with its unit.
 *
 * `hashrate` is what THIS BROWSER computed, over a ten-second window; the pool's own estimate is
 * shown separately in `PoolFacts` and labelled as the pool's, because the two disagree by design.
 * The pool derives its figure from accepted shares, so for a browser that has not yet found one it
 * reads as zero — which is correct, and would be alarming if it were the only number on screen.
 */
function PoolNumbers({
  chain,
  snapshot,
  summary,
}: {
  chain: PoolChain
  snapshot: PoolMinerSnapshot
  summary: PoolSummary
}) {
  return (
    <>
      <p className={snapshot.status === 'failed' ? 'wt-note wt-note--caveat' : 'wt-note'}>
        <strong>{statusLabel(snapshot.status)}</strong>
        {snapshot.detail ? ` — ${snapshot.detail}` : ''}
      </p>
      <dl className="wt-facts">
        <Fact label="Hashrate, measured here" value={`${rate(snapshot.hashrate)}`} />
        <Fact label="Hashes computed this session" value={`${snapshot.hashes.toLocaleString('en')} hashes`} />
        <Fact label="Threads" value={`${snapshot.threads}`} />
        <Fact label="Share difficulty the pool set" value={`${snapshot.difficulty}`} />
        <Fact label="Shares accepted" value={`${snapshot.accepted}`} />
        <Fact label="Shares refused as stale" value={`${snapshot.stale}`} />
        <Fact label="Shares rejected" value={`${snapshot.rejected}`} />
        {snapshot.account && <Fact label="Pool account credited" value={snapshot.account} />}
        {snapshot.worker && <Fact label="Worker name" value={snapshot.worker} />}
      </dl>
      {snapshot.lastRejection && (
        <p className="wt-note wt-note--caveat">The pool's last refusal: {snapshot.lastRejection}</p>
      )}
      <Projection chain={chain} snapshot={snapshot} summary={summary} />
    </>
  )
}

/**
 * The projection, with its arithmetic on screen.
 *
 * Any projection a mining page shows is a claim about somebody's electricity, so this one is
 * written so a reader can check it and catch us being wrong. Every input is printed next to the
 * output, and the two things it is NOT are stated: it is not money — payouts are not implemented —
 * and it is not a prediction, because shares arrive on a Poisson process and the expected time to
 * the first one is also, roughly, the standard deviation of it.
 *
 * The arithmetic itself: a share at difficulty D takes D × (2^32 / 2^16) hashes on average for a
 * scrypt chain, which is `hashesPerDifficulty` — the same constant `pool/src/pow.ts` uses to
 * estimate a worker's rate from its shares, so the two sides of the estate agree about what a share
 * is worth. Divide by the measured rate and the answer is in seconds.
 */
function Projection({
  chain,
  snapshot,
  summary,
}: {
  chain: PoolChain
  snapshot: PoolMinerSnapshot
  summary: PoolSummary
}) {
  const perShare = hashesPerDifficulty(chain.algorithm) * snapshot.difficulty
  const seconds = snapshot.hashrate > 0 ? perShare / snapshot.hashrate : null

  return (
    <div className="wt-panel__sub">
      <h3>How long a share should take</h3>
      <p className="wt-prose">
        A share at difficulty <span className="cf-num">{snapshot.difficulty}</span> needs{' '}
        <span className="cf-num">{Math.round(perShare).toLocaleString('en')}</span> hashes on
        average — that is <span className="cf-num">{hashesPerDifficulty(chain.algorithm).toLocaleString('en')}</span>{' '}
        hashes per unit of difficulty for {chain.algorithm}, times the difficulty the pool set. At
        the <span className="cf-num">{rate(snapshot.hashrate)}</span> measured in this tab over the
        last ten seconds, that is{' '}
        <span className="cf-num">{seconds === null ? 'not yet measurable' : duration(seconds)}</span>{' '}
        per share on average.
      </p>
      <p className="wt-note">
        On average, and not a countdown: shares arrive at random, so half of them take longer than
        this and some take several times longer. Nothing above converts to {chain.asset} or to any
        other amount, because {summary.payoutsImplemented ? 'the conversion is billing’s, not this page’s' : 'this pool does not pay out yet'}.
      </p>
      {/*
        The honest comparison, on the page rather than in a footnote. The band is micro-pool's, from
        `pool/src/vardiff.ts`: a browser connection starts at 1,024 hashes per share and the floor is
        256, so that a tab returns a share about once a second instead of once an hour. Those are
        SMALL numbers on purpose, and a reader who knows what a difficulty usually looks like should
        be told why this one is a fraction before they conclude the page is broken.
      */}
      <p className="wt-note">
        That difficulty is a fraction because the pool sets a browser one deliberately: it starts a
        browser connection at <span className="cf-num">1,024 hashes</span> per share and will not ask
        for fewer than <span className="cf-num">256 hashes</span>, so a tab returns a share roughly
        every second rather than once an hour. It is not the network's difficulty, which is shown
        above as the pool reported it, and it is not a measure of how much work you are doing —
        that is the hashrate. A browser is between three and six orders of magnitude slower than
        purpose-built {chain.algorithm} hardware; this page is a way to take part and to watch the
        arithmetic, not a way to compete with a machine built for it.
      </p>
    </div>
  )
}

/** What the pool says about itself. Its numbers, labelled as its numbers. */
function PoolFacts({ chain, summary }: { chain: PoolChain; summary: PoolSummary }) {
  return (
    <dl className="wt-facts">
      <Fact label="Pool network" value={summary.network} />
      <Fact label="Algorithm" value={chain.algorithm} />
      <Fact
        label="Pool fee"
        value={`${(summary.feeBasisPoints / 100).toFixed(2)}% (${summary.feeBasisPoints} basis points)`}
      />
      <Fact label="Chain height the pool is building on" value={chain.height === null ? 'not known to the pool' : `${chain.height.toLocaleString('en')}`} />
      <Fact
        label="Network difficulty"
        value={chain.networkDifficulty === null ? 'not known to the pool' : chain.networkDifficulty.toLocaleString('en')}
      />
      <Fact
        label={`Pool hashrate, its own estimate over ${chain.windowSeconds} seconds`}
        value={rate(chain.hashrateEstimate)}
      />
      <Fact label={`Shares the pool saw in ${chain.windowSeconds} seconds`} value={`${chain.sharesInWindow}`} />
      <Fact label="Workers connected to the pool" value={`${chain.connections}`} />
      <Fact label="Payouts implemented" value={summary.payoutsImplemented ? 'yes' : 'no'} />
    </dl>
  )
}

/**
 * The work credited to this account, read from the PUBLIC routes with the pool's opaque account id.
 *
 * That id is not the estate user id — micro-pool mints its own, and both routes below take it as a
 * query parameter — so displaying it and putting it in a URL are both safe, which is precisely the
 * distinction that makes the ticket unsafe in both.
 *
 * Polled rather than pushed. The share arrives over the socket the miner already holds, but the
 * pool's OWN record of it is what this panel is for: it is the independent copy, and a page that
 * showed its own count as though it were the pool's would never be able to show a disagreement,
 * which is the one thing this panel is worth having for.
 */
function Credited({ chain, account }: { chain: string; account: string }) {
  const [shares, setShares] = useState<readonly PoolShare[] | null>(null)
  const [workers, setWorkers] = useState<readonly PoolWorker[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const read = () => {
      Promise.all([
        loadShares(chain, account, controller.signal),
        loadWorkers(chain, account, controller.signal),
      ])
        .then(([shareReply, workerReply]) => {
          if (controller.signal.aborted) return
          setShares(shareReply.shares)
          setWorkers(workerReply.workers)
          setFailed(false)
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true)
        })
    }
    read()
    const timer = setInterval(read, CREDIT_POLL_MS)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [chain, account])

  return (
    <div className="wt-panel__sub">
      <h3>What the pool has credited</h3>
      <p className="wt-note">
        Read back from the pool for account <span className="cf-num">{account}</span>, every{' '}
        {CREDIT_POLL_MS / 1000} seconds. This is the pool's own record, not this page's count, so a
        disagreement between the two is visible rather than hidden.
      </p>
      {failed && <p className="wt-note wt-note--caveat">The pool did not answer for that account.</p>}
      {workers && workers.length > 0 && (
        <ul className="wt-rows">
          {workers.map((worker) => (
            <li className="wt-row" key={worker.worker}>
              <span className="wt-row__main">
                <span className="wt-row__title cf-num">{worker.worker}</span>
                <span className="wt-row__sub cf-num">
                  {worker.sharesInWindow} shares in the window · pool estimate{' '}
                  {rate(worker.hashrateEstimate)}
                  {worker.difficulty === null ? '' : ` · difficulty ${worker.difficulty}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {shares && shares.length > 0 ? (
        <div className="wt-tablewrap">
          <table className="wt-table">
            <thead>
              <tr>
                <th scope="col">Share</th>
                <th scope="col">Height</th>
                <th scope="col">Credited at difficulty</th>
                <th scope="col">Difficulty achieved</th>
              </tr>
            </thead>
            <tbody>
              {shares.slice(0, 20).map((share) => (
                <tr key={share.id}>
                  <th scope="row" className="cf-num">
                    {share.worker}
                  </th>
                  <td className="cf-num">{share.height.toLocaleString('en')}</td>
                  <td className="cf-num">{share.creditedDifficulty}</td>
                  {/*
                    Both, deliberately. A digest that cleared its target by a wide margin is the only
                    evidence a miner has that the difficulty they were set is too low for them, and a
                    single "difficulty" column would have to choose which of the two to hide.
                  */}
                  <td className="cf-num">{share.achievedDifficulty.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="wt-note">
          No shares credited to this account yet. A share is only recorded once the pool has verified
          it, so the first one appears here shortly after this tab finds it.
        </p>
      )}
    </div>
  )
}

/* ══════════════════════════════ EMBER ══════════════════════════════ */

interface MiningKey {
  readonly priv: Uint8Array
  readonly pubHex: string
  readonly address: string
  readonly privHex: string
}

interface EmberHandle extends EventTarget {
  start(): Promise<void>
  stop(): void
  pauseOnBattery: boolean
  _applyDuty(): void
}

/**
 * EMBER, mined against the node, paid to a key this tab holds.
 *
 * See the file header for why the reward cannot go to the account's custodial EMBER address. The
 * warning is placed BEFORE the Start button rather than after it, which is the arrangement
 * `network-site/src/components/browsermine.tsx` settled on for the same reason: a key that is only
 * mentioned afterwards is a key somebody has already lost.
 */
function EmberPanel() {
  const [key, setKey] = useState<MiningKey | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [saved, setSaved] = useState(false)
  const [running, setRunning] = useState(false)
  const [hashrate, setHashrate] = useState(0)
  const [height, setHeight] = useState<number | null>(null)
  const [accepted, setAccepted] = useState<readonly { height: number }[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [duty, setDuty] = useState(0.6)
  const [pauseOnBattery, setPauseOnBattery] = useState(true)
  const miner = useRef<EmberHandle | null>(null)

  useEffect(() => () => miner.current?.stop(), [])

  const makeKey = useCallback(async () => {
    setNotice(null)
    try {
      const account = await import('../mining/account.js')
      setKey(account.generateKey())
      setSaved(false)
      setRevealed(false)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'that key could not be made')
    }
  }, [])

  const toggle = useCallback(async () => {
    if (running) {
      miner.current?.stop()
      return
    }
    if (!key) return
    setNotice(null)
    try {
      const { Miner } = await import('../mining/miner.js')
      const instance = new Miner({
        rpc: emberMiningBase(),
        key,
        duty,
        pauseOnBattery,
      }) as unknown as EmberHandle
      miner.current = instance
      instance.addEventListener('state', (event) =>
        setRunning(Boolean((event as CustomEvent).detail.running)),
      )
      instance.addEventListener('hashrate', (event) =>
        setHashrate((event as CustomEvent).detail.hashrate),
      )
      instance.addEventListener('template', (event) =>
        setHeight((event as CustomEvent).detail.height ?? null),
      )
      instance.addEventListener('accepted', (event) =>
        setAccepted((prev) => [(event as CustomEvent).detail, ...prev].slice(0, 8)),
      )
      instance.addEventListener('rejected', (event) =>
        setNotice(`the node refused a block: ${(event as CustomEvent).detail.err}`),
      )
      instance.addEventListener('error', (event) =>
        setNotice((event as CustomEvent).detail.message),
      )
      await instance.start()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'mining could not start')
    }
  }, [running, key, duty, pauseOnBattery])

  return (
    <section className="wt-panel">
      <h2 className="wt-panel__title">EMBER, mined against the network</h2>

      <p className="wt-note wt-note--caveat">
        The block reward goes to an address this tab holds the key to — not to the EMBER address on
        your CloudsForge account. EMBER's proof-of-work is signed by the key the coinbase pays, and
        your account's key is held in custody and is not released to a web page. So mining here pays
        the key below, and if you close this tab without saving it, anything paid to it is
        unreachable by anyone, including us.
      </p>

      {notice && <p className="wt-note wt-note--caveat">{notice}</p>}

      {key === null ? (
        <div className="wt-form__actions">
          <button type="button" className="cf-btn cf-btn--ember" onClick={() => void makeKey()}>
            Create a mining address
          </button>
        </div>
      ) : (
        <>
          <dl className="wt-facts">
            <Fact label="Paid to" value={key.address} />
          </dl>
          {revealed ? (
            <p className="wt-note">
              <span className="cf-num">{key.privHex}</span>
            </p>
          ) : (
            <div className="wt-form__actions">
              <button type="button" className="cf-btn" onClick={() => setRevealed(true)}>
                Show the private key
              </button>
            </div>
          )}
          <label className="wt-check">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>I have saved this private key somewhere I will still have tomorrow</span>
          </label>
          <div className="wt-form__actions">
            {/*
              The one disabled control on this page, and it is disabled by a checkbox the reader
              controls rather than by a deployment setting they cannot see — so it says "not yet"
              to somebody who can make it "yes" in one click.
            */}
            <button
              type="button"
              className="cf-btn cf-btn--ember"
              onClick={() => void toggle()}
              disabled={!saved && !running}
            >
              {running ? 'Stop mining' : 'Start mining EMBER'}
            </button>
          </div>
        </>
      )}

      <Politeness
        duty={duty}
        onDuty={(value) => {
          setDuty(value)
          // The EMBER miner reads `this.duty` live, so a running pool is retuned in place.
          const instance = miner.current as unknown as { duty?: number; _applyDuty?: () => void } | null
          if (instance) {
            instance.duty = value
            instance._applyDuty?.()
          }
        }}
        pauseOnBattery={pauseOnBattery}
        onPauseOnBattery={(value) => {
          setPauseOnBattery(value)
          if (miner.current) {
            miner.current.pauseOnBattery = value
            miner.current._applyDuty()
          }
        }}
        snapshot={null}
      />

      <dl className="wt-facts">
        <Fact label="Hashrate, measured here" value={rate(hashrate)} />
        <Fact label="Chain height being mined" value={height === null ? 'not read yet' : `${height.toLocaleString('en')}`} />
        <Fact label="Blocks this tab found" value={`${accepted.length}`} />
      </dl>

      <p className="wt-note">
        Work is re-read from the node every 45 seconds. A block found on work that has since been
        superseded is refused as stale, which is expected rather than a fault: somebody else reached
        that height first.
      </p>
    </section>
  )
}

/* ══════════════════════════════ shared bits ══════════════════════════════ */

/**
 * The two politeness controls, identical for both chains because the policy is.
 *
 * `snapshot` is the pool miner's, when there is one; the EMBER miner reports the same facts through
 * events and this panel simply does not show them for it, rather than showing a stale copy.
 */
function Politeness({
  duty,
  onDuty,
  pauseOnBattery,
  onPauseOnBattery,
  snapshot,
}: {
  duty: number
  onDuty: (value: number) => void
  pauseOnBattery: boolean
  onPauseOnBattery: (value: boolean) => void
  snapshot: PoolMinerSnapshot | null
}) {
  return (
    <div className="wt-panel__sub">
      <h3>How hard to work this machine</h3>
      <label className="wt-field">
        <span>
          Duty cycle: <span className="cf-num">{Math.round(duty * 100)}%</span> of the time hashing
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(duty * 100)}
          onChange={(event) => onDuty(Number(event.target.value) / 100)}
        />
      </label>
      <label className="wt-check">
        <input
          type="checkbox"
          checked={pauseOnBattery}
          onChange={(event) => onPauseOnBattery(event.target.checked)}
        />
        <span>Pause when this machine is on battery</span>
      </label>
      {snapshot && (
        <p className="wt-note">
          Hashing at <span className="cf-num">{Math.round(snapshot.effectiveDuty * 100)}%</span> right
          now.{' '}
          {snapshot.hidden
            ? 'This tab is in the background, so it is turned down to a trickle — the browser throttles background timers anyway, and fighting that burns power for very little hashing. '
            : ''}
          {snapshot.powerKnown
            ? snapshot.onPower
              ? 'This machine is on mains power.'
              : 'This machine is on battery.'
            : 'This browser will not say whether the machine is on battery, so mining runs normally. Firefox and Safari removed that API as a fingerprinting surface; we would rather say we could not check than imply we did.'}
        </p>
      )}
    </div>
  )
}

/**
 * One labelled number.
 *
 * A fragment rather than a wrapper element, because `.wt-facts` is a two-column grid over its dt
 * and dd children — a `<div>` around each pair would make every fact one grid cell and stack the
 * label on top of the value, which is not what any other panel in this app looks like.
 */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="cf-num">{value}</dd>
    </>
  )
}

/** Hashes per second, in the unit a reader can hold in their head. Ported from network-site. */
function rate(hashes: number): string {
  if (hashes >= 1_000_000) return `${(hashes / 1_000_000).toFixed(2)} MH/s`
  if (hashes >= 1_000) return `${(hashes / 1_000).toFixed(1)} kH/s`
  return `${Math.round(hashes)} H/s`
}

/** Seconds, in whatever unit keeps the number small enough to read. Always states which. */
function duration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'not measurable'
  if (seconds < 90) return `${seconds.toFixed(1)} seconds`
  if (seconds < 5_400) return `${(seconds / 60).toFixed(1)} minutes`
  if (seconds < 172_800) return `${(seconds / 3_600).toFixed(1)} hours`
  return `${(seconds / 86_400).toFixed(1)} days`
}

function statusLabel(status: PoolMinerSnapshot['status']): string {
  switch (status) {
    case 'idle':
      return 'Not started'
    case 'connecting':
      return 'Connecting to the pool'
    case 'mining':
      return 'Mining'
    case 'reconnecting':
      return 'Reconnecting'
    case 'stopped':
      return 'Stopped'
    case 'failed':
      return 'Stopped, and it will not start again on its own'
  }
}
