/**
 * One browser mining session, owned above the router so it outlives the page that started it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS, AND WHAT IT REPLACES
 *
 * `pages/mine.tsx` used to hold the `PoolMiner` in a ref, and stopped it on unmount with the note
 * "a worker pool left running in a detached component keeps every core busy and there is no longer
 * anything on screen to turn it off". That reasoning was exactly right FOR A MINER THAT ONLY THE
 * MINING PAGE CAN SEE. It is what made the feature unreachable: the owner's report was "start
 * mining, from browser is hidden deep in mining page, it should be easily found near the account on
 * all pages", and the same sentence describes the other half of the defect — a reader who found it
 * lost the session the moment they looked at their wallet.
 *
 * Both halves are the same fix. `MiningControl` (@cloudsforge/ui) puts the control in the shared
 * bar on every page; this puts the SESSION above the router so the control on every page is
 * controlling one thing. The concern the old comment named does not go away, it is answered
 * differently: there is now something on screen to turn it off, in the bar, on every address of
 * this surface, including the ones this app does not have a page for.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IT WILL AND WILL NOT START
 *
 * **Pool chains only.** EMBER is deliberately not startable from the bar and stays on `/mine` with
 * its own miner, because starting it is not one decision. EMBER's proof-of-work is signed by the
 * key the coinbase pays (`hearth/node/src/chain/header.js` `verifyPow`), so the reward lands on a
 * throwaway key this tab generates, and what happens next depends on whether the account has a
 * watched custodial deposit address — a self-custody question `pages/mine.tsx` spends two screens
 * on. A control that answered it silently, from a bar, on a page about something else, would be
 * handing somebody a bearer credential they never read about.
 *
 * **The first chain the pool can actually hand work for**, in the pool's own ordering, and nothing
 * clever. `miningBlocker()` is the single decision about mineability and it is not second-guessed
 * here. Measured against the live pool on 2026-08-10 that is LTC and only LTC: bitcoind and
 * dogecoind are still in initial block download, so the pool holds no template for either and both
 * answer `not-ready`. A reader who wants a different chain picks it on `/mine`, which is what the
 * picker is for; the bar is the one-press path to "mine something", not a second chain picker.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE POOL IS READ ONCE PER PAGE LOAD, HERE, AND AGAIN BY THE MINING PAGE
 *
 * Two reads of `GET /v1/pool` per page load on `/mine`, one everywhere else. That is deliberate and
 * it is cheap: the route is public (`auth: false`), it is the pool describing itself, and this
 * provider mounts once for the whole session rather than once per navigation — so it is two
 * requests in a browsing session, not two per page.
 *
 * The alternative — one shared read, with the page consuming this one — was rejected because the
 * page needs a RETRYABLE read with its own failed/forbidden/loading screens (`lib/resource.ts`), and
 * pulling that up here would put the mining page's error UI in the shell, where every other surface
 * of this app would inherit it. A module-level cache was rejected for a different reason: it is
 * state that outlives a sign-out and a second thing every test has to remember to reset.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useSession } from '../lib/auth.tsx'
import { isMineable, loadPool, miningBlocker, type PoolChain, type PoolSummary } from '../lib/pool.ts'
import { PoolMiner, type PoolMinerOptions, type PoolMinerSnapshot } from './pool-miner.ts'

/** The politeness defaults. The same numbers `pages/mine.tsx` opened with before this moved. */
const DEFAULT_DUTY = 0.6

/**
 * The part of `PoolMiner` this drives.
 *
 * Narrow, and for the reason `PoolMiner`'s own `WorkerLike` is narrow: a scenario about the bar
 * must be able to press the control without opening a WebSocket to the live pool. The concrete
 * class is the default and is what every browser gets.
 */
export interface MinerLike {
  readonly chain: PoolChain
  start(): Promise<void>
  stop(): void
  readonly running: boolean
  setDuty(duty: number): void
  setPauseOnBattery(on: boolean): void
}

