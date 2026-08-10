/**
 * Portfolio: every holding, every amount, and every price's own timestamp.
 *
 * ── The two rules this page exists to keep ─────────────────────────────────────────────────────
 *
 * **1. A holding whose rate is unavailable renders WITHOUT a value. Never as zero.**
 * `wallet/src/pricingclient.ts`: "an asset absent from it means 'no usable price' rather than
 * zero. A zero would be a valuation, and a valuation of zero is a lie about a holding that
 * exists." hub-api sends `usd: null` and a `priceReason` for such a holding; the value cell shows
 * the reason, the amount cell is unaffected, and `lib/portfolio.ts` keeps the same absence out of
 * the total.
 *
 * **2. Every quote carries the instant it was observed, and the page shows it.**
 * The same file: "A number with no timestamp cannot be shown to a user honestly and cannot be
 * refused when it goes stale. Every quote in the portfolio renders its own `asOf`, because 'your
 * portfolio is worth £X' with no time attached is a claim about now that is actually a claim about
 * whenever the cache was last warm." So there are two stamps on this page and they are different
 * numbers: the summary carries `pricedAt`, which hub-api computes as the OLDEST contributing
 * observation, and each row carries its own `quotedAt`.
 *
 * Reads `GET /v1/portfolio` — hub-api/src/server.ts. The body is `{ portfolio: <tile> }`,
 * a single key with the tile beneath it (server.ts), not the tile at the top level.
 */
import { useCallback, useId } from 'react'
import { BarChart, StatTile } from '@cloudsforge/ui/charts'
import { EstimateMark, EstimateNotice } from '../components/estimate.tsx'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { TilePanel } from '../components/tile.tsx'
import { formatAmount, formatBps, pricedStamp, quotedStamp } from '../lib/format.ts'
import { loadPortfolio, type Holding, type PortfolioView } from '../lib/hub.ts'
import {
  allocationData,
  estimatedAssets,
  hasAllocation,
  holdingValue,
  isEstimate,
  portfolioTotal,
} from '../lib/portfolio.ts'
import { useResource } from '../lib/resource.ts'
import { hasAnswer } from '../lib/tile.ts'

