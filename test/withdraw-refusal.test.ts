/**
 * What Send does with a refusal, and what the page does with a success.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * TWO DEFECTS, ON THE ONE SCREEN THAT MOVES COINS NOBODY CAN PULL BACK
 *
 *   1. **`components/send.tsx` branched on the STATUS.** `if (err.status === 409) setArmed(null)`,
 *      under a comment naming one refusal. `wallet/src/server.ts` answers 409 for three, and tells
 *      them apart by code: `idempotency_key_reuse` (two bodies under one key — this bundle's bug),
 *      `idempotency_in_flight` (the first request is still running), and the ledger's
 *      `insufficient_funds`. Only the first should retire the key.
 *
 *      Dropping `armed` drops the KEY with it, and the failure path deliberately leaves the
 *      destination and the amount in the fields. So on the other two the reader pressed Review
 *      again, `review()` minted a FRESH key for a body the service had already taken or was still
 *      processing, and the same withdrawal posted twice with nothing left to collapse it. The one
 *      branch written to protect the key was the thing spending it.
 *
 *   2. **`pages/wallet.tsx` guarded on `state === 'loading'`.** `onSent` reloads the dashboard so
 *      the balances are the ones after the withdrawal, and `useResource` reports a refresh as
 *      `loading` exactly as it reports a first read — so the guard unmounted `SendPanel` at the
 *      instant its withdrawal succeeded. The receipt is `SendPanel`'s own state and went with it:
 *      press Send it now, the screen blinks, and you are handed an empty form. `pages/convert.tsx`
 *      already carries this defect and its fix in a comment; this page was missed.
 *
 * ── WHY THE FIRST GROUP COUNTS KEYS RATHER THAN READING THE SCREEN ────────────────────────────
 *
 * Because the screen looks identical either way. All three refusals render the service's sentence
 * in the same notice, and the only observable difference is the `Idempotency-Key` header on the
 * NEXT request — which is also the only thing standing between a retry and a second payment.
 * `test/double-submit.test.ts` proves one press is one request; this file proves that the request
 * a SECOND press makes is the same withdrawal and not a new one.
 *
 * ── WHAT IS TRANSCRIBED AND WHAT IS ARRANGED ──────────────────────────────────────────────────
 *
 * Every refusal sentence below is put into the fixture by this file, in the service's own words,
 * and nothing is imported from `src/` and compared against the page it was built from. The codes
 * are the strings `wallet/src/server.ts` and `wallet/src/withdrawals.ts` emit; a scenario that
 * shared a constant with the component would be green for every possible value, including the
 * misspelling this branch shipped with — the comment said `idempotency_key_reused`, one letter
 * away from a code that has never existed.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type MountOptions, type Routes, type Screen, type Wire } from './dom.ts'
import * as fx from './fixtures.ts'
import { __resetAuth } from '../src/lib/api.ts'
import { SendPanel } from '../src/components/send.tsx'
import { WalletPage } from '../src/pages/wallet.tsx'

const ORIGIN = 'https://hub.cloudsforge.online'
const SIGNED_IN = { 'cf.accessToken': 'held-access-token', 'cf.refreshToken': 'held-refresh-token' }
const WITHDRAWALS = 'POST /v1/withdrawals'
const fresh = (): void => __resetAuth()

/**
 * The three 409s, in the service's own words.
 *
 * `wallet/src/server.ts` maps the first two off `IdempotencyError`; the third is the ledger's,
 * raised inside the transaction that would post the withdrawal with the balance row locked — so
 * nothing was reserved and nothing moved, which is exactly why pressing again is reasonable.
 */
const REFUSALS = {
  reuse: {
    code: 'idempotency_key_reuse',
    message: 'this idempotency key was already used for a different withdrawal',
  },
  inFlight: {
    code: 'idempotency_in_flight',
    message: 'a request with this idempotency key is still being processed',
  },
  insufficient: {
    code: 'insufficient_funds',
    message: 'there is not enough available EMBER to cover this withdrawal',
  },
} as const

const sendPanel = (onSent: () => void = () => undefined): ReactElement =>
  h(SendPanel, { holdings: [fx.holding()], wallets: [fx.wallet()], onSent })

/** Fill the form and press Review, so there is a Confirm step to press. */
async function arm(s: Screen, amount = '1'): Promise<void> {
  await s.type(s.byRole('textbox', 'Destination address'), fx.OTHER_ADDRESS)
  await s.type(s.byRole('textbox', 'Amount'), amount)
  await s.click(s.byRole('button', 'Review'))
  assert.ok(s.text().includes('Confirm this payment'), 'Review did not arm the confirmation step')
}

