/**
 * The address book: every coin this account can be paid in, and the address for each.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE DEFECT, REPORTED THREE TIMES ──────────────────────────────────────────────────────────
 *
 *   *"in overview no bitcoin address exist again (i already discuss this with you twice)"*
 *
 * It was reported twice before and answered twice in the wrong place. `test/deposit-addresses.
 * test.ts` fixed the first half honestly — `GET /v1/deposits` was served, exported and never
 * called, so an address survived only as long as the component state that fetched it — and put
 * the list on the RECEIVE panel, which lives on the Wallet page behind a tab. The Overview, which
 * is the page somebody means when they say "my account", still had no address on it of any kind.
 *
 * The second half was never addressed at all, and it is the one that actually produces the
 * sentence. Measured on mainnet on 2026-08-14:
 *
 *     deposit_address_assignments, by asset
 *       EMBER 237    BTC 3    LTC 3    XRP 3    ETH 2    SOL 2
 *
 * `wallet/src/deposits.ts` assigns ON DEMAND and nothing pre-creates anything, so an account holds
 * an address only for the assets somebody explicitly asked for. The Receive selector defaults to
 * `assets[0]`, which is EMBER, so 237 accounts pressed the button once and got an EMBER address —
 * and Bitcoin, which `GET /v1/deposits/assets` reports as `depositable: true, reason: null`, was
 * behind a `<select>` nobody changed. The estate has supported Bitcoin deposits completely, and
 * the interface made one reachable by accident.
 *
 * ── SO THIS PANEL IS BUILT FROM THE ASSET LIST, NOT FROM THE ASSIGNMENTS ──────────────────────
 *
 * That inversion is the whole fix. A list of your assignments can only ever show what you already
 * have, which is the same shape of bug `lib/money.ts` records for the old holdings-derived Receive
 * menu: *"a receive screen that only offers what you already have cannot be used for the first
 * deposit."* This asks the service what it takes, draws a card for every one of them, and puts the
 * address inside the card if there is one. **Bitcoin therefore has a card, by name, whether or not
 * this account has ever had a Bitcoin address** — and getting one is the button already inside it.
 *
 * ── WHAT IS NOT AUTOMATIC, AND WHY ────────────────────────────────────────────────────────────
 *
 * Mounting this does not assign anything. wallet's own note is the reason — defaulting to an
 * assignment *"would mint a new address on every page load and leave a trail of addresses nobody
 * was told about"* — and a panel that quietly minted eight addresses for a reader who came to look
 * at their balance would be that, once per coin. One press per coin, by the person who wants it.
 *
 * ── THE COLOUR ON EACH CARD IS THE COIN'S OWN, AND IT IS THE NAVIGATION ───────────────────────
 *
 * Bitcoin's orange, Litecoin's slate, Dogecoin's gold: these are the marks people already read
 * these coins by, and using them means the answer to "where is my Bitcoin address" is found by
 * glance rather than by reading eight rows of identical grey. EMBER takes the estate's own ember
 * accent rather than an invented one — it is this platform's chain and it wears the platform's
 * colour. Colour is never the only carrier: the ticker and the full name are on every card.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { noticeFor, type ErrorNotice } from '../lib/api.ts'
import { formatAmount, utcDateTime } from '../lib/format.ts'
import { useLatch } from '../lib/latch.ts'
import type { Holding } from '../lib/hub.ts'
import type { Absence } from '../lib/tile.ts'
import {
  assignDepositAddress,
  depositableAssets,
  loadDepositAddresses,
  type DepositAssignment,
  type DepositableAsset,
} from '../lib/money.ts'

/**
 * What each ticker is called, for people who do not read tickers.
 *
 * "BTC" is a symbol you have to already know; "Bitcoin" is the word somebody types into a search
 * box. The estate's own asset is spelled EMBER in both columns on purpose — it has no second name
 * and inventing one here would be this bundle naming a product.
 */
