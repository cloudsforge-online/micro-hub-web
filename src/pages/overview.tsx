/**
 * The overview: everything hub-api composes, in one call, degrading one tile at a time.
 *
 * ── Why this page renders even when half of it failed ──────────────────────────────────────────
 *
 * `GET /v1/dashboard` answers 200 with holes, never 500 (`hub-api/src/dashboard.ts`), and the
 * arithmetic behind that is why: seven upstreams at 99.9% composed with a shared failure mode give
 * a page at 99.3%, which is three hours a month of downtime on the estate's most visible surface
 * caused entirely by how it was assembled. hub-api's seven degradation tests are the exit
 * criterion. **A client that renders a failure state because one tile is unavailable throws all of
 * that away** — so the only thing that produces a failure state here is a rejection, which after
 * the above can only mean the session or hub-api itself.
 *
 * The layout follows design-system.md §6, in its order and for its stated reasons:
 *
 *   1. Portfolio first, carrying its pricing timestamp.
 *   2. "Needs you" as the primary call to action, one card per source, each degrading alone.
 *   3. Wallet lifecycle state visible in the list rather than behind a detail view.
 *   4. Activity as a preview of the last four, with one link out.
 */
import { useCallback, useId } from 'react'
import { BarChart, StatTile } from '@cloudsforge/ui/charts'
import { Link } from 'react-router-dom'
import { DegradedBanner, TilePanel } from '../components/tile.tsx'
import { EstimateNotice } from '../components/estimate.tsx'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { ActivityRow } from './activity.tsx'
import { WalletRow } from './wallet.tsx'
import { formatAmount, formatBps, pricedStamp } from '../lib/format.ts'
import { loadDashboard, type Dashboard, type NextAction } from '../lib/hub.ts'
import { allocationData, estimatedAssets, hasAllocation, portfolioTotal } from '../lib/portfolio.ts'
import { useResource } from '../lib/resource.ts'
import { degradedSentence } from '../lib/tile.ts'

/**
 * A dashboard is never "empty".
 *
 * `useResource` reduces a count of zero to the empty state, and that is right for a list. It is
 * wrong here: the dashboard's emptiness is a property of each tile, every one of which carries its
 * own empty value and renders its own empty state. A page-level "nothing here" would replace
 * eleven specific answers with one vague one.
 */
const alwaysPresent = () => 1

export function OverviewPage() {
  const load = useCallback((signal: AbortSignal) => loadDashboard(signal), [])
  const { state, data, error, reload } = useResource(load, alwaysPresent, 'We could not put your dashboard together.')

  if (state === 'forbidden') return <Forbidden notice={error ?? undefined} />
  if (state === 'failed' && error) return <Failed notice={error} onRetry={reload} />
  if (state === 'loading' || !data) return <Loading label="Gathering everything into one view" />

  return <Overview dashboard={data} />
}

