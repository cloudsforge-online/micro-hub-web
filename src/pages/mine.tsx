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
 * **EMBER is PAID to a key this tab holds, and then sent on to the account's own custodial deposit
 * address.** This is the one place the port could have quietly become a lie, and until 2026-08-10
 * (micro-org#299) it was half a lie in the other direction. `/mining/template` issues work to a
 * public key and `hearth/node/src/chain/header.js` `verifyPow` recovers the signer from a 65-byte
 * signature over the winning digest — so the coinbase can only be an address whose PRIVATE KEY is in
 * this page, and micro-custody releases a key only through a 24-hour ceremony with a second factor.
 * Both of those are still true and neither bends. What was wrong was the conclusion drawn from them:
 * that the reward therefore had to STAY on the throwaway key, so the page showed the key, told the
 * reader to save it, and gated Start behind a checkbox — a self-custody problem handed to somebody
 * without warning, inside a custodial product, at the worst possible moment.
 *
 * The reward does not have to stay there. It has to be PAID there. One transaction later it can be
 * anywhere, and the account already has a place for it: the custodial EMBER deposit address wallet
 * mints from `POST /v1/deposits`, which the indexer already watches and `handleDepositConfirmed`
 * already books — after EMBER's 60 confirmations, which is also the orphan re-check. So this page
 * asks for that address, and on an accepted block sweeps the key's balance to it. `lib/embersweep.ts`
 * argues the whole design and names what it refuses to do. The old flow is still here, unchanged, as
 * the fallback for a session that has no such address: nothing is written to storage in either.
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
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import type { SweepOutcome } from '../lib/embersweep.ts'
import { loadPool, loadShares, loadWorkers, miningBlocker, type PoolChain, type PoolShare, type PoolSummary, type PoolWorker } from '../lib/pool.ts'
import { useResource } from '../lib/resource.ts'
import { hashesPerDifficulty } from '../lib/stratum.ts'
import type { PoolMinerSnapshot } from '../mining/pool-miner.ts'
import { useMining, type Swept } from '../mining/session.tsx'

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
  /*
   * The page opens on what it was ASKED for, then on whatever is already being mined, then EMBER.
   *
   * `?chain=` is read first because it is the bar's hand-off, and both halves of that hand-off need
   * it (micro-org#362): a press that STARTED EMBER navigates here to show the reader what is now
   * running, and a press that COULD NOT start it navigates here — as a real anchor — so they read
   * the self-custody screens. In the second case there is no session at all to infer a chain from,
   * so without the parameter the reader would arrive at the picker's default and, on a deployment
   * where that default is a pool chain, at a panel about the wrong one.
   *
   * The parameter is a chain ID and nothing else, and an unknown one falls through to EMBER rather
   * than to an empty panel: `chain` below is a lookup in the pool's own answer, so a value that is
   * not `ember` and not a chain the pool named selects nothing, which is the one state this page
   * has no rendering for.
   */
  const session = useMining()
  const [params] = useSearchParams()
  const [selected, setSelected] = useState<string>(() => {
    const asked = params.get('chain')
    if (asked !== null && asked !== '') return asked
    if (session.target === 'ember') return EMBER
    return session.chain?.chain ?? EMBER
  })

  if (state === 'forbidden') return <Forbidden notice={error ?? undefined} />
  if (state === 'failed' && error) return <Failed notice={error} onRetry={reload} />
  if (state === 'loading' || !data) return <Loading label="Reading what this deployment can mine" />

  const chain = data.chains.find((candidate) => candidate.chain === selected) ?? null
  // EMBER is the answer for "EMBER" and for anything the pool did not name — see `?chain=` above.
  // Normalised here rather than in the state so the picker's `aria-checked` cannot disagree with
  // the panel below it.
  const ember = selected === EMBER || chain === null

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

      <ChainPicker summary={data} selected={ember ? EMBER : selected} onSelect={setSelected} />

      {ember ? <EmberPanel /> : chain ? <PoolPanel chain={chain} summary={data} /> : null}
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

/**
 * One pool chain, and the controls for the session that mines it.
 *
 * ── THE MINER IS NOT OWNED HERE ANY MORE, AND THAT IS THE POINT ────────────────────────────────
 *
 * This panel used to hold a `PoolMiner` in a ref and stop it on unmount, which meant a session
 * ended the moment its reader looked at anything else. It now drives the one session
 * `mining/session.tsx` holds above the router — the same one the bar's control on every page is
 * showing and can stop. Nothing here stops it on unmount: leaving this page is not a decision to
 * stop mining, and there is now a control in the bar of the page they left for.
 *
 * `running` and the numbers are scoped to THIS chain rather than to the session, so a panel for a
 * chain that is not the one running shows its own idle state instead of somebody else's hashrate.
 * Starting from a second chain's panel switches the session over; `start()` stops the first.
 */
function PoolPanel({ chain, summary }: { chain: PoolChain; summary: PoolSummary }) {
  const session = useMining()
  const mine = session.chain?.chain === chain.chain
  const snapshot = mine ? session.snapshot : null
  const blocker = miningBlocker(chain)

  const toggle = useCallback(() => {
    if (mine && session.running) session.stop()
    else session.start(chain)
  }, [chain, mine, session])

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

  const running = mine && session.running

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

      {/*
        Both settings live on the SESSION rather than on this panel, so a duty cycle chosen here
        survives the navigation that used to end the session anyway, and applies to the miner the
        bar can start on any page.
      */}
      <Politeness
        duty={session.duty}
        onDuty={session.setDuty}
        pauseOnBattery={session.pauseOnBattery}
        onPauseOnBattery={session.setPauseOnBattery}
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

/**
 * EMBER, mined against the node, paid to a key this tab holds, and swept into the account.
 *
 * ── THE TWO MODES, AND WHY THE PAGE PICKS ONE RATHER THAN OFFERING BOTH ────────────────────────
 *
 * The reward is paid to the tab's key either way — that is consensus and it does not bend (file
 * header). What differs is what happens next, and it turns on a single question this page cannot
 * answer by itself: **does this account have a custodial EMBER deposit address the indexer is
 * already watching?** So it asks, once, on mount.
 *
 *   - **Yes** → the sweep mode. The key is generated but never displayed, nothing is asked of the
 *     reader, and each accepted block's balance is sent to that address, where the estate's ordinary
 *     deposit path credits it after 60 confirmations. Showing a private key that nobody needs would
 *     be inviting somebody to write down a bearer credential for no reason.
 *   - **No** → the old flow, unchanged: the key is shown, the reader is told to save it, and Start
 *     is gated behind a checkbox. `assignDepositAddress` failing, `watchedAt` being null — wallet's
 *     own note is "an unwatched address produces no events", so a sweep there would arrive on chain
 *     and never be credited — or the asset not being depositable all land here.
 *
 * The failing shape this avoids is a page that offers both and lets somebody start in the mode they
 * did not read the paragraph for. Whichever mode is active, its warning is placed BEFORE the Start
 * button, which is the arrangement `network-site/src/components/browsermine.tsx` settled on for the
 * same reason: a key that is only mentioned afterwards is a key somebody has already lost.
 *
 * ── AND THE ESCAPE HATCH, WHICH IS NOT DECORATION ──────────────────────────────────────────────
 *
 * A sweep can fail — the node refuses, the tab loses the network, the balance will not cover its own
 * fee. When one does, the reward is sitting on a key the reader has never seen, which is the very
 * situation this change exists to prevent. So the reveal control comes BACK, in sweep mode, the
 * moment a sweep has not landed: not as a warning up front that would undo the point, but as a
 * recovery path offered exactly when there is something to recover.
 *
 * ── AND NONE OF IT IS OWNED HERE ANY MORE (micro-org#362) ─────────────────────────────────────
 *
 * The miner, the throwaway key, the sweep queue and the custody answer all moved to
 * `mining/session.tsx`, for the same reason the pool miner did and then one more. The bar can now
 * start EMBER, so a miner scoped to this component would be a SECOND one: two `Miner`s grinding at
 * once, doubling the machine's load and racing two sweeps against one key's nonce, which is the
 * exact double-spend-into-a-fee shape `lib/embersweep.ts` was rewritten to stop. There is one
 * session; this panel is a view of it.
 *
 * What is still local is what is local to READING this page: whether the private key has been
 * revealed, and whether the reader has ticked the box saying they saved it. Both are about this
 * screen rather than about the miner, and neither should survive being navigated away from — a
 * checkbox that stays ticked from a previous visit is a checkbox nobody read.
 */
function EmberPanel() {
  const session = useMining()
  const [revealed, setRevealed] = useState(false)
  const [saved, setSaved] = useState(false)

  const key = session.emberKey
  const { hashrate, height, accepted, swept, following, notice } = session.emberSnapshot
  // Scoped to the EMBER miner rather than to the session, so this panel does not report a pool
  // chain's session as its own — the same scoping `PoolPanel` does with `session.chain`.
  const running = session.target === 'ember' && session.running

  /**
   * The address a sweep will send to, or null, taken from the session's own answer rather than
   * re-derived here. `asking` is a third state and not a `null`: the two modes tell a reader
   * opposite things about their own money, and showing one and then swapping it for the other is
   * worse than a moment of silence.
   */
  const offer = session.ember
  const payingIn = offer.state === 'ready' ? offer.payingIn : null

  const toggle = useCallback(() => {
    if (running) session.stop()
    else session.startEmber()
  }, [running, session])

  return (
    <section className="wt-panel">
      <h2 className="wt-panel__title">EMBER, mined against the network</h2>

      {notice && <p className="wt-note wt-note--caveat">{notice}</p>}

      {/*
        Nothing at all until the address question has been answered. Not a spinner and not the
        self-custody warning "for now": the two modes tell a reader opposite things about their own
        money, and showing one and then swapping it for the other is worse than a moment of silence.
      */}
      {offer.state === 'asking' ? (
        <p className="wt-note">Checking where mined EMBER should go on this account…</p>
      ) : payingIn !== null ? (
        <>
          <p className="wt-note">
            Mined EMBER is paid into your CloudsForge EMBER balance. The network pays each block to a
            throwaway address this tab makes, because EMBER's proof-of-work has to be signed by the
            key the block pays — so as soon as a block is accepted, this page sends what it paid on
            to your own EMBER deposit address. It appears in your balance once the network has built{' '}
            <span className="cf-num">60</span> blocks on top of it, roughly fifteen minutes, which is
            also what protects you from being credited for a block that is later reversed.
          </p>
          <dl className="wt-facts">
            <Fact label="Paid into" value={payingIn.address} />
          </dl>
          <div className="wt-form__actions">
            <button type="button" className="cf-btn cf-btn--ember" onClick={toggle}>
              {running ? 'Stop mining' : 'Start mining EMBER'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="wt-note wt-note--caveat">
            The block reward goes to an address this tab holds the key to — not to the EMBER address
            on your CloudsForge account. EMBER's proof-of-work is signed by the key the coinbase
            pays, and your account's key is held in custody and is not released to a web page. We
            could not get a deposit address to forward it to, so mining here pays the key below, and
            if you close this tab without saving it, anything paid to it is unreachable by anyone,
            including us.
          </p>
          {/*
            The named reason from the session, under the standing warning rather than instead of it.
            Since micro-org#362 this is also the destination the BAR sends a reader to, and it sends
            them with this sentence — so the page they land on has to be able to show it, or the
            control that brought them here would be explaining something the page never mentions.
          */}
          {offer.state === 'blocked' && <p className="wt-note">{offer.reason}</p>}
          {key === null ? (
            <div className="wt-form__actions">
              <button
                type="button"
                className="cf-btn cf-btn--ember"
                onClick={session.createEmberKey}
              >
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
                  onClick={toggle}
                  disabled={!saved && !running}
                >
                  {running ? 'Stop mining' : 'Start mining EMBER'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/*
        Both settings live on the SESSION, exactly as the pool panel's do. This panel used to reach
        past the miner's own API and write `duty` then call `_applyDuty()` by hand, which is a shape
        that lets one be set without the other being recomputed; `setDuty` and `setPauseOnBattery`
        have always existed on the implementation and the session calls them on BOTH miners, so a
        duty cycle chosen here is the one the machine runs at whichever chain is going.
      */}
      <Politeness
        duty={session.duty}
        onDuty={session.setDuty}
        pauseOnBattery={session.pauseOnBattery}
        onPauseOnBattery={session.setPauseOnBattery}
        snapshot={null}
      />

      <dl className="wt-facts">
        <Fact label="Hashrate, measured here" value={rate(hashrate)} />
        <Fact label="Chain height being mined" value={height === null ? 'not read yet' : `${height.toLocaleString('en')}`} />
        <Fact label="Blocks this tab found" value={`${accepted.length}`} />
      </dl>

      {payingIn !== null && swept.length > 0 && (
        <SweptRewards swept={swept} keyHex={key?.privHex ?? null} revealed={revealed} onReveal={() => setRevealed(true)} />
      )}

      {/*
        WHICH OF THE TWO IT IS IN, RATHER THAN A SENTENCE THAT ASSUMES ONE. This paragraph used to
        state the 45-second poll as the whole truth, because it was: the stream had been deleted
        from this page's miner while the gateway answered 405 on `/events` (micro-org#236). Now the
        stream is routed, the poll is a fallback, and which one is carrying the tip decides how much
        of the hashrate above is spent on a parent that has already moved. So it is read from the
        miner rather than written down here.
      */}
      <p className="wt-note">
        {running && !following
          ? 'Live block updates are not getting through, so work is re-read every 10 seconds instead.'
          : 'New blocks arrive as the node finds them, with work re-read every 45 seconds as a backstop.'}{' '}
        A block found on work that has since been superseded is refused as stale, which is expected
        rather than a fault: somebody else reached that height first.
      </p>
    </section>
  )
}

/**
 * What became of each block's reward, and the escape hatch when one did not make it.
 *
 * Every outcome is rendered, including the two that moved nothing. A page that showed only the
 * successes would be a page on which a stranded reward is invisible — and a reward stranded on a key
 * the reader has never seen is the exact failure this whole change exists to prevent. So when any
 * sweep has not landed, the private key becomes revealable, framed as the recovery it is.
 */
function SweptRewards({
  swept,
  keyHex,
  revealed,
  onReveal,
}: {
  swept: readonly Swept[]
  keyHex: string | null
  revealed: boolean
  onReveal: () => void
}) {
  const stranded = swept.some((entry) => entry.outcome.kind !== 'sent')

  return (
    <div className="wt-panel__sub">
      <h3>What happened to each reward</h3>
      <ul className="wt-rows">
        {swept.map((entry) => (
          <li className="wt-row" key={`${entry.height}-${entry.outcome.kind}`}>
            <span className="wt-row__main">
              <span className="wt-row__title cf-num">Block {entry.height.toLocaleString('en')}</span>
              <span className="wt-row__sub">{describeSweep(entry.outcome)}</span>
            </span>
          </li>
        ))}
      </ul>
      {stranded && (
        <>
          <p className="wt-note wt-note--caveat">
            At least one reward is still sitting on the throwaway address this tab mined to, so it is
            not on its way to your balance. The next block this tab finds will try again and will
            move everything that has built up, including this. If you would rather not wait, the
            private key to that address is below — it is a bearer credential, so anyone who has it
            can spend what is there.
          </p>
          {revealed ? (
            <p className="wt-note">
              <span className="cf-num">{keyHex}</span>
            </p>
          ) : (
            <div className="wt-form__actions">
              <button type="button" className="cf-btn" onClick={onReveal}>
                Show the private key for that address
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * One sweep outcome as a sentence, in whole EMBER.
 *
 * `1e18` rather than a formatter from `lib/money.ts`: those take integer MINOR units of an asset the
 * wallet knows about, and this amount has not been near the wallet — it is a chain quantity in wei,
 * read off the node by `embersweep.ts`. Converting it through the money layer would imply the estate
 * has booked it, which is exactly the thing that has not happened yet.
 */
function describeSweep(outcome: SweepOutcome): string {
  const WEI = 1_000_000_000_000_000_000n
  const ember = (value: bigint): string =>
    `${(Number((value * 10_000n) / WEI) / 10_000).toFixed(4)} EMBER`
  switch (outcome.kind) {
    case 'sent':
      return `${ember(outcome.value)} sent to your deposit address — it appears in your balance after 60 confirmations`
    case 'too_small':
      return `left where it is: ${ember(outcome.balance)} does not cover the ${ember(outcome.fee)} fee to move it`
    case 'in_flight':
      // Deliberately NOT phrased as a failure, because nothing failed and nothing was lost. Before
      // this state existed the reader saw `insufficient funds for gas * price + value` on every
      // other block — the node's words for a transaction this page should never have signed — and
      // the only honest reading of that sentence is that their money went somewhere. It did not:
      // the earlier transfer is carrying it, and the next one carries this reward too. `queued` is
      // not printed — it is a mempool nonce distance, it is 1 in every case a reader will meet,
      // and the number that answers "how long" is a block rather than a count of transactions.
      return `waiting for the previous transfer to be mined — nothing was sent and nothing was lost, and the next block moves this reward with it`
    case 'failed':
      return `not moved — ${outcome.message}`
  }
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
