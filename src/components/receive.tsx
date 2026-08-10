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
 */
import { useCallback, useEffect, useState } from 'react'
import { noticeFor, type ErrorNotice } from '../lib/api.ts'
import { utcDateTime } from '../lib/format.ts'
import { useLatch } from '../lib/latch.ts'
import {
  assignDepositAddress,
  depositableAssets,
  settlesOnChain,
  type DepositAssignment,
} from '../lib/money.ts'
import type { Holding } from '../lib/hub.ts'

export function ReceivePanel({ holdings }: { holdings: readonly Holding[] }) {
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
        .then((answer) => setAssignment(answer.assignment))
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
        <h2 className="wt-panel__title">Receive</h2>
      </header>

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

      <div className="wt-field">
        <label className="wt-field__label" htmlFor="receive-asset">
          Asset
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