export interface MiningSession {
  /** The pool's answer, or null when it has not answered or could not be reached. */
  readonly summary: PoolSummary | null
  /** Has the pool been asked and answered, one way or the other? Until then nothing is claimed. */
  readonly settled: boolean
  /** The chain the session's miner is attached to. Survives a stop, so the numbers survive it too. */
  readonly chain: PoolChain | null
  readonly snapshot: PoolMinerSnapshot | null
  /**
   * Is a session live?
   *
   * `failed` counts as live on purpose, and `pages/mine.tsx` made the same choice before this
   * moved: a miner that gave up still has threads and a socket to release, so the control has to
   * stay a Stop rather than becoming a second Start that starts a second one.
   */
  readonly running: boolean
  /** Why nothing can be mined in this browser right now, in a sentence, or null. */
  readonly refusal: string | null
  /** The pool's own flag. False on this estate; see `pool/src/payouts.ts`. */
  readonly payoutsImplemented: boolean
  readonly duty: number
  readonly pauseOnBattery: boolean
  /** Start, on the given chain or on the first one the pool can hand work for. */
  start: (chain?: PoolChain) => void
  stop: () => void
  setDuty: (duty: number) => void
  setPauseOnBattery: (on: boolean) => void
}

const MiningContext = createContext<MiningSession | null>(null)

/**
 * Throwing, rather than returning a not-mining default, for the reason `useSession` gives about
 * its own: a component rendered outside the provider would show a control that looks like it works
 * and does nothing, and nobody would ever see why.
 */
export function useMining(): MiningSession {
  const value = useContext(MiningContext)
  if (!value) throw new Error('useMining must be used inside <MiningProvider>')
  return value
}

/**
 * Whether this browser can mine at all, in the reader's terms, or null if it can.
 *
 * Two capabilities and no feature-detection theatre. Without `Worker` the proof-of-work would run
 * on the main thread and freeze the page it is rendered on; without `WebSocket` there is no Stratum
 * connection to carry work or shares. Both are read off `window` rather than off the bare global so
 * a harness can say what this browser is, which is the same reason `PoolMiner` takes a `spawn`.
 */
export function deviceRefusal(): string | null {
  if (typeof window === 'undefined') return null
  const view = window as unknown as Record<string, unknown>
  if (typeof view['Worker'] !== 'function') {
    return 'This browser does not support Web Workers, so the proof-of-work would have to run on the same thread as the page and would freeze it.'
  }
  if (typeof view['WebSocket'] !== 'function') {
    return 'This browser does not support WebSockets, so there is no connection to carry work from the pool or shares back to it.'
  }
  return null
}

/**
 * Why the pool cannot be mined from here, or null.
 *
 * The two blocker kinds are kept apart all the way to the sentence, because `lib/pool.ts` is right
 * that they lead to different next moves: `unpublished` is an operator decision that will be the
 * same tomorrow, and `not-ready` is a node catching up and fixes itself. A reader deciding whether
 * to come back needs to know which one they are looking at.
 */
export function poolRefusal(summary: PoolSummary | null, settled: boolean): string | null {
  if (!settled) return null
  if (summary === null) {
    return 'The pool could not be reached from this browser, so there is nothing to connect to. This is the estate rather than your account or your machine.'
  }
  if (summary.chains.length === 0) {
    return 'The pool is running no chains on this deployment, so there is nothing here to mine.'
  }
  if (summary.chains.some(isMineable)) return null
  if (summary.chains.some((chain) => miningBlocker(chain) === 'not-ready')) {
    return 'The pool has no work to hand out right now — its node is still downloading the chain and will not build on a history it has not finished reading. Nothing is wrong with your machine or your account, and mining is offered again as soon as the pool has work.'
  }
  return 'Browser mining has not been published on this deployment. The pool mines and accepts shares over its Stratum port, but no address a browser can reach has been published, so there is nothing for this tab to connect to.'
}

export interface MiningProviderProps {
  readonly children: ReactNode
  /**
   * Test seam. A real `PoolMiner` in a browser, a fake in a harness that must not dial the pool.
   *
   * The same shape and the same reason as `PoolMiner`'s own `spawn` and `client` options — see
   * that file. It is optional and unset everywhere in this application; `components/shell.tsx`
   * mounts this provider with children and nothing else.
   */
  readonly create?: (options: PoolMinerOptions) => MinerLike
}

