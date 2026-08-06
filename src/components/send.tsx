/**
 * Send: the withdrawal form, its confirmation step, and its receipt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE ONE RULE THIS SCREEN EXISTS TO KEEP ───────────────────────────────────────────────────
 *
 * **The destination shown on the confirmation step is the destination submitted.**
 *
 * Not "the same string" — the same OBJECT. Pressing Review freezes a `SendIntent`; the
 * confirmation renders fields off that object and the submit posts that object, untouched. There
 * is no path between the two that re-reads a form field, re-trims, re-normalises or re-cases. A
 * form that displays one address and sends to another is the most expensive defect a frontend can
 * have in this estate, and the only way to make it impossible is to give the two steps nothing to
 * disagree about. `test/money.test.ts` asserts the request body against the frozen object.
 *
 * ── ONE INTENT, ONE KEY, ONE WITHDRAWAL ───────────────────────────────────────────────────────
 *
 * The `Idempotency-Key` is minted when Review is pressed and held for as long as the frozen
 * intent is unchanged — so a double-click on Confirm, a browser Back and a second Confirm, and a
 * retry after a timeout are all ONE withdrawal (BJ-WAL-09, BJ-WAL-10). Editing a field and
 * reviewing again is a different intent and gets a different key, because re-using one across two
 * different bodies is a 409 from the service and would be this app's bug, not the user's.
 *
 * ── WHAT THIS SCREEN CANNOT SHOW, AND WILL NOT INVENT ─────────────────────────────────────────
 *
 * **The fee, before confirmation.** 05:269 and BJ-WAL-08 both require it. `micro-wallet` quotes
 * the network fee INSIDE `POST /v1/withdrawals` (`wallet/src/withdrawals.ts`) and serves
 * no route that quotes one — there is no `GET /v1/fees`, no fee on any read route, and
 * `WALLET_FEE_QUOTES` is an environment value the service does not publish. So the fee is stated
 * where it becomes known, on the receipt, and the confirmation says plainly that it is not yet
 * known and that the amount entered is the gross. Rendering a made-up figure, or calling a route
 * that does not exist, are the two things that would be worse.
 *
 * **Policy `deny` / `challenge` / `review` (BJ-WAL-12..14).** The withdrawal path in
 * `micro-wallet` consults no policy service today — `grep policy wallet/src/withdrawals.ts` finds
 * nothing, and the refusals it can produce are `withdrawals_disabled`, `not_withdrawable`,
 * `invalid_amount`, `fee_unavailable`, `amount_too_small` and the ledger's insufficient-funds.
 * Those render as what they are, with their request id. A "your limit resets at…" panel would be
 * a screen for a decision nothing makes.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import { useState, type FormEvent } from 'react'
import { ApiError, noticeFor, type ErrorNotice } from '../lib/api.ts'
import { formatAmount, scaleOf, toBaseUnits } from '../lib/format.ts'
import { mintIdempotencyKey } from '../lib/idempotency.ts'
import { useLatch } from '../lib/latch.ts'
import { requestWithdrawal, settlesOnChain, type SendIntent, type Withdrawal } from '../lib/money.ts'
import type { Absence } from '../lib/tile.ts'
import type { Holding, WalletRecord } from '../lib/hub.ts'

/** An intent, frozen at Review, with everything the confirmation step needs to render it. */
interface Armed {
  readonly intent: SendIntent
  readonly key: string
  /** The human form of `intent.amount`, or null when the asset's scale could not be established. */
  readonly amountHuman: string | null
  /** True when the destination is not one of this account's own wallets. */
  readonly untrusted: boolean
}

const sameIntent = (a: SendIntent, b: SendIntent): boolean =>
  a.assetCode === b.assetCode && a.destination === b.destination && a.amount === b.amount

