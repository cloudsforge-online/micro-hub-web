/**
 * Access: what this account is entitled to, and what is paying for it.
 *
 * Both lists are one tile of `/v1/dashboard` — hub-api fetches billing's entitlements and
 * subscriptions together and returns them under a single `entitlements` tile
 * (`hub-api/src/dashboard.ts`), because they are one question from a reader's point of
 * view and two statuses for one fact would be a panel that could contradict itself.
 *
 * ── `active` and `confersAccess` are billing's decisions, not this page's ──────────────────────
 *
 * Billing "serves `active` and `confersAccess` computed at an explicit instant, so this cache
 * holds a decision rather than a number" (upstreams.ts). Recomputing either here from
 * `expiresAt` and the browser's clock would produce a second answer, from a clock nobody
 * synchronised, that disagrees with the one the platform actually enforces. So the flags are
 * rendered and the dates are shown beside them as context, never as the source.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── WHY THE SIX-COLUMN TABLE IS GONE ──────────────────────────────────────────────────────────
 *
 *   *"it have a lot of ugly text in boxes in access and settings"*
 *
 * A table is the right instrument for comparing many rows on the same axis. This page has never
 * had many rows: a grant is a rare event, most accounts hold none, and the ones that do hold two
 * or three. SKU / Scope / Granted by / From / Until / State laid six columns across a viewport to
 * carry them, so on a phone the whole page was a horizontal scrollbar, and on a desktop it was
 * four-fifths whitespace with the reader's own answer — *can I open this or not* — in the last
 * column, furthest from the name.
 *
 * A card puts the two facts that matter together at the top (what it is, and whether it works
 * today), and demotes the four dates to a footer, which is where a date belongs when it is
 * context rather than the answer. The state is also a coloured left edge, so a page of grants
 * reads at a glance without moving your eyes across six columns.
 *
 * ── AND WHY THE EMPTY STATE IS THE DESIGN, NOT THE FALLBACK ───────────────────────────────────
 *
 * Access is empty for very nearly every account in this estate. The page as it stood answered
 * that with two grey sentences of the form "nothing has been granted", which is a report filed
 * about the reader rather than anything they can act on. It is now an invitation with the two
 * destinations that actually produce a grant, because an empty screen is the one screen where
 * the interface has the reader's full attention and nothing to compete with.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { TilePanel } from '../components/tile.tsx'
import { utcDateTime } from '../lib/format.ts'
import { hosts } from '../lib/hosts.ts'
import { loadDashboard, type BillingEntitlement, type BillingSubscription } from '../lib/hub.ts'
import { useResource } from '../lib/resource.ts'
import { hasAnswer } from '../lib/tile.ts'

const alwaysPresent = () => 1

export function EntitlementsPage() {
  const load = useCallback((signal: AbortSignal) => loadDashboard(signal), [])
  const { state, data, error, reload } = useResource(load, alwaysPresent, 'We could not read what this account has access to.')

  if (state === 'forbidden') return <Forbidden notice={error ?? undefined} />
  if (state === 'failed' && error) return <Failed notice={error} onRetry={reload} />
  if (state === 'loading' || !data) return <Loading label="Reading what you have access to" />

  const tile = data.tiles.entitlements
  const { entitlements, subscriptions } = tile.data
  const answered = hasAnswer(tile)

  return (
    <>
      <header className="wt-page__head">
        <h1 className="wt-page__title">Access</h1>
        <p className="wt-page__lede">
          Everything this one account can open across CloudsForge, and whatever is paying for it. A
          grant covers the whole platform or a single title — each card says which.
        </p>
      </header>

      <TilePanel title="What you can open" tile={tile} empty={<NothingGranted />}>
        {answered && entitlements.length > 0 ? (
          <ul className="wt-grants">
            {entitlements.map((entitlement) => (
              <GrantCard key={entitlement.id} entitlement={entitlement} />
            ))}
          </ul>
        ) : null}
      </TilePanel>

      <TilePanel title="Subscriptions" tile={tile} empty={<NothingRecurring />}>
        {answered && subscriptions.length > 0 ? (
          <ul className="wt-rows">
            {subscriptions.map((subscription) => (
              <SubscriptionRow key={subscription.id} subscription={subscription} />
            ))}
          </ul>
        ) : null}
      </TilePanel>
    </>
  )
}

/**
 * The state almost every reader sees, so it is written as a beginning rather than as a shortfall.
 *
 * Both destinations are real and both actually produce a grant: Forge Market issues one on a
 * purchase, and a Skerry membership is the other route. The Market link is an anchor and not a
 * router `Link` because Market is a separate surface on its own hostname — a router link would
 * push a path this bundle does not route and land the reader on a blank screen.
 */
