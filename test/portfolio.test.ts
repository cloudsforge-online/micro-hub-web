/**
 * The never-invent-a-number rule, as executable assertions.
 *
 * `wallet/src/pricingclient.ts` states it: "A rate that cannot be quoted is an error, never a
 * default… A fallback rate is a rate at which somebody trades", and "an asset absent from it means
 * 'no usable price' rather than zero. A zero would be a valuation, and a valuation of zero is a
 * lie about a holding that exists."
 *
 * hub-api honours it on the server: an unpriced holding is EXCLUDED from `totalUsd` and
 * `pricingComplete` goes false, rather than being counted at nothing. Which leaves exactly one way
 * for this bundle to break it — printing `totalUsd` unconditionally. When pricing is down that
 * field is the string "0", because zero is the honest sum of an empty set, and a screen that
 * renders "$0.00" beside "Total held" tells a user whose portfolio is intact that it is worth
 * nothing.
 *
 * The first test in `portfolioTotal` below is the one that fails if that regression is ever
 * written.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Holding, PortfolioView } from '../src/lib/hub.ts'
import {
  allocationData,
  hasAllocation,
  holdingValue,
  portfolioTotal,
  pricedHoldings,
  unpricedHoldings,
} from '../src/lib/portfolio.ts'

const holding = (over: Partial<Holding> & { assetCode: string }): Holding => ({
  amount: '1000000000000000000',
  amountFormatted: '1',
  available: '1000000000000000000',
  reserved: '0',
  usdScaled: '2500000000',
  usd: '2500',
  allocationBps: 10_000,
  quotedAt: '2026-03-14T14:22:00.000Z',
  priceReason: null,
  ...over,
})

const view = (over: Partial<PortfolioView>): PortfolioView => ({
  totalUsdScaled: '0',
  totalUsd: '0',
  pricedAt: null,
  pricingComplete: true,
  holdings: [],
  allocation: [],
  shards: '0',
  ember: '0',
  ...over,
})

describe('portfolioTotal', () => {
  it('shows NO figure when nothing could be priced, even though totalUsd is "0"', () => {
    // The pricing-is-down response, exactly as hub-api sends it: every amount right, every value
    // null, the total a truthful zero over an empty set, and `pricingComplete: false` saying so.
    const down = view({
      totalUsd: '0',
      pricingComplete: false,
      holdings: [
        holding({ assetCode: 'ETH', usd: null, usdScaled: null, allocationBps: null, priceReason: 'no quote available' }),
        holding({ assetCode: 'BTC', usd: null, usdScaled: null, allocationBps: null, priceReason: 'no quote available' }),
      ],
    })

    const total = portfolioTotal(down)
    assert.equal(total.value, null, 'a portfolio with no usable price must render no total')
    assert.notEqual(total.value, '$0.00')
    assert.equal(total.partial, false, 'nothing was excluded from a total that does not exist')
    assert.match(total.caveat ?? '', /amounts below are exact/)
  })

  it('shows the figure, marked partial and counted, when some holdings are unpriced', () => {
    const partial = view({
      totalUsd: '2500',
      pricingComplete: false,
      holdings: [
        holding({ assetCode: 'EMBER' }),
        holding({ assetCode: 'TOKEN:urn', usd: null, usdScaled: null, priceReason: 'no price source for a minted token' }),
      ],
    })

    const total = portfolioTotal(partial)
    assert.equal(total.value, '$2,500.00')
    assert.equal(total.partial, true)
    // Sized, not vague: "some are missing" is a caveat nobody can act on.
    assert.equal(total.caveat, '1 holding is unpriced and excluded from this total.')
  })

  it('pluralises the caveat, because a count of one and a count of three read differently', () => {
    const total = portfolioTotal(
      view({
        totalUsd: '10',
        pricingComplete: false,
        holdings: [
          holding({ assetCode: 'EMBER' }),
          holding({ assetCode: 'A', usd: null, usdScaled: null }),
          holding({ assetCode: 'B', usd: null, usdScaled: null }),
        ],
      }),
    )
    assert.equal(total.caveat, '2 holdings are unpriced and excluded from this total.')
  })

  it('shows a clean figure with no caveat when everything is priced', () => {
    const total = portfolioTotal(
      view({ totalUsd: '12480.229', pricingComplete: true, holdings: [holding({ assetCode: 'EMBER' })] }),
    )
    // …and it is CUT to 12,480.22, not rounded up to .23.
    assert.equal(total.value, '$12,480.22')
    assert.equal(total.partial, false)
    assert.equal(total.caveat, null)
  })

  it('renders no total for an account that holds nothing, which is not the same as a zero', () => {
    // An empty account and a priced-at-zero account must not read alike; the empty STATE belongs
    // here, and a "$0.00" would suppress it.
    const total = portfolioTotal(view({ holdings: [] }))
    assert.equal(total.value, null)
    assert.equal(total.caveat, null)
  })

  it('treats pricingComplete:false as partial even when every holding happens to carry a value', () => {
    // Belt and braces: hub-api owns that flag, and if it says the total is incomplete then the
    // total is incomplete, whatever this client thinks it can see.
    const total = portfolioTotal(
      view({ totalUsd: '5', pricingComplete: false, holdings: [holding({ assetCode: 'EMBER' })] }),
    )
    assert.equal(total.partial, true)
    assert.equal(total.value, '$5.00')
  })
})

describe('holdingValue', () => {
  it('is null for an unpriced holding and never a zero', () => {
    assert.equal(holdingValue(holding({ assetCode: 'ETH', usd: null })), null)
  })

  it('formats a priced holding', () => {
    assert.equal(holdingValue(holding({ assetCode: 'ETH', usd: '1234.5' })), '$1,234.50')
  })
})

describe('priced and unpriced partitions', () => {
  it('splits on the presence of a value, so the page can show both without dropping either', () => {
    const v = view({
      holdings: [
        holding({ assetCode: 'EMBER' }),
        holding({ assetCode: 'ETH', usd: null, usdScaled: null }),
      ],
    })
    assert.deepEqual(pricedHoldings(v).map((h) => h.assetCode), ['EMBER'])
    assert.deepEqual(unpricedHoldings(v).map((h) => h.assetCode), ['ETH'])
    // Neither list is the source of the total; both are rendered.
    assert.equal(pricedHoldings(v).length + unpricedHoldings(v).length, v.holdings.length)
  })
})

describe('allocationData', () => {
  it('plots basis points, so money never passes through a float', () => {
    const v = view({
      allocation: [
        { label: 'EMBER', usdScaled: '1', usd: '1', bps: 4200 },
        { label: 'ETH', usdScaled: '1', usd: '1', bps: 2600 },
      ],
    })
    assert.deepEqual(allocationData(v), [
      { label: 'EMBER', value: 4200 },
      { label: 'ETH', value: 2600 },
    ])
  })

  it('preserves hub-api’s order rather than sorting again', () => {
    // The rows arrive largest first and already folded past eight. A second sort here would be a
    // second opinion about an order that has one.
    const v = view({
      allocation: [
        { label: 'ETH', usdScaled: '1', usd: '1', bps: 2600 },
        { label: 'EMBER', usdScaled: '1', usd: '1', bps: 4200 },
      ],
    })
    assert.deepEqual(allocationData(v).map((r) => r.label), ['ETH', 'EMBER'])
  })

  it('drops zero and negative rows: a bar of no length is a table row, not a mark', () => {
    const v = view({
      allocation: [
        { label: 'EMBER', usdScaled: '1', usd: '1', bps: 10_000 },
        { label: 'Dust', usdScaled: '0', usd: '0', bps: 0 },
      ],
    })
    assert.equal(allocationData(v).length, 1)
  })

  it('has no allocation at all when nothing could be priced', () => {
    // A share of an unknown total is not a number, so the chart is absent — while the holdings
    // list below it still shows every asset.
    const v = view({
      allocation: [],
      holdings: [holding({ assetCode: 'ETH', usd: null, usdScaled: null, allocationBps: null })],
    })
    assert.equal(hasAllocation(v), false)
    assert.equal(v.holdings.length, 1)
  })
})
