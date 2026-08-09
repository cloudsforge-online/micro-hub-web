/**
 * One pool mining thread.
 *
 * Scrypt at Litecoin's parameters is 128 KiB of memory traffic and about seven hundred microseconds
 * per hash on the machine this was measured on (1,457 H/s single-threaded, 2026-08-09). On the main
 * thread that is a seven-hundred-microsecond stall per hash — at any useful rate the page would
 * simply stop responding, and no amount of batching hides it, because the work is not divisible
 * below one hash. **So this runs in a Worker, and the page never computes a proof of work.** That is
 * not an optimisation, it is the difference between a page that scrolls and one that does not.
 *
 * ── HOW THE THREADS DIVIDE THE WORK ───────────────────────────────────────────────────────────
 *
 * Each worker owns the extranonce2 values congruent to its index modulo the worker count: worker 0
 * takes 0, 4, 8…, worker 1 takes 1, 5, 9… Two threads therefore never build the same coinbase, so
 * they never search the same header space, and they achieve this without sharing anything or taking
 * a lock. `network-site/src/mining/worker.js` partitions the NONCE by stride for the same reason;
 * partitioning the extranonce2 instead is the change that matters here, because the coinbase and
 * the merkle root are then constant for a whole sweep and are computed once rather than per hash.
 * At a browser's hash rate a single extranonce2 holds a fortnight of nonces, so in practice each
 * thread stays on its first one for the life of a job.
 *
 * ── AND WHY IT YIELDS ─────────────────────────────────────────────────────────────────────────
 *
 * Ported unchanged in shape from `network-site/src/mining/worker.js`, whose comment states the real
 * reason and is worth repeating: a Worker that never yields cannot receive `postMessage`, so a stop
 * or a new job would sit in the queue until the current run finished. Yielding is what makes the
 * miner interruptible; the duty cycle is what makes it polite. `duty <= 0` is a real pause — an
 * unplugged laptop gets zero and hashes nothing at all, while the loop stays alive so a later
 * `tune` resumes without needing a fresh job.
 *
 * ── ONE DELIBERATE CHANGE FROM THE PORT (2026-08-09) ──────────────────────────────────────────
 *
 * The batch size is 32, not 64. The Ember hash the original grinds is microseconds; scrypt is
 * ~0.7 ms, so 64 hashes is a 45 ms block of unresponsiveness in which a `stop` cannot be seen, and
 * a reader pressing Stop would wait almost a frame and a half for it. 32 halves that to ~22 ms,
 * near enough one frame, at a batching overhead that is not measurable. SHA-256d chains get a far
 * larger batch for exactly the inverse reason — see `BATCH`.
 */
import { scryptPow } from '../lib/scrypt.ts'
import { sha256d } from '../lib/sha256.ts'
import {
  bytesToHex,
  difficultyOfHash,
  extranonce2,
  headerFor,
  meetsTarget,
  targetForDifficulty,
  writeNonce,
  type PowAlgorithm,
  type StratumJob,
} from '../lib/stratum.ts'

/* ══════════════════════════════ the messages ══════════════════════════════ */

/**
 * A job, as the page hands it over.
 *
 * `StratumJob` holds `Uint8Array`s, which the structured clone algorithm copies faithfully, so the
 * parsed job crosses unchanged rather than being re-parsed here. Parsing in one place is what stops
 * the Worker and the page from ever disagreeing about a header.
 */
export interface WorkerJobMessage {
  readonly type: 'job'
  readonly job: StratumJob
  readonly extranonce1: Uint8Array
  readonly extranonce2Size: number
  readonly algorithm: PowAlgorithm
  readonly difficulty: number
  /** This thread's index, and how many there are. Together they partition the search. */
  readonly index: number
  readonly count: number
}

export interface WorkerTuneMessage {
  readonly type: 'tune'
  /** 0 pauses, 1 is flat out. Anything between sleeps proportionally after each batch. */
  readonly duty: number
}

export interface WorkerDifficultyMessage {
  readonly type: 'difficulty'
  readonly difficulty: number
}

export interface WorkerStopMessage {
  readonly type: 'stop'
}

export type WorkerInbound =
  | WorkerJobMessage
  | WorkerTuneMessage
  | WorkerDifficultyMessage
  | WorkerStopMessage

export interface WorkerProgressMessage {
  readonly type: 'progress'
  readonly hashes: number
  readonly ms: number
}

/**
 * A share.
 *
 * Carries the five fields `mining.submit` needs and nothing else — assembling the parameter array is
 * `lib/stratum.ts`'s job, and doing it here would put the protocol in two places.
 *
 * `difficulty` is what the digest ACHIEVED, not what it was credited at. The page shows both,
 * because a share that clears its target by a factor of ten is the only visible evidence a miner
 * has that the pool's difficulty is set too low for them.
 */
export interface WorkerSolvedMessage {
  readonly type: 'solved'
  readonly jobId: string
  readonly extranonce2Hex: string
  readonly ntimeHex: string
  readonly nonceHex: string
  readonly difficulty: number
}

export type WorkerOutbound = WorkerProgressMessage | WorkerSolvedMessage

/* ══════════════════════════════ the loop ══════════════════════════════ */

/**
 * Hashes per batch, by algorithm.
 *
 * Chosen so a batch is roughly one animation frame of work, which is the unit that matters: it
 * bounds how long a `stop` waits, and it bounds the granularity of the duty cycle. Scrypt at
 * ~0.7 ms per hash reaches that at 32; SHA-256d over an 80-byte header is some four microseconds,
 * so it needs four thousand of them to fill the same window and would otherwise spend most of its
 * time in `postMessage` rather than hashing.
 */