const ASSET_NAMES: Readonly<Record<string, string>> = Object.freeze({
  BTC: 'Bitcoin',
  EMBER: 'EMBER',
  ETH: 'Ethereum',
  LTC: 'Litecoin',
  DOGE: 'Dogecoin',
  SOL: 'Solana',
  XRP: 'XRP',
  ETC: 'Ethereum Classic',
})

export const assetName = (code: string): string => ASSET_NAMES[code] ?? code

/**
 * The order coins are drawn in, and it is not alphabetical.
 *
 * EMBER leads because it is the chain this platform runs and the only asset every product here
 * settles in. Bitcoin is second because it is the one people look for, and the one this panel
 * exists for. Everything the service offers and this list does not name falls in after them, in
 * whatever order the service gave, so a chain added to the estate appears here without a change to
 * this file — a hard-coded list that silently dropped a new asset would be the previous defect
 * wearing a different shape.
 */
const LEAD: readonly string[] = Object.freeze(['EMBER', 'BTC', 'LTC', 'ETH', 'DOGE', 'SOL', 'XRP'])

function inDisplayOrder(assets: readonly DepositableAsset[]): readonly DepositableAsset[] {
  const rank = (code: string) => {
    const i = LEAD.indexOf(code)
    return i === -1 ? LEAD.length : i
  }
  return [...assets].sort((a, b) => rank(a.assetCode) - rank(b.assetCode))
}

/**
 * Why an asset cannot be deposited, said to the person rather than to the operator.
 *
 * ── THE SERVICE'S OWN SENTENCE WINS (micro-wallet#26) ─────────────────────────────────────────
 *
 * `GET /v1/deposits/assets` now carries `detail`: the prose wallet raises on the 503 when somebody
 * asks for an address for this very asset. Printing it means the screen and the refusal cannot
 * disagree, and it means a chain added to — or dropped from — a deployment explains itself here
 * without a change to this file.
 *
 * The local prose stays as the fall-back, because a deployment running a wallet older than #26
 * answers without the field and `undefined` is not a sentence. `lib/money.ts` documents the three
 * reasons; `unknown` is the one that matters to get right, being transient — telling somebody
 * Bitcoin is unsupported on the strength of it would be a lie that lasts until they reload.
 */
function unavailableBecause(asset: DepositableAsset): string {
  const authored = typeof asset.detail === 'string' ? asset.detail.trim() : ''
  // Sentence case. wallet writes these to sit inside `"… because we could not confirm that …"`, so
  // one of the three opens lower-case; standing on its own under a heading it needs a capital.
  if (authored.length > 0) return authored.charAt(0).toUpperCase() + authored.slice(1)
  switch (asset.reason) {
    case 'not_followed':
      return 'We are not watching this chain yet, so anything sent would land on it and never be credited. Use one of the coins above instead.'
    case 'not_retrievable':
      return 'We can watch this chain but have no way to pay it back out, so we will not take a deposit we could not return. Use one of the coins above instead.'
    case 'unknown':
      return 'We could not check this one just now — that is our end, not yours. Reload and it may come back.'
    default:
      return 'Not accepted right now. Use one of the coins above instead.'
  }
}

/**
 * What this account holds of one coin, said in one line — micro-org#485 §2.
 *
 * *"An asset showing nothing must say why in one line a person can act on."* There are three
 * different nothings and they must not read alike:
 *
 *   * the ledger did not answer — the balance is UNKNOWN, and printing "None held" for it would
 *     tell somebody their Bitcoin is gone because a read timed out (`lib/tile.ts`);
 *   * the ledger answered and holds no row for this asset — genuinely none;
 *   * the ledger holds a row of zero — also genuinely none, and the same sentence.
 *
 * The third argument is what turns the second and third into something actionable: with an
 * address the next move is to send to it, without one the next move is to get one.
 */
