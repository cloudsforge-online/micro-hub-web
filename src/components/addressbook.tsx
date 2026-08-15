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
import { utcDateTime } from '../lib/format.ts'
import { useLatch } from '../lib/latch.ts'
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
 * `lib/money.ts` documents the three the service emits and they are three different facts about
 * the deployment. `unknown` is the one that matters to get right: it is transient and means we
 * could not ask, so telling somebody Bitcoin is unsupported on the strength of it would be a lie
 * that lasts until they reload. Anything unrecognised falls through to plain unavailability,
 * because a new reason must not turn into a blank space in a browser running an older bundle.
 */
function unavailableBecause(reason: string | null): string {
  switch (reason) {
    case 'not_followed':
      return 'We do not follow this chain yet.'
    case 'not_retrievable':
      return 'We can watch this chain but cannot pay it back out, so we will not take a deposit we could not return.'
    case 'unknown':
      return 'We could not check this one just now. Reload and it may come back.'
    default:
      return 'Not accepted right now.'
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

/** One coin: its address if this account has one, and the way to get one if it does not. */
function AddressCard({
  asset,
  assignment,
  onAssign,
  busy,
}: {
  asset: DepositableAsset
  assignment: DepositAssignment | undefined
  onAssign: (assetCode: string) => void
  busy: boolean
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
        <p className="wt-coin__why">{unavailableBecause(asset.reason)}</p>
      </li>
    )
  }

  return (
    <li className={cls}>
      <span className="wt-coin__mark" aria-hidden="true" />
      <span className="wt-coin__head">
        <span className="wt-coin__name">{name}</span>
        {ticker ? <span className="wt-coin__ticker cf-num">{ticker}</span> : null}
        <span className="wt-coin__chain cf-num">
          {asset.chain.toLowerCase() === asset.assetCode.toLowerCase() ? '' : asset.chain}
          {assignment
            ? `${asset.chain.toLowerCase() === asset.assetCode.toLowerCase() ? '' : ' · '}${assignment.network}`
            : ''}
        </span>
      </span>

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
export function AddressBook({ compact = false }: { compact?: boolean }) {
  const [assets, setAssets] = useState<readonly DepositableAsset[] | null>(null)
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

  const head = (
    <header className="wt-panel__head">
      <h2 className="wt-panel__title">Deposit addresses</h2>
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

  return (
    <section className="wt-panel">
      {head}
      <p className="wt-note">
        {yours === 0
          ? 'Every coin below can be paid into this account. Pick one and we will give you an address for it.'
          : `An address is a destination for one coin on one chain. ${yours === open.length ? 'You have one for each coin we take.' : 'Get one for anything you are missing.'}`}
      </p>

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
          />
        ))}
      </ul>

      {shut.length > 0 && (
        <details className="wt-more">
          <summary>
            {shut.length} coin{shut.length === 1 ? '' : 's'} we cannot take yet
          </summary>
          <ul className="wt-coins wt-coins--quiet">
            {shut.map((asset) => (
              <AddressCard
                key={asset.assetCode}
                asset={asset}
                assignment={undefined}
                onAssign={assign}
                busy={false}
              />
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
