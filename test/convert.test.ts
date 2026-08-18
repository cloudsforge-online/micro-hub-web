/**
 * The conversion desk, on the browser side (micro-org#496).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE FOUR THINGS THIS SCREEN CAN GET WRONG, AND WHY EACH NEEDS ITS OWN SCENARIO ────────────
 *
 *   1. **It can offer a pair the desk refuses.** The desk is funded in EMBER and in nothing else
 *      until micro-org#492 and #493 close, so every other output would be offered here and refused
 *      at `readDeskInventory` with a 409. USD and `TOKEN:` codes are refused 422 `not_convertible`
 *      and EMBER-into-EMBER 422 `same_asset`. A menu that offers any of them is a dead end
 *      presented to a person as a choice — the defect `settlesOnChain` was written for, one asset
 *      list over. Asserted as the ABSENCE of those options, which is a shape of assertion that
 *      fails the moment somebody widens the filter.
 *
 *   2. **It can display one conversion and submit another.** `components/send.tsx`'s rule, and
 *      the same countermeasure: the intent is frozen when the price is asked for, and the confirm
 *      step is given nothing else to render. What is asserted is the REQUEST BODY against the
 *      figures that were on screen — never the body against a copy of itself.
 *
 *   3. **It can turn a refusal into "something went wrong".** This is the whole reason hub-api
 *      composes the two writes at all. `desk_inventory_short` means CloudsForge is short, not the
 *      reader, and a 409 that arrives as a 500 loses that distinction entirely. Every refusal
 *      `micro-wallet` can raise is driven through the screen below with the SERVICE'S OWN sentence
 *      in the fixture, so a page that quietly replaced it with prose of its own fails.
 *
 *   4. **It can promise a price it was not given.** `holdNotice` is a field on the quote precisely
 *      so no surface has to compose that sentence; the scenario puts a sentence no component could
 *      have invented into the fixture and looks for it verbatim.
 *
 * ── WHAT IS TRANSCRIBED AND WHAT IS ARRANGED ──────────────────────────────────────────────────
 *
 * Every service sentence asserted below is put into the fixture by this file, and every sentence
 * this bundle authors is written out in full here rather than imported from `src/`. A test that
 * compares a screen against a constant the screen was built from is green for every possible
 * value of that constant, including the wrong one.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type MountOptions, type Routes, type Screen, type Wire } from './dom.ts'
import * as fx from './fixtures.ts'
import { __resetAuth } from '../src/lib/api.ts'
import { ConvertPage, nextStepFor } from '../src/pages/convert.tsx'
import type { Holding } from '../src/lib/hub.ts'

const MAINNET = 'https://hub.cloudsforge.online'
const TESTNET = 'https://hub-testnet.cloudsforge.online'
const SIGNED_IN = { 'cf.accessToken': 'held-access-token', 'cf.refreshToken': 'held-refresh-token' }
const fresh = (): void => __resetAuth()

/**
 * A Bitcoin holding, eight decimals, with `amount` and `amountFormatted` a matched pair.
 *
 * The pair is load-bearing: `scaleOf` recovers the asset's scale by finding the unique `d` for
 * which the formatted string reproduces the integer, and a fixture whose halves disagreed would
 * put every scenario here onto the smallest-units path, which is a different screen with a
 * different label on the amount field.
 */
const btc = (over: Partial<Holding> = {}): Holding =>
  fx.holding({
    assetCode: 'BTC',
    amount: '150000000',
    amountFormatted: '1.5',
    available: '150000000',
    usdScaled: '9000000',
    usd: '90.00',
    priceSource: 'market',
    ...over,
  })

/** The desk's own sentences, as `wallet/src/money.ts` writes them. Put here, not imported. */
const DESK = {
  inventoryShort: 'the desk is out of EMBER right now — try a smaller amount, or try again shortly',
  rateUnavailable:
    'there is no usable BTC price right now; the conversion is refused rather than guessed',
  amountTooSmall: 'that amount of BTC converts to less than one unit of EMBER',
  notConvertible: 'conversions are supported between SHARD and the chain assets only',
  sameAsset: 'EMBER cannot be converted into itself',
  insufficientFunds: 'insufficient funds',
} as const