function balanceLine(
  holding: Holding | undefined,
  absent: Absence | null,
  hasAddress: boolean,
): { readonly amount: string | null; readonly note: string } {
  if (holding === undefined || holding.amount === '0') {
    if (absent !== null) {
      return {
        amount: null,
        // The upstream is named for the same reason `TilePanel` names it: "the balance is missing"
        // and "the ledger is down" are different facts, and only the second says where to look.
        note: `We could not read your balances just now — ${absent.reason}. Nothing has changed about what you hold.`,
      }
    }
    return {
      amount: null,
      note: hasAddress
        ? 'None held. Send to the address below and it lands in this balance once the chain has buried it deep enough to be safe.'
        : 'None held. Get an address below and anything sent to it is credited here.',
    }
  }
  /*
    A holding whose scale nothing knows is NOT nothing. `amountFormatted` is null for a `TOKEN:`
    asset, whose decimals no service in the fan-out can supply (`lib/hub.ts`), and drawing that as
    "Nothing held" would report a balance somebody has as a balance they do not.
  */
  const figure = formatAmount(holding.amountFormatted)
  if (figure === null) {
    return {
      amount: null,
      note: 'You hold some of this, but nothing here knows how many decimal places it has, so we will not print a figure we cannot vouch for. Portfolio has it in smallest units.',
    }
  }
  /*
    NO FIGURE FOR THE RESERVED PART, deliberately. `available` and `reserved` are SMALLEST UNITS
    (`hub-api/src/portfolio.ts`) and this card has no decimals table to turn them into human ones —
    `lib/format.ts` records why this bundle cannot have one. Printing `120000` beside `0.0012 BTC`
    would be two figures for one balance, differing by a factor nobody can see. The split has a
    home already: the Portfolio table shows both columns, side by side, labelled.
  */
  return {
    amount: figure,
    note:
      holding.reserved !== '0'
        ? 'Part of this is reserved against something already in flight — Portfolio shows the split.'
        : 'All of it free to spend.',
  }
}

/**
 * Copy to the clipboard, and say so.
 *
 * A deposit address is 42 characters of hex or base58 and the cost of one wrong character is the
 * whole payment. Selecting it by hand across a wrap is exactly how a character goes missing, and
 * until now this bundle offered no other way — there was no copy control anywhere in it.
 *
 * `navigator.clipboard` is absent outside a secure context and rejects when the document is not
 * focused, and both are ordinary rather than exceptional. The fallback SELECTS the address, which
 * puts the user one keystroke from the same result and, unlike a silent failure, is visible.
 */
function CopyAddress({ address, label }: { address: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'select'>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const t = setTimeout(() => setState('idle'), 2200)
    return () => clearTimeout(t)
  }, [state])

  const copy = useCallback(() => {
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (!clip?.writeText) {
      setState('select')
      return
    }
    clip.writeText(address).then(
      () => setState('copied'),
      () => setState('select'),
    )
  }, [address])

  return (
    <button
      type="button"
      className="wt-copy"
      onClick={copy}
      // The address itself is in the accessible name: a page with eight of these needs eight
      // distinguishable buttons, and "Copy" eight times is one button announced eight times.
      aria-label={`Copy the ${label} deposit address`}
    >
      <span aria-hidden="true" className="wt-copy__glyph">
        {state === 'copied' ? '✓' : '⧉'}
      </span>
      {state === 'copied' ? 'Copied' : state === 'select' ? 'Select it' : 'Copy'}
    </button>
  )
}

