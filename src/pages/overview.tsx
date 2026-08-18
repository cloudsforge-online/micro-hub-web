/**
 * The overview: everything hub-api composes, in one call, degrading one tile at a time.
 *
 * ── Why this page renders even when half of it failed ──────────────────────────────────────────
 *
 * `GET /v1/dashboard` answers 200 with holes, never 500 (`hub-api/src/dashboard.ts`), and the
 * arithmetic behind that is why: eight upstreams at 99.9% composed with a shared failure mode give
 * a page at 99.2%, which is more than five hours a month of downtime on the estate's most visible
 * surface caused entirely by how it was assembled. hub-api's per-upstream degradation tests are
 * the exit criterion. **A client that renders a failure state because one tile is unavailable
 * throws all of that away** — so the only thing that produces a failure state here is a rejection,
 * which after the above can only mean the session or hub-api itself.
 *
 * The layout follows design-system.md §6, in its order and for its stated reasons:
 *
 *   1. Portfolio first, carrying its pricing timestamp.
 *   2. Deposit addresses — the one departure from §6's order, argued at the panel itself. What you
 *      hold and how anything gets in are one question, and this half of it had never been on the
 *      page at all.
 *   3. "Needs you" as the primary call to action, one card per source, each degrading alone.
 *   4. Wallet lifecycle state visible in the list rather than behind a detail view.
 *   5. Activity as a preview of the last four, with one link out.
 *   6. Notifications, the newest few and the unread total — last because it is the only region
 *      here that is purely informational, and because it was absent altogether until micro-org
 *      #415: the tile it draws was a hard-coded `unavailable`, which put a permanent
 *      "notifications is not showing current data" banner at the top of this page for every user.
 */
import { useCallback, useId } from 'react'
import { surface, type SurfaceKey } from '@cloudsforge/ui'
import { BarChart, StatTile } from '@cloudsforge/ui/charts'
import { Link } from 'react-router-dom'
import { AddressBook } from '../components/addressbook.tsx'
import { DegradedBanner, TilePanel } from '../components/tile.tsx'
import { EstimateNotice } from '../components/estimate.tsx'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { ActivityRow } from './activity.tsx'
import { WalletRow } from './wallet.tsx'
import { formatAmount, formatBps, pricedStamp, utcTime } from '../lib/format.ts'
import { loadDashboard, type Dashboard, type NextAction } from '../lib/hub.ts'
import { allocationData, estimatedAssets, hasAllocation, portfolioTotal } from '../lib/portfolio.ts'
import { useResource } from '../lib/resource.ts'
import { degradedSentence } from '../lib/tile.ts'
import { viewedSurfaceUrl } from '../lib/viewed.ts'

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
          /*
            Two ways out, because this panel answers two questions and only had a link for one.
            "See every holding" is the reading move; Convert is the DOING move, and micro-org#496
            put it a click away from the figures it operates on rather than behind a nav entry a
            reader has to already know exists. The wrapper is what stops `space-between` from
            throwing them to opposite ends of the header.
          */
          <span className="wt-panel__links">
            <Link className="wt-link" to="/convert">
              Convert to EMBER →
            </Link>
            <Link className="wt-link" to="/portfolio">
              See every holding →
            </Link>
          </span>
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
            The coins, as hub-api ordered them: EMBER first because it is this platform's own
            chain, then whatever this account actually holds, largest first. There is no fixed
            list here on purpose — see `CoinTile` in lib/hub.ts.

            This replaced a hard-coded "Shards" tile. The number under it was true, and that was
            not the problem: SHARD is retired, nothing new may be denominated in it, and it was
            occupying the space on the estate's most-read screen where somebody's Bitcoin should
            have been. A tile is a promotion, and a wound-down asset does not get one.
          */}
          {portfolio.coins.map((coin) => (
            <StatTile
              key={coin.assetCode}
              label={coin.assetCode}
              value={formatAmount(coin.amountFormatted)}
              emptyLabel="None held"
            />
          ))}
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

      {/*
        ── 2. HOW MONEY GETS IN, DIRECTLY UNDER WHAT YOU HOLD ──────────────────────────────────

        This panel is here because of a defect reported three times, the last of them:

          *"in overview no bitcoin address exist again (i already discuss this with you twice)"*

        And the reader was right on every occasion. The Overview is the page somebody means when
        they say "my account", and it has never carried a deposit address of any kind — the only
        one in this bundle was on Wallet → Receive, behind a `<select>` that defaults to EMBER.
        `components/addressbook.tsx` records the measurement that proves the consequence: 237
        accounts on mainnet hold an EMBER address and three hold a Bitcoin one, on an estate that
        has taken Bitcoin deposits, correctly and completely, the whole time.

        It sits second because it is the pair to the panel above it. Portfolio says what you have;
        this says how anything gets in. Putting it below "Waiting on you", where a strict reading
        of design-system.md §6 would have it, would leave the answer to "where do I send my
        Bitcoin" under a fold on the one page that is supposed to answer it.

        `compact` gives it the link out to Wallet rather than repeating rotation and the older
        addresses here — that screen owns those, and this one owns the question.
      */}
      <AddressBook compact />

      {/* ── 3. "Needs you" — the primary call to action ───────────────────────────────────── */}
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
        {/* ── 4. Wallets, with lifecycle state in the list ────────────────────────────────── */}
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

        {/* ── 5. Activity: the last four, and one link out ────────────────────────────────── */}
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
            // The same typed row the Activity page draws, so the preview and the page it links to
            // are one design (micro-org#482). `showDate` because there are no day headings here.
            <ul className="wt-tape wt-tape--tight">
              {tiles.activity.data.map((record) => (
                <ActivityRow key={record.id} record={record} showDate />
              ))}
            </ul>
          )}
        </TilePanel>
      </div>

      {/* ── 6. Notifications ──────────────────────────────────────────────────────────────── */}
      <NotificationsPanel tile={tiles.notifications} />

      <WhatThisAccountReaches />
    </>
  )
}

