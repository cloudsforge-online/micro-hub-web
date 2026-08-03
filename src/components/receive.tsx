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
 * `wallet/src/deposits.ts:89-90`: "Null until the indexer has been told to watch it. An unwatched
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
 * (`hub-api/src/nextactions.ts:146-148`) — and `micro-wallet` serves no route that states one. A
 * number invented here would be the denominator hub-api refused to invent.
 */
import { useCallback, useState } from 'react'
import { noticeFor, type ErrorNotice } from '../lib/api.ts'
import { utcDateTime } from '../lib/format.ts'
import { assignDepositAddress, type DepositAssignment } from '../lib/money.ts'
import type { Holding } from '../lib/hub.ts'

export function ReceivePanel({ holdings }: { holdings: readonly Holding[] }) {
  // Every chain asset the account could receive, whether or not it holds any today — a receive
  // screen that only offers what you already have cannot be used for the first deposit.
  const assets = holdings.map((h) => h.assetCode).filter((code) => /^[A-Z]+$/.test(code))
  const [assetCode, setAssetCode] = useState(assets[0] ?? 'EMBER')
  const [assignment, setAssignment] = useState<DepositAssignment | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<ErrorNotice | null>(null)

  const fetchAddress = useCallback(
    (rotate: boolean) => {
      setBusy(true)
      setNotice(null)
      assignDepositAddress(assetCode, rotate)
        .then((answer) => setAssignment(answer.assignment))
        .catch((err: unknown) => setNotice(noticeFor(err, 'Could not get a deposit address.')))
        .finally(() => setBusy(false))
    },
    [assetCode],
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
            {busy ? 'Getting your address…' : `Show my ${assetCode} deposit address`}
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
              ▲ CloudsForge is not yet watching this address. A deposit sent now would arrive on
              chain and would not be credited until watching starts. Reload this panel in a moment.
            </p>
          ) : (
            <p className="wt-note">
              Watched since <span className="cf-num">{utcDateTime(assignment.watchedAt)}</span>.
              Deposits are credited after the chain confirms them; the Wallet page lists each one
              while it is confirming.
            </p>
          )}

          {/* BJ-WAL-17: both sentences, in the page, at body size. */}
          <p className="wt-note wt-note--caveat">
            This is a <strong>deposit address</strong>, not your wallet. It accepts{' '}
            {assignment.assetCode} on {assignment.chain} {assignment.network} only, and value sent
            to it on any other network is lost.
          </p>
          <p className="wt-note wt-note--caveat">
            Your <strong>managed wallet</strong> is the account CloudsForge holds the key for. It is
            what your balance is in, and it is listed under Addresses above — a deposit address
            feeds it, and there may be several over time.
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
