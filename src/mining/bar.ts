/**
 * The session, as the five states `MiningControl` renders. One function, no hooks, no JSX.
 *
 * It is separated from `components/shell.tsx` because it is where every judgement about what the
 * reader is told lives, and because the alternative shape — a `switch` inside a component — can
 * only be exercised by mounting the whole shell and arranging a browser. Here each state is a
 * value, and `test/mining-bar.test.ts` walks all five answers — the four phases below and the one
 * that is `undefined` — as well as the phase this function must NEVER return.
 *
 * ── THE ORDER OF THE CHECKS IS THE DESIGN ─────────────────────────────────────────────────────
 *
 * 1. **A live session outranks everything, including a refusal.** A miner that is running is a fact
 *    about this tab — two threads and an open socket — and the one thing the reader must always be
 *    able to do is stop it. A refusal genuinely can arrive mid-session: the pool's last mineable
 *    chain going `not-ready` is what a node restarting looks like from here, and it is the ordinary
 *    case rather than a corner. Checking the refusal first replaces the Stop with a disabled
 *    control at exactly that moment, which is the defect `pages/mine.tsx`'s old teardown comment
 *    named in advance — "there is no longer anything on screen to turn it off". Found by
 *    `test/mining-bar.test.ts` before it reached a browser, which is why that file is pure.
 * 2. **Then a refusal, over everything that is not already running.** A browser with no Web Workers,
 *    or a deployment that has published no address, cannot mine for a signed-in reader either —
 *    offering Sign in first would walk somebody through an authentication for a control that was
 *    never going to work.
 * 3. **Signed out, before the pool has answered.** This is the state a stranger arrives in, and the
 *    honest first step is the same whatever the pool says: there is no ticket without a session
 *    (`POST /v1/pool/ticket`), so Sign in is the next move either way.
 * 4. **Nothing at all until the pool has answered**, for a signed-in reader. `idle` claims a press
 *    will start something and `unavailable` claims it will not; both are guesses before
 *    `GET /v1/pool` lands. The control appears when there is something true to say, which costs one
 *    small element arriving late in the bar and buys never having said the wrong thing.
 */
import type { MiningControlProps } from '@cloudsforge/ui'
import type { PoolMinerSnapshot } from './pool-miner.ts'

export interface BarMiningInput {
  readonly signedIn: boolean
  /** Has `GET /v1/pool` answered, one way or the other? */
  readonly settled: boolean
  readonly running: boolean
  /** Why nothing can be mined here, or null. */
  readonly refusal: string | null
  readonly snapshot: Pick<PoolMinerSnapshot, 'hashrate' | 'accepted'> | null
  readonly payoutsImplemented: boolean
  readonly onSignIn: () => void
  readonly onStart: () => void
  readonly onStop: () => void
}

/** The props for the bar's mining control, or `undefined` for "say nothing yet". */
export function barMining(input: BarMiningInput): MiningControlProps | undefined {
  const payoutsImplemented = input.payoutsImplemented

  if (input.running) {
    return {
      phase: 'mining',
      onStop: input.onStop,
      // Zero is the honest reading of a miner that has connected and not yet measured a window —
      // it is what `PoolMiner` reports until it has half a second of samples, and inventing
      // anything else would put a number on the page that nothing measured.
      readout: {
        hashrate: input.snapshot?.hashrate ?? 0,
        accepted: input.snapshot?.accepted ?? 0,
      },
      payoutsImplemented,
    }
  }
  if (input.refusal !== null) {
    return { phase: 'unavailable', reason: input.refusal, payoutsImplemented }
  }
  if (!input.signedIn) {
    return { phase: 'signed-out', onSignIn: input.onSignIn, payoutsImplemented }
  }
  if (!input.settled) return undefined
  return { phase: 'idle', onStart: input.onStart, payoutsImplemented }
}