/* ─────────────────────── the rest of the estate, from the registry ─────────────────────── */

/**
 * What this account reaches, with each product's name and address taken from the shared registry.
 *
 * ── THE COMMENT THAT USED TO BE HERE WAS NOT TRUE, AND THAT IS THE WHOLE OF THIS CHANGE ───────
 *
 * It said: "Every name below is a real product in the shared surface registry the bar and the
 * footer are also built from, so this list cannot drift out of step with what the account actually
 * reaches." Underneath it were five hand-typed `<li>` rows. Nothing was derived from anything, no
 * row was a link, and the drift the comment promised could not happen had already happened — Forge
 * Exchange had shipped and this list, on the page a reader means when they say "my account", did
 * not mention it, while the bar and the footer above and below it both did.
 *
 * So the NAMES and the ADDRESSES are now read from `surface(key)` and `viewedSurfaceUrl(key)`, and
 * the claim is true by construction: a product renamed in the registry is renamed here, and a row
 * naming a key that does not exist will not compile.
 *
 * ── THE PROSE STAYS LOCAL, AND THAT IS DELIBERATE ─────────────────────────────────────────────
 *
 * `surface(key).blurb` exists and is not used. The registry's blurb describes a product to someone
 * who has never seen it — it is what the switcher and the footer show. These sentences describe
 * what a product does TO THE BALANCE ON THIS PAGE ("lands in the balance above", "settle as one
 * balanced entry against this account"), which is a fact about this screen and belongs to it.
 *
 * ── THE HOSTNAME IS NEVER TYPED ───────────────────────────────────────────────────────────────
 *
 * `viewedSurfaceUrl` composes it from the registry row and the network the reader is VIEWING, and
 * self-checks its composition against `hosts()` before trusting it. A reader on testnet is offered
 * the testnet estate; a preview deployment is offered the address that actually answers; and no
 * environment is written into this bundle, which `test/no-build-time-config.test.ts` would fail the
 * build over in any case. No path is appended to any of them: which address inside a surface is
 * its front door is that repository's decision.
 */