export function PortfolioPage() {
  /*
    One id for the unlisted-asset statement, minted by the page rather than by the component that
    renders it, because the elements that POINT at it are in a different section — the value cells
    of the holdings table, below the panel the statement sits in. `useId` rather than a constant for
    the reason `MiningControl` gives: two of the same id on one page would be a silently wrong
    `aria-describedby` rather than a visible break.
  */
  const estimateId = useId()
  const load = useCallback((signal: AbortSignal) => loadPortfolio(signal), [])
  const { state, data, error, reload } = useResource(
    load,
    // Emptiness is a property of the holdings, not of the response: a 200 carrying a portfolio
    // with no holdings is the empty state, and a 200 carrying an unavailable tile is not.
    (result) => (hasAnswer(result.portfolio) ? result.portfolio.data.holdings.length : 1),
    'We could not value what you are holding.',
  )

  if (state === 'forbidden') return <Forbidden notice={error ?? undefined} />
  if (state === 'failed' && error) return <Failed notice={error} onRetry={reload} />
  if (state === 'loading' || !data) return <Loading label="Working out what it is all worth" />

  const tile = data.portfolio
  if (state === 'empty' && hasAnswer(tile)) {
    return (
      <Empty
        title="You are not holding anything yet"
        hint="Anything you deposit, earn, or are paid for a sale shows up here the moment it settles."
      />
    )
  }

  const view = tile.data
  const total = portfolioTotal(view)
  const stamp = pricedStamp(view.pricedAt)
  const estimated = estimatedAssets(view)

  return (
    <>
      <header className="wt-page__head">
        <h1 className="wt-page__title">Portfolio</h1>
        <p className="wt-page__lede">
          Everything you hold across CloudsForge, valued together. Prices are the middle of four
          independent sources rather than one, and a round where they disagree too widely is thrown
          away instead of averaged. Anything we have no honest price for is listed with its amount
          and no value, never as zero, and is left out of the total.
        </p>
        {/*
          The summary stamp, in the head, where the reference layout puts it. It is the OLDEST
          contributing observation — hub-api computes it that way on purpose, because "a portfolio
          valued from a BTC quote taken two seconds ago and an XRP quote taken four minutes ago is,
          as a single number, four minutes old" (hub-api/src/portfolio.ts).
        */}
        {stamp && <p className="wt-page__meta cf-num">{stamp}</p>}
      </header>

      <TilePanel title="Held" tile={tile} empty={<p className="wt-note">You hold nothing yet.</p>}>
        <div className="wt-tiles">
          <StatTile
            label="Total held"
            value={total.value}
            emptyLabel="No usable price"
            {...(stamp ? { pricedAt: stamp } : {})}
          />
          {/*
            ── THE SHARDS TILE IS UNCHANGED ON PURPOSE. micro-org#226 ──────────────────────────

            SHARD is retired (`RETIRED_ASSETS`, `contracts/packages/chain/src/index.ts`) and the
            estate has swept its user surfaces for the name (micro-org#227). This tile is not one
            of the surfaces that sweep was for. Those were copy that said "Shards" over data that
            was something else — USD cents, EMBER, a season reward. `view.shards` is the LEDGER'S
            OWN SHARD LIABILITY: `hub-api/src/portfolio.ts` sums the balances whose `assetCode` is
            `SHARD` out of ledger's `GET /accounts/:subject/balances` and sends the total under
            that name. The label therefore says exactly what the number is.

            Measured on mainnet 2026-08-09 (micro-org#226): 13 user liability accounts hold 13,000
            SHARD between them, against a single custody account of 13,000. Small, and beacon and
            test residue rather than real users — but real ledger rows. Relabelling this tile would
            tell whoever holds them that their balance is denominated in a unit the ledger does not
            record, and would put a number on screen that no posting supports.

            `mint/src/migrations.ts` (`retire_shard_pricing`) states the general form of this in
            its own words: the customer's screen said "Pay 2,500 Shards" and it was TRUE, "which is
            why the screen could not be fixed by relabelling it, and why this migration is the
            fix". The same holds here. The unit is a property of the ledger, so it changes in the
            service that posts to the ledger and this tile follows — it does not lead.

            That change is micro-org#226, which is an open OWNER decision and not a find-and-
            replace: the two migrations that have retired a SHARD price went to USD cents and
            refused EMBER by name, and the grant leg pays users who cannot hold USD, so the payout
            path is unbuilt. `trade-web`, `worlds-web/src/pages/title.tsx` and
            `admin-web/src/pages/engagement.tsx` are held for the same reason.
          */}
          <StatTile label="Shards" value={formatAmount(view.shards)} emptyLabel="None held" />
          <StatTile label="EMBER" value={formatAmount(view.ember)} emptyLabel="None held" />
          <StatTile
            label="Assets"
            value={view.holdings.length === 0 ? null : String(view.holdings.length)}
            emptyLabel="None held"
          />
        </div>
        {total.caveat && <p className="wt-note wt-note--caveat">{total.caveat}</p>}
        {/*
          Under "Total held", because the total is a SUM that includes the estimate — a reader who
          only looks at the one big number must still meet the statement. It is a second sentence
          rather than a clause of `total.caveat`: that caveat is about holdings LEFT OUT of the
          total, and this is about the kind of price one of the holdings that is IN it carries.
        */}
        <EstimateNotice id={estimateId} assets={estimated} />
      </TilePanel>

      {hasAnswer(tile) && hasAllocation(view) && (
        <section className="wt-panel">
          {/*
            Sorted horizontal bars with direct labels, and never a pie — rule 6 of §6: "a pie asks
            a reader to compare angles, which they cannot do, in exchange for a shape". The values
            are basis points rather than USD, which keeps money out of a `number`; see
            lib/portfolio.ts.
          */}
          <BarChart
            title="Allocation"
            data={allocationData(view)}
            {...(stamp ? { pricedAt: stamp } : {})}
            formatValue={(bps) => formatBps(bps) ?? '—'}
            emptyLabel="Nothing priced in this account"
            errorLabel="Could not load these balances"
          />
        </section>
      )}

      {hasAnswer(tile) && view.holdings.length > 0 && (
        <HoldingsTable view={view} estimateId={estimateId} />
      )}
    </>
  )
}

