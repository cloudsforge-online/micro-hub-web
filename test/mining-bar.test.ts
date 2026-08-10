/**
 * WHAT THE BAR TELLS A READER ABOUT MINING, WALKED STATE BY STATE.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE HAS NO DOM IN IT
 *
 * `src/mining/bar.ts` is where every judgement about what the reader is told lives, and it is a
 * function from a session to a set of props. The shell's own scenarios (`test/head.test.ts`,
 * `test/journeys.test.ts`) mount it for real and press it; what they cannot do cheaply is arrange
 * eight combinations of "signed in / pool answered / miner running / device refuses" in a browser,
 * one mount each. The states this function distinguishes are precisely the states nobody arranges
 * by accident, so they are asserted here as values.
 *
 * ── THE ONE ASSERTION THIS FILE EXISTS FOR ────────────────────────────────────────────────────
 *
 * That the control is SILENT rather than wrong while `GET /v1/pool` is in flight. `idle` claims a
 * press will start something and `unavailable` claims it will not; both are guesses before the pool
 * has answered, and the estate's honesty regime (`pool/src/payouts.ts`, `pool-web`'s notices) is a
 * regime about not saying things that are not measured. `undefined` is the fifth answer and it is
 * the one a refactor deletes first, because it looks like a missing case.
 *
 * ── AND THAT `elsewhere` NEVER COMES FROM HERE ────────────────────────────────────────────────
 *
 * `MiningControl` has five phases and this function returns four of them. `elsewhere` is the answer
 * for the thirteen surfaces that do not host the miner, and it is produced by `miningOnHub()` in the
 * design system. Forge Hub returning it would render a link to Forge Hub's own mining page from
 * Forge Hub's own bar, which is a control that does nothing on the surface that can actually do it.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NOT_PAID_CLAUSE, type MiningControlProps } from '@cloudsforge/ui'

import { barMining, type BarMiningInput } from '../src/mining/bar.ts'

/**
 * The ordinary case: a signed-in reader, on a device that can mine, with a pool that has answered
 * and is not mining yet. Every scenario below changes ONE field of it and says which.
 *
 * The three callbacks are distinguishable on purpose. A control that wired `onStart` to the
 * sign-in press would be invisible to an assertion that only checked "something was called".
 */
const input = (over: Partial<BarMiningInput> = {}): BarMiningInput => ({
  signedIn: true,
  settled: true,
  running: false,
  refusal: null,
  snapshot: null,
  payoutsImplemented: false,
  onSignIn: () => calls.push('signIn'),
  onStart: () => calls.push('start'),
  onStop: () => calls.push('stop'),
  ...over,
})

/** What the props' handlers did, in order. Reset by each scenario that presses anything. */
let calls: string[] = []

/** Press the control, whatever kind of press this phase has. Fails for the two that have none. */
const press = (props: MiningControlProps | undefined): void => {
  assert.ok(props, 'there is no control to press')
  if (props.phase === 'signed-out') props.onSignIn()
  else if (props.phase === 'idle') props.onStart()
  else if (props.phase === 'mining') props.onStop()
  else assert.fail(`the ${props.phase} phase carries no press`)
}

/* ══════════════════════════════ the five answers ══════════════════════════════ */

