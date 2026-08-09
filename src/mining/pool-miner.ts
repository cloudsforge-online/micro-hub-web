/**
 * Pool mining, assembled: a Stratum connection, a pool of Workers, and the politeness policy.
 *
 * `lib/stratum.ts` is the protocol, `lib/stratum-client.ts` is the socket, `pool-worker.ts` is the
 * grind. This is the only file that knows about all three, and it exists so `pages/mine.tsx` can
 * render a snapshot and press two buttons rather than orchestrate threads.
 *
 * ── THE POLITENESS POLICY IS PORTED, NOT REINVENTED ───────────────────────────────────────────
 *
 * `effectiveDuty` below is `network-site/src/mining/miner.js`'s function, carried over with its
 * reasoning intact because the reasoning is about people and hardware and did not change when the
 * hash did:
 *
 *   * unplugged means STOP — "a miner that quietly drains someone's laptop is the behaviour that
 *     makes browser mining a dirty word";
 *   * a hidden tab gets a trickle, because the browser throttles its timers anyway and fighting
 *     that burns power for very little hashing;
 *   * there is deliberately no "the machine is idle" term. A page cannot see whether somebody is at
 *     the keyboard. `requestIdleCallback` means this tab's event loop is quiet, which is always
 *     true of a page that is only mining, and the Idle Detection API is permission-gated and
 *     Chromium-only. `document.hidden` is the strongest honest signal available.
 *
 * The Battery Status API is Chromium-only — Firefox and Safari removed it as a fingerprinting
 * surface — so `powerKnown` is reported separately from `onPower` and the page says which of the
 * two it got. Promising power-awareness on a browser that cannot provide it would be a lie told to
 * the reader most likely to care about it.
 *
 * ── ONE DELIBERATE DIFFERENCE FROM THE EMBER MINER (2026-08-09) ───────────────────────────────
 *
 * The EMBER miner spawns `hardwareConcurrency - 1` threads. This one spawns at most two, and the
 * default is `min(2, hardwareConcurrency - 1)`.
 *
 * Scrypt at Litecoin's parameters is 128 KiB of random access per hash, and 128 KiB is the size of
 * an L2 slice on most of the machines this will run on. Two threads fit; eight do not, and they do
 * not fail gracefully — they evict each other's ROMix tables and every thread slows down, so eight
 * threads deliver appreciably less than two while making the machine unusable and the fans audible.
 * This is the memory-hardness working exactly as Colin Percival designed it, on the wrong side.
 */
import { miningBlocker, type PoolChain } from '../lib/pool.ts'
import { StratumClient, type ShareOutcome, type StratumStatus } from '../lib/stratum-client.ts'
import type { StratumJob, Subscription } from '../lib/stratum.ts'
import type { WorkerInbound, WorkerOutbound } from './pool-worker.ts'

/** See the header. Two, and the reason is L2, not politeness. */
const MAX_THREADS = 2

/** The meter's window. Long enough to settle, short enough that stopping shows within a breath. */
const RATE_WINDOW_MS = 10_000

export interface PoolMinerSnapshot {
  readonly status: StratumStatus
  readonly detail: string
  /** Measured, in hashes per second, over the last ten seconds. Never the pool's estimate. */
  readonly hashrate: number
  /** Every hash this session has computed, since Start. */
  readonly hashes: number
  readonly difficulty: number
  readonly accepted: number
  readonly rejected: number
  /** Refused as stale (error 21). Counted apart from `rejected` because it is not a fault. */
  readonly stale: number
  readonly lastRejection: string | null
  /** The pool's opaque account for this user, once a ticket has named it. Safe to display. */
  readonly account: string | null
  readonly worker: string | null
  readonly height: number | null
  readonly threads: number
  readonly duty: number
  readonly effectiveDuty: number
  readonly hidden: boolean
  readonly onPower: boolean
  readonly powerKnown: boolean
}

interface Sample {
  readonly at: number
  readonly n: number
}

export interface PoolMinerOptions {
  readonly chain: PoolChain
  readonly onChange: (snapshot: PoolMinerSnapshot) => void
  readonly duty?: number
  readonly pauseOnBattery?: boolean
  /** Test seam. A real `Worker` in a browser; a fake in the harness. */
  readonly spawn?: () => WorkerLike
  readonly client?: StratumClient
}

/** The part of `Worker` this drives. Narrow so a test can supply four methods, not a thread. */
export interface WorkerLike {
  postMessage(message: WorkerInbound): void
  terminate(): void
  onmessage: ((event: { data: WorkerOutbound }) => void) | null
}

export class PoolMiner {
  readonly chain: PoolChain
  #onChange: (snapshot: PoolMinerSnapshot) => void
  #spawn: () => WorkerLike
  #client: StratumClient | null = null
  #workers: WorkerLike[] = []
  #samples: Sample[] = []
  #meter: ReturnType<typeof setInterval> | null = null
  #battery: (EventTarget & { charging: boolean; level: number }) | null = null
  #onCharging: (() => void) | null = null
  #onVisibility: () => void

