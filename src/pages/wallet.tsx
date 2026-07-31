/**
 * Wallet: addresses to deposit to, deposits arriving, withdrawals leaving.
 *
 * ── This page reads `/v1/dashboard`, and that is not laziness ──────────────────────────────────
 *
 * hub-api serves five routes and none of them is a wallet route (see `lib/hub.ts`). The wallet
 * registry, the deposits in flight and the withdrawals in flight are three of the eleven tiles of
 * `/v1/dashboard`, composed there from the wallet service. Fetching the dashboard and rendering
 * three of its tiles is the honest way to draw this page today; inventing `GET /v1/wallet` and
 * writing a client for it is how `wallet/src/pricingclient.ts` came to call a `/v1/quotes` that
 * has never existed.
 *
 * It also costs nothing worth having: hub-api caches the wallet registry for 60s and the two
 * in-flight lists for 5s, keyed per user, and the dashboard load a moment ago warmed all three
 * (`hub-api/src/upstreams.ts:87-99`).
 *
 * ── Two of these lists are filtered upstream, and the page says so ─────────────────────────────
 *
 * `deposits` holds only credits that have NOT yet been credited, and `withdrawals` only those in a
 * non-terminal state (`dashboard.ts:294-316`). A page that presented either as "your deposits" or
 * "your withdrawals" would be describing a filtered list as a complete one. They are labelled by
 * what they actually are: what is in flight. The settled history is the Activity page.
 */
import { useCallback } from 'react'
import { NotComposed, TilePanel } from '../components/tile.tsx'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { confirmationLabel, formatAmount, shortHash, utcDateTime } from '../lib/format.ts'
import { loadDashboard, type DepositCredit, type WalletRecord, type WithdrawalRecord } from '../lib/hub.ts'
import { useResource } from '../lib/resource.ts'

const alwaysPresent = () => 1

export function WalletPage() {
  const load = useCallback((signal: AbortSignal) => loadDashboard(signal), [])
  const { state, data, error, reload } = useResource(load, alwaysPresent, 'Could not load your wallets.')

  if (state === 'forbidden') return <Forbidden notice={error ?? undefined} />
  if (state === 'failed' && error) return <Failed notice={error} onRetry={reload} />
  if (state === 'loading' || !data) return <Loading label="Loading your wallets" />

  const { wallets, deposits, withdrawals } = data.tiles

  return (
    <>
      <header className="wt-page__head">
        <h1 className="wt-page__title">Wallet</h1>
      </header>

      <TilePanel
        title="Addresses"
        tile={wallets}
        empty={
          <p className="wt-note">
            No wallet has been created or connected yet. A managed wallet is provisioned the first
            time you deposit.
          </p>
        }
      >
        {wallets.data.length === 0 ? null : (
          <ul className="wt-rows">
            {wallets.data.map((wallet) => (
              <WalletRow key={wallet.id} wallet={wallet} showAddress />
            ))}
          </ul>
        )}
      </TilePanel>

      <TilePanel
        title="Arriving"
        tile={deposits}
        empty={<p className="wt-note">No deposit is currently confirming.</p>}
      >
        {deposits.data.length === 0 ? null : (
          <ul className="wt-rows">
            {deposits.data.map((credit) => (
              <DepositRow key={credit.id} credit={credit} />
            ))}
          </ul>
        )}
      </TilePanel>

      <TilePanel
        title="Leaving"
        tile={withdrawals}
        empty={<p className="wt-note">No withdrawal is in flight.</p>}
      >
        {withdrawals.data.length === 0 ? null : (
          <ul className="wt-rows">
            {withdrawals.data.map((withdrawal) => (
              <WithdrawalRow key={withdrawal.id} withdrawal={withdrawal} />
            ))}
          </ul>
        )}
      </TilePanel>

      {/*
        Transfers and conversions are real operations — wallet serves `POST /v1/transfers` and
        `POST /v1/conversions` (wallet/src/server.ts:738, 765), both idempotency-keyed — but hub-api
        composes neither, and neither has a read route this page could list. Rather than render an
        empty section that looks like "you have made none", the hole is named. See the README.
      */}
      <NotComposed title="Transfers and conversions">
        <p>
          Moving value between your own accounts and converting between assets are served by the
          wallet service as <code>POST /v1/transfers</code> and <code>POST /v1/conversions</code>,
          each behind an idempotency key. hub-api composes neither, so this page has nothing to
          list and no route to submit to. It is not that you have made none — it is that Forge Hub
          cannot yet see them.
        </p>
      </NotComposed>
    </>
  )
}