/**
 * Every holding, with its own quote timestamp.
 *
 * A table rather than a list: these are five comparable columns, and a table is the accessible,
 * copyable and printable form of them. `available` and `reserved` are both shown because "why can
 * I not spend it" is the question the reserved column exists to answer
 * (hub-api/src/portfolio.ts).
 */
function HoldingsTable({ view, estimateId }: { view: PortfolioView; estimateId: string }) {
  return (
    <section className="wt-panel">
      <header className="wt-panel__head">
        <h2 className="wt-panel__title">Every holding</h2>
      </header>
      <div className="wt-tablewrap">
        <table className="wt-table">
          <thead>
            <tr>
              <th scope="col">Asset</th>
              <th scope="col">Amount</th>
              <th scope="col">Available</th>
              <th scope="col">Reserved</th>
              <th scope="col">Value</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {view.holdings.map((holding) => (
              <HoldingRow key={holding.assetCode} holding={holding} estimateId={estimateId} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function HoldingRow({ holding, estimateId }: { holding: Holding; estimateId: string }) {
  const value = holdingValue(holding)
  const asOf = quotedStamp(holding.quotedAt)
  const share = formatBps(holding.allocationBps)
  const estimated = isEstimate(holding)

  return (
    <tr className={value === null ? 'wt-table__row--unpriced' : undefined}>
      <th scope="row">{holding.assetCode}</th>
      {/*
        `amountFormatted` is null for a `TOKEN:` asset, whose decimals nothing in the fan-out
        knows (hub-api gap 5). The raw smallest-units figure is shown instead, labelled as such —
        formatting it with a guessed exponent would be a wrong number rather than a raw one.
      */}
      <td className="cf-num">
        {holding.amountFormatted ?? (
          <span title="This is the raw smallest-unit figure. Nothing publishes how many decimal places this asset uses, so we will not pretend to place the point.">
            {holding.amount} <span className="wt-unit">raw</span>
          </span>
        )}
      </td>
      <td className="cf-num">{formatAmount(holding.available) ?? holding.available}</td>
      <td className="cf-num">{formatAmount(holding.reserved) ?? holding.reserved}</td>
      {/*
        `aria-describedby` on the CELL, pointing at the statement in the panel above. The figure is
        not focusable and must not become focusable — a tab stop on a read-only number is a stop a
        keyboard user has to pass through on every row — so the association is made on the element
        a screen reader lands on when it reads the cell, and the statement it names is ordinary
        visible text rather than anything hidden behind an interaction.
      */}
      <td className="cf-num" {...(estimated ? { 'aria-describedby': estimateId } : {})}>
        {value === null ? (
          // Rule 1. No figure, and pricing's own words for why — never a dash that could be read
          // as nothing, and never a zero.
          <span className="wt-unpriced">
            no honest price
            {holding.priceReason && <span className="wt-unpriced__why"> — {holding.priceReason}</span>}
          </span>
        ) : (
          <>
            {value}
            {/* The word, for a reader who is looking at the figure rather than at the panel. */}
            {estimated && <EstimateMark />}
            {/* Rule 2. This quote's own instant, not the summary's. */}
            {asOf && <span className="wt-asof cf-num"> {asOf}</span>}
          </>
        )}
      </td>
      <td className="cf-num">{share ?? '—'}</td>
    </tr>
  )
}
