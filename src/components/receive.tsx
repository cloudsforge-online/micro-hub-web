/**
 * Receive: getting the deposit address for an asset, and saying what it is.
 *
 * ── The two sentences 05 §1.3 requires are on the page, at body size ───────────────────────────
 *
 * BJ-WAL-17 asks that the screen explain the difference between a MANAGED WALLET and a DEPOSIT
 * ADDRESS *in the UI*, "both sentences on the page at body size, not in a tooltip". They are the
 * paragraph below the address, and they are there because the distinction is the one that costs
 * money: a deposit address is watched for one asset on one network, and value sent to it on a
 * different network arrives at an address nobody is watching.
 *
 * ── `watchedAt` is rendered, and it is not decoration ──────────────────────────────────────────
 *
 * `wallet/src/deposits.ts`: "Null until the indexer has been told to watch it. An unwatched
 * address produces no events." A deposit to an unwatched address lands on chain and is never
 * credited. Showing the address without that state would be handing somebody a destination that
 * silently swallows a payment.
 *
 * ── What is NOT here, and why ──────────────────────────────────────────────────────────────────
 *
 * **A QR code.** 05 §1.3 asks for one. This bundle has no QR dependency and hand-rolling a
 * Reed-Solomon encoder in the screen that produces a payment destination is a worse idea than the
 * address in full and selectable: a QR that encodes one character wrong is unreadable by eye and
 * looks exactly like a correct one. It is a dependency decision, and it belongs to whoever adds
 * the dependency.
 *
 * **The confirmation depth.** BJ-WAL-16 asks for "the confirmation depth shown matches the
 * chain's policy". Nothing publishes a depth policy: hub-api deliberately omits the denominator
 * from a confirmation count for exactly this reason — "41/0 is worse than 41 confirmations"
 * (`hub-api/src/nextactions.ts`) — and `micro-wallet` serves no route that states one. A
 * number invented here would be the denominator hub-api refused to invent.
 *
 * ── The addresses you ALREADY have, which nothing rendered ─────────────────────────────────────
 *
 * `wallet/src/server.ts` has served `GET /v1/deposits` — "every assignment this account holds" —
 * since the route was written, and `lib/money.ts` has exported `loadDepositAddresses` for it. No
 * screen in this bundle called either. So an address was visible for exactly as long as the
 * button that fetched it stayed on screen: come back tomorrow and the account showed nothing, on
 * every asset, and the only way to see your own Bitcoin address again was to know that a button
 * on this panel would give it back to you.
 *
 * That is what the owner hit — *"I don't see on my account any bitcoin address"* — and it is not
 * a missing feature. It is a rendered surface missing for a served route, the same shape as
 * `micro-foresight`'s `/stake-assets`: the API answered correctly the whole time.
 *
 * The list is therefore the FIRST thing on the panel, before the selector, and it is loaded on
 * mount rather than on a press. Getting an address is now the thing you do when the list does not
 * already contain the asset you want.
 */
import { useCallback, useEffect, useState } from 'react'
import { noticeFor, type ErrorNotice } from '../lib/api.ts'
import { utcDateTime } from '../lib/format.ts'
import { useLatch } from '../lib/latch.ts'
import {
  assignDepositAddress,
  depositableAssets,
  loadDepositAddresses,
  settlesOnChain,
  type DepositAssignment,
} from '../lib/money.ts'
import type { Holding } from '../lib/hub.ts'