function WhatThisAccountReaches() {
  return (
    <section className="wt-panel">
      <header className="wt-panel__head">
        <h2 className="wt-panel__title">What this one account reaches</h2>
      </header>
      <p className="wt-note">
        Signing in here signs you in everywhere. There is no second password to keep, no separate
        balance to top up, and no reconciling one product against another.
      </p>
      <ul className="wt-rows">
        {REACHES.map((row) => (
          <li className="wt-row" key={row.keys.join('+')}>
            <span className="wt-row__main">
              <span className="wt-row__title">
                {row.keys.map((key, index) => (
                  <span key={key}>
                    {index > 0 && (index === row.keys.length - 1 ? ' and ' : ', ')}
                    <a className="wt-link" href={viewedSurfaceUrl(key)} rel="noreferrer noopener">
                      {surface(key).name}
                    </a>
                  </span>
                ))}
              </span>
              <span className="wt-row__sub">{row.blurb}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The products, in the order a reader meets them, and what each one does to the balance above.
 *
 * Grouped where the sentence is genuinely about several of them at once; the keys are what carry
 * the names and the links, so a group is three links under one sentence rather than one link
 * pretending to stand for three.
 */
const REACHES: ReadonlyArray<{ readonly keys: readonly SurfaceKey[]; readonly blurb: string }> = [
  {
    keys: ['trade'],
    blurb:
      'Put a trading rule through real price history with fees and slippage charged, then run ' +
      'what survives on paper before anything is at stake.',
  },
  {
    keys: ['market'],
    blurb:
      'Buy and sell items, tokens and memberships. Escrow, the fee and every creator royalty ' +
      'settle as one balanced entry against this account.',
  },
  {
    /*
      THE ROW THIS PAGE WAS MISSING, and the reason its neighbour needs a sentence of its own.

      Forge Exchange and the Convert page in this tab are both "swap one asset for another" and
      they are not the same arrangement: here CloudsForge quotes a price, sells out of its own
      holdings and keeps custody of both sides; there the trade is a transaction against pools on
      the EMBER chain, priced by what is in the pool, with CloudsForge holding nothing. A reader
      who conflates them has been misled about who is holding their money, so the distinction is
      drawn where the two are named together and nowhere else on this page.
    */
    keys: ['exchange'],
    blurb:
      'Swap EMBER and the tokens minted on Forge Create against pools that live on the chain ' +
      'itself. Those trades are transactions, priced by what is in the pool and settled in your ' +
      'own wallet — unlike Convert in this tab, where you trade with CloudsForge at a quoted ' +
      'price and we keep custody of both sides.',
  },
  {
    keys: ['network'],
    blurb:
      "The EMBER chain, its explorer and its faucet. It runs a real EVM — Solidity compiles and " +
      'deploys against it, Hardhat and Foundry work unmodified, and it is held to Ethereum’s own ' +
      'published test vectors.',
  },
  {
    keys: ['create', 'worlds', 'foresight'],
    blurb:
      'Making things, playing in them, and asking what happens next. Whatever you earn or spend ' +
      'across them lands in the balance above.',
  },
  {
    keys: ['developers'],
    blurb: 'API keys and the console, for building against any of it directly.',
  },
]

/**
 * Notifications — the newest few, and the unread total.
 *
 * ── Why this panel did not exist until now ─────────────────────────────────────────────────────
 *
 * hub-api's `notifications` tile was a constant `unavailable`, so `dashboard.degraded` contained
 * it on every response and `DegradedBanner` above printed "notifications is not showing current
 * data. Everything else on this page is." on every signed-in Overview in the estate — the exact
 * sentence the defect was reported as. There was nothing to render, so nothing rendered, and the
 * banner was the only trace of a feature notify had been serving all along: 172 notifications for
 * 85 users on mainnet at the time it was measured (2026-08-11, micro-org #415).
 *
 * ── Two things this component must not do ──────────────────────────────────────────────────────
 *
 * It must not build a sentence. `title` arrives written and substituted from notify's
 * `templates.ts`, the one place in the estate a user-visible sentence is authored; composing one
 * here from `templateId` would be a second copy free to drift.
 *
 * It must not link a row whose `href` is null. Null is not "no destination yet" — it is notify
 * saying the destination IS the single-use credential it has already redacted, so a link would
 * point at `/[redacted]` while looking like it works. The row is shown, unlinked.
 */
function NotificationsPanel({ tile }: { tile: Dashboard['tiles']['notifications'] }) {
  const { unread, items } = tile.data
  return (
    <TilePanel
      title="Notifications"
      tile={tile}
      action={
        // The count, not a link out: there is no inbox page in this app yet, and a link to one
        // that does not exist is worse than none. `unread` is the whole inbox rather than
        // `items.length`, which is why it can exceed the number of rows below.
        unread > 0 ? <span className="wt-chip wt-chip--warn cf-num">{unread} unread</span> : null
      }
      empty={<p className="wt-note">Nothing has been sent to you yet.</p>}
    >
      {items.length === 0 ? null : (
        <ul className="wt-rows">
          {items.map((item) => (
            <li className="wt-row" key={item.id}>
              <span className="wt-row__time cf-num">{utcTime(item.createdAt)}</span>
              <span className="wt-row__main">
                <span className="wt-row__title">
                  {item.href === null ? item.title : <Link to={item.href}>{item.title}</Link>}
                </span>
                <span className="wt-row__sub">{item.category}</span>
              </span>
              <span className="wt-row__meta">
                {item.readAt === null && <span className="wt-chip wt-chip--warn">New</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </TilePanel>
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
