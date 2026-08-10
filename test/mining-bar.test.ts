/**
 * WHAT THE BAR TELLS A READER ABOUT MINING, WALKED STATE BY STATE.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE HAS NO DOM IN IT
 *
 * `src/mining/bar.ts` is where every judgement about what the reader is told lives, and it is a
 * function from a session to a set of props. The shell's own scenarios (`test/head.test.ts`,
 * `test/journeys.test.ts`) mount it for real and press it; what they cannot do cheaply is arrange
 * ten combinations of "signed in / where a found block would go / miner running / device refuses"
 * in a browser, one mount each. The states this function distinguishes are precisely the states
 * nobody arranges by accident, so they are asserted here as values.
 *
 * ── THE ASSERTION THIS FILE EXISTS FOR (micro-org#362) ────────────────────────────────────────
 *
 * That a bare press mines EMBER. It used to mine LTC, silently: the function ended in an
 * unconditional `idle` whose `onStart` ran the pool's first startable chain, and on this deployment
 * that is Litecoin and only Litecoin, because bitcoind and dogecoind are still in initial block
 * download. The estate's own chain was the one thing its own bar would not mine. `subject` is how
 * that is asserted as a value — it is carried into the design system, which renders a different
 * sentence and a different honesty clause for each of the two.
 *
 * ── AND THAT THE ALTERNATIVE TO STARTING IS A DESTINATION, NOT A FALLBACK ─────────────────────
 *
 * When EMBER cannot be started safely the press must not quietly become a different chain and must
 * not quietly mint a bearer key. It becomes `elsewhere`: a real anchor to this surface's own mining
 * page with EMBER selected, where the self-custody screens already are, carrying the reason.
 *
 * This is where this file's own older comment was WRONG rather than merely narrow. It said
 * `elsewhere` "never comes from here", on the grounds that Forge Hub linking to Forge Hub is a
 * control that does nothing on the surface that can actually do it. That holds only while the press
 * could always just start. Once the press must NOT start, the mining page is not where the reader
 * already is in any sense that matters — it is two screens they have not read, about money that
 * would otherwise land on a key nobody told them about. The anchor is doing real work.
 *
 * ── AND THAT IT IS SILENT RATHER THAN WRONG WHILE IT DOES NOT KNOW ───────────────────────────
 *
 * `idle` claims a press will start something and `elsewhere` claims it will not; both are guesses
 * before `POST /v1/deposits` has answered, and both are claims about somebody's money. `undefined`
 * is the fifth answer and it is the one a refactor deletes first, because it looks like a missing
 * case.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EMBER_CREDITED_CLAUSE, NOT_PAID_CLAUSE, type MiningControlProps } from '@cloudsforge/ui'

import { EMBER_MINE_HREF, barMining, type BarMiningInput } from '../src/mining/bar.ts'
import type { DepositAssignment } from '../src/lib/money.ts'
import type { EmberOffer } from '../src/mining/session.tsx'

/**
 * A watched custodial EMBER deposit address, which is the whole precondition. Written out here
 * rather than imported from a fixture because the ONE field that decides the answer — `watchedAt`
 * — has to be visible in the scenario that flips it.
 */
const WATCHED: DepositAssignment = {
  id: 'dep_ember_1',
  assetCode: 'EMBER',
  chain: 'ember',
  network: 'mainnet',
  walletId: 'wal_1',
  address: '0x00000000000000000000000000000000000000fe',
  status: 'active',
  assignedAt: '2026-08-10T09:00:00.000Z',
  watchedAt: '2026-08-10T09:00:01.000Z',
}

/** The two offers a settled session can carry. `asking` is the third and it is the silent one. */
const READY: EmberOffer = { state: 'ready', payingIn: WATCHED }
const BLOCKED: EmberOffer = { state: 'blocked', reason: 'There is nowhere for a found block to go.' }

/**
 * The ordinary case: a signed-in reader, on a device that can mine, whose account has a watched
 * EMBER deposit address, not mining yet. Every scenario below changes ONE field of it and says
 * which.
 *
 * The three callbacks are distinguishable on purpose. A control that wired `onStart` to the
 * sign-in press would be invisible to an assertion that only checked "something was called".
 */
const input = (over: Partial<BarMiningInput> = {}): BarMiningInput => ({
  signedIn: true,
  live: null,
  refusal: null,
  ember: READY,
  payoutsImplemented: false,
  onSignIn: () => calls.push('signIn'),
  onStart: () => calls.push('start'),
  onStop: () => calls.push('stop'),
  ...over,
})