export function ReceivePanel({
  holdings,
  compact = false,
}: {
  holdings: readonly Holding[]
  /**
   * Drop the held-address list, because something above already drew it — micro-org#485.
   *
   * The Wallet page now opens with `components/addressbook.tsx`, which draws one card per coin
   * carrying its balance, its network and its active address. Rendering `HeldAddresses` under that
   * would put the same eight addresses on the same screen twice, which is the complaint the issue
   * was filed about: *"useless text"*. What this panel still owns and nothing else does is
   * ROTATION and the ROTATED ADDRESSES rotation leaves behind, so under `compact` it narrows to
   * exactly that.
   *
   * The default is `false` and every direct mount of this component leaves it there, so BJ-WAL-16
   * and BJ-WAL-17 continue to observe the whole panel.
   */
  compact?: boolean
}) {
  // Every chain asset the account could receive, whether or not it holds any today — a receive
  // screen that only offers what you already have cannot be used for the first deposit.
  //
  // The same broken test as Send carried the same defect here: `/^[A-Z]+$/` matches `SHARD`, so
  // this menu offered a Shard deposit address and `wallet/src/deposits.ts` refuses it with
  // `not_depositable` — "a Shard deposit address would be an address on no chain". Confirmed
  // against the running service, not against a stub.
  // ASKED, NOT DERIVED. The comment above is right and the code under it was not: building this
  // from `holdings` made a first deposit impossible, because you could only receive an asset you
  // already held. `GET /v1/deposits/assets` reports what `assignDepositAddress` itself would
  // accept, so the menu cannot offer something the service then refuses — and cannot omit
  // something it would have taken.
  //
  // `holdings` is still the fallback while the request is in flight, so the panel renders
  // immediately rather than flashing empty.
  const [offered, setOffered] = useState<readonly string[] | null>(null)
  useEffect(() => {
    let live = true
    depositableAssets()
      .then((r) => {
        if (live) setOffered(r.assets.filter((a) => a.depositable).map((a) => a.assetCode))
      })
      .catch(() => {
        // A failed lookup must not empty the menu — it falls through to the holdings-derived list
        // below, which is the old behaviour and strictly better than an unusable screen.
        if (live) setOffered(null)
      })
    return () => {
      live = false
    }
  }, [])
  const assets =
    offered ?? holdings.map((h) => h.assetCode).filter((code) => settlesOnChain(code))
  const [assetCode, setAssetCode] = useState(assets[0] ?? 'EMBER')
  const [assignment, setAssignment] = useState<DepositAssignment | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<ErrorNotice | null>(null)

  /**
   * Every deposit address this account already holds.
   *
   * THREE STATES, NOT TWO, and the third is why `heldFailed` exists beside the array. `null` is
   * "we have not been told yet", `[]` is "you genuinely have none", and a failed read is neither
   * — drawing `[]` for it would be this bundle telling somebody they have no Bitcoin address
   * while the row sits in the database. `lib/tile.ts` states the rule for the tiled reads and it
   * governs the direct ones too: *"an empty array is a field that renders correctly by accident."*
   *
   * `epoch` re-runs the read after a fetch or a rotation, so the list below and the address in the
   * panel above it are never two answers to one question.
   */
  const [held, setHeld] = useState<readonly DepositAssignment[] | null>(null)
  const [heldFailed, setHeldFailed] = useState(false)
  const [epoch, setEpoch] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    loadDepositAddresses(controller.signal)
      .then((r) => {
        setHeld(r.assignments)
        setHeldFailed(false)
      })
      .catch(() => {
        // An abort is this component going away, not a failure to report. Without the guard, every
        // unmount would paint the "could not read" sentence on the way out.
        if (controller.signal.aborted) return
        setHeldFailed(true)
      })
    return () => controller.abort()
  }, [epoch])

  /**
   * There was no guard here at all beyond `disabled={busy}`, and this route carries no key.
   *
   * `POST /v1/deposits` with `rotate: true` is the sharp one: wallet's own note says defaulting to
   * rotation "would mint a new address on every page load and leave a trail of addresses nobody
   * was told about", and a double click on Rotate does precisely that — two rotations, so the
   * address the user is finally shown is the second, while the first is already retired and may
   * have been copied from the screen in between. `disabled={busy}` cannot stop it: the attribute
   * is not on the node until the render commits, and the second click was dispatched before that.
   */
  const request = useLatch()

  const fetchAddress = useCallback(
    (rotate: boolean) => {
      if (!request.take()) return
      setBusy(true)
      setNotice(null)
      assignDepositAddress(assetCode, rotate)
        .then((answer) => {
          setAssignment(answer.assignment)
          // The list above has just become wrong — a first assignment is missing from it, and a
          // rotation left it showing the retired address. Re-read rather than splice: the service
          // decides which assignment is `active`, and reproducing that decision here is a second
          // implementation of it.
          setEpoch((n) => n + 1)
        })
        .catch((err: unknown) => setNotice(noticeFor(err, 'Could not get a deposit address.')))
        .finally(() => {
          request.release()
          setBusy(false)
        })
    },
    [assetCode, request],
  )

  return (
    <section className="wt-panel">
      <header className="wt-panel__head">
        {/*
          Named for what it is left doing. On its own it is Receive; under the coin cards it is the
          second address for a coin that already has one, which is a different sentence and a much
          rarer thing to want.
        */}
        <h2 className="wt-panel__title">{compact ? 'Another address' : 'Receive'}</h2>
      </header>

      {compact && (
        <p className="wt-note">
          Each coin above already has an address, and it keeps working for ever. Take a second one
          only if you want to keep two sources of payment apart.
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

      <HeldAddresses held={held} failed={heldFailed} olderOnly={compact} />

      <div className="wt-field">
        <label className="wt-field__label" htmlFor="receive-asset">
          {/*
            The label used to be a bare "Asset", which was right when this control was the whole
            panel. Above it there is now a list of the addresses you have, so the control's job has
            narrowed to the one it is for: getting an address for something not on that list.
          */}
          Get an address for
        </label>
        <select
          className="cf-select"
          id="receive-asset"
          value={assetCode}
          onChange={(event) => {
            setAssetCode(event.target.value)
            // The address on screen belongs to the asset that was selected when it was fetched.
            // Leaving it up while the selector says something else is how a deposit goes to the
            // right address on the wrong chain.
            setAssignment(null)
          }}
        >
          {(assets.length > 0 ? assets : ['EMBER']).map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>

      {assignment === null ? (
        <div className="wt-form__actions">
          <button
            type="button"
            className="cf-btn cf-btn--ember"
            disabled={busy}
            onClick={() => fetchAddress(false)}
          >
            {busy ? 'Fetching it…' : `Show my ${assetCode} deposit address`}
          </button>
        </div>
      ) : (
        <div className="wt-confirm">
          <dl className="wt-facts wt-facts--mono">
            <dt>Send {assignment.assetCode} to</dt>
            <dd>
              <code className="cf-num wt-addr">{assignment.address}</code>
            </dd>
            <dt>Chain</dt>
            <dd>
              {assignment.chain} · {assignment.network}
            </dd>
            <dt>Assigned</dt>
            <dd className="cf-num">{utcDateTime(assignment.assignedAt)}</dd>
          </dl>

          {assignment.watchedAt === null ? (
            <p className="wt-confirm__warn" role="alert">
              ▲ We are not yet watching this address. Send to it right now and the money will
              land on chain perfectly well, but would not be credited to you until the watch
              begins. Give this panel a moment and reload it first.
            </p>
          ) : (
            <p className="wt-note">
              Watched since <span className="cf-num">{utcDateTime(assignment.watchedAt)}</span>.
              Anything you send appears on the Wallet page as it confirms, with a running count,
              and is credited once the chain has buried it deep enough that it will not be
              reversed.
            </p>
          )}

          {/* BJ-WAL-17: both sentences, in the page, at body size. */}
          <p className="wt-note wt-note--caveat">
            What you have above is a <strong>deposit address</strong> rather than your wallet. It
            takes {assignment.assetCode} on {assignment.chain} {assignment.network} and nothing
            else — value sent to it on any other network is lost, with nobody able to retrieve
            it.
          </p>
          {/*
            micro-org#200, and the paragraph above is why it is needed rather than covered. That
            one warns about the WRONG NETWORK, which is the case where the money is genuinely gone.
            The case that keeps happening is the wrong ASSET on the RIGHT network — USDT or USDC
            sent to an ETH deposit address — and the two have opposite endings. That transfer
            arrives at an address custody holds the key to, so it is not lost; it is simply not
            credited, because nothing in this estate carries the token's decimals, there is no
            ledger asset for it and no path to withdraw one. Saying "lost" here would be wrong and
            saying nothing is what produced the issue.
          */}
          <p className="wt-note wt-note--caveat">
            Send only <strong>{assignment.assetCode}</strong> here. A <strong>token</strong> on
            this same network — USDT and USDC are the ones people send — will arrive and will{' '}
            <strong>not be credited</strong>: it will not appear in your balance and it cannot be
            withdrawn. It is not lost, and we do notice it, but getting it back is a support
            request rather than something this account can do. If you have already sent one, it is
            listed on the Wallet page.
          </p>
          <p className="wt-note wt-note--caveat">
            Your <strong>managed wallet</strong> is the account whose key we look after. That is
            where your balance actually sits, and it is the one listed under Addresses further up.
            Deposit addresses feed into it, and you may collect several of them over time.
          </p>

          <div className="wt-form__actions">
            <button
              type="button"
              className="cf-btn"
              disabled={busy}
              onClick={() => {
                // An explicit ask, exactly as the service treats it: "Defaulting to it would mint
                // a new address on every page load and leave a trail of addresses nobody was told
                // about." The old address keeps working — it is `rotated`, not retired.
                if (
                  typeof window !== 'undefined' &&
                  !window.confirm(
                    'Get a new deposit address? The current one keeps working for payments already on their way.',
                  )
                ) {
                  return
                }
                fetchAddress(true)
              }}
            >
              New address
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * The deposit addresses this account already holds, from `GET /v1/deposits`.
 *
 * ── Why the ACTIVE ones and the older ones are two lists ───────────────────────────────────────
 *
 * `listAssignments` returns every row for the network, at every status, `order by id desc`. Drawn
 * as one list that is a set of destinations with no statement of which one to use, and the answer
 * matters: `wallet/src/deposits.ts` marks the previous row `rotated` and keeps crediting it,
 * precisely so a payment already in flight is not lost. Both are real; only one is the address to
 * hand out today.
 *
 * `retired` is never written by the service — its own comment says so — so a retired row would be
 * data from somewhere this bundle cannot see, and it is labelled as unusable rather than dropped.
 * A destination that vanishes from the screen is one somebody asks support about.
 *
 * ── `watchedAt` again, and it is the same warning as below ─────────────────────────────────────
 *
 * An unwatched address takes money on chain and credits nobody. The panel below says so for the
 * address it has just fetched; this list has to say it too, because after this change the list is
 * where most people will read an address off the screen.
 */
function HeldAddresses({
  held,
  failed,
  olderOnly = false,
}: {
  held: readonly DepositAssignment[] | null
  failed: boolean
  /**
   * Draw only what rotation left behind — micro-org#485.
   *
   * Under `olderOnly` the panel above this one already reports the active addresses AND the three
   * states of the read that produces them, so repeating either here would be the same fact twice
   * on one screen. Rotated rows are the part nothing else draws, and they are drawn or the block
   * is absent: there is no "you have no old addresses", because nobody was looking for one.
   */
  olderOnly?: boolean
}) {
  if (olderOnly) {
    const older = (held ?? []).filter((a) => a.status !== 'active')
    if (older.length === 0) return null
    return (
      <div className="wt-panel__sub wt-panel__sub--first">
        <h3>Addresses you have replaced</h3>
        <p className="wt-note">
          A <strong>rotated</strong> address still credits you, which is why it is kept: a payment
          already on its way must not be lost because a new address was issued after it was sent.
        </p>
        <ul className="wt-rows">
          {older.map((assignment) => (
            <AddressRow key={assignment.id} assignment={assignment} />
          ))}
        </ul>
      </div>
    )
  }
  if (failed) {
    return (
      <p className="wt-note" role="status">
        We could not read the deposit addresses on this account just now. Nothing has changed about
        them — this panel could not ask. Asking again below still works, and returns the address you
        already have rather than a new one.
      </p>
    )
  }
  // NO ELLIPSIS IN THIS SENTENCE, and it is not a style choice. BJ-WAL-16 asserts that the whole
  // rendered text of this panel contains no `…`, because a SHORTENED DEPOSIT ADDRESS is a
  // destination somebody can copy and lose money to. A loading line that borrowed the ellipsis for
  // decoration would put one in that text and make the assertion turn on the timing of a fetch.
  if (held === null) return <p className="wt-note">Looking up the addresses you already have.</p>
  if (held.length === 0) {
    return (
      <p className="wt-note">
        You have no deposit address yet. Choose a coin below and we will assign you one. It is yours
        from then on, and it is listed here every time you come back.
      </p>
    )
  }

  const active = held.filter((a) => a.status === 'active')
  const older = held.filter((a) => a.status !== 'active')
  return (
    <>
      <div className="wt-panel__sub wt-panel__sub--first">
        <h3>Your deposit addresses</h3>
        <ul className="wt-rows">
          {active.map((assignment) => (
            <AddressRow key={assignment.id} assignment={assignment} />
          ))}
        </ul>
      </div>

      {older.length > 0 && (
        <div className="wt-panel__sub">
          <h3>Older addresses</h3>
          <p className="wt-note">
            Replaced by the ones above. A <strong>rotated</strong> address still credits you, which
            is why it is kept: a payment already on its way must not be lost because a new address
            was issued after it was sent.
          </p>
          <ul className="wt-rows">
            {older.map((assignment) => (
              <AddressRow key={assignment.id} assignment={assignment} />
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function AddressRow({ assignment }: { assignment: DepositAssignment }) {
  // Two states are a warning and they are the two where sending is a mistake. `wt-row__sub--critical`
  // is the existing colour for exactly that, so this borrows the rule rather than inventing one, and
  // it is a wrapping text line rather than `wt-row__meta`, which is a fixed-width flex strip.
  const unusable = assignment.status === 'retired' || assignment.watchedAt === null
  return (
    <li className="wt-row">
      <span className="wt-row__main">
        <span className="wt-row__title">
          {assignment.assetCode}{' '}
          <span className="wt-chip">
            {assignment.chain} · {assignment.network}
          </span>
        </span>
        <code className="cf-num wt-addr">{assignment.address}</code>
        <span className={unusable ? 'wt-row__sub wt-row__sub--critical' : 'wt-row__sub'}>
          {assignment.status === 'retired'
            ? 'No longer in use — do not send to it. '
            : assignment.watchedAt === null
              ? '▲ Not watched yet, so anything sent now would land on chain and not be credited. '
              : `Watched since ${utcDateTime(assignment.watchedAt)}. `}
          Assigned {utcDateTime(assignment.assignedAt)}.
        </span>
      </span>
    </li>
  )
}