/**
 * The quote hub-api forwards, with a `holdNotice` no component could have written.
 *
 * `2.75` out for `0.25` in is not a real rate and is not meant to be: the scenario asserts the
 * figures the SERVICE sent reach the screen, and a fixture carrying a plausible rate would pass
 * just as well against a page that had computed one itself.
 */
const quote = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  quote: {
    fromAssetCode: 'BTC',
    fromAmount: '25000000',
    fromAmountFormatted: '0.25',
    toAssetCode: 'EMBER',
    toAmount: '2750000000000000000',
    toAmountFormatted: '2.75',
    rateScale: '11000000000',
    quotedAt: '2026-08-17T09:15:00.000Z',
    hold: false,
    holdNotice:
      'This price is not held for you: the desk prices again when you confirm, and what you ' +
      'are shown here may not be what you get.',
    ...over,
  },
})

const receipt = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  entryId: 'ent-0000-0000-0000-000000000001',
  replayed: false,
  summary: {
    fromAssetCode: 'BTC',
    fromAmount: '25000000',
    fromAmountFormatted: '0.25',
    toAssetCode: 'EMBER',
    toAmount: '2750000000000000000',
    toAmountFormatted: '2.75',
    quotedAt: '2026-08-17T09:15:00.000Z',
  },
  ...over,
})

const emptyList = (key: 'conversions' | 'transfers') => ({
  [key]: [],
  nextCursor: null,
  status: 'ok',
  reason: null,
  cached: false,
  ageMs: null,
})

/**
 * The Convert page with the holdings a scenario names, and the desk answering what it is told to.
 *
 * The conversions list is routed EMPTY by default rather than left unrouted: `test/dom.ts` throws
 * on an unrouted request, and a scenario about the FORM should not be reading its assertions
 * through a failure banner belonging to the panel underneath it.
 */
function convertPage(
  holdings: readonly Holding[],
  routes: Routes = {},
  origin = MAINNET,
): { element: ReactElement; options: MountOptions } {
  return {
    element: h(MemoryRouter, { initialEntries: ['/convert'] }, h(ConvertPage)),
    options: {
      url: `${origin}/convert`,
      storage: SIGNED_IN,
      routes: {
        'GET /v1/dashboard': {
          body: fx.dashboard({
            portfolio: fx.ok(fx.portfolio({ holdings: [...holdings] }), 'ledger+pricing'),
          }),
        },
        'GET /v1/conversions': { body: emptyList('conversions') },
        ...routes,
      } as Routes,
    },
  }
}

/** Fill the amount and press for a price. */
async function priceIt(s: Screen, amount: string): Promise<void> {
  await s.type(s.byRole('textbox', /Amount/), amount)
  await s.click(s.byRole('button', 'Get a price'))
}

/**
 * The conversions actually BOOKED, by exact path.
 *
 * `api.matching` is a prefix match — it is what the route table is keyed on — so
 * `"POST /v1/conversions"` also returns every `POST /v1/conversions/quote`. Counting quotes as
 * conversions makes the double-submit scenario pass with the guard removed, and makes "exactly one
 * conversion" true of a page that made none at all.
 */
const booked = (s: Screen): readonly Wire[] =>
  s.api.wire.filter((c) => c.method === 'POST' && c.path === '/v1/conversions')