/** One coin: what you hold of it, its address if this account has one, and how to get one. */
function AddressCard({
  asset,
  assignment,
  onAssign,
  busy,
  network,
  balance,
}: {
  asset: DepositableAsset
  assignment: DepositAssignment | undefined
  onAssign: (assetCode: string) => void
  busy: boolean
  /** The network the wallet service answered on. Named on every card — micro-org#485 §3. */
  network: string | null
  /** What this account holds, when the caller has it. Absent on the Overview, which prices it. */
  balance: { readonly amount: string | null; readonly note: string } | undefined
}) {
  const name = assetName(asset.assetCode)
  const cls = `wt-coin wt-coin--${asset.assetCode.toLowerCase()}`
  /*
    The ticker is a second, shorter way to say the same thing, so it is only worth space when it
    says something the name does not. `assetName` returns the code itself for a coin we have no
    English name for — EMBER being the one that matters here — and printing both rendered a card
    headed `EMBER EMBER`.
  */
  const ticker = name === asset.assetCode ? null : asset.assetCode

  if (!asset.depositable) {
    return (
      <li className={`${cls} wt-coin--off`}>
        <span className="wt-coin__mark" aria-hidden="true" />
        <span className="wt-coin__head">
          <span className="wt-coin__name">{name}</span>
          {ticker ? <span className="wt-coin__ticker cf-num">{ticker}</span> : null}
        </span>
        {/*
          A balance on a coin we cannot take is the one figure a reader would most hate to have
          hidden — it says the money is still theirs while the deposit route is shut. Only the
          figure, and only when there is one: the "none held" line would be noise on a card whose
          whole message is already that nothing can arrive.
        */}
        {balance?.amount != null && (
          <p className="wt-coin__bal">
            <span className="wt-coin__figure cf-num">
              {balance.amount} <span className="wt-coin__unit">{asset.assetCode}</span>
            </span>
            <span className="wt-coin__balnote">Still yours. It is arriving that is shut, not it.</span>
          </p>
        )}
        <p className="wt-coin__why">{unavailableBecause(asset)}</p>
      </li>
    )
  }

  /*
    THE NETWORK IS ON THE CARD WHETHER OR NOT AN ADDRESS EXISTS (micro-org#485 §3).

    It used to come off `assignment.network`, so a coin this account had never asked for an address
    for showed no network at all — and those are exactly the cards carrying the button that mints
    one. `GET /v1/deposits/assets` answers with the deployment's own `WALLET_NETWORK` beside the
    asset list; `components/receive.tsx` fetched that field and threw it away. The assignment's own
    network still wins where there is one, because it is the per-row fact rather than the
    per-deployment one, and the two can only differ if something is wrong.
  */
  const net = assignment?.network ?? network
  const chain = asset.chain.toLowerCase() === asset.assetCode.toLowerCase() ? null : asset.chain

  return (
    <li className={cls}>
      <span className="wt-coin__mark" aria-hidden="true" />
      <span className="wt-coin__head">
        <span className="wt-coin__name">{name}</span>
        {ticker ? <span className="wt-coin__ticker cf-num">{ticker}</span> : null}
        {chain !== null && <span className="wt-coin__chain cf-num">{chain}</span>}
        {/* The one network treatment the whole account uses, so testnet reads the same everywhere. */}
        {net !== null && net !== '' && <span className={`wt-net wt-net--${net}`}>{net}</span>}
      </span>

      {balance !== undefined && (
        <p className="wt-coin__bal">
          {balance.amount === null ? (
            <span className="wt-coin__none">Nothing held</span>
          ) : (
            <span className="wt-coin__figure cf-num">
              {balance.amount} <span className="wt-coin__unit">{asset.assetCode}</span>
            </span>
          )}
          <span className="wt-coin__balnote">{balance.note}</span>
        </p>
      )}

      {assignment === undefined ? (
        <div className="wt-coin__get">
          <button
            type="button"
            className="cf-btn cf-btn--ember"
            disabled={busy}
            onClick={() => onAssign(asset.assetCode)}
          >
            {busy ? 'Getting it' : `Get my ${name} address`}
          </button>
          <p className="wt-coin__hint">Yours from then on, and shown here every time you return.</p>
        </div>
      ) : (
        <>
          <div className="wt-coin__addr">
            {/* NO TRUNCATION. `test/deposit-addresses.test.ts` asserts no `…` appears anywhere in
                this text, because a shortened deposit address is a destination somebody can copy
                and lose money to. It wraps instead. */}
            <code className="cf-num wt-addr">{assignment.address}</code>
            <CopyAddress address={assignment.address} label={name} />
          </div>
          {assignment.watchedAt === null ? (
            <p className="wt-coin__warn" role="alert">
              We are not watching this address yet. Anything sent now would land on the chain and
              not be credited to you. Give it a moment and reload.
            </p>
          ) : (
            <p className="wt-coin__hint">
              Watched since <span className="cf-num">{utcDateTime(assignment.watchedAt)}</span>. Send
              only {asset.assetCode}
              {/*
                Naming the chain matters when it is a different thing from the coin — EMBER settles
                on Hearth, and somebody holding an 0x address needs to be told which network to pick
                in their wallet. For Bitcoin the chain slug IS the ticker, and "send only BTC on
                btc" is a sentence that says one fact twice and reads like a placeholder.
              */}
              {asset.chain.toLowerCase() === asset.assetCode.toLowerCase()
                ? ''
                : ` on ${asset.chain}`}{' '}
              — anything else is not credited.
            </p>
          )}
        </>
      )}
    </li>
  )
}