/** A running session, reduced to what the bar renders. */
const live = (subject: 'pool' | 'ember', readout: { hashrate: number; accepted: number } | null) => ({
  subject,
  readout,
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

/* ══════════════════════════ 1. what a bare press mines ══════════════════════════ */

describe('the bar’s mining control — what a bare press mines', () => {
  it('offers to mine EMBER, not the pool’s first startable chain', () => {
    // THE MUTATION PROOF for micro-org#362. Delete the `ember` branch and restore the old
    // unconditional `{ phase: 'idle', onStart }` and this goes red on `subject`, because the old
    // props had no subject at all and the old press started `summary.chains.find(isMineable)`.
    calls = []
    const props = barMining(input())
    assert.equal(props?.phase, 'idle')
    assert.ok(props.phase === 'idle')
    assert.equal(
      props.subject,
      'ember',
      'the bar’s one press is not offering EMBER. On this deployment the pool’s first startable ' +
        'chain is LTC and only LTC, so an unsubjected press mines Litecoin from the estate’s own bar',
    )
    press(props)
    assert.deepEqual(calls, ['start'], 'the idle press did not start the session')
  })

  it('does not offer a press at all when there is nowhere for a found block to go', () => {
    // The other half of the same proof. A press here would have to do one of the two things the
    // owner ruled out: start a pool chain the reader did not choose, or mint a bearer key and put
    // the reward on it without saying so.
    const props = barMining(input({ ember: BLOCKED }))
    assert.equal(
      props?.phase,
      'elsewhere',
      'the control still presses when EMBER cannot be started safely. Whatever that press starts ' +
        'is a chain or a key the reader never agreed to',
    )
  })

  it('sends that reader to the mining page with EMBER already selected, carrying the reason', () => {
    const props = barMining(input({ ember: BLOCKED }))
    assert.ok(props?.phase === 'elsewhere')
    assert.equal(props.href, EMBER_MINE_HREF)
    assert.match(props.href, /[?&]chain=ember\b/, 'the link lands on the picker’s default, not EMBER')
    assert.equal(
      props.reason,
      BLOCKED.state === 'blocked' ? BLOCKED.reason : '',
      'the reason the session gave is not the one the reader is shown',
    )
    assert.equal(props.subject, 'ember')
  })

  it('says nothing at all until it knows where a found block would go, rather than guessing', () => {
    const props = barMining(input({ ember: { state: 'asking' } }))
    assert.equal(
      props,
      undefined,
      'the control appears before `POST /v1/deposits` has answered. Whichever phase it chose is a ' +
        'claim about whether a press will start mining, and nothing has been measured yet',
    )
  })

  it('does not wait on that answer to invite a stranger to sign in', () => {
    // The state a first-time reader arrives in. `asking` is the point: there is no deposit address
    // without a session, so Sign in is the next move whatever the answer turns out to be, and
    // waiting would leave the bar blank for the one reader who has the furthest to go.
    calls = []
    const props = barMining(input({ signedIn: false, ember: { state: 'asking' } }))
    assert.equal(props?.phase, 'signed-out')
    press(props)
    assert.deepEqual(calls, ['signIn'], 'the signed-out press did not start authentication')
  })
})

/* ══════════════════════ 2. a session that is already running ══════════════════════ */

describe('the bar’s mining control — a session that is already running', () => {
  it('offers Stop while a session is live, and carries the measured figures', () => {
    calls = []
    const readout = { hashrate: 412_318, accepted: 9 }
    const props = barMining(input({ live: live('ember', readout) }))
    assert.equal(props?.phase, 'mining')
    assert.ok(props.phase === 'mining')
    // Read back out of the readout the scenario supplied, never written as a literal: a control
    // that rendered a constant would agree with a literal and disagree with the miner.
    assert.deepEqual(props.readout, { hashrate: readout.hashrate, accepted: readout.accepted })
    press(props)
    assert.deepEqual(calls, ['stop'], 'the mining press did not stop the session')
  })

  it('does not hijack a pool session that a reader chose from the picker', () => {
    // Point 3 of the brief, as a value. A reader who picked LTC on `/mine` gets the pool's Stop,
    // the pool's shares and — through `subject` — the pool's honesty clause. This change is about
    // what a BARE press starts, and it must be invisible to somebody already mining something else.
    const props = barMining(input({ live: live('pool', { hashrate: 900, accepted: 3 }) }))
    assert.ok(props?.phase === 'mining')
    assert.equal(
      props.subject,
      'pool',
      'a running pool session is described as EMBER. The reader would be told their Litecoin ' +
        'shares are being credited to their EMBER deposit address, which is false',
    )
  })

  it('reads zero for a session that has connected and not yet measured a window', () => {
    // `PoolMiner` reports no readout until its meter has samples, and the honest reading of a
    // machine that has started and measured nothing is zero — not a hidden control, and not an
    // invented rate. The Stop must be there the instant the session is, or the first half-second of
    // every session is a session nobody can turn off.
    const props = barMining(input({ live: live('ember', null) }))
    assert.ok(props?.phase === 'mining')
    assert.deepEqual(props.readout, { hashrate: 0, accepted: 0 })
  })
})

/* ══════════════════ 3. the order of the checks, the part easy to get wrong ══════════════════ */

describe('the bar’s mining control — the order of the checks', () => {
  it('refuses with a reason when the device cannot mine', () => {
    const refusal = 'This browser does not support Web Workers.'
    const props = barMining(input({ refusal }))
    assert.ok(props?.phase === 'unavailable')
    assert.equal(props.reason, refusal, 'the refusal the session gave is not the one shown')
  })

  it('lets a refusal outrank an invitation to sign in', () => {
    // Otherwise a stranger on a machine that cannot mine is walked through creating an account,
    // confirming an address and signing in, to arrive at a control that was never going to work.
    const props = barMining(
      input({ signedIn: false, ember: { state: 'asking' }, refusal: 'No Web Workers here.' }),
    )
    assert.equal(props?.phase, 'unavailable')
  })

  it('lets a live session outrank a refusal that arrived after it started', () => {
    // A refusal can appear mid-session. The threads, and the socket or the event stream, are still
    // this tab's to release, so the one thing the reader must never lose is the Stop.
    calls = []
    const props = barMining(
      input({ live: live('ember', { hashrate: 1, accepted: 0 }), refusal: 'This tab lost its Workers.' }),
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

  it('lets a refusal outrank an EMBER offer that is ready', () => {
    // A device that cannot run a Worker cannot run the EMBER miner either. The offer being ready is
    // about where the money would go, not about whether the machine can do the work.
    const props = barMining(input({ refusal: 'This browser does not support Web Workers.' }))
    assert.equal(props?.phase, 'unavailable')
  })
})

/* ══════════════════════════ 4. honesty, in every answer ══════════════════════════ */

describe('the bar’s mining control — honesty', () => {
  it('carries the pool’s own payout flag into every phase, unchanged', () => {
    // Not a constant here and not a default here. `pool/src/payouts.ts` derives it, the session
    // reads it off `GET /v1/pool`, and this function is the only thing between the two. Both values
    // are walked so that a function which hard-coded either one is red.
    for (const payoutsImplemented of [false, true]) {
      // Annotated because the loop below reads `props.phase` back into the failure message, and an
      // inferred element type makes that self-referential for the compiler.
      const every: readonly (MiningControlProps | undefined)[] = [
        barMining(input({ payoutsImplemented })),
        barMining(input({ payoutsImplemented, signedIn: false })),
        barMining(input({ payoutsImplemented, ember: BLOCKED })),
        barMining(input({ payoutsImplemented, live: live('pool', { hashrate: 2, accepted: 2 }) })),
        barMining(input({ payoutsImplemented, refusal: 'nothing can mine here' })),
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

  it('never claims an EMBER press pays, and never lets EMBER weaken the pool’s clause', () => {
    // The design system renders the copy and `ui`'s own `mining.test.ts` asserts both rendered
    // strings. What is asserted HERE is that the two clauses stay two different sentences, because
    // the temptation this change creates is to soften the pool's one now that ONE subject really is
    // credited. `pool/src/payouts.ts` has not shipped payouts; EMBER swept to your own custodial
    // deposit address is credited. Both are true and neither implies the other.
    assert.notEqual(EMBER_CREDITED_CLAUSE, NOT_PAID_CLAUSE)
    assert.ok(
      NOT_PAID_CLAUSE.length > 0 && !/\d/.test(NOT_PAID_CLAUSE),
      'the not-paid clause carries a figure. `pool-web` set the standard: no number accompanies ' +
        'it, because a zero reads as “not yet, but soon” and the truth is “not at all”',
    )
    assert.ok(
      !/\d/.test(EMBER_CREDITED_CLAUSE),
      'the credited clause carries a figure. A block reward is 5.3929 EMBER on mainnet today and ' +
        'the halving schedule is in `hearth/node/src/chain/`; a number here is a projection',
    )
  })

  it('does not put a number, a currency or an earnings word anywhere near the reader', () => {
    // There is no prop for an amount — `MiningControlProps` has no field for a balance, a
    // projection or a currency — so the only way one could reach the bar is through the readout,
    // and both of its fields are work.
    const props = barMining(input({ live: live('ember', { hashrate: 412_318, accepted: 9 }) }))
    assert.ok(props?.phase === 'mining')
    assert.deepEqual(
      Object.keys(props.readout).sort(),
      ['accepted', 'hashrate'],
      'the readout grew a third field. Hashes and blocks are work; a third number in this ' +
        'position is read as what the work paid',
    )
  })
})
