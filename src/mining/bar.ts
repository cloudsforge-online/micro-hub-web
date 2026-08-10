/**
 * The session, as the five states `MiningControl` renders. One function, no hooks, no JSX.
 *
 * It is separated from `components/shell.tsx` because it is where every judgement about what the
 * reader is told lives, and because the alternative shape — a `switch` inside a component — can
 * only be exercised by mounting the whole shell and arranging a browser. Here each state is a
 * value, and `test/mining-bar.test.ts` walks every answer, including the one that is `undefined`.
 *
 * ── WHAT A BARE PRESS STARTS (micro-org#362) ──────────────────────────────────────────────────
 *
 * EMBER, when EMBER can be started safely, and otherwise NOTHING. This function used to end with
 * an unconditional `idle` whose `onStart` started `summary.chains.find(isMineable)` — the pool's
 * first startable chain, which on this deployment is LTC and only LTC, because bitcoind and
 * dogecoind are still in initial block download. So the bar's one press mined Litecoin, and the
 * estate's own chain was the one thing it would not mine. `mining/session.tsx` carries the full
 * argument and the mainnet measurement behind it.
 *
 * The judgement that used to keep EMBER out of the bar — starting it mints a bearer key the reader
 * never read about — is true only when the reward has to STAY on that key. When the account has a
 * watched custodial EMBER deposit address the reward is swept to it and the key is an
 * implementation detail of a transfer, so there is nothing to consent to and nothing is hidden.
 * `MiningSession.ember` is that distinction, already made, and this function only reads it.
 *
 * ── THE ORDER OF THE CHECKS IS THE DESIGN ─────────────────────────────────────────────────────
 *
 * 1. **A live session outranks everything, including a refusal.** A miner that is running is a fact
 *    about this tab — threads, and a socket or an event stream — and the one thing the reader must
 *    always be able to do is stop it. A refusal genuinely can arrive mid-session. Checking the
 *    refusal first replaces the Stop with a disabled control at exactly that moment, which is the
 *    defect `pages/mine.tsx`'s old teardown comment named in advance — "there is no longer anything
 *    on screen to turn it off". Found by `test/mining-bar.test.ts` before it reached a browser,
 *    which is why that file is pure.
 *
 *    A live session also carries its own SUBJECT rather than being assumed to be EMBER. A reader
 *    who started LTC from the mining page's picker must see the pool's Stop, with the pool's shares
 *    and the pool's clause, and must not be hijacked by a change about what a BARE press does.
 * 2. **Then a refusal, over everything that is not already running.** A browser with no Web Workers
 *    cannot mine anything for a signed-in reader either — offering Sign in first would walk
 *    somebody through an authentication for a control that was never going to work. What is NOT
 *    here any more is the pool's own troubles: a pool with no published endpoint, or with every
 *    node in initial block download, no longer disables this control, because the press does not
 *    touch the pool. See `deviceRefusal` for what that leaves.
 * 3. **Signed out, before anything about an account.** This is the state a stranger arrives in, and
 *    Sign in is the honest next move whatever the answer would have been: there is no deposit
 *    address and no pool ticket without a session.
 * 4. **Nothing at all until it is known where a found block would go.** `idle` claims a press will
 *    start something and `elsewhere` claims it will not; both are guesses before `POST /v1/deposits`
 *    lands, and both are claims about somebody's money. The control appears when there is something
 *    true to say, which costs one small element arriving late in the bar and buys never having said
 *    the wrong thing. This check used to wait on `GET /v1/pool` — the same shape, pointed at the
 *    question that now decides the press.
 * 5. **Then `idle` or `elsewhere`**, which is the whole fix. Ready means the press starts EMBER in
 *    sweep mode and the reward reaches the account. Blocked means the press is an ANCHOR to this
 *    surface's own mining page with EMBER selected, carrying the reason — never a silent fall back
 *    to a pool chain, and never a silently minted key.
 */
import { HUB_MINE_PATH, surface, type MiningControlProps, type MiningSubject } from '@cloudsforge/ui'
import type { EmberOffer } from './session.tsx'

/**
 * A session that is running right now, reduced to the two things the bar renders.
 *
 * `readout` is nullable because a miner that has connected and not yet measured a window has
 * nothing to report; zero is substituted at the edge below rather than invented here.
 */
export interface BarLiveSession {
  readonly subject: MiningSubject
  readonly readout: { readonly hashrate: number; readonly accepted: number } | null
}

export interface BarMiningInput {
  readonly signedIn: boolean
  /** The running session, or null. Null is not "idle"; it is "nothing is running". */
  readonly live: BarLiveSession | null
  /** Why nothing can be mined in this browser at all, or null. */
  readonly refusal: string | null
  /** What a bare press would do about EMBER, from `MiningSession`. */
  readonly ember: EmberOffer
  /** The pool's own flag, for the states that describe the pool. False on this estate. */
  readonly payoutsImplemented: boolean
  readonly onSignIn: () => void
  readonly onStart: () => void
  readonly onStop: () => void
}

/**
 * Where a reader goes when the press cannot start EMBER: this surface's mining page, with EMBER
 * already selected, so the two self-custody screens are the first thing they read.
 *
 * Root-relative and not absolute, which is the one place this differs from `miningOnHub()`. That
 * helper composes an absolute address because it is called from thirteen OTHER origins, which have
 * to name Forge Hub to reach it. This anchor is rendered on Forge Hub, so the origin is the one
 * the document is already on and writing it out would mean resolving a host to point at ourselves.
 */
export const EMBER_MINE_HREF = `${HUB_MINE_PATH}?chain=ember`

/** The props for the bar's mining control, or `undefined` for "say nothing yet". */
export function barMining(input: BarMiningInput): MiningControlProps | undefined {
  const payoutsImplemented = input.payoutsImplemented

  if (input.live !== null) {
    return {
      phase: 'mining',
      onStop: input.onStop,
      subject: input.live.subject,
      // Zero is the honest reading of a miner that has connected and not yet measured a window —
      // it is what `PoolMiner` reports until it has half a second of samples, and inventing
      // anything else would put a number on the page that nothing measured.
      readout: {
        hashrate: input.live.readout?.hashrate ?? 0,
        accepted: input.live.readout?.accepted ?? 0,
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
  if (input.ember.state === 'asking') return undefined
  if (input.ember.state === 'ready') {
    return { phase: 'idle', onStart: input.onStart, subject: 'ember', payoutsImplemented }
  }
  return {
    phase: 'elsewhere',
    href: EMBER_MINE_HREF,
    hostSurfaceName: surface('hub').name,
    subject: 'ember',
    reason: input.ember.reason,
    payoutsImplemented,
  }
}