/**
 * The panel. One request for what the estate takes, one for what this account holds.
 *
 * THREE STATES AND NOT TWO, the rule `lib/tile.ts` states and this panel is the sharpest case of:
 * *"an empty array is a field that renders correctly by accident."* A failed read drawn as an
 * empty list tells somebody they have no Bitcoin address while the row sits in the database, and
 * they may then go and mint a second one. `failed` is therefore its own state and says so.
 */
export function AddressBook({
  compact = false,
  balances,
  balanceAbsent = null,
}: {
  compact?: boolean
  /**
   * What this account holds, when the caller already has it — micro-org#485 §2, *"each asset row:
   * balance, the network it is on, and its deposit address where one exists"*.
   *
   * Passed in rather than fetched. The Wallet page has already read the dashboard and its
   * portfolio tile is the same figure; a second read here would be a second answer to one question
   * on one screen, and the two would disagree for as long as one of them was in flight. Absent on
   * the Overview, where the Portfolio panel directly above already carries every balance.
   */
  balances?: readonly Holding[] | undefined
  /** Why the balances are missing, when they are. An empty list and a failed read are not alike. */
  balanceAbsent?: Absence | null | undefined
}) {
  const [assets, setAssets] = useState<readonly DepositableAsset[] | null>(null)
  const [network, setNetwork] = useState<string | null>(null)
  const [held, setHeld] = useState<readonly DepositAssignment[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState<ErrorNotice | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0)
  const request = useLatch()

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    Promise.all([depositableAssets(), loadDepositAddresses(controller.signal)])
      .then(([offered, mine]) => {
        if (!live) return
        setAssets(offered.assets)
        // The deployment's own `WALLET_NETWORK`, straight off the wire. See `AddressCard`.
        setNetwork(typeof offered.network === 'string' ? offered.network : null)
        setHeld(mine.assignments)
        setFailed(false)
      })
      .catch(() => {
        // An abort is this component going away, not a failure to report — without the guard every
        // unmount paints "we could not read" on the way out.
        if (controller.signal.aborted || !live) return
        setFailed(true)
      })
    return () => {
      live = false
      controller.abort()
    }
  }, [epoch])

  const assign = useCallback(
    (assetCode: string) => {
      if (!request.take()) return
      setPending(assetCode)
      setNotice(null)
      assignDepositAddress(assetCode)
        .then(() => setEpoch((n) => n + 1))
        .catch((err: unknown) => setNotice(noticeFor(err, 'Could not get a deposit address.')))
        .finally(() => {
          request.release()
          setPending(null)
        })
    },
    [request],
  )

  /*
    The panel is called what it CONTAINS. With balances on it, "Deposit addresses" names one of
    the three things on each card and undersells the other two; without them, "Your coins" would
    promise a balance that is not there. One component, two honest headings.
  */
  const withBalances = balances !== undefined
  const head = (
    <header className="wt-panel__head">
      <h2 className="wt-panel__title">{withBalances ? 'Your coins' : 'Deposit addresses'}</h2>
      {compact && (
        <Link className="wt-link" to="/wallet">
          Wallet →
        </Link>
      )}
    </header>
  )

  if (failed) {
    return (
      <section className="wt-panel">
        {head}
        <p className="wt-note" role="status">
          We could not read your deposit addresses just now. Nothing has changed about them — this
          panel could not ask. Reload, or open{' '}
          <Link className="wt-link" to="/wallet">
            Wallet
          </Link>
          .
        </p>
      </section>
    )
  }

  if (assets === null || held === null) {
    return (
      <section className="wt-panel">
        {head}
        <p className="wt-note">Reading your addresses.</p>
      </section>
    )
  }

  // `active` is the address to hand out today. A `rotated` row still credits the account — wallet
  // keeps it so a payment already in flight is not lost — but it is not the one to print here, and
  // one flat list of destinations does not say which. The older ones stay on Wallet → Receive,
  // which is the screen that owns rotation.
  const active = new Map<string, DepositAssignment>()
  for (const a of held) if (a.status === 'active') active.set(a.assetCode, a)

  const ordered = inDisplayOrder(assets)
  const open = ordered.filter((a) => a.depositable)
  const shut = ordered.filter((a) => !a.depositable)
  const yours = open.filter((a) => active.has(a.assetCode)).length

  // The ledger keys by asset code and so does the asset list, so this is a join and not a guess.
  const byCode = new Map<string, Holding>()
  for (const holding of balances ?? []) byCode.set(holding.assetCode, holding)
  const balanceFor = (assetCode: string) =>
    balances === undefined
      ? undefined
      : balanceLine(byCode.get(assetCode), balanceAbsent ?? null, active.has(assetCode))

  return (
    <section className="wt-panel">
      {head}
      {/*
        One sentence, and only when it is doing work. micro-org#485: *"anything that must be said
        belongs beside the control it qualifies"* — and with a balance, a network and an address on
        every card, a standing paragraph above them qualifies nothing. It survives for the reader
        who has no address at all, because that reader has nothing else on screen to read.
      */}
      {yours === 0 ? (
        <p className="wt-note">
          Every coin below can be paid into this account. Pick one and we will give you an address
          for it.
        </p>
      ) : withBalances ? null : (
        <p className="wt-note">
          An address is a destination for one coin on one chain.{' '}
          {yours === open.length
            ? 'You have one for each coin we take.'
            : 'Get one for anything you are missing.'}
        </p>
      )}

      {notice && (
        <p className="wt-formerror" role="alert">
          {notice.message}
          {notice.requestId && (
            <>
              {' '}
              Quote <code className="cf-num wt-reqid">{notice.requestId}</code> to support.
            </>
          )}
        </p>
      )}

      <ul className="wt-coins">
        {open.map((asset) => (
          <AddressCard
            key={asset.assetCode}
            asset={asset}
            assignment={active.get(asset.assetCode)}
            onAssign={assign}
            busy={pending === asset.assetCode}
            network={network}
            balance={balanceFor(asset.assetCode)}
          />
        ))}
      </ul>

      {/*
        ── REFUSED COINS ARE DRAWN, NOT HIDDEN (micro-org#481) ──────────────────────────────────

        *"I don't see any dogecoin reference in the wallet."* The DOGE row has been in
        `GET /v1/deposits/assets` the whole time; every surface threw it away. This panel kept it,
        and then put it behind a collapsed `<details>` — which is the same defect wearing a
        disclosure triangle, because a reader looking for Dogecoin and finding nothing does not
        open a summary that does not say "Dogecoin".

        So they are a plain section with the tickers visible. Quiet, after the coins that work,
        each one carrying wallet's own sentence about why it cannot be used yet. The honest answer
        to "where is Dogecoin" is a Dogecoin card that says what is missing, never an absence.
      */}
      {shut.length > 0 && (
        <div className="wt-panel__sub">
          <h3>
            {shut.length === 1 ? 'One coin we' : `${shut.length} coins we`} cannot take yet
          </h3>
          <p className="wt-note">
            The estate knows about {shut.length === 1 ? 'this one' : 'these'} and is not taking{' '}
            {shut.length === 1 ? 'it' : 'them'} today. Each card says what is missing — none of it
            is anything you can fix, and none of it affects what you already hold.
          </p>
          <ul className="wt-coins wt-coins--quiet">
            {shut.map((asset) => (
              <AddressCard
                key={asset.assetCode}
                asset={asset}
                assignment={undefined}
                onAssign={assign}
                busy={false}
                network={network}
                balance={balanceFor(asset.assetCode)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
