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
 */
import { useCallback } from 'react'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { TilePanel } from '../components/tile.tsx'
import { utcDateTime } from '../lib/format.ts'
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
          What this account is entitled to across CloudsForge, and any subscription paying for it.
          A grant may cover the whole platform or only one title or community, and the scope column
          says which.
        </p>
      </header>

      <TilePanel
        title="Entitlements"
        tile={tile}
        empty={
          <p className="wt-note">
            Nothing has been granted to this account so far. Access arrives when you buy
            something, start a subscription, or somebody on our side grants it to you directly.
          </p>
        }
      >
        {answered && entitlements.length > 0 ? (
          <div className="wt-tablewrap">
            <table className="wt-table">
              <thead>
                <tr>
                  <th scope="col">SKU</th>
                  <th scope="col">Scope</th>
                  <th scope="col">Granted by</th>
                  <th scope="col">From</th>
                  <th scope="col">Until</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {entitlements.map((entitlement) => (
                  <EntitlementRow key={entitlement.id} entitlement={entitlement} />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </TilePanel>

      <TilePanel
        title="Subscriptions"
        tile={tile}
        empty={
          <p className="wt-note">
            Nothing recurring is attached to this account, so nothing here renews or bills.
          </p>
        }
      >
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

function EntitlementRow({ entitlement }: { entitlement: BillingEntitlement }) {
  return (
    <tr className={entitlement.active ? undefined : 'wt-table__row--inactive'}>
      <th scope="row">{entitlement.sku}</th>
      <td>{entitlement.scope}</td>
      <td>{entitlement.source}</td>
      <td className="cf-num">{utcDateTime(entitlement.grantedAt)}</td>
      {/*
        No expiry is not "expired" and it is not a blank cell either — it is a grant that does not
        end, which is a materially different thing to own.
      */}
      <td className="cf-num">{utcDateTime(entitlement.expiresAt) ?? 'no end date'}</td>
      <td>
        {entitlement.active ? (
          <span className="wt-chip wt-chip--ok">active</span>
        ) : (
          <span className="wt-chip">inactive</span>
        )}
      </td>
    </tr>
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
