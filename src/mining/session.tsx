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
 * WHAT A BARE PRESS STARTS: EMBER, WHEN EMBER CAN BE STARTED SAFELY (micro-org#362)
 *
 * This file used to say "**Pool chains only.** EMBER is deliberately not startable from the bar",
 * on the grounds that starting EMBER is not one decision: the proof-of-work is signed by the key
 * the coinbase pays (`hearth/node/src/chain/header.js` `verifyPow`), so the reward lands on a
 * throwaway key this tab generates, and a control that answered the self-custody question silently
 * "would be handing somebody a bearer credential they never read about".
 *
 * That is true of ONE of the two cases, and `pages/mine.tsx` already distinguishes them. When the
 * account has a custodial EMBER deposit address the indexer is watching, the mining page runs in
 * SWEEP MODE: the key is generated, never displayed, never mentioned, and each accepted block's
 * balance is sent to that address, where the estate's ordinary deposit path books it after EMBER's
 * 60 confirmations (`lib/embersweep.ts`). Nothing is handed to the reader and there is no decision
 * to read. That mechanism is not theoretical — it has run on mainnet since 2026-08-10, from block
 * 10,919 onward, sweeping 5.3929 EMBER a block into the owner's own deposit address.
 *
 * So the gate is that address, not "EMBER is special", and the bar behaves accordingly:
 *
 *   - **a watched `chain === 'ember'` assignment** → a bare press starts EMBER, in sweep mode,
 *     exactly as the mining page's Start does, and the reward reaches the account;
 *   - **anything else** — signed out, no assignment, `watchedAt` still null, wallet unreachable,
 *     EMBER not depositable on this deployment — → the bar starts NOTHING. It renders
 *     `MiningControl`'s `elsewhere` phase: a real anchor to `/mine` with EMBER selected, carrying
 *     the reason, so the reader arrives at the two self-custody screens rather than at a key they
 *     never agreed to hold. `mining/bar.ts` owns those four sentences.
 *
 * **It never falls back to a pool chain.** LTC is still the first chain `isMineable` returns on
 * this deployment, but not for the reason this used to give. Measured 2026-08-11 at bitcoin height
 * 961,975: mainnet runs `POOL_CHAINS=ltc,btc`, bitcoind reached tip on 2026-08-10, and the pool
 * holds a template for BTC — `ready: true`. `isMineable` skips it anyway, because the pool refuses
 * the chain to browsers (`browserMining.available` false) and sends it to mining hardware over
 * Stratum instead (micro-org#360). dogecoind is still in initial block download and the pool does
 * not serve DOGE at all. So LTC was what a bare press started, which is the defect: the estate's
 * own chain was the one thing the bar would not mine. A pool chain is now started only by naming
 * it — `start(chain)` from the mining page's picker, which is what the picker is for.
 *
 * ── AND THE POOL'S TROUBLES ARE NO LONGER THE BAR'S ───────────────────────────────────────────
 *
 * `refusal` used to be `deviceRefusal() ?? poolRefusal(...)`, so a pool with no published endpoint,
 * or with every node in initial block download, disabled the bar's control. For an account that can
 * mine EMBER that was simply wrong — EMBER does not go through the pool, and `pool/src/chains.ts`
 * refuses to run one for it. `poolRefusal` is gone rather than kept unused; its two sentences were
 * near-copies of the ones `pages/mine.tsx` renders in the pool panel, which is where a sentence
 * about the pool belongs and where a reader who wants a pool chain now goes to start one.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ONE EMBER MINER, HERE, RATHER THAN ONE PER MOUNT OF THE MINING PAGE
 *
 * The EMBER miner used to live in `EmberPanel`'s local state, which was safe only while the bar
 * could not start one. Two `Miner`s grinding at once is the failure this provider exists to
 * prevent: it doubles the machine's load, and — worse — it races two sweeps against one key's
 * nonce, which is precisely the shape micro-org#356 was about. So the miner, the throwaway key,
 * the sweep queue and the custody answer all live here, and the panel renders them.
 *
 * The alternative shape considered was leaving the miner on the page and having the bar navigate
 * there and press it. It was rejected because it makes the bar's control a lie about its own state:
 * the session would not exist until a page that is not mounted had mounted, so the phase the bar
 * showed would be a prediction, and stopping from another address — the whole point of putting the
 * control in the bar — would be impossible.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * TWO READS PER PAGE LOAD, AND ONE `POST /v1/deposits`
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
 *
 * The custody question moved the other way, and had to. `POST /v1/deposits` was asked by
 * `EmberPanel` on mount; it is now asked here, once, for a signed-in reader, because the BAR needs
 * the answer to know what a press does — on every address, before anybody has been to `/mine`. It
 * is one extra call per browsing session for a reader who never opens the mining page, and it is
 * the same call the mining page already made: `assignDepositAddress` is called WITHOUT `rotate`,
 * and wallet's own comment is that rotation is the dangerous default because it "would mint a new
 * address on every page load and leave a trail of addresses nobody was told about". Without it the
 * service returns the existing active assignment and mints at most one, ever — the same address the
 * receive screen hands out. It is not asked at all for a signed-out reader, because there is no
 * account for it to be about and the bar answers `signed-out` before it looks.
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
import { sweepToCustody, type SweepOutcome } from '../lib/embersweep.ts'
import { emberMiningBase } from '../lib/hosts.ts'
import { viewedSurfaceUrl } from '../lib/viewed.ts'
import { assignDepositAddress, type DepositAssignment } from '../lib/money.ts'
import { poolApiWorthAsking, usePoolApi } from '../lib/deployment.tsx'
import { isMineable, loadPool, type PoolChain, type PoolSummary } from '../lib/pool.ts'
import { PoolMiner, type PoolMinerOptions, type PoolMinerSnapshot } from './pool-miner.ts'

/** The politeness defaults. The same numbers `pages/mine.tsx` opened with before this moved. */
const DEFAULT_DUTY = 0.6

/** EMBER is not one of the pool's chains, so the assignment's own chain id is what is checked. */
const EMBER_CHAIN = 'ember'

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

/**
 * The throwaway key an EMBER block is paid to. `mining/account.js`'s `MiningKey`, restated as a
 * type this module can name without importing the JavaScript at module scope — the miner and the
 * curve are a dynamic import, so a reader who never mines never downloads them.
 */
export interface EmberMiningKey {
  readonly priv: Uint8Array
  readonly pubHex: string
  readonly address: string
  readonly privHex: string
}

export interface EmberMinerOptions {
  readonly rpc: string
  readonly key: EmberMiningKey
  readonly duty: number
  readonly pauseOnBattery: boolean
}

/**
 * The part of `mining/miner.js`'s `Miner` this drives, for the same reason `MinerLike` is narrow.
 *
 * `addEventListener` rather than an `onChange` callback because the concrete miner is an
 * `EventTarget` and has been since it was vendored from network-site; wrapping it in a callback
 * here would be a second event vocabulary for one miner.
 */
export interface EmberMinerLike {
  start(): Promise<void>
  stop(): void
  setDuty(duty: number): void
  setPauseOnBattery(on: boolean): void
  addEventListener(type: string, listener: (event: Event) => void): void
}

/** One accepted block, and what became of the reward it paid to this tab's key. */
export interface Swept {
  readonly height: number
  readonly outcome: SweepOutcome
}

/**
 * Where a bare press stands with EMBER, as one value rather than four booleans to recombine.
 *
 * `asking` is not "no": until `POST /v1/deposits` has answered, `ready` and `blocked` are both
 * guesses, and each of them is a claim about what a press will do with somebody's money. The bar
 * says nothing at all in that state — see `mining/bar.ts`, which is where that decision is walked.
 */
export type EmberOffer =
  | { readonly state: 'asking' }
  /** There is a watched custodial EMBER address, so a block found here reaches the account. */
  | { readonly state: 'ready'; readonly payingIn: DepositAssignment }
  /** There is not, and this is the sentence the reader is given on the way to `/mine`. */
  | { readonly state: 'blocked'; readonly reason: string }

/**
 * The EMBER miner's live figures. Always present, never null: before a start it reads zero, which
 * is what a machine that has measured nothing has done, and it is what the mining page renders.
 */
export interface EmberSnapshot {
  readonly running: boolean
  readonly hashrate: number
  /** The height being mined, or null before the first template is read. */
  readonly height: number | null
  /**
   * How many blocks this tab has found, ALL of them.
   *
   * This replaces an `accepted` array that was capped at `EMBER_HISTORY` (8) as a display buffer
   * and then COUNTED by two surfaces — "Blocks this tab found" on the mine page and the shell
   * bar's badge. Both therefore stopped at 8: a tab that had found thirty blocks reported eight,
   * on the single number the mining page exists to report.
   *
   * The array is gone rather than kept beside this, because nothing ever rendered it. It existed
   * only to be measured, which is exactly what made the wrong measurement available. A counter
   * cannot be truncated, so the defect cannot come back.
   */
  readonly acceptedTotal: number
  readonly swept: readonly Swept[]
  /** Is the tip arriving live over `GET /events`, or is the fallback poll carrying it? */
  readonly following: boolean
  readonly notice: string | null
}

const EMBER_IDLE: EmberSnapshot = {
  running: false,
  hashrate: 0,
  height: null,
  acceptedTotal: 0,
  swept: [],
  following: false,
  notice: null,
}

/** How many sweep outcomes are kept. The page shows a recent list of them. */
const EMBER_HISTORY = 8

export interface MiningSession {
  /** The pool's answer, or null when it has not answered or could not be reached. */
  readonly summary: PoolSummary | null
  /** Has the pool been asked and answered, one way or the other? Until then nothing is claimed. */
  readonly settled: boolean
  /** The chain the session's POOL miner is attached to. Survives a stop, so its numbers do too. */
  readonly chain: PoolChain | null
  readonly snapshot: PoolMinerSnapshot | null
  /** Which of the two miners this session last started, or null before either. */
  readonly target: 'pool' | 'ember' | null
  /** What a bare press would do about EMBER, and why. */
  readonly ember: EmberOffer
  /** The throwaway key EMBER blocks are paid to, once there is one. */
  readonly emberKey: EmberMiningKey | null
  readonly emberSnapshot: EmberSnapshot
  /**
   * Is a session live?
   *
   * `failed` counts as live on purpose, and `pages/mine.tsx` made the same choice before this
   * moved: a miner that gave up still has threads and a socket to release, so the control has to
   * stay a Stop rather than becoming a second Start that starts a second one.
   */
  readonly running: boolean
  /** Why nothing can be mined in this browser at all, in a sentence, or null. */
  readonly refusal: string | null
  /** The pool's own flag. False on this estate; see `pool/src/payouts.ts`. */
  readonly payoutsImplemented: boolean
  readonly duty: number
  readonly pauseOnBattery: boolean
  /** Start a named pool chain, or — with no argument — EMBER, when EMBER is `ready`. */
  start: (chain?: PoolChain) => void
  /** Start EMBER explicitly, whatever the offer says. The mining page's self-custody Start. */
  startEmber: () => void
  /** Mint the throwaway key without starting, for the self-custody screen that displays it. */
  createEmberKey: () => void
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
 * Whether this browser can mine ANYTHING, in the reader's terms, or null if it can.
 *
 * One capability, and it is the one both miners need: without `Worker` the proof-of-work would run
 * on the main thread and freeze the page it is rendered on. It is read off `window` rather than off
 * the bare global so a harness can say what this browser is, which is the same reason `PoolMiner`
 * takes a `spawn`.
 *
 * `WebSocket` used to be checked here too, and it no longer is (micro-org#362). It is a POOL
 * requirement — there is no Stratum connection without one — and the bar's press starts EMBER,
 * which talks to hearth over `fetch` and `EventSource` and has no socket at all. Refusing a whole
 * browser here for a capability only one of the two miners needs would disable the estate's own
 * chain over the pool's transport. A browser that has Workers and no WebSocket still gets a
 * truthful answer when it starts a pool chain: `PoolMiner` reports `failed` with the reason on the
 * mining page's own panel, which is where a pool-shaped failure belongs.
 */
export function deviceRefusal(): string | null {
  if (typeof window === 'undefined') return null
  const view = window as unknown as Record<string, unknown>
  if (typeof view['Worker'] !== 'function') {
    return 'This browser does not support Web Workers, so the proof-of-work would have to run on the same thread as the page and would freeze it.'
  }
  return null
}

/*
 * ── THE FOUR REASONS A PRESS BECOMES A JOURNEY ────────────────────────────────────────────────
 *
 * Kept apart all the way to the sentence, for the reason `lib/pool.ts` keeps its two blocker kinds
 * apart: they lead to different next moves, and a reader deciding what to do needs to know which
 * one they are looking at. Each is written to follow "Mine EMBER in your browser, on Forge Hub."
 * — the design system's own opening for the `elsewhere` phase — so the pair reads as one thought.
 *
 * None of them promises that a found block reaches the account, because in every one of them it
 * would not. That is the whole reason the reader is being sent to the two screens that explain the
 * alternative and what it costs them.
 */

/** No session. There is no account for a deposit address to belong to. */
export const EMBER_NO_SESSION =
  'Mining EMBER pays each block to a key this browser makes, and there is no account signed in here for it to be forwarded on to.'

/** Asked, and there is no assignment: wallet refused, was unreachable, or EMBER is not depositable. */
export const EMBER_NO_ADDRESS =
  'There is no CloudsForge EMBER deposit address on this account for a found block to be sent to, so the mining page has to ask you where it should go instead — and tell you what holding it yourself means.'

/**
 * There is an address and the indexer has not been told to watch it. wallet's own comment is that
 * "an unwatched address produces no events", so a sweep to it would arrive on chain and never be
 * credited. Losing the sweep is recoverable; sending EMBER into a hole is not.
 */
export const EMBER_UNWATCHED =
  'This account’s EMBER deposit address is not being watched yet, so anything sent to it would arrive on the chain and never be credited. The mining page has the alternative, and what it costs you.'

/** An assignment for something that is not the chain this browser mines. Belt and braces. */
export const EMBER_WRONG_CHAIN =
  'The deposit address this account holds is for another chain, so a block mined here has nowhere on your account to land. The mining page has the alternative, and what it costs you.'

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
  /**
   * The same seam for the EMBER miner, and it earns its keep for a second reason: the real one is
   * a dynamic `import()` of a byte-for-byte port of the node's proof-of-work, so a scenario that
   * only wants to know WHICH chain a press started should not have to load a curve to find out.
   */
  readonly createEmber?: (options: EmberMinerOptions) => EmberMinerLike
}

export function MiningProvider({ children, create, createEmber }: MiningProviderProps) {
  const { account } = useSession()
  // Whether this estate has a pool API behind it at all. `present` outside `DeploymentProvider`,
  // which is the behaviour this provider has always had — see src/lib/deployment.tsx.
  const presence = usePoolApi()
  const [summary, setSummary] = useState<PoolSummary | null>(null)
  const [settled, setSettled] = useState(false)
  const [snapshot, setSnapshot] = useState<PoolMinerSnapshot | null>(null)
  const [chain, setChain] = useState<PoolChain | null>(null)
  const [target, setTarget] = useState<'pool' | 'ember' | null>(null)
  const [duty, setDutyValue] = useState(DEFAULT_DUTY)
  const [pauseOnBattery, setPauseValue] = useState(true)
  const miner = useRef<MinerLike | null>(null)

  const [custody, setCustody] = useState<DepositAssignment | null>(null)
  const [custodyState, setCustodyState] = useState<'asking' | 'settled'>('asking')
  const [emberKey, setEmberKey] = useState<EmberMiningKey | null>(null)
  const [emberSnapshot, setEmberSnapshot] = useState<EmberSnapshot>(EMBER_IDLE)
  const emberMiner = useRef<EmberMinerLike | null>(null)

  /*
   * The pool, once, for the whole session.
   *
   * An aborted read is not an answer, so `settled` is not set on that path: under StrictMode the
   * first effect is torn down and its request aborted while the second is still in flight, and
   * setting it there would flash the "nothing can be mined" state at a reader for whom the question
   * is still open.
   */
  useEffect(() => {
    /*
     * NOT ASKED AT ALL ON A DEPLOYMENT WITH NO POOL (micro-org#406).
     *
     * `pool-testnet.<apex>/v1/pool` answers 502 on every estate that does not run the `pool`
     * compose profile, permanently and by design, and this effect runs on EVERY page of this app
     * because the bar's Start control lives above the router. So the failure path below was a
     * doomed cross-origin request per page load, per reader, forever — and `settled: true` with a
     * null summary, which is the same state this now reaches without asking.
     *
     * `unknown` also declines, and that is the point rather than an accident: it lasts one
     * same-origin round trip against this container, and a request fired during it lands on the 502
     * anyway. What the reader loses is nothing — the bar has no pool chain to offer until this
     * resolves either way.
     */
    if (!poolApiWorthAsking(presence)) {
      setSummary(null)
      setSettled(presence === 'absent')
      return
    }
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
  }, [presence])

  const signedIn = account.signedIn

  /**
   * Ask wallet where this account's EMBER deposits go. Once, and only for a signed-in reader.
   *
   * The reasoning for calling a `POST` on a page load is in the file header, and it came with this
   * effect from `pages/mine.tsx`: without `rotate` the service returns the existing active
   * assignment and mints at most one, ever. What is new is only WHERE it is asked, and that is
   * forced by the bar — a control on every address cannot decide what a press does from an answer
   * that only the mining page has.
   */
  const asked = useRef(false)
  useEffect(() => {
    /*
     * ONCE PER SESSION, AND THE GUARD IS NOT DECORATION.
     *
     * `src/main.tsx` mounts this app inside `<StrictMode>`, which runs every effect, tears it down
     * and runs it again — so the ordinary `let live = true` cleanup, which cancels the STATE UPDATE,
     * still lets the REQUEST go twice. For a GET that is waste; for a `POST /v1/deposits` it is two
     * calls to the route wallet says must not be called casually. Both are harmless today because
     * `rotate` is absent and the second returns the same assignment, but "harmless because of a
     * default on somebody else's route" is not a thing to rely on twice a page load.
     *
     * There is deliberately no abort either. The request may already have minted the account's only
     * EMBER deposit address, and aborting the response does not unmint it — it just throws away the
     * one copy of the answer. Setting state after an unmount is a no-op in React 18 and later.
     */
    if (!signedIn || asked.current) return
    asked.current = true
    assignDepositAddress('EMBER')
      .then((answer) => setCustody(answer.assignment))
      .catch(() => {
        // Deliberately silent, and deliberately not a notice. Every reason this can fail — EMBER
        // not depositable on this deployment, wallet down, the account refused — has the same
        // correct consequence: the bar does not start EMBER and points at the mining page, which
        // explains the alternative. An error banner on every page about a working fallback is noise.
        setCustody(null)
      })
      .finally(() => setCustodyState('settled'))
  }, [signedIn])

  /**
   * The address a sweep will actually send to, or null. Both conditions are refusals to send.
   *
   * `watchedAt === null` means the indexer has not been told to watch it, so a deposit to it arrives
   * on chain and is never credited. The `chain` check is belt and braces against an assignment for
   * something that is not the chain this browser mines; `viewedSurfaceUrl` derives the wallet host
   * and the RPC host from the same network, so the two cannot be different DEPLOYMENTS, but they
   * can be different assets.
   *
   * That "same network" used to be "same apex", which was true only while the hostname decided it.
   * Under the combined view the switcher decides, so both go through `lib/viewed.ts` — and they go
   * through it in the same render, which is what keeps them from disagreeing mid-session.
   */
  const payingIn =
    custody !== null && custody.watchedAt !== null && custody.chain === EMBER_CHAIN ? custody : null

  const ember = useMemo<EmberOffer>(() => {
    if (!signedIn) return { state: 'blocked', reason: EMBER_NO_SESSION }
    if (custodyState === 'asking') return { state: 'asking' }
    if (custody === null) return { state: 'blocked', reason: EMBER_NO_ADDRESS }
    if (custody.chain !== EMBER_CHAIN) return { state: 'blocked', reason: EMBER_WRONG_CHAIN }
    if (custody.watchedAt === null) return { state: 'blocked', reason: EMBER_UNWATCHED }
    return { state: 'ready', payingIn: custody }
  }, [signedIn, custodyState, custody])

  /*
   * Refs beside the state, because the `accepted` listener is registered ONCE when the miner is
   * built and would otherwise close over whatever these were at that instant — a block found ten
   * minutes later would sweep to an address that had since been re-read, or with a key from a
   * previous session.
   */
  const payingInRef = useRef<DepositAssignment | null>(null)
  payingInRef.current = payingIn
  const keyRef = useRef<EmberMiningKey | null>(null)
  keyRef.current = emberKey
  const dutyRef = useRef(duty)
  dutyRef.current = duty
  const pauseRef = useRef(pauseOnBattery)
  pauseRef.current = pauseOnBattery

  const patchEmber = useCallback((change: Partial<EmberSnapshot>) => {
    setEmberSnapshot((prev) => ({ ...prev, ...change }))
  }, [])

  /**
   * One sweep at a time, whatever the chain does.
   *
   * Two blocks accepted seconds apart would otherwise read `eth_getTransactionCount` concurrently,
   * get the same nonce, and sign two transactions of which the chain takes one — turning a reward
   * into a fee. The queue is a promise chain rather than a lock because the work is already async
   * and a lock would need a release path on every throw. A second sweep behind a first also fixes
   * itself: `sweepToCustody` pays out the BALANCE, so by the time it runs the first has already
   * moved what it could and this one moves whatever arrived after.
   */
  const sweepQueue = useRef<Promise<void>>(Promise.resolve())

  const sweep = useCallback(
    (height: number) => {
      const to = payingInRef.current
      const signing = keyRef.current
      if (to === null || signing === null) return
      sweepQueue.current = sweepQueue.current.then(async () => {
        const outcome = await sweepToCustody(signing, to.address)
        setEmberSnapshot((prev) => ({
          ...prev,
          swept: [{ height, outcome }, ...prev.swept].slice(0, EMBER_HISTORY),
        }))
      })
    },
    [],
  )

  /* ── stopping, which both starts have to do first ──────────────────────────────────────────── */

  const stopPool = useCallback(() => {
    // The instance is kept rather than dropped, and so is the snapshot it last emitted: `stop()`
    // emits one with `status: 'stopped'`, and that is what the mining page renders its final
    // numbers from. Dropping them would clear the session's figures at the moment somebody wanted
    // to read what it did.
    miner.current?.stop()
  }, [])

  const stopEmber = useCallback(() => {
    emberMiner.current?.stop()
    // `following` is the ONE figure that is not the miner's to report once it has stopped: the
    // stream is closed in `stop()` and no `follow` event follows it, so a session that ended while
    // blind would leave the page saying live updates are not getting through, forever.
    setEmberSnapshot((prev) => ({ ...prev, running: false, following: false, hashrate: 0 }))
  }, [])

  const stop = useCallback(() => {
    stopPool()
    stopEmber()
  }, [stopPool, stopEmber])

  /* ── starting ─────────────────────────────────────────────────────────────────────────────── */

  const startPool = useCallback(
    (wanted: PoolChain) => {
      const current = miner.current
      if (current !== null && current.running && current.chain.chain === wanted.chain) return
      // Switching stops whatever was running first. Two miners would be two connections, four
      // threads on a two-thread budget, and a bar that can only stop one.
      current?.stop()
      emberMiner.current?.stop()
      const options: PoolMinerOptions = {
        chain: wanted,
        duty: dutyRef.current,
        pauseOnBattery: pauseRef.current,
        onChange: setSnapshot,
      }
      const instance = create ? create(options) : new PoolMiner(options)
      miner.current = instance
      setChain(wanted)
      setSnapshot(null)
      setTarget('pool')
      setEmberSnapshot((prev) => ({ ...prev, running: false, following: false, hashrate: 0 }))
      void instance.start()
    },
    [create],
  )

  /**
   * A start is asynchronous — the curve, the key and the miner are all dynamic imports — and a
   * second press during that window would build a second miner. The ref is the guard, and it is a
   * ref rather than state because the value is read inside the same tick that sets it.
   */
  const emberStarting = useRef(false)

  const startEmber = useCallback(() => {
    if (emberStarting.current || emberSnapshot.running) return
    emberStarting.current = true
    void (async () => {
      try {
        patchEmber({ notice: null })
        miner.current?.stop()
        /*
         * In sweep mode there is no "Create a mining address" step to press, because the address is
         * an implementation detail of a transfer the reader never sees — so the key is made here, on
         * the way to starting. `keyRef` is written alongside the state because the `accepted`
         * listener below is registered in this same pass and would otherwise close over the null.
         */
        let signing = keyRef.current
        if (signing === null) {
          signing = (await import('../mining/account.js')).generateKey()
          keyRef.current = signing
          setEmberKey(signing)
        }
        const options: EmberMinerOptions = {
          // The viewed network's Hearth, not the serving hostname's — the same resolution the
          // deposit address above came through, which is what keeps a sweep on the chain that
          // minted its destination. See `lib/hosts.ts` on `emberMiningBase`.
          rpc: emberMiningBase(viewedSurfaceUrl('rpc')),
          key: signing,
          duty: dutyRef.current,
          pauseOnBattery: pauseRef.current,
        }
        const instance = createEmber
          ? createEmber(options)
          : new (await import('../mining/miner.js')).Miner(options)
        emberMiner.current = instance
        setTarget('ember')
        instance.addEventListener('state', (event) =>
          patchEmber({ running: Boolean((event as CustomEvent).detail.running) }),
        )
        instance.addEventListener('hashrate', (event) =>
          patchEmber({ hashrate: (event as CustomEvent).detail.hashrate }),
        )
        instance.addEventListener('template', (event) =>
          patchEmber({ height: (event as CustomEvent).detail.height ?? null }),
        )
        instance.addEventListener('accepted', (event) => {
          const detail = (event as CustomEvent).detail as { height: number }
          setEmberSnapshot((prev) => ({ ...prev, acceptedTotal: prev.acceptedTotal + 1 }))
          // The whole of micro-org#299, in one line and only when there is somewhere to send it.
          // `sweep` is a no-op in the self-custody mode, where the reward is meant to stay put.
          sweep(detail.height)
        })
        instance.addEventListener('rejected', (event) =>
          patchEmber({ notice: `the node refused a block: ${(event as CustomEvent).detail.err}` }),
        )
        instance.addEventListener('error', (event) =>
          patchEmber({ notice: (event as CustomEvent).detail.message }),
        )
        instance.addEventListener('follow', (event) =>
          patchEmber({ following: Boolean((event as CustomEvent).detail.following) }),
        )
        await instance.start()
      } catch (err) {
        patchEmber({ notice: err instanceof Error ? err.message : 'mining could not start' })
      } finally {
        emberStarting.current = false
      }
    })()
  }, [createEmber, emberSnapshot.running, patchEmber, sweep])

  const createEmberKey = useCallback(() => {
    void (async () => {
      try {
        patchEmber({ notice: null })
        const account = await import('../mining/account.js')
        const made = account.generateKey()
        keyRef.current = made
        setEmberKey(made)
      } catch (err) {
        patchEmber({ notice: err instanceof Error ? err.message : 'that key could not be made' })
      }
    })()
  }, [patchEmber])

  /**
   * The bare press, and the whole of micro-org#362 in one branch.
   *
   * A named chain is a pool chain and starts it. No argument means EMBER, and only when EMBER is
   * `ready` — there is deliberately no fallback to `summary.chains.find(isMineable)` here. That
   * fallback is what made the bar start Litecoin, and a press that quietly mines a different chain
   * from the one it offered is worse than a press that does nothing: the bar never offers this
   * press unless `ember.state === 'ready'`, so reaching it in any other state is a caller that has
   * stopped agreeing with `mining/bar.ts`, and starting nothing is the safe way to disagree.
   */
  const start = useCallback(
    (wanted?: PoolChain) => {
      if (wanted !== undefined) {
        startPool(wanted)
        return
      }
      if (ember.state !== 'ready') return
      startEmber()
    },
    [ember.state, startEmber, startPool],
  )

  // The provider unmounts when the application does. This is the last release of the threads, the
  // socket and the event stream, and it is the only one left now that the page owns none of them.
  useEffect(
    () => () => {
      miner.current?.stop()
      emberMiner.current?.stop()
    },
    [],
  )

  /*
   * A session belongs to an account, so the end of the account is the end of the session. Without
   * this a sign-out would leave two threads hashing and a socket authorised against a ticket minted
   * for somebody who has left, with a bar that no longer offers a way to stop it.
   *
   * The throwaway EMBER key goes with it, and that is the same answer `EmberPanel` gave when it
   * held the key and was unmounted by the sign-out: the key belongs to the session that made it.
   * A sweep that had not landed is the case where that costs something, which is why the mining
   * page offers the key for recovery the moment a sweep does not land, rather than afterwards.
   */
  useEffect(() => {
    if (signedIn) return
    miner.current?.stop()
    miner.current = null
    emberMiner.current?.stop()
    emberMiner.current = null
    keyRef.current = null
    setEmberKey(null)
    setEmberSnapshot(EMBER_IDLE)
    setChain(null)
    setSnapshot(null)
    setTarget(null)
    setCustody(null)
    setCustodyState('asking')
    asked.current = false
  }, [signedIn])

  const setDuty = useCallback((value: number) => {
    setDutyValue(value)
    miner.current?.setDuty(value)
    emberMiner.current?.setDuty(value)
  }, [])

  const setPauseOnBattery = useCallback((value: boolean) => {
    setPauseValue(value)
    miner.current?.setPauseOnBattery(value)
    emberMiner.current?.setPauseOnBattery(value)
  }, [])

  const value = useMemo<MiningSession>(() => {
    const poolRunning =
      snapshot !== null && snapshot.status !== 'stopped' && snapshot.status !== 'idle'
    return {
      summary,
      settled,
      chain,
      snapshot,
      target,
      ember,
      emberKey,
      emberSnapshot,
      running: target === 'ember' ? emberSnapshot.running : poolRunning,
      refusal: deviceRefusal(),
      payoutsImplemented: summary?.payoutsImplemented ?? false,
      duty,
      pauseOnBattery,
      start,
      startEmber,
      createEmberKey,
      stop,
      setDuty,
      setPauseOnBattery,
    }
  }, [
    summary,
    settled,
    chain,
    snapshot,
    target,
    ember,
    emberKey,
    emberSnapshot,
    duty,
    pauseOnBattery,
    start,
    startEmber,
    createEmberKey,
    stop,
    setDuty,
    setPauseOnBattery,
  ])

  return <MiningContext.Provider value={value}>{children}</MiningContext.Provider>
}

/**
 * The first chain the pool can hand work for, in the pool's own ordering.
 *
 * No longer what a bare press starts (micro-org#362) and kept because the mining page's picker
 * still needs to know which chains are startable at all. `isMineable` is the single decision about
 * mineability and it is not second-guessed here.
 */
export function firstMineable(summary: PoolSummary | null): PoolChain | null {
  return summary?.chains.find(isMineable) ?? null
}
