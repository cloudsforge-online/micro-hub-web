/**
 * Wallet: send, receive, export a key — and the lists those three change.
 *
 * ── The page READS through hub-api and WRITES to the services directly ─────────────────────────
 *
 * This page was read-only until docs/ecosystem/22 §8.2 named it as the estate's largest coverage
 * gap: no `<form>`, no `<button>`, no mutation, while 05's journeys 4, 5 and 6 and fifteen browser
 * scenarios waited on it. The three mutations are now here; `lib/money.ts` carries the reasoning
 * for why they go to `micro-wallet` and `micro-custody` directly, which is that **hub-api composes
 * no mutation at all** — its five routes are all reads — and inventing a sixth one to proxy them
 * is how `wallet/src/pricingclient.ts` came to call a `/v1/quotes` that has never existed.
 *
 * ── The reads still come from `/v1/dashboard`, and that is not laziness ────────────────────────
 *
 * The wallet registry, the deposits in flight and the withdrawals in flight are three of the
 * eleven tiles of `/v1/dashboard`, composed there from the wallet service. Fetching the dashboard
 * and rendering three of its tiles is the honest way to draw this page.
 *
 * It also costs nothing worth having: hub-api caches the wallet registry for 60s and the two
 * in-flight lists for 5s, keyed per user, and the dashboard load a moment ago warmed all three
 * (`hub-api/src/upstreams.ts`).
 *
 * ── Two of these lists are filtered upstream, and the page says so ─────────────────────────────
 *
 * `deposits` holds only credits that have NOT yet been credited, and `withdrawals` only those in a
 * non-terminal state (`dashboard.ts`). A page that presented either as "your deposits" or
 * "your withdrawals" would be describing a filtered list as a complete one. They are labelled by
 * what they actually are: what is in flight. The settled history is the Activity page.
 */
import { useCallback } from 'react'
import { KeyExportPanel } from '../components/keyexport.tsx'
import { ReceivePanel } from '../components/receive.tsx'
import { SendPanel } from '../components/send.tsx'
import { NotComposed, TilePanel } from '../components/tile.tsx'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { confirmationLabel, formatAmount, shortHash, utcDateTime } from '../lib/format.ts'
import { loadDashboard, type DepositCredit, type WalletRecord, type WithdrawalRecord } from '../lib/hub.ts'
import { loadTokenSightings, type TokenSighting } from '../lib/money.ts'
import { absenceOf, hasAnswer } from '../lib/tile.ts'
import { useResource } from '../lib/resource.ts'

const alwaysPresent = () => 1