  #running = false
  #status: StratumStatus = 'idle'
  #detail = ''
  #hashrate = 0
  #hashes = 0
  #difficulty = 1
  #accepted = 0
  #rejected = 0
  #stale = 0
  #lastRejection: string | null = null
  #account: string | null = null
  #workerName: string | null = null
  #height: number | null = null
  #duty: number
  #pauseOnBattery: boolean
  #onPower = true
  #powerKnown = false

  constructor(options: PoolMinerOptions) {
    this.chain = options.chain
    this.#onChange = options.onChange
    this.#duty = options.duty ?? 0.6
    this.#pauseOnBattery = options.pauseOnBattery ?? true
    this.#spawn = options.spawn ?? defaultSpawn
    if (options.client) this.#client = options.client
    this.#onVisibility = () => this.#applyDuty()
  }

  snapshot(): PoolMinerSnapshot {
    return {
      status: this.#status,
      detail: this.#detail,
      hashrate: this.#hashrate,
      hashes: this.#hashes,
      difficulty: this.#difficulty,
      accepted: this.#accepted,
      rejected: this.#rejected,
      stale: this.#stale,
      lastRejection: this.#lastRejection,
      account: this.#account,
      worker: this.#workerName,
      height: this.#height,
      threads: this.#workers.length,
      duty: this.#duty,
      effectiveDuty: this.effectiveDuty(),
      hidden: typeof document !== 'undefined' && document.hidden,
      onPower: this.#onPower,
      powerKnown: this.#powerKnown,
    }
  }

  /**
   * Start, or refuse in a sentence.
   *
   * A chain the pool has not published a WebSocket endpoint for is refused HERE as well as being
   * disabled in the page, because the two protect different things: the page's disabled control is
   * what a reader sees, and this is what stops a future caller from constructing an endpoint out of
   * `window.location` — the defect micro-org#285 exists to record. There is no code path in this
   * file that builds a URL.
   */
  async start(): Promise<void> {
    if (this.#running) return
    const endpoint = this.chain.websocketEndpoint
    const blocker = miningBlocker(this.chain)
    if (blocker !== null || typeof endpoint !== 'string') {
      this.#status = 'failed'
      // The page does not render a Start control in either case, so reaching this is a caller's
      // mistake rather than a reader's — which is exactly why it names the cause instead of failing
      // with one sentence that fits both.
      this.#detail =
        blocker === 'not-ready'
          ? `the pool has no work for ${this.chain.name} right now`
          : `browser mining has not been published on this deployment for ${this.chain.name}`
      this.#emit()
      return
    }
    this.#running = true
    this.#hashes = 0
    this.#samples = []
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.#onVisibility)
    }
    await this.#watchPower()

    const client =
      this.#client ??
      new StratumClient({
        endpoint,
        onStatus: (status, detail) => {
          this.#status = status
          this.#detail = detail
          // A dropped connection means every in-flight nonce is against a job the pool will no
          // longer accept. Stopping the threads is not tidiness — it is the difference between a
          // reconnect that resumes and one that arrives to find two threads still burning a core on
          // work that cannot be submitted.
          if (status !== 'mining') this.#post({ type: 'stop' })
          this.#emit()
        },
        onDifficulty: (difficulty) => {
          this.#difficulty = difficulty
          this.#post({ type: 'difficulty', difficulty })
          this.#emit()
        },
        onJob: (job, difficulty, subscription) => {
          this.#difficulty = difficulty
          this.#dispatch(job, subscription)
        },
        onShare: (outcome) => this.#share(outcome),
        onIdentity: (account, worker) => {
          this.#account = account
          this.#workerName = worker
          this.#emit()
        },
      })
    this.#client = client
    client.start()
    this.#meter = setInterval(() => this.#measure(), 1_000)
    this.#emit()
  }