const BATCH: Record<PowAlgorithm, number> = { scrypt: 32, sha256d: 4096 }

interface Work {
  readonly job: StratumJob
  readonly algorithm: PowAlgorithm
  readonly extranonce1: Uint8Array
  readonly extranonce2Size: number
  readonly index: number
  readonly count: number
  /** The header for the current extranonce2, with only the nonce still moving. */
  header: Uint8Array
  extranonce2Hex: string
  counter: number
  nonce: number
  target: bigint
  difficulty: number
}

let work: Work | null = null
let duty = 1
let running = false

/** The one place the algorithm is chosen. Everything else is byte-identical between the two. */
function powHash(algorithm: PowAlgorithm, header: Uint8Array): Uint8Array {
  return algorithm === 'scrypt' ? scryptPow(header) : sha256d(header)
}

/** Move to the next extranonce2 this thread owns, and rebuild the header for it. */
function nextSweep(state: Work): void {
  const value = extranonce2(state.counter, state.extranonce2Size)
  state.extranonce2Hex = bytesToHex(value)
  state.header = headerFor({ job: state.job, extranonce1: state.extranonce1, extranonce2: value })
  state.counter += state.count
  state.nonce = 0
}

function begin(message: WorkerJobMessage): void {
  const state: Work = {
    job: message.job,
    algorithm: message.algorithm,
    extranonce1: message.extranonce1,
    extranonce2Size: message.extranonce2Size,
    index: message.index,
    count: Math.max(1, message.count),
    header: new Uint8Array(80),
    extranonce2Hex: '',
    // Starts at this thread's index so the very first sweep is already disjoint from its siblings'.
    counter: message.index,
    nonce: 0,
    target: targetForDifficulty(message.algorithm, message.difficulty),
    difficulty: message.difficulty,
  }
  nextSweep(state)
  work = state
  if (!running) {
    running = true
    tick()
  }
}

function tick(): void {
  const state = work
  if (!running || state === null) {
    running = false
    return
  }
  // A real pause, not a slow trickle. The loop stays alive so a later `tune` resumes it.
  if (duty <= 0) {
    setTimeout(tick, 500)
    return
  }

  const started = performance.now()
  const batch = BATCH[state.algorithm]
  for (let i = 0; i < batch; i += 1) {
    writeNonce(state.header, state.nonce)
    const digest = powHash(state.algorithm, state.header)
    if (meetsTarget(digest, state.target)) {
      post({
        type: 'solved',
        jobId: state.job.jobId,
        extranonce2Hex: state.extranonce2Hex,
        ntimeHex: state.job.ntimeHex,
        // The submitted nonce is the STRATUM spelling — big-endian hex of the scalar, which is the
        // reverse of the four bytes sitting in the header. `writeNonce` performs that swap on the
        // way in; re-reading the header here would submit the mirror image and be rejected as low
        // difficulty, with everything about the share otherwise correct.
        nonceHex: state.nonce.toString(16).padStart(8, '0'),
        difficulty: difficultyOfHash(state.algorithm, digest),
      })
      // Keep grinding. A share is not the end of a job — the pool wants every share this thread can
      // find until it says otherwise, which is the whole basis of the share accounting.
      state.nonce += 1
      continue
    }
    state.nonce += 1
    if (state.nonce > 0xffffffff) {
      nextSweep(state)
      break
    }
  }

  const spent = performance.now() - started
  post({ type: 'progress', hashes: batch, ms: spent })

  // Polite mining: at duty 0.35 the thread sleeps roughly twice as long as it worked, so the machine
  // stays usable and the fans stay quiet. Capped at 250 ms so a low duty cycle stays responsive to
  // a stop. At duty 1 it only yields, which it must do regardless — see the header.
  const rest = duty >= 1 ? 0 : Math.min(250, spent * (1 / duty - 1))
  setTimeout(tick, rest > 1 ? rest : 0)
}

/* ══════════════════════════════ the seam ══════════════════════════════ */

/**
 * `postMessage` and `onmessage`, reached through globals rather than `self`.
 *
 * A Worker's `self` is a `DedicatedWorkerGlobalScope`, which the DOM library does not give this
 * file — `tsc` is configured for a browser page, not for a worker, and adding the worker lib
 * globally would let page code call worker-only APIs and typecheck. Narrowing here keeps the
 * mistake impossible in both directions, at the cost of one cast in one place.
 *
 * It also makes the module importable by a test, which cannot happen if the module body touches a
 * global that only exists inside a Worker.
 */
declare const self: {
  onmessage: ((event: { data: WorkerInbound }) => void) | null
  postMessage: (message: WorkerOutbound) => void
}

function post(message: WorkerOutbound): void {
  self.postMessage(message)
}

export function handle(message: WorkerInbound): void {
  switch (message.type) {
    case 'job':
      begin(message)
      return
    case 'tune':
      duty = message.duty
      return
    case 'difficulty': {
      const state = work
      if (state === null) return
      // Recomputing the target rather than restarting the sweep: a difficulty change does not
      // invalidate the job, and throwing away a partly searched nonce range for it would discard
      // work the pool would still have credited.
      state.difficulty = message.difficulty
      state.target = targetForDifficulty(state.algorithm, message.difficulty)
      return
    }
    case 'stop':
      running = false
      work = null
      return
  }
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (event) => handle(event.data)
}
