/**
 * Reading a portfolio without ever inventing a number.
 *
 * ── The rule, and where it comes from ──────────────────────────────────────────────────────────
 *
 * `wallet/src/pricingclient.ts` states it twice, and this file is the client-side half of it:
 *
 * > "A rate that cannot be quoted is an error, never a default… A fallback rate is a rate at
 * > which somebody trades."
 *
 * > "An asset absent from it means 'no usable price' rather than zero. A zero would be a
 * > valuation, and a valuation of zero is a lie about a holding that exists."
 *
 * hub-api already honours it: an unpriced holding arrives with `usd: null` and a `priceReason`,
 * and it is EXCLUDED from `totalUsd` rather than counted at nothing, with `pricingComplete: false`
 * to say so (`hub-api/src/portfolio.ts`).
 *
 * ── Which leaves exactly one way for the client to break it ────────────────────────────────────
 *
 * By rendering `totalUsd` unconditionally. When pricing is down, hub-api sends holdings with every
 * amount correct, every value null, and `totalUsd: "0"` — because zero is the honest sum of an
 * empty set of priced holdings, and `pricingComplete: false` is the field that says the set was
 * empty. A screen that prints "$0.00" beside "Total held" has taken a truthful response and turned
 * it into the exact lie the whole chain was built to avoid: a user whose portfolio is intact reads
 * that it is worth nothing.
 *
 * `portfolioTotal()` below is the guard. Nothing in this app may format `totalUsd` directly.
 */
import { formatUsd } from './format.ts'
import type { Holding, PortfolioView } from './hub.ts'

export interface PortfolioTotal {
  /**
   * The figure to print, already formatted — or `null`, meaning "do not print a figure".
   *
   * `StatTile` takes `value: string | null` and renders its `emptyLabel` for null, which is why
   * this is the shape: the absence travels all the way to the component instead of being turned
   * into a string somewhere on the way.
   */
  readonly value: string | null
  /** True when the total is real but INCOMPLETE — some holdings are missing from it. */
  readonly partial: boolean
  /** What to say under the number. Null when the total needs no footnote. */
  readonly caveat: string | null
}

/** Holdings that carry a usable valuation. */
export function pricedHoldings(view: PortfolioView): readonly Holding[] {
  return view.holdings.filter((holding) => holding.usd !== null)
}

/** Holdings the oracle could not price. Shown, always — never dropped, never zeroed. */
export function unpricedHoldings(view: PortfolioView): readonly Holding[] {
  return view.holdings.filter((holding) => holding.usd === null)
}

/**
 * The total, or the honest absence of one.
 *
 * Four cases, in order:
 *
 *   1. **No holdings at all.** There is nothing to value. The empty state belongs here, not a
 *      zero — an account that holds nothing and an account whose prices failed must not read the
 *      same.
 *   2. **Holdings, none of them priced.** No figure. This is the pricing-is-down case and the one
 *      that costs somebody their nerve if it renders as $0.00.
 *   3. **Some priced, some not.** A figure, marked partial, naming how many are missing from it.
 *      hub-api's `pricingComplete: false` is the flag; the count is computed here because a
 *      caveat that says "some" is a caveat nobody can size.
 *   4. **Everything priced.** The figure, and nothing else to say.
 */
export function portfolioTotal(view: PortfolioView): PortfolioTotal {
  if (view.holdings.length === 0) {
    return { value: null, partial: false, caveat: null }
  }

  const missing = unpricedHoldings(view)
  if (missing.length === view.holdings.length) {
    return {
      value: null,
      partial: false,
      caveat:
        'No holding could be priced, so there is no total to show. The amounts below are exact; ' +
        'only their value in USD is missing.',
    }
  }

  const formatted = formatUsd(view.totalUsd)
  if (missing.length > 0 || !view.pricingComplete) {
    const noun = missing.length === 1 ? 'holding is' : 'holdings are'
    return {
      value: formatted,
      partial: true,
      caveat: `${missing.length} ${noun} unpriced and excluded from this total.`,
    }
  }
  return { value: formatted, partial: false, caveat: null }
}

/** One holding's value, formatted. Null stays null: see the file header. */
export function holdingValue(holding: Holding): string | null {
  return formatUsd(holding.usd)
}

/**
 * The allocation bars, as chart data.
 *
 * The VALUE plotted is `bps` — basis points, an integer hub-api computed with BigInt arithmetic —
 * and not the USD figure. Two reasons, and the second is the load-bearing one:
 *
 *   1. An allocation chart is read as proportions, so proportions are what it should carry.
 *   2. `ChartDatum.value` is a `number`. Passing a USD amount through it means `Number(view.usd)`,
 *      which is the float conversion this whole stack goes to some trouble to avoid. Basis points
 *      are already integers under 10,000 and lose nothing.
 *
 * Rows are returned in hub-api's order, which is largest first and already folded to "Other" past
 * eight (`portfolio.ts`). Re-sorting here would be a second opinion about an order that
 * has one.
 */
export function allocationData(view: PortfolioView): { label: string; value: number }[] {
  return view.allocation
    .filter((row) => Number.isFinite(row.bps) && row.bps > 0)
    .map((row) => ({ label: row.label, value: row.bps }))
}

/**
 * Whether the allocation chart has anything to draw.
 *
 * Distinct from "the portfolio is empty": a portfolio of entirely unpriced holdings has holdings
 * and no allocation, because a share of an unknown total is not a number. The list below the
 * chart still shows every one of them.
 */
export function hasAllocation(view: PortfolioView): boolean {
  return allocationData(view).length > 0
}