export function MiningProvider({ children, create }: MiningProviderProps) {
  const { account } = useSession()
  const [summary, setSummary] = useState<PoolSummary | null>(null)
  const [settled, setSettled] = useState(false)
  const [snapshot, setSnapshot] = useState<PoolMinerSnapshot | null>(null)
  const [chain, setChain] = useState<PoolChain | null>(null)
  const [duty, setDutyValue] = useState(DEFAULT_DUTY)
  const [pauseOnBattery, setPauseValue] = useState(true)
  const miner = useRef<MinerLike | null>(null)

  /*
   * The pool, once, for the whole session.
   *
   * An aborted read is not an answer, so `settled` is not set on that path: under StrictMode the
   * first effect is torn down and its request aborted while the second is still in flight, and
   * setting it there would flash the "nothing can be mined" state at a reader for whom the question
   * is still open.
   */
  useEffect(() => {
    const controller = new AbortController()
    let live = true
    loadPool(controller.signal).then(
      (answer) => {
        if (!live) return
        setSummary(answer)
        setSettled(true)
      },
      () => {
        if (!live) return
        setSettled(true)
      },
    )
    return () => {
      live = false
      controller.abort()
    }
  }, [])

  // The provider unmounts when the application does. This is the last release of the threads and
  // the socket, and it is the only one left now that the page no longer owns them.
  useEffect(() => () => miner.current?.stop(), [])

  /*
   * A session belongs to an account, so the end of the account is the end of the session. Without
   * this a sign-out would leave two threads hashing and a socket authorised against a ticket minted
   * for somebody who has left, with a bar that no longer offers a way to stop it.
   */
  const signedIn = account.signedIn
  useEffect(() => {
    if (signedIn || miner.current === null) return
    miner.current.stop()
    miner.current = null
    setChain(null)
    setSnapshot(null)
  }, [signedIn])

  /** The chain a bare press starts. The pool's own ordering; see the header. */
  const candidate = useMemo(() => summary?.chains.find(isMineable) ?? null, [summary])

  const start = useCallback(
    (wanted?: PoolChain) => {
      const target = wanted ?? candidate
      if (target === null) return
      const current = miner.current
      if (current !== null && current.running && current.chain.chain === target.chain) return
      // Switching chains stops the old session first. Two `PoolMiner`s would be two Stratum
      // connections, four threads on a two-thread budget, and a bar that can only stop one.
      current?.stop()
      const options: PoolMinerOptions = { chain: target, duty, pauseOnBattery, onChange: setSnapshot }
      const instance = create ? create(options) : new PoolMiner(options)
      miner.current = instance
      setChain(target)
      setSnapshot(null)
      void instance.start()
    },
    [candidate, create, duty, pauseOnBattery],
  )

  const stop = useCallback(() => {
    // The instance is kept rather than dropped, and so is the snapshot it last emitted: `stop()`
    // emits one with `status: 'stopped'`, and that is what the mining page renders its final
    // numbers from. Dropping them would clear the session's figures at the moment somebody wanted
    // to read what it did.
    miner.current?.stop()
  }, [])

  const setDuty = useCallback((value: number) => {
    setDutyValue(value)
    miner.current?.setDuty(value)
  }, [])

  const setPauseOnBattery = useCallback((value: boolean) => {
    setPauseValue(value)
    miner.current?.setPauseOnBattery(value)
  }, [])

  const value = useMemo<MiningSession>(() => {
    const device = deviceRefusal()
    return {
      summary,
      settled,
      chain,
      snapshot,
      running: snapshot !== null && snapshot.status !== 'stopped' && snapshot.status !== 'idle',
      refusal: device ?? poolRefusal(summary, settled),
      payoutsImplemented: summary?.payoutsImplemented ?? false,
      duty,
      pauseOnBattery,
      start,
      stop,
      setDuty,
      setPauseOnBattery,
    }
  }, [summary, settled, chain, snapshot, duty, pauseOnBattery, start, stop, setDuty, setPauseOnBattery])

  return <MiningContext.Provider value={value}>{children}</MiningContext.Provider>
}
