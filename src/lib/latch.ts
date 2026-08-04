/**
 * One in-flight action per control, held in a ref rather than in component state.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────────────────────────
 *
 *   A GUARD WRITTEN AS COMPONENT STATE CANNOT SEE A SECOND EVENT IN THE SAME TICK.
 *
 * Every write on this surface used to be guarded either by `if (busy) return` read out of the
 * render closure, or by nothing at all beyond `disabled={busy}`. Both have the same hole, from
 * opposite ends:
 *
 *   - `setBusy(true)` only SCHEDULES a render. Two clicks dispatched before React commits both
 *     read `busy === false` from their own closures, and both run.
 *   - `disabled={busy}` is not on the DOM node until that render commits, and the second event
 *     was already dispatched.
 *
 * A comment in `components/send.tsx` used to defend the first of those, asserting that "React
 * batches the `setBusy(true)` below before the next click can be processed". It does not, and the
 * same false comment was copy-pasted across this estate's frontends — `micro-admin-web`,
 * `micro-devportal-web` and `micro-foresight-admin-web` each removed their own copy of it.
 *
 * ── WHY A DOWNSTREAM RESCUE IS NOT A GUARD ────────────────────────────────────────────────────
 *
 * On Send the net effect was survivable, and that is exactly why the hole lasted: one intent mints
 * one `Idempotency-Key` (`lib/idempotency.ts`), both requests carry it, and `wallet` replays the
 * second — so no money moved twice. That is the SERVICE cleaning up after this client. It says
 * nothing about the routes that carry no key, and this app has several: `POST /v1/deposits` with
 * `rotate`, `POST /v1/exports/:id/redeem`, `POST /auth/mfa`, `POST /auth/register`. On those the
 * second request is a second effect, or a refusal reported over a success.
 *
 * How many times a browser sends is the one thing about a duplicate that is squarely the client's
 * own. It belongs here rather than in a service.
 *
 * ── THE SHAPE ─────────────────────────────────────────────────────────────────────────────────
 *
 *   const latch = useLatch()
 *   const act = () => {
 *     if (!latch.take()) return       // synchronous, BEFORE the first await
 *     setBusy(true)                   // affordance only, never the guard
 *     doWork().finally(() => { latch.release(); setBusy(false) })
 *   }
 *
 * `take()` and `release()` are deliberately separate rather than wrapped around a promise: the
 * call sites here are a mix of `async` and `.then()` chains, and a wrapper that hid the `finally`
 * would make it easy to write a release that does not run on the throwing path.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { useRef } from 'react'

export interface Latch {
  /**
   * Take the latch, or answer `false` if it is already held.
   *
   * Synchronous and total: it must be called before the first `await` of the work it guards,
   * because everything after that point is a later tick and a later tick is too late.
   */
  take(): boolean
  /**
   * Release it. **Always from a `finally`.**
   *
   * Releasing on the success path only would leave the control permanently dead the first time
   * the work threw — which is the failure mode that gets a latch deleted rather than fixed.
   */
  release(): void
}

export function useLatch(): Latch {
  // Not `useState`: the whole point is a value written and read in the same tick.
  //
  // Under `<StrictMode>` (src/main.tsx:33) React double-invokes the component function on mount,
  // so this initialiser runs twice and one of the two refs is discarded. That is harmless — both
  // start `false`, and from the first commit onwards there is exactly one ref, which is the one
  // both clicks of a double click read. `test/double-submit.test.ts` proves every scenario in
  // both modes, because a guard that has only ever run outside StrictMode is a guard that has
  // never run the way this app runs it.
  const held = useRef(false)

  // The object identity is stable for the life of the component, so this may be read from an
  // effect's dependency list without re-running it. A fresh `{ take, release }` per render would
  // still work — the latch is `held`, not the wrapper — but a stable one is cheaper to reason
  // about, and `test/double-submit.test.ts` asserts the ref survives a re-render mid-flight.
  const api = useRef<Latch | null>(null)
  if (api.current === null) {
    api.current = {
      take() {
        if (held.current) return false
        held.current = true
        return true
      },
      release() {
        held.current = false
      },
    }
  }
  return api.current
}