const priced = (s: Screen): readonly Wire[] =>
  s.api.wire.filter((c) => c.method === 'POST' && c.path === '/v1/conversions/quote')

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   1. The desk buys EMBER and nothing else, and the form says so where the control is.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('what the form offers is what the desk will take', () => {
  it('offers every convertible holding to sell and never the asset the desk pays in', async () => {
    fresh()
    // Four holdings, and only two of them may be offered. EMBER is what the desk PAYS in, so
    // selling it back is `same_asset` at best and an unfunded pair at worst; a `TOKEN:` code is
    // 422 `not_convertible`; and SHARD is IN despite being retired for new denominations, because
    // converting a balance somebody already holds out of it is the one thing left to do with it.
    const { element, options } = convertPage([
      btc(),
      fx.holding({ assetCode: 'EMBER' }),
      fx.holding({
        assetCode: 'TOKEN:ethereum:mainnet:0xdac17f958d2ee523a2206206994597c13d831ec7',
        amountFormatted: null,
        amount: '250731000',
        available: '250731000',
      }),
      fx.holding({ assetCode: 'SHARD', amount: '4200', amountFormatted: '42.00', available: '4200' }),
    ])
    await withScreen(element, options, async (s) => {
      const menu = s.byRole('combobox', 'Convert from')
      const offered = Array.from(menu.querySelectorAll('option'), (o) =>
        (o.textContent ?? '').trim(),
      )
      assert.deepEqual(offered, ['BTC', 'SHARD'], `the menu offered ${offered.join(', ')}`)
      // And the token is not merely last — it is absent, which is the assertion that fails if
      // somebody re-adds it "for completeness".
      assert.ok(!offered.some((code) => code.startsWith('TOKEN:')), 'a token is on offer')
    })
  })

  it('states the output asset instead of offering a menu of one, and says why it is fixed', async () => {
    fresh()
    const { element, options } = convertPage([btc()])
    await withScreen(element, options, async (s) => {
      // There is exactly ONE `<select>` on this form. A second one holding a single option would
      // be a control that cannot be operated, and the reader would learn what the desk pays in by
      // failing to change it.
      assert.equal(s.allByRole('combobox').length, 1, 'the output was rendered as a control')
      const body = s.text()
      assert.ok(body.includes('Convert into'), 'the output side is not labelled')
      // The reason is beside the control and before the button, which is the whole point of it.
      assert.match(
        body,
        /pays in nothing else at the moment/,
        'the form does not say why the output is fixed',
      )
      s.before(
        'pays in nothing else',
        'Get a price',
        'the reader is told what is not on offer only after asking for a price',
      )
    })
  })

  it('with nothing the desk takes, says so without claiming the account is empty', async () => {
    fresh()
    // EMBER only: a real balance, and nothing on it the desk will buy. "You hold nothing" would
    // be a wrong statement about somebody's money; "nothing here the desk can take" is the true
    // one, and it names what the desk does take.
    const { element, options } = convertPage([fx.holding({ assetCode: 'EMBER' })])
    await withScreen(element, options, async (s) => {
      const body = s.text()
      assert.match(body, /nothing here the desk can take/i, 'the empty case is not explained')
      assert.ok(!/you hold nothing/i.test(body), 'the page claims the account is empty')
      assert.equal(s.queryByRole('button', 'Get a price'), null, 'a price can be asked for anyway')
    })
  })

  it('tells an unread balance apart from an empty one, and names where it could not read', async () => {
    fresh()
    const reason = 'the ledger did not answer within the budget'
    const element = h(MemoryRouter, { initialEntries: ['/convert'] }, h(ConvertPage))
    await withScreen(
      element,
      {
        url: `${MAINNET}/convert`,
        storage: SIGNED_IN,
        routes: {
          'GET /v1/dashboard': {
            body: fx.dashboard({
              portfolio: fx.unavailable(
                fx.portfolio({ holdings: [] }),
                'ledger+pricing',
                reason,
              ),
            }),
          },
          'GET /v1/conversions': { body: emptyList('conversions') },
        } as Routes,
      },
      async (s) => {
        const body = s.text()
        // The service's reason, and this bundle's sentence about what the reason means. Both.
        assert.ok(body.includes(reason), 'the page does not name what went unread')
        assert.match(body, /ignorance on our part rather than emptiness on yours/i)
        assert.ok(
          !/nothing here the desk can take/i.test(body),
          'an unread balance is being reported as nothing to convert',
        )
      },
    )
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   2. What you confirm is what is sent.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('the quote, the confirmation and the conversion are one intent', () => {
  it('shows the service’s own figures on the confirm step and posts the intent they belong to', async () => {
    fresh()
    const { element, options } = convertPage([btc()], {
      'POST /v1/conversions/quote': { body: quote() },
      'POST /v1/conversions': { status: 201, body: receipt() },
    })
    await withScreen(element, options, async (s) => {
      await priceIt(s, '0.25')

      // ── the confirm step renders the SERVER's answer ──────────────────────────────────────
      const confirming = s.text()
      assert.match(confirming, /Confirm this conversion/)
      assert.ok(confirming.includes('0.25 BTC'), 'the amount given is not on the confirm step')
      assert.ok(confirming.includes('2.75 EMBER'), 'the amount received is not on the confirm step')
      // The smallest-units twin as well as the human one: the human figure is what a person
      // checks and the integer is what actually moves, and a screen that shows only the first
      // cannot be checked against the request body at all.
      assert.ok(confirming.includes('2750000000000000000'), 'the units the service quoted are absent')

      // ── the quote is not a hold, in the service's own words ───────────────────────────────
      assert.ok(
        confirming.includes('This price is not held for you'),
        'the confirm step does not carry the service’s hold notice',
      )

      await s.click(s.byRole('button', 'Convert now'))

      // ── the body is the intent, compared with what was on screen ──────────────────────────
      const posted = booked(s)
      assert.equal(posted.length, 1, 'exactly one conversion')
      assert.deepEqual(posted[0]?.json, {
        fromAssetCode: 'BTC',
        toAssetCode: 'EMBER',
        // 0.25 BTC at eight decimals. Derived from the SCENARIO's fixture pair, not read back off
        // the page: `1.5`/`150000000` is what makes eight the scale.
        amount: '25000000',
      })
      assert.ok(posted[0]?.headers['idempotency-key'], 'the conversion carries no idempotency key')

      // ── the receipt is the service's summary, and it settles at once ──────────────────────
      const done = s.text()
      assert.match(done, /Converted/)
      assert.ok(done.includes('0.25 BTC'), 'the receipt does not say what was given')
      assert.ok(done.includes('2.75 EMBER'), 'the receipt does not say what was received')
      assert.match(done, /nothing to wait for and no chain to watch/i)
    })
  })

  it('asks for a price without an idempotency key, because a quote books nothing', async () => {
    fresh()
    const { element, options } = convertPage([btc()], {
      'POST /v1/conversions/quote': { body: quote() },
    })
    await withScreen(element, options, async (s) => {
      await priceIt(s, '0.25')
      const asked = priced(s)
      assert.equal(asked.length, 1)
      assert.equal(
        asked[0]?.headers['idempotency-key'],
        undefined,
        'the quote carries a key, which would put it in play before anything was agreed',
      )
    })
  })

  it('retries an unanswered conversion under its original key, and retires the key once it lands', async () => {
    fresh()
    // The sequence that matters: a conversion whose ANSWER was lost. The reader does not know
    // whether it happened, re-prices the same amount and presses again — and that second press is
    // a retry, not a second purchase, so it has to carry the first press's key. Going back through
    // "Change it" is the only way the form is reachable again, which is precisely why the key
    // cannot be held on the confirm step.
    const { element, options } = convertPage([btc()], {
      'POST /v1/conversions/quote': { body: quote() },
      'POST /v1/conversions': (_wire, n) =>
        n === 1
          ? { networkError: 'The connection dropped before the response arrived' }
          : { status: 201, body: receipt() },
    })
    await withScreen(element, options, async (s) => {
      await priceIt(s, '0.25')
      await s.click(s.byRole('button', 'Convert now'))

      await s.click(s.byRole('button', 'Change it'))
      await priceIt(s, '0.25')
      await s.click(s.byRole('button', 'Convert now'))

      const posted = booked(s)
      assert.equal(posted.length, 2, 'expected the lost attempt and the retry')
      const retried = posted[0]?.headers['idempotency-key']
      assert.ok(retried, 'no key was sent at all')
      assert.equal(
        posted[1]?.headers['idempotency-key'],
        retried,
        'the retry went under a new key, so the service would book it as a second conversion',
      )

      // And then the key is spent. Converting the same amount again is a genuine second
      // conversion, and a key that survived would have it replayed — a receipt for money that did
      // not move.
      await priceIt(s, '0.25')
      await s.click(s.byRole('button', 'Convert now'))
      const after = booked(s)
      assert.equal(after.length, 3)
      assert.notEqual(
        after[2]?.headers['idempotency-key'],
        retried,
        'a second conversion re-used the key of the first, which the service replays',
      )
    })
  })

  it('mints a new key when the amount changes, so two bodies never share one', async () => {
    fresh()
    const { element, options } = convertPage([btc()], {
      'POST /v1/conversions/quote': { body: quote() },
      'POST /v1/conversions': (_wire, n) =>
        n === 1
          ? { networkError: 'The connection dropped before the response arrived' }
          : { status: 201, body: receipt() },
    })
    await withScreen(element, options, async (s) => {
      await priceIt(s, '0.25')
      await s.click(s.byRole('button', 'Convert now'))
      await s.click(s.byRole('button', 'Change it'))
      // A different amount is a different conversion. One key over two bodies is a 409
      // `idempotency_key_reuse` from the service, and the reader can do nothing about it.
      await priceIt(s, '0.5')
      await s.click(s.byRole('button', 'Convert now'))

      const posted = booked(s)
      assert.equal(posted.length, 2)
      assert.notDeepEqual(posted[0]?.json, posted[1]?.json)
      assert.notEqual(
        posted[1]?.headers['idempotency-key'],
        posted[0]?.headers['idempotency-key'],
        'two different conversions went under one key',
      )
    })
  })

  it('refuses an amount it could not convert, and says which unit it wanted', async () => {
    fresh()
    // Arithmetic, not a rule: what counts as a valid amount stays the service's decision. What
    // this bundle refuses is a string it could not turn into an integer, because the alternative
    // is `BigInt('')` — which is `0n` and does not throw.
    const { element, options } = convertPage([btc()])
    await withScreen(element, options, async (s) => {
      await priceIt(s, '0.000000001')
      assert.match(s.text(), /at most 8 decimal places/i)
      assert.equal(priced(s).length, 0, 'it asked anyway')
    })
  })

  it('two presses in one tick make one conversion', async () => {
    fresh()
    // `busy` is state: both clicks read `busy === false` in the same tick and both post. The latch
    // is a ref, so it is taken synchronously. How many times a browser sends is the browser's own
    // business — a guard that works only because the service replays is not a guard.
    const { element, options } = convertPage([btc()], {
      'POST /v1/conversions/quote': { body: quote() },
      'POST /v1/conversions': { status: 201, body: receipt(), delayMs: 20 },
    })
    await withScreen(element, options, async (s) => {
      await priceIt(s, '0.25')
      const go = s.byRole('button', 'Convert now')
      s.clickNoFlush(go)
      s.clickNoFlush(go)
      await s.settle(60)
      assert.equal(booked(s).length, 1, 'the desk was asked twice')
    })
  })

  it('reads a replayed conversion as the one already made, not as a failure', async () => {
    fresh()
    const { element, options } = convertPage([btc()], {
      'POST /v1/conversions/quote': { body: quote() },
      'POST /v1/conversions': { body: receipt({ replayed: true }) },
    })
    await withScreen(element, options, async (s) => {
      await priceIt(s, '0.25')
      await s.click(s.byRole('button', 'Convert now'))
      const body = s.text()
      assert.match(body, /Already converted/)
      assert.match(body, /does not make a second one/i)
      assert.ok(!/could not/i.test(body), 'a working replay is being reported as a failure')
    })
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   3. Every refusal the desk can raise arrives as a refusal.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('a refusal reaches the reader as what it is', () => {
  it('renders desk_inventory_short as OUR shortfall, with the service’s sentence and the id', async () => {
    fresh()
    // The one this ticket names. `micro-wallet` raises it at the conversion and never at the
    // quote — quoting deliberately does not consult inventory, because "an unlimited, free,
    // unbooked route that answers 'can you fill N?' is an oracle" — so it can only arrive here.
    const requestId = 'cf-req-desk-409'
    const { element, options } = convertPage([btc()], {
      'POST /v1/conversions/quote': { body: quote() },
      'POST /v1/conversions': {
        status: 409,
        requestId,
        body: fx.errorBody('desk_inventory_short', DESK.inventoryShort, [], requestId),
      },
    })
    await withScreen(element, options, async (s) => {
      await priceIt(s, '0.25')
      await s.click(s.byRole('button', 'Convert now'))
      const body = s.text()
      assert.ok(body.includes(DESK.inventoryShort), 'the service’s own sentence was not rendered')
      // The half the service cannot say, because it depends on the screen: whose shortfall it is.
      assert.match(body, /our holding being short rather than yours/i)
      assert.match(body, /nothing has left your balance/i)
      assert.ok(body.includes(requestId), 'the refusal offers no request id to quote')
      // And it stays armed: a reader refused for want of inventory should be able to press again
      // in a minute without retyping, under the same key.
      assert.ok(s.queryByRole('button', 'Convert now'), 'the confirm step was thrown away')
    })
  })

  it('renders rate_unavailable as a refusal to guess rather than a fault in the balance', async () => {
    fresh()
    const { element, options } = convertPage([btc()], {
      'POST /v1/conversions/quote': {
        status: 503,
        body: fx.errorBody('rate_unavailable', DESK.rateUnavailable),
      },
    })
    await withScreen(element, options, async (s) => {
      await priceIt(s, '0.25')
      const body = s.text()
      assert.ok(body.includes(DESK.rateUnavailable), 'the service’s own sentence was not rendered')
      assert.match(body, /nothing wrong with your balance/i)
      assert.equal(s.queryByRole('button', 'Convert now'), null, 'a refused quote armed the form')
    })
  })

  it('renders amount_too_small with the move that fixes it', async () => {
    fresh()
    const { element, options } = convertPage([btc()], {
      'POST /v1/conversions/quote': {
        status: 422,
        body: fx.errorBody('amount_too_small', DESK.amountTooSmall),
      },
    })
    await withScreen(element, options, async (s) => {
      await priceIt(s, '0.00000001')
      const body = s.text()
      assert.ok(body.includes(DESK.amountTooSmall))
      assert.match(body, /convert more of it in one go/i)
    })
  })

  it('renders insufficient_funds against the figure the form is showing', async () => {
    fresh()
    const { element, options } = convertPage([btc()], {
      'POST /v1/conversions/quote': { body: quote() },
      'POST /v1/conversions': {
        status: 409,
        body: fx.errorBody('insufficient_funds', DESK.insufficientFunds),
      },
    })
    await withScreen(element, options, async (s) => {
      await priceIt(s, '0.25')
      await s.click(s.byRole('button', 'Convert now'))
      // The ledger's own 409, forwarded when the shortfall is the READER's rather than the desk's.
      // The two are one status and one word apart, and telling them apart is the point.
      assert.match(s.text(), /reserved for a withdrawal in flight/i)
      assert.ok(!/our holding being short/i.test(s.text()), 'the reader is being told it is our fault')
    })
  })

  /**
   * The rest of the set, as a table.
   *
   * Every code `micro-wallet` can raise on either path gets a rendered sentence, including the
   * three this form cannot provoke: `same_asset` and `not_convertible` are closed off by the menu
   * above, and `invalid_amount` by the parse before the request. They are covered anyway, because
   * "the form cannot produce it" is a property of today's form and the codes belong to the
   * service — and a refusal with nothing to say is the "something went wrong" this ticket exists
   * to eliminate.
   *
   * `nextStepFor` is exported for exactly this. Driving eleven refusals through the DOM would be
   * eleven mounts asserting one string each; what the DOM scenarios above prove is that the
   * function's answer reaches the screen beside the service's sentence.
   */
  it('has something to say about every code the desk can return', () => {
    const CODES = [
      'desk_inventory_short',
      'insufficient_funds',
      'amount_too_small',
      'same_asset',
      'not_convertible',
      'rate_unavailable',
      'invalid_amount',
      'bad_field',
      'idempotency_key_required',
      'idempotency_key_reuse',
      'idempotency_in_flight',
      'rate_limited',
    ] as const
    for (const code of CODES) {
      const next = nextStepFor(code)
      assert.ok(next, `${code} has no next step`)
      assert.ok((next ?? '').length > 20, `${code}'s next step is too short to be one`)
    }
    // And an unknown code gets NOTHING rather than a guess: the service's sentence stands alone,
    // which is better than a confident instruction about a refusal this bundle has never seen.
    assert.equal(nextStepFor('a_code_from_the_future'), null)
    assert.equal(nextStepFor(undefined), null)
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   4. The list underneath, and the seam to the other kind of swap.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('what has been converted', () => {
  it('draws both sides of each conversion and the price behind it', async () => {
    fresh()
    const { element, options } = convertPage([btc()], {
      'GET /v1/conversions': {
        body: {
          conversions: [
            {
              id: 'cv-1',
              occurredAt: '2026-08-16T11:02:00.000Z',
              recordedAt: '2026-08-16T11:02:00.000Z',
              fromAssetCode: 'BTC',
              fromAmount: '25000000',
              fromAmountFormatted: '0.25',
              toAssetCode: 'EMBER',
              toAmount: '2750000000000000000',
              toAmountFormatted: '2.75',
              rateScale: '11000000000',
              quotedAt: '2026-08-16T11:01:58.000Z',
            },
          ],
          nextCursor: null,
          status: 'ok',
          reason: null,
          cached: false,
          ageMs: null,
        },
      },
    })
    await withScreen(element, options, async (s) => {
      const body = s.text()
      assert.ok(body.includes('0.25 BTC'), 'the row does not say what was given')
      assert.ok(body.includes('2.75 EMBER'), 'the row does not say what was received')
      assert.match(body, /priced/i, 'the row does not say when the price was taken')
    })
  })

  it('does not read an unavailable list as a history of nothing', async () => {
    fresh()
    // hub-api answers 200 with an empty array when wallet is down, so the outage and the account
    // that has never converted anything arrive as the same list. Rendering the first as the second
    // is how an outage reads as a quiet week.
    const reason = 'wallet did not answer within the budget'
    const { element, options } = convertPage([btc()], {
      'GET /v1/conversions': {
        body: {
          conversions: [],
          nextCursor: null,
          status: 'unavailable',
          reason,
          cached: false,
          ageMs: null,
        },
      },
    })
    await withScreen(element, options, async (s) => {
      const body = s.text()
      assert.ok(body.includes(reason), 'the outage is not named')
      assert.ok(
        !/have not converted anything yet/i.test(body),
        'an outage is being reported as an empty history',
      )
    })
  })
})

describe('the seam to Forge Exchange', () => {
  it('names the venue distinction and links to the surface the registry resolves', async () => {
    fresh()
    const { element, options } = convertPage([btc()])
    await withScreen(element, options, async (s) => {
      const link = s.byRole('link', /Open Forge Exchange/)
      // The hostname comes from the registry row's `subdomain: 'exchange'` and the reader's viewed
      // network. Composed, never typed — and with NO path appended, because which address inside
      // that surface is its front door is that repository's decision and not this bundle's guess.
      assert.equal(link.getAttribute('href'), 'https://exchange.cloudsforge.online')

      const body = s.text()
      // The distinction, in both directions. A reader who conflates the two has been misled about
      // who is holding their money.
      assert.match(body, /pools that live on the EMBER chain/i)
      assert.match(body, /CloudsForge holds nothing/i)
      assert.match(body, /trading with CloudsForge and CloudsForge keeps custody/i)
    })
  })

  it('offers the sibling estate to a reader viewing the sibling estate', async () => {
    fresh()
    // The viewed network is load-bearing here and has been shipped wrong twice. A page served from
    // the testnet hostname must not send its reader to the mainnet exchange, where the pools are
    // real and so is the money.
    const { element, options } = convertPage([btc()], {}, TESTNET)
    await withScreen(element, options, async (s) => {
      assert.equal(
        s.byRole('link', /Open Forge Exchange/).getAttribute('href'),
        'https://exchange-testnet.cloudsforge.online',
      )
      // And the page says which estate every figure on it belongs to, in the head.
      assert.match(s.text(), /Everything below is testnet/i)
    })
  })
})