describe('the bar’s mining control', () => {
  it('says nothing at all until the pool has answered, rather than guessing', () => {
    const props = barMining(input({ settled: false }))
    assert.equal(
      props,
      undefined,
      'the control appears before `GET /v1/pool` has answered. Whichever phase it chose is a ' +
        'claim about whether a press will start mining, and nothing has been measured yet',
    )
  })

  it('offers Start to a signed-in reader once the pool has answered', () => {
    calls = []
    const props = barMining(input())
    assert.equal(props?.phase, 'idle')
    press(props)
    assert.deepEqual(calls, ['start'], 'the idle press did not start the session')
  })

  it('invites a stranger to sign in, and does so BEFORE the pool has answered', () => {
    // The state a first-time reader arrives in. `settled: false` is the point: there is no ticket
    // without a session (`POST /v1/pool/ticket`), so Sign in is the next move whatever the pool
    // turns out to say, and waiting for the pool would leave the bar blank for the one reader who
    // has the furthest to go.
    calls = []
    const props = barMining(input({ signedIn: false, settled: false }))
    assert.equal(props?.phase, 'signed-out')
    press(props)
    assert.deepEqual(calls, ['signIn'], 'the signed-out press did not start authentication')
  })

  it('offers Stop while a session is live, and carries the measured figures', () => {
    calls = []
    const snapshot = { hashrate: 412_318, accepted: 9 }
    const props = barMining(input({ running: true, snapshot }))
    assert.equal(props?.phase, 'mining')
    assert.ok(props.phase === 'mining')
    // Read back out of the snapshot the scenario supplied, never written as a literal: a control
    // that rendered a constant would agree with a literal and disagree with the miner.
    assert.deepEqual(props.readout, { hashrate: snapshot.hashrate, accepted: snapshot.accepted })
    press(props)
    assert.deepEqual(calls, ['stop'], 'the mining press did not stop the session')
  })

  it('reads zero for a session that has connected and not yet measured a window', () => {
    // `PoolMiner` reports no snapshot until its meter has samples, and the honest reading of a
    // machine that has started and measured nothing is zero — not a hidden control, and not an
    // invented rate. The Stop must be there the instant the session is, or the first half-second of
    // every session is a session nobody can turn off.
    const props = barMining(input({ running: true, snapshot: null }))
    assert.ok(props?.phase === 'mining')
    assert.deepEqual(props.readout, { hashrate: 0, accepted: 0 })
  })

  it('refuses with a reason when the device or the deployment cannot mine', () => {
    const refusal = 'This browser does not support Web Workers.'
    const props = barMining(input({ refusal }))
    assert.ok(props?.phase === 'unavailable')
    assert.equal(props.reason, refusal, 'the refusal the session gave is not the one shown')
  })

  /* ── the order of the checks, which is the part that is easy to get wrong ─────────────────── */

  it('lets a refusal outrank an invitation to sign in', () => {
    // Otherwise a stranger on a machine that cannot mine is walked through creating an account,
    // confirming an address and signing in, to arrive at a control that was never going to work.
    const props = barMining(input({ signedIn: false, settled: false, refusal: 'No WebSockets here.' }))
    assert.equal(props?.phase, 'unavailable')
  })

  it('lets a live session outrank a refusal that arrived after it started', () => {
    // A refusal can appear mid-session — the pool's last mineable chain going `not-ready` while a
    // browser is connected to it is the ordinary case, and it is what a node restarting looks like.
    // The threads and the socket are still this tab's to release, so the one thing the reader must
    // never lose is the Stop.
    calls = []
    const props = barMining(
      input({ running: true, snapshot: { hashrate: 1, accepted: 0 }, refusal: 'The pool has no work.' }),
    )
    assert.equal(
      props?.phase,
      'mining',
      'a refusal replaced the Stop on a session that is still running — the miner keeps every ' +
        'core busy and there is now nothing on screen to turn it off',
    )
    press(props)
    assert.deepEqual(calls, ['stop'])
  })

  it('never returns the phase that belongs to the other thirteen surfaces', () => {
    // `elsewhere` is a link to Forge Hub. From Forge Hub's own bar it is a control that leaves the
    // reader where they already are and does nothing.
    const every = [
      barMining(input()),
      barMining(input({ settled: false })),
      barMining(input({ signedIn: false })),
      barMining(input({ running: true, snapshot: { hashrate: 1, accepted: 1 } })),
      barMining(input({ refusal: 'nothing to mine' })),
    ]
    for (const props of every) {
      assert.notEqual(props?.phase, 'elsewhere', 'Forge Hub linked to Forge Hub')
    }
  })

  /* ── the honesty flag, in every answer ────────────────────────────────────────────────────── */

  it('carries the pool’s own payout flag into every phase, unchanged', () => {
    // Not a constant here and not a default here. `pool/src/payouts.ts` derives it, the session
    // reads it off `GET /v1/pool`, and this function is the only thing between the two. Both values
    // are walked so that a function which hard-coded either one is red.
    for (const payoutsImplemented of [false, true]) {
      const every = [
        barMining(input({ payoutsImplemented })),
        barMining(input({ payoutsImplemented, signedIn: false })),
        barMining(input({ payoutsImplemented, running: true, snapshot: { hashrate: 2, accepted: 2 } })),
        barMining(input({ payoutsImplemented, refusal: 'nothing to mine' })),
      ]
      for (const props of every) {
        assert.equal(
          props?.payoutsImplemented,
          payoutsImplemented,
          `the ${props?.phase} phase rewrote the pool's payout flag`,
        )
      }
    }
  })

  it('does not put a number, a currency or an earnings word anywhere near the reader', () => {
    // The design system renders the copy and `ui`'s own `mining.test.ts` asserts the rendered
    // string. What is asserted HERE is the half that lives in this repository: that nothing this
    // function produces is an amount. There is no prop for one — `MiningControlProps` has no field
    // for a balance, a projection or a currency — so the only way an amount could reach the bar is
    // through the readout, and both of its fields are work.
    const props = barMining(input({ running: true, snapshot: { hashrate: 412_318, accepted: 9 } }))
    assert.ok(props?.phase === 'mining')
    assert.deepEqual(
      Object.keys(props.readout).sort(),
      ['accepted', 'hashrate'],
      'the readout grew a third field. Hashes and shares are work; a third number in this ' +
        'position is read as what the work paid, and nothing is paid',
    )
    // And the clause the design system attaches when the flag is false is a real exported string,
    // not a paraphrase this repository maintains a second copy of.
    assert.ok(
      NOT_PAID_CLAUSE.length > 0 && !/\d/.test(NOT_PAID_CLAUSE),
      'the not-paid clause carries a figure. `pool-web` set the standard: no number accompanies ' +
        'it, because a zero reads as “not yet, but soon” and the truth is “not at all”',
    )
  })
})