/** Press the confirm step's own button. */
const send = async (s: Screen): Promise<void> => s.click(s.byRole('button', 'Send it'))

const posted = (s: Screen): readonly Wire[] => s.api.matching(WITHDRAWALS)

const keysOf = (s: Screen): readonly (string | undefined)[] =>
  posted(s).map((w) => w.headers['idempotency-key'])

/**
 * A withdrawal route that refuses the first attempt with `code`/`message` and accepts the second.
 *
 * The second attempt has to SUCCEED rather than be refused again: a stub that refused everything
 * would leave the panel in the same state after both presses, and the scenario could not tell a
 * held key from a re-minted one that happened to fail the same way.
 */
const refuseThenAccept = (
  refusal: { code: string; message: string },
  status = 409,
): Routes => ({
  [WITHDRAWALS]: (_wire, n) =>
    n === 1
      ? { status, body: fx.errorBody(refusal.code, refusal.message) }
      : { status: 201, body: { withdrawal: fx.withdrawal(), replayed: false } },
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   1. Which refusal retires the key.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('a 409 is three refusals, and only one of them spends the key', () => {
  for (const [name, refusal] of [
    ['still in flight', REFUSALS.inFlight],
    ['insufficient funds', REFUSALS.insufficient],
  ] as const) {
    it(`keeps the key when the refusal is ${name}, so pressing again is a retry`, async () => {
      fresh()
      await withScreen(
        sendPanel(),
        { url: `${ORIGIN}/wallet`, storage: SIGNED_IN, routes: refuseThenAccept(refusal) },
        async (s) => {
          await arm(s)
          await send(s)

          // The service's sentence, not one this bundle composed on top of a status code.
          assert.ok(
            s.text().includes(refusal.message),
            `the refusal was not shown in the service’s own words: "${s.text()}"`,
          )
          // Still armed. The intent was never the thing at fault, and re-typing an address is how
          // a reader ends up sending to a different one.
          assert.ok(
            s.text().includes('Confirm this payment'),
            'the confirmation step was torn down, so the reader must re-enter the payment',
          )

          await send(s)

          const keys = keysOf(s)
          assert.equal(posted(s).length, 2, `expected the refusal and the retry, got ${keys.length}`)
          assert.ok(typeof keys[0] === 'string' && keys[0].length >= 8, 'no key was sent at all')
          assert.equal(
            keys[1],
            keys[0],
            'the retry went under a NEW key, so the service books it as a second withdrawal — ' +
              'and this is the coin that does not come back',
          )
          // Both presses carried the same body too. A key held over a changed intent would be the
          // opposite defect, and the 409 this branch is named for.
          assert.deepEqual(posted(s)[1]?.json, posted(s)[0]?.json)
        },
      )
    })
  }

  it('retires the key when the service says it was already bound to a different withdrawal', async () => {
    fresh()
    await withScreen(
      sendPanel(),
      { url: `${ORIGIN}/wallet`, storage: SIGNED_IN, routes: refuseThenAccept(REFUSALS.reuse) },
      async (s) => {
        await arm(s)
        await send(s)

        assert.ok(s.text().includes(REFUSALS.reuse.message), 'the refusal was not shown')
        // Back on the form: this key is spent whatever the reader does, so holding the intent
        // would offer a button that can only produce the same 409 forever.
        assert.ok(
          !s.text().includes('Confirm this payment'),
          'the intent survived a key the service has already bound to another withdrawal',
        )

        // The fields are deliberately left standing on a failure, so reviewing again is one press.
        await s.click(s.byRole('button', 'Review'))
        await send(s)

        const keys = keysOf(s)
        assert.equal(posted(s).length, 2)
        assert.notEqual(
          keys[1],
          keys[0],
          'the second attempt re-used the key the service had just objected to',
        )
      },
    )
  })

  it('does not retire the key on a refusal that is not a 409 at all', async () => {
    fresh()
    // `fee_unavailable` is a 503 from `wallet/src/withdrawals.ts` — the fee is quoted inside the
    // withdrawal call, so nothing was booked, the coin never moved, and the reader's own next move
    // is to press again in a minute. The status is passed EXPLICITLY here rather than left at the
    // helper's default: a scenario named for a 503 that quietly sent a 409 would be describing an
    // arrangement it does not make, and this one has to hold when somebody widens the branch from
    // the code back to "anything that failed".
    await withScreen(
      sendPanel(),
      {
        url: `${ORIGIN}/wallet`,
        storage: SIGNED_IN,
        routes: refuseThenAccept(
          {
            code: 'fee_unavailable',
            message: 'we could not price the network fee for this withdrawal just now',
          },
          503,
        ),
      },
      async (s) => {
        await arm(s)
        await send(s)
        assert.ok(s.text().includes('Confirm this payment'), 'a 503 tore down the intent')
        await send(s)
        const keys = keysOf(s)
        assert.equal(keys[1], keys[0], 'a retry after a 503 went under a new key')
      },
    )
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   2. The receipt survives the reload the withdrawal itself triggers.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

const emptyTransfers = {
  transfers: [],
  nextCursor: null,
  status: 'ok',
  reason: null,
  cached: false,
  ageMs: null,
}

/**
 * The Wallet page, whose dashboard answers with a DIFFERENT balance the second time.
 *
 * The second answer is what makes this scenario about a refresh rather than about a mount: if the
 * reload never happened the balance on screen would be the first one, and the receipt would be
 * standing there for a reason that has nothing to do with the fix.
 */
function walletPage(): { element: ReactElement; options: MountOptions } {
  const before = fx.holding({ amount: '2500000000000000000', amountFormatted: '2.5' })
  const after = fx.holding({ amount: '1500000000000000000', amountFormatted: '1.5' })
  return {
    element: h(MemoryRouter, { initialEntries: ['/wallet'] }, h(WalletPage)),
    options: {
      url: `${ORIGIN}/wallet`,
      storage: SIGNED_IN,
      routes: {
        'GET /v1/dashboard': (_wire, n) => ({
          body: fx.dashboard({
            portfolio: fx.ok(fx.portfolio({ holdings: [n === 1 ? before : after] }), 'ledger+pricing'),
            wallets: fx.ok([fx.wallet()], 'wallet'),
            deposits: fx.ok([], 'wallet'),
            withdrawals: fx.ok([], 'wallet'),
          }),
          // Long enough that the assertions below run while the refresh is still in flight, which
          // is the moment the page used to blank.
          delayMs: n === 1 ? 0 : 60,
        }),
        'GET /v1/exports': { body: { exports: [] } },
        'GET /v1/deposits/token-sightings': { body: { sightings: [], nextCursor: null } },
        'GET /v1/deposits/assets': {
          body: {
            network: 'mainnet',
            assets: [
              { assetCode: 'EMBER', chain: 'hearth', depositable: true, reason: null, detail: null },
            ],
          },
        },
        'GET /v1/deposits': { body: { assignments: [] } },
        'GET /v1/transfers': { body: emptyTransfers },
        [WITHDRAWALS]: { status: 201, body: { withdrawal: fx.withdrawal(), replayed: false } },
      } as Routes,
    },
  }
}

describe('a completed withdrawal leaves its receipt on the screen', () => {
  it('refreshes the balances underneath it without taking the receipt away', async () => {
    fresh()
    const { element, options } = walletPage()
    await withScreen(element, options, async (s) => {
      await s.settle()
      await arm(s)
      await send(s)

      /*
       * Mid-flight. The dashboard is being re-read because the withdrawal succeeded, and the page
       * has data already — so it draws that data rather than throwing the screen away. The
       * loading label is this bundle's own sentence, named here in full: a page that returned to
       * it would have unmounted the panel holding the receipt.
       */
      await s.settle(15)
      assert.ok(
        !s.text().includes('Reading your wallets'),
        'the page went back to its loading screen for a refresh it already had data for',
      )
      assert.ok(s.text().includes('Withdrawal requested'), 'the receipt was destroyed mid-refresh')

      await s.settle(120)

      /*
       * And afterwards, which is the assertion that needs no timing at all: `SendPanel` holds the
       * receipt in its own state, so an unmount destroys it permanently — a remounted panel comes
       * back with `sent = null` and the receipt never returns.
       *
       * `0.99` and the fee are on the receipt and nowhere else on this page: `Leaving` is routed
       * empty, and what the reader typed was `1`. The net and the fee are quoted by the service
       * INSIDE the withdrawal call, so this is the only sight of either.
       */
      const body = s.text()
      assert.ok(body.includes('Withdrawal requested'), 'the receipt did not survive the reload')
      assert.ok(
        body.includes(fx.withdrawal().netFormatted),
        `the receipt is not showing what actually arrives: "${body}"`,
      )
      assert.ok(
        body.includes(fx.OTHER_ADDRESS),
        'the receipt is not showing the destination read back off the service’s record',
      )

      // The reload it triggered really did happen, and really did land.
      assert.equal(
        s.api.matching('GET /v1/dashboard').length,
        2,
        'the withdrawal did not refresh the balances, so this scenario proves nothing',
      )
      assert.ok(
        body.includes('1.5'),
        'the refreshed balance never reached the screen, so nothing was re-read',
      )
    })
  })
})
