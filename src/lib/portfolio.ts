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

/* ───────────────────────── prices no market ever agreed to ───────────────────────── */

/**
 * Whether this holding's figure came from an operator rather than from a market.
 *
 * ── Why this reads `priceSource` and never an asset code ───────────────────────────────────────
 *
 * EMBER is the only administered asset today, and writing `assetCode === 'EMBER'` here would work
 * today. It would also put a copy of `ADMINISTERED_ASSETS` (`pricing/src/rates.ts`) in a bundle
 * that ships separately from the service that owns it, and the first asset added to that list — or
 * removed from it, the day EMBER is listed somewhere — would be a note this screen keeps showing or
 * never starts showing, with nothing failing anywhere. Pricing already answers the question on
 * every rate; this asks it.
 *
 * A holding with no `priceSource` is not an estimate. SHARD and USD are fixed by contract, which is
 * a stronger statement than a market price rather than a weaker one.
 */
export function isEstimate(holding: Holding): boolean {
  return holding.priceSource === 'administered' && holding.usd !== null
}

/** The assets on this screen whose value is an estimate, in the order the holdings arrived. */
export function estimatedAssets(view: PortfolioView): readonly string[] {
  return view.holdings.filter(isEstimate).map((holding) => holding.assetCode)
}

/**
 * The standing statement to print beside those figures, or null when there are none.
 *
 * ── The copy standard, from `pool-web/src/components/notices.tsx` ──────────────────────────────
 *
 * That file is this estate's reference for saying an uncomfortable thing plainly, and its three
 * rules are kept here:
 *
 *   * **Present tense, no schedule.** "not yet listed" and "listing soon" both describe a date that
 *     does not exist. EMBER *is not listed*; whether that ever changes is not this sentence's to
 *     say.
 *   * **No number.** Not a target price, not a range, not a confidence. The figure beside the note
 *     is the only number in view, and the note's whole job is to say what kind of number it is.
 *   * **Derived from the API.** The asset names come from the holdings that reported an
 *     administered source, so this sentence cannot name an asset the service did not.
 *
 * "an estimate set by CloudsForge" rather than "an estimated value": the second implies somebody
 * estimated what a market would pay, and nobody has, because there is no market to estimate.
 */
export function estimateNotice(assets: readonly string[]): string | null {
  if (assets.length === 0) return null
  if (assets.length === 1) {
    return (
      `${assets[0]} is not listed on any exchange. Its value here is an estimate set by ` +
      `CloudsForge, not a market price.`
    )
  }
  const named = `${assets.slice(0, -1).join(', ')} and ${assets[assets.length - 1]}`
  return (
    `${named} are not listed on any exchange. Their values here are estimates set by CloudsForge, ` +
    `not market prices.`
  )
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