function Overview({ dashboard }: { dashboard: Dashboard }) {
  const estimateId = useId()
  const { tiles, nextActions } = dashboard
  const portfolio = tiles.portfolio.data
  const total = portfolioTotal(portfolio)
  const stamp = pricedStamp(portfolio.pricedAt)
  const estimated = estimatedAssets(portfolio)

  return (
    <>
      <header className="wt-page__head">
        <h1 className="wt-page__title">Overview</h1>
        <p className="wt-page__lede">
          One sign-in, one balance and one record of what you have done, shared by every CloudsForge
          product. What you hold is counted once here rather than kept in six separate places.
        </p>
        {/*
          The composition time, on screen. It is the cheapest possible answer to "is this slow for
          everyone or just me", and hub-api sends `elapsedMs` and `budgetMs` on every response for
          exactly that purpose.
        */}
        <p className="wt-page__meta cf-num">
          gathered in {dashboard.elapsedMs}ms of the {dashboard.budgetMs}ms allowed
        </p>
      </header>

      <DegradedBanner sentence={degradedSentence(dashboard.degraded)} />

      {/* ── 1. Portfolio first, with its pricing timestamp ────────────────────────────────── */}
      <TilePanel
        title="Portfolio"
        tile={tiles.portfolio}
        action={
          <Link className="wt-link" to="/portfolio">
            See every holding →
          </Link>
        }
        empty={<p className="wt-note">You are not holding anything yet.</p>}
      >
        <div className="wt-tiles">
          {/*
            `value` is `total.value`, which is NULL rather than "$0.00" when nothing could be
            priced. See lib/portfolio.ts — this is the single line on which the estate's
            never-invent-a-number rule is either kept or broken.
          */}
          <StatTile
            label="Total held"
            value={total.value}
            emptyLabel="No usable price"
            {...(stamp ? { pricedAt: stamp } : {})}
          />
          {/*
            Unchanged on purpose, and not an instance of the retired-asset mislabel micro-org#227
            swept the estate for. `portfolio.shards` is the ledger's own SHARD liability, summed by
            `hub-api/src/portfolio.ts` off the balances whose `assetCode` is `SHARD`, so the label
            names what the number is rather than dressing something else up as it. Re-denominating
            it is micro-org#226 — an open owner decision that changes the ledger first and this
            tile afterwards. The argument in full, with the mainnet measurement behind it, is on
            the same tile in `pages/portfolio.tsx`.
          */}
          <StatTile label="Shards" value={formatAmount(portfolio.shards)} emptyLabel="None held" />
          <StatTile label="EMBER" value={formatAmount(portfolio.ember)} emptyLabel="None held" />
          <StatTile
            label="Assets"
            value={portfolio.holdings.length === 0 ? null : String(portfolio.holdings.length)}
            emptyLabel="None held"
          />
        </div>

        {total.caveat && <p className="wt-note wt-note--caveat">{total.caveat}</p>}

        {/*
          "Total held" here is the same sum as on the portfolio page and can carry the same
          estimate inside it. This page shows no per-holding figures, so there is nothing to point
          an `aria-describedby` at — the statement stands on its own, under the number it is about.
        */}
        <EstimateNotice id={estimateId} assets={estimated} />

        {hasAllocation(portfolio) && (
          <BarChart
            title="Allocation"
            data={allocationData(portfolio)}
            {...(stamp ? { pricedAt: stamp } : {})}
            formatValue={(bps) => formatBps(bps) ?? '—'}
            emptyLabel="Nothing priced in this account"
            errorLabel="Could not load these balances"
          />
        )}
      </TilePanel>

      {/* ── 2. "Needs you" — the primary call to action ───────────────────────────────────── */}
      <section className="wt-panel">
        <header className="wt-panel__head">
          <h2 className="wt-panel__title">Waiting on you</h2>
        </header>
        {nextActions.actions.length === 0 ? (
          <p className="wt-note">
            Nothing is waiting on you.
            {nextActions.missing.length > 0 &&
              ' A few sources went unread, though, so something could be missing from this list — see below.'}
          </p>
        ) : (
          <ul className="wt-cards">
            {nextActions.actions.map((action) => (
              <ActionCard key={action.id} action={action} />
            ))}
          </ul>
        )}
        {/*
          A card that cannot load is ABSENT, not broken (nextactions.ts), and the reason is
          reported for the operator rather than dressed up for the user. Naming it here is the
          difference between "you have nothing pending" and "we could not ask".
        */}
        {nextActions.missing.length > 0 && (
          <p className="wt-note wt-note--caveat">
            We could not ask:{' '}
            {nextActions.missing.map((m) => `${m.source} (${m.reason})`).join('; ')}.
          </p>
        )}
      </section>

      <div className="wt-columns">
        {/* ── 3. Wallets, with lifecycle state in the list ────────────────────────────────── */}
        <TilePanel
          title="Wallets"
          tile={tiles.wallets}
          action={
            <Link className="wt-link" to="/wallet">
              Manage →
            </Link>
          }
          empty={
            <p className="wt-note">
              No wallet has been created or connected yet. One is set up for you the first time
              something arrives.
            </p>
          }
        >
          {tiles.wallets.data.length === 0 ? null : (
            <ul className="wt-rows">
              {tiles.wallets.data.map((wallet) => (
                <WalletRow key={wallet.id} wallet={wallet} />
              ))}
            </ul>
          )}
        </TilePanel>

        {/* ── 4. Activity: the last four, and one link out ────────────────────────────────── */}
        <TilePanel
          title="Activity"
          tile={tiles.activity}
          action={
            <Link className="wt-link" to="/activity">
              See everything →
            </Link>
          }
          empty={<p className="wt-note">Nothing has been recorded against this account yet.</p>}
        >
          {tiles.activity.data.length === 0 ? null : (
            <ul className="wt-rows">
              {tiles.activity.data.map((record) => (
                <ActivityRow key={record.id} record={record} />
              ))}
            </ul>
          )}
        </TilePanel>
      </div>

      {/*
        The single-account story, said once on the surface that owns it. Every name below is a real
        product in the shared surface registry the bar and the footer are also built from, so this
        list cannot drift out of step with what the account actually reaches.
      */}
      <section className="wt-panel">
        <header className="wt-panel__head">
          <h2 className="wt-panel__title">What this one account reaches</h2>
        </header>
        <p className="wt-note">
          Signing in here signs you in everywhere. There is no second password to keep, no separate
          balance to top up, and no reconciling one product against another.
        </p>
        <ul className="wt-rows">
          <li className="wt-row">
            <span className="wt-row__main">
              <span className="wt-row__title">Forge Trade</span>
              <span className="wt-row__sub">
                Put a trading rule through real price history with fees and slippage charged, then
                run what survives on paper before anything is at stake.
              </span>
            </span>
          </li>
          <li className="wt-row">
            <span className="wt-row__main">
              <span className="wt-row__title">Forge Market</span>
              <span className="wt-row__sub">
                Buy and sell items, tokens and memberships. Escrow, the fee and every creator
                royalty settle as one balanced entry against this account.
              </span>
            </span>
          </li>
          <li className="wt-row">
            <span className="wt-row__main">
              <span className="wt-row__title">Forge Network</span>
              <span className="wt-row__sub">
                The EMBER chain, its explorer and its faucet. It runs a real EVM — Solidity
                compiles and deploys against it, Hardhat and Foundry work unmodified, and it is
                held to Ethereum's own published test vectors.
              </span>
            </span>
          </li>
          <li className="wt-row">
            <span className="wt-row__main">
              <span className="wt-row__title">Forge Create, Worlds and Foresight</span>
              <span className="wt-row__sub">
                Making things, playing in them, and asking what happens next. Whatever you earn or
                spend across them lands in the balance above.
              </span>
            </span>
          </li>
          <li className="wt-row">
            <span className="wt-row__main">
              <span className="wt-row__title">Developer Platform</span>
              <span className="wt-row__sub">
                API keys and the console, for building against any of it directly.
              </span>
            </span>
          </li>
        </ul>
      </section>
    </>
  )
}

/**
 * One "needs you" card.
 *
 * Every card carries a VERB and a destination, because "2FA is not enabled" is an observation and
 * "Enable →" is an action — a card a user cannot act on from here is a worry with no outlet.
 * `href` is relative and stays relative: hub-api emits deep links without an origin because "the
 * SPA owns its own origin" (nextactions.ts).
 */
function ActionCard({ action }: { action: NextAction }) {
  return (
    <li className={`wt-card wt-card--${action.severity}`}>
      <p className="wt-card__title">{action.title}</p>
      <p className="wt-card__detail">{action.detail}</p>
      {action.progress && (
        <p className="wt-card__progress cf-num">
          {action.progress.done}/{action.progress.total}
          {action.progress.etaMinutes !== null && ` · ~${action.progress.etaMinutes} min`}
        </p>
      )}
      <div className="wt-card__foot">
        <Link className="cf-btn" to={action.href}>
          {action.verb}
        </Link>
        <span className="wt-card__source">{action.source}</span>
      </div>
    </li>
  )
}