export function WalletPage() {
  const load = useCallback((signal: AbortSignal) => loadDashboard(signal), [])
  const { state, data, error, reload } = useResource(load, alwaysPresent, 'We could not read your wallets.')

  if (state === 'forbidden') return <Forbidden notice={error ?? undefined} />
  if (state === 'failed' && error) return <Failed notice={error} onRetry={reload} />
  if (state === 'loading' || !data) return <Loading label="Reading your wallets" />

  const { wallets, deposits, withdrawals, portfolio } = data.tiles

  return (
    <>
      <header className="wt-page__head">
        <h1 className="wt-page__title">Wallet</h1>
        {/*
          THIS LIST WAS `CHAIN_ASSETS` FROM `lib/money.ts` AND IT IS NOT ANY MORE (micro-org#421).

          It read "We hold EMBER, Bitcoin, Ether, Litecoin, Dogecoin, Ethereum Classic, Solana and
          XRP for you" — the eight assets Send OFFERS, which is the right list for a menu and the
          wrong one for the verb "hold". Measured on the mainnet estate 2026-08-11, micro-indexer
          runs three followers (EMBER, BTC, LTC) and no address has ever been issued on ETH, ETC,
          SOL or XRP: there is nothing of a reader's on those chains for us to be holding. The
          owner caught the identical sentence on the public marketing site the same day. (Named
          that way and not by hostname because the estate rule greps this file for one, comments
          included, and it is right to.)

          So the prose names what a deposit can arrive in — `CREDITABLE_ASSETS` in
          `contracts/packages/chain`, written out in words rather than rendered from it, because a
          sentence assembled from an array reads like one and this is the first paragraph on the
          page. Dogecoin is named as NEXT rather than held, which is what it is: the code is
          written and this estate's node is still catching up.

          The MENU below is unchanged and stays eight, for the reason `lib/money.ts` argues at
          length — a chain that is offered and refused with a reason is honest, and the panels are
          gated on a real balance and on what the service answers rather than on this prose. What
          changed is only the sentence that used the menu to make a custody claim.
        */}
        <p className="wt-page__lede">
          We hold EMBER, Bitcoin and Litecoin for you — Dogecoin is next — so sending, receiving and
          spending across CloudsForge take no key handling on your part. Send anything out and the
          network fee is taken from the amount rather than added to it, and the figure that will
          actually land is shown before you commit.
        </p>
        {/*
          Every depth here is `confirmations` from `contracts/packages/chain/src/index.ts`, which is
          the one place the estate agrees them — wallet, settlement, custody and the indexer all
          read that package and none of them restate it. Ethereum Classic's 7,500 is not a typo and
          is deliberately given as a number rather than spelled out: it is three orders of magnitude
          above its neighbours, for the reason contracts records against it, and rounding it into a
          phrase like "a few thousand" would hide the one figure on this line a person would want to
          plan around.
        */}
        <p className="wt-note">
          Money arriving is credited once the chain has buried it deep enough to be safe: one
          confirmation on XRP, six on Bitcoin, twelve on Ether and Litecoin, thirty on Dogecoin,
          thirty-two on Solana, sixty on EMBER and 7,500 on Ethereum Classic. Should a chain
          reorganise beneath a deposit, crediting halts rather than guesses. If you would rather
          hold the key yourself, any managed wallet can be exported below — that is deliberate,
          deliberate enough to take a day, and it cannot be undone.
        </p>
      </header>

      {/*
        ── The three mutations, above the lists they change ────────────────────────────────────
        Send and Receive go to `micro-wallet` and the export ceremony to `micro-custody`, each
        directly and each with the user's own token: hub-api composes no mutation at all (five
        routes, all reads), and custody's ceremony reads `amr` and `auth_time` off the token a
        service credential could not carry. See `lib/money.ts` for the hosts and what still has to
        be true in `micro-deploy` for the browser to reach them.

        They read the wallet and holding lists this page has already loaded rather than fetching
        their own. A Send form that asked the server what your balance was, while the page above it
        showed a different figure, would be two answers to one question on one screen.
      */}
      <SendPanel
        holdings={hasAnswer(portfolio) ? portfolio.data.holdings : []}
        wallets={hasAnswer(wallets) ? wallets.data : []}
        /*
          WHY THE ABSENCE TRAVELS WITH THE LIST. `hasAnswer(t) ? t.data : []` collapses "the
          ledger did not answer" and "you hold nothing" into one empty array, and the panel then
          said "There is no balance to send" for both — the rule in lib/tile.ts broken by
          the screen that can least afford it. The list is still empty; what goes with it now is
          why.
        */
        balanceAbsent={absenceOf(portfolio)}
        onSent={reload}
      />

      <ReceivePanel holdings={hasAnswer(portfolio) ? portfolio.data.holdings : []} />

      <TokenSightingsPanel />

      <TilePanel
        title="Addresses"
        tile={wallets}
        empty={
          <p className="wt-note">
            No wallet has been created or connected yet. We set up a managed wallet for you the
            first time something arrives, so there is nothing to do here in advance.
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
        empty={
          <p className="wt-note">
            No deposit is currently confirming. Anything on its way in appears here with its
            confirmation count until it is credited.
          </p>
        }
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
        empty={
          <p className="wt-note">
            Nothing is on its way out. A payment stays on this list until the chain has taken it.
          </p>
        }
      >
        {withdrawals.data.length === 0 ? null : (
          <ul className="wt-rows">
            {withdrawals.data.map((withdrawal) => (
              <WithdrawalRow key={withdrawal.id} withdrawal={withdrawal} />
            ))}
          </ul>
        )}
      </TilePanel>

      <KeyExportPanel
        wallets={hasAnswer(wallets) ? wallets.data : []}
        walletsAbsent={absenceOf(wallets)}
      />

      {/*
        Transfers and conversions are real operations — wallet serves `POST /v1/transfers` and
        `POST /v1/conversions` (wallet/src/server.ts, 761), both idempotency-keyed — but
        neither has a READ route anywhere in the estate: hub-api composes neither and wallet lists
        neither, so a form for them could submit but the result would vanish from the screen the
        moment it was made. A money-moving control whose outcome the user cannot then see is worse
        than no control, so the hole is named instead. `POST /v1/transfers` also takes a
        `toUserId` — an internal identifier this app has no way to look up, and no route resolves a
        handle to one.
      */}
      <NotComposed title="Transfers and conversions">
        <p>
          Shifting value between your own accounts, and swapping one asset for another, both work
          at the service level. Neither has anywhere that lists what you did afterwards, and a
          transfer has to name its recipient by an internal identifier that nothing here can look
          up. Rather than give you a control whose result then vanishes off the screen, we have
          left it out and said so.
        </p>
      </NotComposed>

      {/*
        05 journey 6. The flow is: `POST /v1/wallets` with `origin: external` issues a challenge
        nonce, the OWNER SIGNS IT with the external wallet's key, and `POST /v1/wallets/verify`
        submits the signature (wallet/src/server.ts, 528). The middle step is the whole flow,
        and it needs a signer — a browser extension, a hardware device, a mobile deep link. This
        bundle has none, no dependency provides one, and a form that asked a user to paste a
        signature they produced somewhere else is not journey 6; it is a way to make people move
        their key to a machine that can sign a string.
      */}
      <NotComposed title="Connecting an external wallet">
        <p>
          Bringing in a wallet you already hold the key for means signing a challenge we issue,
          with that wallet. This page has no way to reach a browser extension or a hardware device
          and ask it to sign, so there is no form for it. Anything you have connected elsewhere and
          proved ownership of shows up in the list above, marked as verified.
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

const countSightings = (answer: { sightings: readonly TokenSighting[] }) => answer.sightings.length

/**
 * Tokens that arrived at this account's deposit addresses and were NOT credited — micro-org#200.
 *
 * The list `micro-wallet` serves at `/v1/deposits/token-sightings`. It is the only place a user can
 * see this today: the estate also emits `wallet.deposit.token_uncredited` for micro-notify to mail,
 * and that topic is not in the frozen registry, so the producer's relay quarantines the event and
 * the mail does not go out until `micro-contracts` names it.
 *
 * ── It renders NOTHING when the list is empty, and nothing when the request fails ───────────────
 *
 * Empty first, and that is the ordinary case: this is an exception report, and a permanent panel
 * saying "no tokens have been lost at your deposit addresses" on every visit is a sentence that
 * teaches people to stop reading the page.
 *
 * The failure case is the deliberate one, because `lib/resource.ts` states the opposite rule —
 * "FAILURE OUTRANKS EMPTINESS ... reporting 'nothing here' for a timeout is how an outage reads as
 * a quiet week" — and that rule is right for a list whose absence would mislead. This one is
 * different in a way worth writing down: the route is NEWER THAN THE DEPLOYED SERVICE. A bundle
 * ships the moment it is merged and `micro-wallet` ships on a version bump, so between the two
 * every call here is a 404, and an honest failure line would put a red sentence about lost money on
 * the wallet page of every user in the estate for the whole gap — about a list that is empty for
 * almost all of them. Silence costs a user who has one sighting a page visit; the alternative costs
 * every user their trust in the page. What is NOT silent is the estate-side view: micro-wallet
 * publishes `wallet_deposit_token_sightings` as a gauge, so nobody is relying on this component to
 * know the number is non-zero.
 */
function TokenSightingsPanel() {
  const load = useCallback((signal: AbortSignal) => loadTokenSightings(signal), [])
  const { state, data } = useResource(
    load,
    countSightings,
    'We could not check for uncredited token deposits.',
  )
  if (state !== 'ok' || !data) return null

  return (
    <section className="wt-panel">
      <header className="wt-panel__head">
        <h2 className="wt-panel__title">Tokens we could not credit</h2>
      </header>
      <p className="wt-confirm__warn" role="alert">
        ▲ These arrived at your deposit addresses and are <strong>not part of your balance</strong>.
        They cannot be withdrawn from here. They are not lost — the address they landed on is one we
        hold the key to — but getting them back needs a support request, so quote the transaction
        below. Please do not send more to that address.
      </p>
      <ul className="wt-rows">
        {data.sightings.map((sighting) => (
          <TokenSightingRow key={sighting.id} sighting={sighting} />
        ))}
      </ul>
      {data.nextCursor !== null && (
        <p className="wt-note">
          Older ones than these exist. Support can list them all; this page shows the most recent.
        </p>
      )}
    </section>
  )
}

/**
 * One uncredited token.
 *
 * The amount is the raw integer the chain carried and is LABELLED as raw, rather than divided by a
 * power of ten. `micro-wallet` will not assert the token's decimals — its absence is the reason the
 * deposit is not credited at all — and a front end that quietly picked 18 would be printing a
 * figure the rest of the estate refused to print, on the one screen where being wrong about the
 * number is worst. The explorer link is what shows the human figure, because the explorer reads the
 * contract.
 */
function TokenSightingRow({ sighting }: { sighting: TokenSighting }) {
  return (
    <li className="wt-row wt-row--critical">
      <span className="wt-dot wt-dot--critical" aria-hidden="true" />
      <span className="wt-row__main">
        <span className="wt-row__title cf-num">
          {sighting.amount} <span className="wt-chip">raw units</span>
        </span>
        <span className="wt-row__sub cf-num">
          token {shortHash(sighting.tokenAddress) ?? sighting.tokenAddress} ·{' '}
          {shortHash(sighting.txHash) ?? sighting.txHash} ·{' '}
          {confirmationLabel(sighting.confirmations, null)}
        </span>
      </span>
      <span className="wt-row__meta">
        <span className="wt-chip">{sighting.chain}</span>
        <span className="wt-chip">{sighting.network}</span>
        <span className="wt-chip wt-chip--warn">not credited</span>
        <span className="wt-row__time cf-num">{utcDateTime(sighting.firstSeenAt)}</span>
        {sighting.explorerUrl && (
          <a
            className="wt-link"
            href={sighting.explorerUrl}
            rel="noreferrer noopener"
            target="_blank"
          >
            Explorer ↗
          </a>
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
 * "41/0 is worse than 41 confirmations" (nextactions.ts). This mirrors that rather than
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
 * (nextactions.ts).
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
            {withdrawal.failureReason ?? 'the chain has not told us either way yet'}
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