export function SendPanel({
  holdings,
  wallets,
  balanceAbsent = null,
  onSent,
}: {
  holdings: readonly Holding[]
  wallets: readonly WalletRecord[]
  /**
   * Set when the balance could not be READ, as opposed to being nothing.
   *
   * Both arrive here as an empty `holdings`, and saying "there is no balance to send" for the
   * first is a confident, wrong statement about somebody's money — `lib/tile.ts`'s own rule,
   * broken by the screen that can least afford it. See `absenceOf`.
   */
  balanceAbsent?: Absence | null
  /** Called after a withdrawal is accepted, so the page can re-read the in-flight list. */
  onSent: () => void
}) {
  // Only what can actually be sent: a chain asset with a positive available balance. A SHARD row
  // would be offered and then refused by the service ("does not settle on a chain"), which is a
  // dead end presented as a choice.
  //
  // That comment is older than this line and was always right. The test it sat above was
  // `/^[A-Z]+$/.test(h.assetCode)`, which does not implement it: `SHARD` is plain uppercase, so it
  // matched, and this menu offered a withdrawal the service refuses with `not_withdrawable`. The
  // regex excluded the `TOKEN:<urn>` holdings and nothing else. `settlesOnChain` asks the actual
  // question, against the list `micro-wallet` was observed to accept — see `lib/money.ts`.
  const sendable = holdings.filter((h) => h.available !== '0' && settlesOnChain(h.assetCode))

  const [assetCode, setAssetCode] = useState(sendable[0]?.assetCode ?? '')
  const [destination, setDestination] = useState('')
  const [amountText, setAmountText] = useState('')
  const [armed, setArmed] = useState<Armed | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<ErrorNotice | null>(null)
  const [sent, setSent] = useState<{ withdrawal: Withdrawal; replayed: boolean } | null>(null)

  const holding = sendable.find((h) => h.assetCode === assetCode) ?? null
  // Derived from the holding the server sent, never from a table in this bundle. See `scaleOf`.
  const scale = holding ? scaleOf(holding.amount, holding.amountFormatted) : null
  const inBaseUnits = scale === null

  /** Every address this account holds, for the untrusted-destination warning below. */
  const own = new Set(wallets.map((w) => w.address))
  // Offered as suggestions: a managed wallet, or an external one this account has verified.
  // hub-api's wallets tile does not carry the per-wallet authorisation set, so this app cannot
  // tell whether `withdrawal_destination` was granted — the service decides, and refuses a
  // destination that does not hold it. The list is a convenience, not a permission.
  const suggestions = wallets.filter((w) => w.origin === 'managed' || w.verifiedAt !== null)

  const review = (event: FormEvent) => {
    event.preventDefault()
    setNotice(null)
    const trimmedDestination = destination.trim()
    const units = inBaseUnits ? toBaseUnits(amountText, 0) : toBaseUnits(amountText, scale)
    if (units === null || units <= 0n) {
      // The only thing checked here, and it is arithmetic rather than a rule: a value this app
      // could not convert must not be turned into a number and sent. What counts as a valid
      // amount for the asset is the service's decision and stays there.
      setNotice({
        message: inBaseUnits
          ? 'Enter the amount as a whole number of the smallest units.'
          : `Enter an amount with at most ${scale} decimal places.`,
        requestId: undefined,
        forbidden: false,
      })
      return
    }
    const intent: SendIntent = {
      assetCode,
      destination: trimmedDestination,
      amount: units.toString(),
    }
    setArmed((previous) => ({
      intent,
      // The key survives a Back-and-review of the SAME intent, and only that.
      key: previous && sameIntent(previous.intent, intent) ? previous.key : mintIdempotencyKey('withdraw'),
      // EXACT, and deliberately not put through `formatAmount`: that one cuts at eight decimal
      // places, and a confirmation step that renders 0.000000001 EMBER as "0" is showing the user
      // a different number from the one being sent.
      amountHuman: scale === null ? null : humanise(units, scale),
      untrusted: !own.has(trimmedDestination),
    }))
  }

  /**
   * One withdrawal per intent, and the latch is what enforces it.
   *
   * This used to read `if (!armed || busy) return`, and `busy` is state — so two Confirm clicks in
   * one tick both read `busy === false` and both posted. The reason nobody noticed is at the top
   * of this file: one intent mints one `Idempotency-Key`, both requests carried it, and
   * `wallet/src/server.ts` replayed the second. No money moved twice, which made this a
   * guard that only worked because the service cleaned up after it. `micro-beacon`'s BJ-WAL-09
   * drives real Chromium and counts what leaves the browser, and it counted two.
   */
  const submission = useLatch()

  const confirm = () => {
    if (!armed || !submission.take()) return
    setBusy(true)
    setNotice(null)
    requestWithdrawal(armed.intent, armed.key)
      .then((outcome) => {
        setSent({ withdrawal: outcome.withdrawal, replayed: outcome.replayed })
        setArmed(null)
        setDestination('')
        setAmountText('')
        onSent()
      })
      .catch((err: unknown) => {
        setNotice(noticeFor(err, 'That withdrawal could not be requested.'))
        if (err instanceof ApiError && err.status === 409) {
          // `idempotency_key_reused` — two different bodies under one key. That is a bug in this
          // bundle rather than something the user can fix, so the intent is dropped: pressing
          // Confirm again against a key the service has already bound would repeat it forever.
          setArmed(null)
        }
      })
      // The latch first, and both in the `finally`. Releasing only on success would leave Confirm
      // permanently dead the first time a withdrawal failed — the failure mode that gets a latch
      // deleted rather than fixed.
      .finally(() => {
        submission.release()
        setBusy(false)
      })
  }

  if (sendable.length === 0) {
    return (
      <section className="wt-panel">
        <header className="wt-panel__head">
          <h2 className="wt-panel__title">Send</h2>
        </header>
        {balanceAbsent ? (
          // NOT "there is no balance". The tile did not answer, so this app does not know what the
          // balance is, and a zero is not the safe guess — it is the one wrong answer nobody
          // questions. `role="alert"`: a user who cannot send today needs to know it is an outage.
          <p className="wt-note wt-note--caveat" role="alert">
            ▲ CloudsForge could not read your balances — {balanceAbsent.reason}. This is not a
            statement that you have nothing to send; it is that Forge Hub does not know. Reload in
            a moment, and do not act on an empty screen.
          </p>
        ) : (
          <p className="wt-note">
            There is no balance to send. A managed wallet is provisioned the first time you deposit.
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="wt-panel">
      <header className="wt-panel__head">
        <h2 className="wt-panel__title">Send</h2>
      </header>

      {sent && <Receipt sent={sent} onDismiss={() => setSent(null)} />}
      {notice && <FormNotice notice={notice} />}

      {armed ? (
        <ConfirmStep
          armed={armed}
          busy={busy}
          onEdit={() => setArmed(null)}
          onConfirm={confirm}
        />
      ) : (
        <form className="wt-form" onSubmit={review} noValidate>
          <div className="wt-field">
            <label className="wt-field__label" htmlFor="send-asset">
              Asset
            </label>
            <select
              className="cf-select"
              id="send-asset"
              value={assetCode}
              onChange={(event) => setAssetCode(event.target.value)}
            >
              {sendable.map((h) => (
                <option key={h.assetCode} value={h.assetCode}>
                  {h.assetCode}
                </option>
              ))}
            </select>
            <p className="wt-field__hint cf-num">
              Available: {holding?.amountFormatted ?? holding?.available ?? '—'}{' '}
              {holding?.amountFormatted ? assetCode : `${assetCode} (smallest units)`}
            </p>
          </div>

          <div className="wt-field">
            <label className="wt-field__label" htmlFor="send-destination">
              Destination address
            </label>
            <input
              className="cf-input cf-input--mono"
              id="send-destination"
              name="destination"
              type="text"
              value={destination}
              list="send-own-addresses"
              autoComplete="off"
              spellCheck={false}
              required
              onChange={(event) => setDestination(event.target.value)}
            />
            {/*
              Suggestions, not a closed list. A user withdrawing to an exchange or to somebody
              else is the normal case; restricting the field to addresses this account already
              holds would make the feature useless and would be this app inventing a rule.
            */}
            <datalist id="send-own-addresses">
              {suggestions.map((w) => (
                <option key={w.id} value={w.address}>
                  {w.label ?? `${w.chain} ${w.origin}`}
                </option>
              ))}
            </datalist>
            <p className="wt-field__hint">
              CloudsForge checks the address when you send. Nothing here is corrected for you.
            </p>
          </div>

          <div className="wt-field">
            <label className="wt-field__label" htmlFor="send-amount">
              Amount{inBaseUnits ? ` (${assetCode}, smallest units)` : ` (${assetCode})`}
            </label>
            <input
              className="cf-input cf-input--mono"
              id="send-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              value={amountText}
              autoComplete="off"
              required
              onChange={(event) => setAmountText(event.target.value)}
            />
            <p className="wt-field__hint">
              {inBaseUnits
                ? // Said out loud rather than hidden: this app cannot know this asset's decimals,
                  // and asking for the unit the API takes is better than converting by guesswork.
                  'This build cannot establish this asset’s decimal places from your balance, so the amount is taken in smallest units — exactly as the wallet service takes it.'
                : `Up to ${scale} decimal places. The network fee is taken from this amount and is quoted when the withdrawal is submitted.`}
            </p>
          </div>

          <div className="wt-form__actions">
            <button type="submit" className="cf-btn cf-btn--ember">
              Review
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

/**
 * The confirmation step.
 *
 * It renders `armed.intent` and nothing else — no form state is in scope here, which is what
 * makes "what you see is what is sent" a property of the code rather than a promise. `Edit`
 * discards the intent rather than returning to it, so a change of mind always produces a fresh
 * review and, if anything changed, a fresh idempotency key.
 */
function ConfirmStep({
  armed,
  busy,
  onEdit,
  onConfirm,
}: {
  armed: Armed
  busy: boolean
  onEdit: () => void
  onConfirm: () => void
}) {
  return (
    <div className="wt-confirm">
      <h3 className="wt-panel__title">Confirm this payment</h3>
      <dl className="wt-facts wt-facts--mono">
        <dt>Asset</dt>
        <dd>{armed.intent.assetCode}</dd>
        <dt>To</dt>
        {/*
          In full, never shortened, and `user-select: all`. A shortened address on a confirmation
          step is a confirmation of the first eight characters, which is precisely what an address
          substitution is designed to survive.
        */}
        <dd>
          <code className="cf-num wt-addr" data-testid="confirm-destination">
            {armed.intent.destination}
          </code>
        </dd>
        <dt>Amount</dt>
        <dd className="cf-num">
          {armed.amountHuman ? `${armed.amountHuman} ${armed.intent.assetCode}` : null}
          {armed.amountHuman ? ' · ' : ''}
          {armed.intent.amount} smallest units
        </dd>
        <dt>Network fee</dt>
        <dd>Quoted by CloudsForge when this is submitted, and taken from the amount above.</dd>
      </dl>

      {armed.untrusted && (
        <p className="wt-confirm__warn" role="alert">
          ▲ This is not one of your CloudsForge wallets. A payment to the wrong address cannot be
          reversed by anyone. Check every character.
        </p>
      )}

      <div className="wt-form__actions">
        <button type="button" className="cf-btn cf-btn--ember" onClick={onConfirm} disabled={busy}>
          {busy ? 'Sending…' : 'Send it'}
        </button>
        <button type="button" className="cf-btn" onClick={onEdit} disabled={busy}>
          Edit
        </button>
      </div>
    </div>
  )
}

/** What actually left, read back off the service's own record rather than off the form. */
function Receipt({
  sent,
  onDismiss,
}: {
  sent: { withdrawal: Withdrawal; replayed: boolean }
  onDismiss: () => void
}) {
  const { withdrawal, replayed } = sent
  return (
    <div className="wt-confirm" role="status">
      <h3 className="wt-panel__title">
        {replayed ? 'Already requested' : 'Withdrawal requested'}
      </h3>
      {replayed && (
        // NOT an error. The service replays a repeat of one idempotency key and answers 200 with
        // the FIRST withdrawal, which is the mechanism working — telling the user it failed would
        // invite them to send a second one.
        <p className="wt-note">
          This is the payment you already asked for. Pressing Send twice does not send twice.
        </p>
      )}
      <dl className="wt-facts wt-facts--mono">
        <dt>To</dt>
        <dd>
          <code className="cf-num wt-addr">{withdrawal.destination}</code>
        </dd>
        <dt>Amount</dt>
        <dd className="cf-num">
          {withdrawal.amountFormatted} {withdrawal.assetCode}
        </dd>
        <dt>Network fee</dt>
        <dd className="cf-num">
          {formatAmount(withdrawal.fee) ?? withdrawal.fee} {withdrawal.assetCode}
        </dd>
        <dt>Arriving</dt>
        <dd className="cf-num">
          {withdrawal.netFormatted} {withdrawal.assetCode}
        </dd>
        <dt>State</dt>
        <dd>{withdrawal.state}</dd>
      </dl>
      <div className="wt-form__actions">
        <button type="button" className="cf-btn" onClick={onDismiss}>
          Done
        </button>
      </div>
    </div>
  )
}

function FormNotice({ notice }: { notice: ErrorNotice }) {
  return (
    <p className="wt-formerror" role="alert">
      {notice.message}
      {notice.requestId && (
        <>
          {' '}
          Quote <code className="cf-num wt-reqid">{notice.requestId}</code> to support.
        </>
      )}
    </p>
  )
}

/**
 * Smallest units back to a human decimal string, for display on the confirmation only.
 *
 * String arithmetic on the digits, never a division: the value routinely exceeds 2^53 and the
 * whole point of carrying it as a string is that nothing rounds it.
 */
function humanise(units: bigint, decimals: number): string {
  if (decimals === 0) return units.toString()
  const digits = units.toString().padStart(decimals + 1, '0')
  const cut = digits.length - decimals
  // Trailing zeros trimmed, and the point with them when nothing is left: `1.500000000000000000`
  // is the same number as `1.5` and the shorter one is the one a person can check.
  const fraction = digits.slice(cut).replace(/0+$/, '')
  return fraction === '' ? digits.slice(0, cut) : `${digits.slice(0, cut)}.${fraction}`
}