  stop(): void {
    this.#running = false
    this.#client?.stop()
    this.#client = null
    for (const worker of this.#workers) {
      worker.postMessage({ type: 'stop' })
      worker.terminate()
    }
    this.#workers = []
    if (this.#meter !== null) {
      clearInterval(this.#meter)
      this.#meter = null
    }
    if (this.#battery && this.#onCharging) {
      this.#battery.removeEventListener('chargingchange', this.#onCharging)
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.#onVisibility)
    }
    this.#hashrate = 0
    this.#status = 'stopped'
    this.#detail = ''
    this.#emit()
  }

  get running(): boolean {
    return this.#running
  }

  setDuty(duty: number): void {
    this.#duty = duty
    this.#applyDuty()
  }

  setPauseOnBattery(on: boolean): void {
    this.#pauseOnBattery = on
    this.#applyDuty()
  }

  /** Ported from `network-site/src/mining/miner.js`. See the header for why each term is here. */
  effectiveDuty(): number {
    if (this.#pauseOnBattery && this.#powerKnown && !this.#onPower) return 0
    const hidden = typeof document !== 'undefined' && document.hidden
    return hidden ? Math.min(this.#duty, 0.15) : this.#duty
  }

  /* ── threads ──────────────────────────────────────────────────────────────────────────────── */

  #dispatch(job: StratumJob, subscription: Subscription): void {
    if (!this.#running) return
    if (this.#workers.length === 0) this.#hire()
    const duty = this.effectiveDuty()
    this.#workers.forEach((worker, index) => {
      worker.postMessage({ type: 'tune', duty })
      worker.postMessage({
        type: 'job',
        job,
        extranonce1: subscription.extranonce1,
        extranonce2Size: subscription.extranonce2Size,
        algorithm: this.chain.algorithm,
        difficulty: this.#difficulty,
        index,
        count: this.#workers.length,
      })
    })
    this.#emit()
  }

  #hire(): void {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4
    const count = Math.max(1, Math.min(MAX_THREADS, cores - 1))
    for (let i = 0; i < count; i += 1) {
      const worker = this.#spawn()
      worker.onmessage = (event) => this.#fromWorker(event.data)
      this.#workers.push(worker)
    }
  }

  #post(message: WorkerInbound): void {
    for (const worker of this.#workers) worker.postMessage(message)
  }

  #applyDuty(): void {
    this.#post({ type: 'tune', duty: this.effectiveDuty() })
    this.#emit()
  }

  #fromWorker(message: WorkerOutbound): void {
    if (message.type === 'progress') {
      this.#hashes += message.hashes
      this.#samples.push({ at: now(), n: message.hashes })
      return
    }
    // A share found microseconds after a drop is simply lost — `submit` returns false and says so
    // by doing nothing. Counting it as rejected would blame the miner for a race it did not lose.
    this.#client?.submit({
      jobId: message.jobId,
      extranonce2Hex: message.extranonce2Hex,
      ntimeHex: message.ntimeHex,
      nonceHex: message.nonceHex,
    })
  }

  #share(outcome: ShareOutcome): void {
    if (outcome.accepted) {
      this.#accepted += 1
    } else if (outcome.code === 21) {
      // JOB_NOT_FOUND. The tip moved between the job being issued and the share being found, which
      // on a fast chain and a slow browser is routine and is not a fault of anybody's.
      this.#stale += 1
    } else {
      this.#rejected += 1
      this.#lastRejection = outcome.message ?? 'the pool refused a share and gave no reason'
    }
    this.#emit()
  }

  /**
   * Hashes per second, measured.
   *
   * A rolling ten-second window over what the threads actually reported — never the pool's own
   * estimate, which is derived from accepted shares and therefore lags by minutes and reads as zero
   * for a browser that has not yet found one. The two numbers are both shown on the page and are
   * labelled differently for that reason.
   */
  #measure(): void {
    const cut = now() - RATE_WINDOW_MS
    this.#samples = this.#samples.filter((sample) => sample.at >= cut)
    const first = this.#samples[0]
    const total = this.#samples.reduce((sum, sample) => sum + sample.n, 0)
    const span = first ? (now() - first.at) / 1000 : 0
    // Below half a second the divisor is small enough that a single batch reads as a wild rate.
    // Zero is the honest answer until there is enough of a window to divide by.
    this.#hashrate = span > 0.5 ? total / span : 0
    this.#emit()
  }

  /* ── power ────────────────────────────────────────────────────────────────────────────────── */

  async #watchPower(): Promise<void> {
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<never> }).getBattery
    if (typeof getBattery !== 'function') {
      // Firefox and Safari. `powerKnown` stays false and mining runs normally; the page says it
      // could not check rather than implying it did.
      return
    }
    let battery: EventTarget & { charging: boolean; level: number }
    try {
      battery = (await getBattery.call(navigator)) as unknown as EventTarget & {
        charging: boolean
        level: number
      }
    } catch {
      return
    }
    this.#battery = battery
    this.#onCharging = () => {
      this.#onPower = battery.charging
      this.#applyDuty()
    }
    battery.addEventListener('chargingchange', this.#onCharging)
    this.#powerKnown = true
    // A machine with no battery reports `charging: true`, which is the answer a desktop wants.
    this.#onCharging()
  }

  #emit(): void {
    this.#onChange(this.snapshot())
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/**
 * A real thread.
 *
 * `new URL('./pool-worker.ts', import.meta.url)` is the form Vite recognises and rewrites into a
 * built worker chunk. A string path here would ship the literal at runtime and 404 in production,
 * where the file is hashed — which is the failure that looks like "mining does nothing on the
 * deployed site and works perfectly in dev".
 */
function defaultSpawn(): WorkerLike {
  return new Worker(new URL('./pool-worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike
}