function NothingGranted() {
  return (
    <div className="wt-invite">
      <p className="wt-invite__title">Nothing is granted to this account yet</p>
      <p className="wt-invite__body">
        Access arrives when you buy something, start a subscription, or somebody on our side grants
        it to you directly. It then shows up here, and works everywhere you are signed in without
        a second purchase.
      </p>
      <div className="wt-invite__links">
        <a className="wt-link" href={`${hosts().market}/`}>
          Browse Forge Market →
        </a>
        <Link className="wt-link" to="/portfolio">
          See what you hold →
        </Link>
      </div>
    </div>
  )
}

function NothingRecurring() {
  return (
    <p className="wt-note">
      Nothing recurring is attached to this account. Nothing here renews, and nothing bills you.
    </p>
  )
}

/**
 * One grant.
 *
 * `active` is billing's own verdict and it decides the card's edge, its chip and its dimming
 * together — one fact rendered three ways rather than three facts that could disagree. The dates
 * sit under a rule as context: `grantedAt` is history, and `expiresAt` being absent is a grant
 * that does not end, which is materially different from an empty cell and is said in words.
 */
function GrantCard({ entitlement }: { entitlement: BillingEntitlement }) {
  const until = utcDateTime(entitlement.expiresAt)
  return (
    <li className={`wt-grant${entitlement.active ? '' : ' wt-grant--off'}`}>
      <p className="wt-grant__sku">{entitlement.sku}</p>
      <p className="wt-grant__scope">
        {entitlement.scope === 'platform' ? 'Everywhere on CloudsForge' : entitlement.scope}
      </p>
      <p>
        {entitlement.active ? (
          <span className="wt-chip wt-chip--ok">open to you now</span>
        ) : (
          <span className="wt-chip">not currently open</span>
        )}
      </p>
      <p className="wt-grant__dates">
        <span>
          <b>From</b>
          <span className="cf-num">{utcDateTime(entitlement.grantedAt)}</span>
        </span>
        <span>
          <b>Until</b>
          <span className="cf-num">{until ?? 'no end date'}</span>
        </span>
        <span>
          <b>Granted by</b>
          <span>{entitlement.source}</span>
        </span>
      </p>
    </li>
  )
}

function SubscriptionRow({ subscription }: { subscription: BillingSubscription }) {
  const pastDue = subscription.status === 'past_due'
  return (
    <li className={`wt-row${pastDue ? ' wt-row--critical' : ''}`}>
      <span
        className={`wt-dot wt-dot--${pastDue ? 'critical' : subscription.confersAccess ? 'active' : 'pending'}`}
        aria-hidden="true"
      />
      <span className="wt-row__main">
        <span className="wt-row__title">{subscription.productId}</span>
        <span className="wt-row__sub cf-num">
          {subscription.scope}
          {subscription.currentPeriodEnd &&
            ` · this period ends ${utcDateTime(subscription.currentPeriodEnd)}`}
          {subscription.cancelAt && ` · cancels ${utcDateTime(subscription.cancelAt)}`}
        </span>
      </span>
      <span className="wt-row__meta">
        <span className={`wt-chip${pastDue ? ' wt-chip--warn' : ''}`}>{subscription.status}</span>
        {/*
          Billing's own verdict, printed as its own field. A subscription can be `active` and
          confer nothing, or `past_due` and still confer access inside a grace period — collapsing
          the two into one badge would tell a reader the wrong one on both occasions.
        */}
        {subscription.confersAccess ? (
          <span className="wt-chip wt-chip--ok">grants access</span>
        ) : (
          <span className="wt-chip">grants no access</span>
        )}
      </span>
    </li>
  )
}
