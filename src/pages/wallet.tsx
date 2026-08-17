/**
 * Wallet: what you hold, where it arrives, and how to send it out.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── WHAT THIS PAGE WAS, AND WHY IT WAS REDESIGNED (micro-org#485) ─────────────────────────────
 *
 *   *"Useless text also."*
 *
 * The page opened with two paragraphs — a custody claim naming three coins, and every chain's
 * confirmation depth spelled out in words — and then a Send form. A reader arriving to answer
 * "how much Bitcoin have I got and where do I send more" read 120 words about neither. Three
 * changes, and each one is a rearrangement rather than a decoration:
 *
 *   1. **The coins come first, and each one carries its own three facts.** #485 §2 asks for
 *      "balance, the network it is on, and its deposit address where one exists" per asset, and
 *      `components/addressbook.tsx` is now given the portfolio tile so its cards can say all
 *      three. An asset showing nothing says which nothing it is, in a line with a next move in it.
 *   2. **Nothing that must be said stands in front of the page.** The confirmation-depth sentence
 *      was true and unreadable where it was; it is now inside "Arriving", which is the panel it is
 *      about and the only one it changes how you read. The custody sentence was a claim about
 *      three coins that the coin cards themselves now make, per coin, from what the service
 *      answers rather than from prose that has already gone stale once (micro-org#421).
 *   3. **Every figure on the page names its network.** #485 §3. The coin cards, the wallet rows,
 *      the arriving rows and — new here — the leaving rows all carry it, in one shared treatment
 *      that reads differently for testnet. `WithdrawalRecord.network` was on the wire the whole
 *      time and this page threw it away.
 *
 * ── THE ADDRESS APPEARS EXACTLY ONCE ──────────────────────────────────────────────────────────
 *
 * `AddressBook` and `ReceivePanel` both draw held addresses, and stacking them would print the
 * same eight destinations twice — the complaint, reproduced. `ReceivePanel` takes `compact` here,
 * which narrows it to the one job nothing else does: getting a SECOND address for a coin that
 * already has one, and the rotated addresses that leaves behind.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
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
import { AddressBook } from '../components/addressbook.tsx'
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
import { viewedNetwork } from '../lib/viewed.ts'

const alwaysPresent = () => 1

export function WalletPage() {
  const load = useCallback((signal: AbortSignal) => loadDashboard(signal), [])
  const { state, data, error, reload } = useResource(load, alwaysPresent, 'We could not read your wallets.')

  if (state === 'forbidden') return <Forbidden notice={error ?? undefined} />
  if (state === 'failed' && error) return <Failed notice={error} onRetry={reload} />
  if (state === 'loading' || !data) return <Loading label="Reading your wallets" />

  const { wallets, deposits, withdrawals, portfolio } = data.tiles
  const network = viewedNetwork()

  return (
    <>
      <header className="wt-page__head">
        <h1 className="wt-page__title">Wallet</h1>
        {/*
          ONE SENTENCE, NAMING THE TWO THINGS THE PAGE DOES. What used to be here is recorded at
          the top of this file: a custody claim about three coins (micro-org#421) followed by every
          chain's confirmation depth. Both were true; neither belonged in front of the balances.

          The network is a chip and not a clause, because it qualifies every figure below rather
          than the sentence beside it. `viewedNetwork()` and not `hosts()`: under the combined view
          both networks are served from the mainnet hostnames, so the hostname is not an answer —
          `lib/viewed.ts` has the whole of it. Every read on this page goes out through
          `viewedApiOrigin()`, so this names the estate the figures came from and nothing else.
        */}
        <p className="wt-page__lede">
          What you hold, the address each coin arrives at, and how to send it out again.
        </p>
        <p className="wt-page__meta">
          Everything below is <span className={`wt-net wt-net--${network}`}>{network}</span>
        </p>
      </header>

      {/*
        The exception report goes first. It renders nothing at all in the ordinary case, and when
        it does render it is about money that arrived and was not credited — which outranks a
        balance.
      */}
      <TokenSightingsPanel />

      {/*
        ── 1. THE COINS: BALANCE, NETWORK, ADDRESS ─────────────────────────────────────────────
        micro-org#485 §2 in one panel. The balances are PASSED IN from the dashboard this page has
        already read, not fetched again: a second read would be a second answer to one question on
        one screen, and the two would disagree for as long as either was in flight. `absenceOf`
        travels with them so a card can tell "you hold none" from "we could not ask" — the rule in
        lib/tile.ts, on the screen that can least afford to break it.
      */}
      <AddressBook
        balances={hasAnswer(portfolio) ? portfolio.data.holdings : []}
        balanceAbsent={absenceOf(portfolio)}
      />

      {/*
        ── 2. SENDING, WHICH IS THE OTHER ACTION ───────────────────────────────────────────────
        Send goes to `micro-wallet` and the export ceremony to `micro-custody`, each directly and
        each with the user's own token: hub-api composes no mutation at all (five routes, all
        reads), and custody's ceremony reads `amr` and `auth_time` off the token a service
        credential could not carry. See `lib/money.ts` for the hosts and what still has to be true
        in `micro-deploy` for the browser to reach them.

        It reads the wallet and holding lists this page has already loaded rather than fetching its
        own, for the same reason the panel above does.
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

      {/* ── 3. WHAT IS IN FLIGHT, IN AND OUT ────────────────────────────────────────────────── */}
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
          <>
            <ul className="wt-rows">
              {deposits.data.map((credit) => (
                <DepositRow key={credit.id} credit={credit} />
              ))}
            </ul>
            {/*
              THE CONFIRMATION DEPTHS, BESIDE THE COUNTS THEY EXPLAIN — micro-org#485 §1,
              *"anything that must be said belongs beside the control it qualifies"*. This
              paragraph used to be the second thing on the page, three panels above the only
              numbers it gives meaning to.

              INSIDE the non-empty branch, and that is load-bearing rather than tidy. `TilePanel`
              renders `children ?? empty`, so a paragraph that was always present would suppress
              the empty state for ever — the panel would stop saying "No deposit is currently
              confirming" and start printing depth figures at an account with nothing arriving,
              which BJ-WAL-07 asserts against because a strip that prints a digit it did not read
              is the defect this whole page is built to avoid. It also happens to be the better
              design: an explanation of a confirmation count belongs where there is one.

              Every depth is `confirmations` from `contracts/packages/chain/src/index.ts`, the one
              place the estate agrees them — wallet, settlement, custody and the indexer all read
              that package and none of them restate it. Ethereum Classic's 7,500 is not a typo and
              is deliberately a number rather than words: it is three orders of magnitude above its
              neighbours, and rounding it into "a few thousand" would hide the one figure here a
              person would plan around.
            */}
            <p className="wt-note wt-note--caveat">
              A deposit is credited once the chain has buried it deep enough to be safe: one
              confirmation on XRP, six on Bitcoin, twelve on Ether and Litecoin, thirty on
              Dogecoin, thirty-two on Solana, sixty on EMBER and 7,500 on Ethereum Classic. Should
              a chain reorganise beneath one, crediting halts rather than guesses.
            </p>
          </>
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

      {/*
        ── 4. THE ACCOUNTS UNDERNEATH ──────────────────────────────────────────────────────────
        Renamed from "Addresses", which it shared with two other things on this page after the
        redesign: the deposit addresses on the coin cards and the rotated ones below. These are
        managed wallets — the accounts custody holds a key for and the deposit addresses feed into
        — and "Wallets" is what the Overview has always called the same tile.
      */}
      <TilePanel
        title="Wallets"
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

      {/*
        `compact`, so this draws no address the cards above have already drawn. What is left is the
        one thing nothing else offers: a SECOND address for a coin that already has one, and the
        rotated addresses that leaves behind — which still credit you, and are therefore not
        something a screen may quietly drop.
      */}
      <ReceivePanel holdings={hasAnswer(portfolio) ? portfolio.data.holdings : []} compact />

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
        {/*
          The network is not a chip among chips — micro-org#485 §3. It gets its own treatment,
          shared by every row and card on this page, so testnet cannot be read past. Colour is not
          the only channel: the word itself is the content.
        */}
        <span className={`wt-net wt-net--${wallet.network}`}>{wallet.network}</span>
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
        <span className={`wt-net wt-net--${sighting.network}`}>{sighting.network}</span>
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
        <span className={`wt-net wt-net--${credit.network}`}>{credit.network}</span>
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
        {/*
          THE NETWORK WAS ON THE WIRE AND THIS ROW THREW IT AWAY — micro-org#485 §3.
          `WithdrawalRecord.network` has always been in the response (`lib/hub.ts`), and a leaving
          payment is the single row on the estate where confusing testnet for mainnet costs the
          most. It goes first in the strip, ahead of the state.
        */}
        <span className={`wt-net wt-net--${withdrawal.network}`}>{withdrawal.network}</span>
        <span className={`wt-chip${stuck ? ' wt-chip--warn' : ''}`}>{withdrawal.state}</span>
        <span className="wt-row__time cf-num">{utcDateTime(withdrawal.requestedAt)}</span>
      </span>
    </li>
  )
}