/**
 * One wallet, with its lifecycle state visible.
 *
 * Rule 3 of design-system §6: "Wallet lifecycle state is visible in the list, not behind a detail
 * view. `exported` and `external·verified` are facts a user must be able to see at a glance."
 * `exported` means a private key has left custody, and a user who cannot see that on the list is a
 * user who does not know which of their wallets is still protected.
 */
export function WalletRow({
  wallet,
  showAddress = false,
}: {
  wallet: WalletRecord
  showAddress?: boolean | undefined
}) {
  const verified = wallet.origin !== 'managed' && wallet.verifiedAt !== null
  return (
    <li className="wt-row">
      <span className={`wt-dot wt-dot--${wallet.status}`} aria-hidden="true" />
      <span className="wt-row__main">
        <span className="wt-row__title">
          {wallet.label ?? `${wallet.chain} wallet`}
          {wallet.isPrimary && <span className="wt-chip">primary</span>}
        </span>
        {/*
          The address in full when the page is about addresses, shortened when it is a preview.
          `user-select: all` on the full form: an address retyped by hand is an address sent to the
          wrong place, and the whole string is what a reader needs to copy.
        */}
        <code className={showAddress ? 'cf-num wt-addr' : 'cf-num wt-addr wt-addr--short'}>
          {showAddress ? wallet.address : (shortHash(wallet.address) ?? wallet.address)}
        </code>
      </span>
      <span className="wt-row__meta">
        <span className="wt-chip">{wallet.chain}</span>
        <span className="wt-chip">{wallet.network}</span>
        <span className="wt-chip">{wallet.origin}</span>
        {verified && <span className="wt-chip wt-chip--ok">verified</span>}
        {/* Not a chip among chips: a key that has left custody is the loudest fact on the row. */}
        {wallet.status === 'exported' && <span className="wt-chip wt-chip--warn">exported</span>}
        {wallet.status === 'frozen' && <span className="wt-chip wt-chip--warn">frozen</span>}
        {wallet.status !== 'active' && wallet.status !== 'exported' && wallet.status !== 'frozen' && (
          <span className="wt-chip">{wallet.status}</span>
        )}
      </span>
    </li>
  )
}

/**
 * A deposit still confirming.
 *
 * The confirmation count is the authoritative field and the fraction is a display aid — hub-api
 * omits the denominator entirely for a chain whose depth policy this build does not know, because
 * "41/0 is worse than 41 confirmations" (nextactions.ts:146-148). This mirrors that rather than
 * substituting a guess.
 */
function DepositRow({ credit }: { credit: DepositCredit }) {
  return (
    <li className="wt-row">
      <span className="wt-dot wt-dot--pending" aria-hidden="true" />
      <span className="wt-row__main">
        <span className="wt-row__title cf-num">
          {credit.amountFormatted} {credit.assetCode}
        </span>
        <span className="wt-row__sub cf-num">
          {confirmationLabel(credit.confirmations, null)} · {shortHash(credit.txHash)}
        </span>
      </span>
      <span className="wt-row__meta">
        <span className="wt-chip">{credit.network}</span>
        {credit.explorerUrl && (
          <a className="wt-link" href={credit.explorerUrl} rel="noreferrer noopener" target="_blank">
            Explorer ↗
          </a>
        )}
      </span>
    </li>
  )
}

/**
 * A withdrawal in flight.
 *
 * `stuck` is called out because it is the only non-terminal failure state in wallet's machine: the
 * reservation is held and the payment's fate is unknown. "It is the single most important thing
 * this dashboard can tell a user, because the money is neither theirs nor gone"
 * (nextactions.ts:168-171).
 */
function WithdrawalRow({ withdrawal }: { withdrawal: WithdrawalRecord }) {
  const stuck = withdrawal.state === 'stuck'
  return (
    <li className={`wt-row${stuck ? ' wt-row--critical' : ''}`}>
      <span className={`wt-dot wt-dot--${stuck ? 'critical' : 'pending'}`} aria-hidden="true" />
      <span className="wt-row__main">
        <span className="wt-row__title cf-num">
          {withdrawal.amountFormatted} {withdrawal.assetCode}
        </span>
        <span className="wt-row__sub cf-num">
          to {shortHash(withdrawal.destination)} · net {withdrawal.netFormatted} · fee{' '}
          {formatAmount(withdrawal.fee) ?? withdrawal.fee}
        </span>
        {stuck && (
          <span className="wt-row__sub wt-row__sub--critical">
            {withdrawal.failureReason ?? 'awaiting confirmation from the chain'}
          </span>
        )}
      </span>
      <span className="wt-row__meta">
        <span className={`wt-chip${stuck ? ' wt-chip--warn' : ''}`}>{withdrawal.state}</span>
        <span className="wt-row__time cf-num">{utcDateTime(withdrawal.requestedAt)}</span>
      </span>
    </li>
  )
}
