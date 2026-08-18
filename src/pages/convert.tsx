/**
 * Convert: the conversion desk, which is CloudsForge selling you EMBER out of its own holdings.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE ONE THING THIS SCREEN MUST SAY OUT LOUD ───────────────────────────────────────────────
 *
 * **This is custodial, and there are two different swaps in this estate.**
 *
 * Here, CloudsForge quotes a price, sells you EMBER from inventory it owns, takes the asset you
 * gave in exchange, and goes on holding both. Nothing touches a chain, no contract is involved, and
 * the counterparty is the company. One hostname over, Forge Exchange is the opposite arrangement —
 * constant-product pools deployed on Hearth, where the trade IS a transaction and CloudsForge holds
 * nothing and can refuse nothing. Both are "swap one asset for another" in four words, which is
 * exactly why a reader will conflate them unless a screen says which one they are on. So this page
 * says it in the lede, and links to the other one rather than pretending it does not exist.
 *
 * ── THE DESK BUYS. IT DOES NOT SELL, AND THE FORM SAYS SO WHERE IT OFFERS THE CONTROL ─────────
 *
 * `DESK_BUYS` is EMBER and the output side is not a menu. That is a fact about how the desk is
 * FUNDED rather than a rule in `micro-wallet`: `convert()` there accepts any convertible pair and
 * refuses at `readDeskInventory` with a 409 `desk_inventory_short` for an asset it holds none of
 * (`wallet/src/money.ts`). The desk is funded in EMBER and in nothing else until micro-org#492 and
 * #493 close, so every other output would be offered here and refused there — a dead end presented
 * to a person as a choice, which is the defect `settlesOnChain` exists in `lib/money.ts` to close.
 *
 * The sentence under the field is therefore load-bearing rather than decorative: the reader is told
 * what is not on offer at the moment they are choosing, not after they have pressed a button. When
 * #492 and #493 land, this constant becomes a second `<select>` fed by whatever route publishes the
 * desk's inventory, and the sentence goes with it.
 *
 * ── THE QUOTE IS NOT A HOLD, AND THE SENTENCE SAYING SO IS THE SERVICE'S ──────────────────────
 *
 * `holdNotice` is printed verbatim from the quote. wallet made it a FIELD rather than a line in its
 * API documentation precisely so that no surface has to compose that sentence itself — "a surface
 * that renders a quote as though it were a hold is making a promise this service has not made". A
 * second copy of it typed into this file is a second copy free to drift, on the one screen where
 * drifting means promising a price nobody promised.
 *
 * A successful quote is also not a promise the conversion will FILL. wallet deliberately does not
 * consult the desk's inventory when quoting, because "an unlimited, free, unbooked route that
 * answers 'can you fill N?' is an oracle" — so `desk_inventory_short` arrives at the confirm step
 * and never at the quote, and this page is built to expect it there.
 *
 * ── WHAT YOU CONFIRM IS WHAT IS SENT ──────────────────────────────────────────────────────────
 *
 * The same rule `components/send.tsx` is built around, and for the same reason. Pressing "Get a
 * price" freezes a `ConversionIntent`; the quote is the SERVER'S answer about that object, the
 * confirm step renders the quote and nothing else, and the submit posts that same object untouched.
 * No path between the two re-reads a field or re-derives an amount, so the figure on screen and the
 * figure in the request body cannot disagree.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import { useCallback, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { surface } from '@cloudsforge/ui'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { ApiError, noticeFor, type ErrorNotice } from '../lib/api.ts'
import { FeedStatus } from '../components/tile.tsx'
import { quotedStamp, scaleOf, toBaseUnits, utcDateTime } from '../lib/format.ts'
import { mintIdempotencyKey } from '../lib/idempotency.ts'
import { useLatch } from '../lib/latch.ts'
import { convertible } from '../lib/money.ts'
import {
  convert,
  loadConversions,
  loadDashboard,
  quoteConversion,
  type ConversionIntent,
  type ConversionQuote,
  type ConversionReceipt,
  type ConversionRecord,
  type Holding,
} from '../lib/hub.ts'
import { absenceOf, hasAnswer, type Absence } from '../lib/tile.ts'
import { useResource } from '../lib/resource.ts'
import { viewedNetwork, viewedSurfaceUrl } from '../lib/viewed.ts'

/**
 * What the desk pays out in, today.
 *
 * See the header. This is a statement about the desk's funding rather than about wallet's rules,
 * and it is a constant here so that the one place it changes is the place the sentence beside it
 * changes too.
 */
const DESK_BUYS = 'EMBER'

const alwaysPresent = () => 1

export function ConvertPage() {
  const load = useCallback((signal: AbortSignal) => loadDashboard(signal), [])
  const { state, data, error, reload } = useResource(
    load,
    alwaysPresent,
    'We could not read what you are holding.',
  )
  /*
   * Remounts the list below after a conversion.
   *
   * `useResource` owns its own `reload`, and there is no way to reach one component's from another
   * without lifting the whole fetch into this page — which would mean this page holding a cursor,
   * a page state and a failure state for a list it does not otherwise care about. A key is the
   * smaller mechanism and it is exact: the list refetches, and it refetches from the first page,
   * which is where the conversion that just happened is.
   */
  const [converted, setConverted] = useState(0)

  if (state === 'forbidden') return <Forbidden notice={error ?? undefined} />
  if (state === 'failed' && error) return <Failed notice={error} onRetry={reload} />
  /*
   * `!data`, and NOT `state === 'loading'`. The difference is a first read against a refresh.
   *
   * `onConverted` reloads this dashboard so the figure beside the asset is the balance after the
   * conversion — and `useResource` reports a refresh as `loading` exactly as it reports a first
   * read. A guard on the STATE therefore unmounts the panel that has just rendered the receipt,
   * and the receipt goes with it: the reader presses Convert now, the screen blinks, and they are
   * handed an empty form with no evidence anything happened. On a screen that moves money, "it
   * looks like nothing happened" is the most expensive sentence available, and it invites the one
   * response that costs the most — pressing it again.
   *
   * Once there IS data there is something to draw, so a refresh redraws it in place. The failure
   * guards above are deliberately left on the state: a dashboard that has stopped answering is a
   * page that cannot say what you hold, which is different from one that is merely re-reading.
   */
  if (!data) return <Loading label="Reading what you hold" />

  const { portfolio } = data.tiles
  const network = viewedNetwork()

  return (
    <>
      <header className="wt-page__head">
        <h1 className="wt-page__title">Convert</h1>
        <p className="wt-page__lede">
          Turn something you are holding into {DESK_BUYS}. We quote a price, sell it to you out of
          our own holdings, and keep custody of both sides — this is a trade with CloudsForge, not a
          transaction on a chain.
        </p>
        {/*
          The network is a chip and not a clause, exactly as on Wallet: it qualifies every figure
          below rather than the sentence beside it. `viewedNetwork()` and never the hostname —
          under the combined view both estates are served from the mainnet hostnames, so the
          address bar is not an answer. Every read and every write on this page goes out through
          `viewedApiOrigin()`, so this names the estate the conversion happens in.
        */}
        <p className="wt-page__meta">
          Everything below is <span className={`wt-net wt-net--${network}`}>{network}</span>
        </p>
      </header>

      <ConvertPanel
        holdings={hasAnswer(portfolio) ? portfolio.data.holdings : []}
        balanceAbsent={absenceOf(portfolio)}
        onConverted={() => {
          reload()
          setConverted((n) => n + 1)
        }}
      />

      <ConversionsPanel key={converted} />

      <PoolsElsewhere />
    </>
  )
}

/* ────────────────────────────── the form ────────────────────────────── */

/** An intent, frozen when the price was asked for, with the answer the service gave about it. */
interface Armed {
  readonly intent: ConversionIntent
  readonly key: string
  readonly quote: ConversionQuote
}

const sameIntent = (a: ConversionIntent, b: ConversionIntent): boolean =>
  a.fromAssetCode === b.fromAssetCode && a.toAssetCode === b.toAssetCode && a.amount === b.amount

/** An idempotency key, and the intent it was minted for. See `minted` in `ConvertPanel`. */
interface Minted {
  readonly intent: ConversionIntent
  readonly key: string
}

/** A refusal, with the service's own code kept beside the sentence. See `nextStepFor`. */
interface Refusal {
  readonly notice: ErrorNotice
  readonly code: string | undefined
}

const refusalOf = (err: unknown, fallback: string): Refusal => ({
  notice: noticeFor(err, fallback),
  code: err instanceof ApiError ? err.code : undefined,
})

export function ConvertPanel({
  holdings,
  balanceAbsent = null,
  onConverted,
}: {
  holdings: readonly Holding[]
  /**
   * Set when the balance could not be READ, as opposed to being nothing. `components/send.tsx`
   * carries the argument: both arrive here as an empty list, and "you hold nothing to convert" is
   * a confident, wrong statement about somebody's money.
   */
  balanceAbsent?: Absence | null
  onConverted: () => void
}) {
  /*
   * What the desk will actually take, out of what this account actually holds.
   *
   * Three filters and each one closes a refusal the reader would otherwise meet on submit:
   * `available !== '0'` is `insufficient_funds`, `convertible` is 422 `not_convertible` (USD and
   * every `TOKEN:` code), and excluding the output asset is 422 `same_asset`. What is left is a
   * menu where every entry can be pressed.
   */
  const sellable = holdings.filter(
    (h) => h.available !== '0' && convertible(h.assetCode) && h.assetCode !== DESK_BUYS,
  )

  const [assetCode, setAssetCode] = useState(sellable[0]?.assetCode ?? '')
  const [amountText, setAmountText] = useState('')
  const [armed, setArmed] = useState<Armed | null>(null)
  /*
   * THE KEY OUTLIVES THE CONFIRM STEP, AND IT HAS TO.
   *
   * It was held on `armed` at first, which made it die with every "Change it" — and the sequence
   * that matters is exactly the one that goes through "Change it": press Convert now, the answer
   * never arrives (a timeout, a dropped connection, a 502 from the edge), so this page does not
   * know whether the conversion happened. A reader in that position re-prices the same amount and
   * presses again, and with a fresh key that second press is a SECOND conversion rather than a
   * replay of the first. Keeping the intent it was minted for beside it is what makes "the same
   * conversion" a comparison rather than a hope.
   *
   * Retired on success, deliberately: converting 0.25 BTC twice in a row is two conversions, and a
   * key that survived the first would replay it and hand back a receipt for money that never moved.
   */
  const [minted, setMinted] = useState<Minted | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [done, setDone] = useState<ConversionReceipt | null>(null)

  const holding = sellable.find((h) => h.assetCode === assetCode) ?? null
  // Derived from the pair the server sent for this holding, never from a table in this bundle.
  const scale = holding ? scaleOf(holding.amount, holding.amountFormatted) : null
  const inBaseUnits = scale === null

  /**
   * Ask for a price, and freeze the intent that was asked about.
   *
   * The quote request carries no idempotency key — it books nothing, and wallet's quote route does
   * not take one — but the KEY is minted here anyway, beside the intent it belongs to. A key
   * minted at the confirm click would be a new key for every click of it, which is the mechanism
   * defeated rather than used (`lib/idempotency.ts`).
   */
  const pricing = useLatch()

  const askForAPrice = (event: FormEvent) => {
    event.preventDefault()
    setRefusal(null)
    setDone(null)
    // The ternary rather than `inBaseUnits ? 0 : scale` inside one call: `inBaseUnits` is an alias
    // for `scale === null`, and TypeScript narrows `scale` through the alias only in the branches
    // of the condition itself. Same shape as `components/send.tsx` for the same reason.
    const units = inBaseUnits ? toBaseUnits(amountText, 0) : toBaseUnits(amountText, scale)
    if (units === null || units <= 0n) {
      // Arithmetic, not a rule: a value this app could not convert must not be turned into a
      // number and sent. What counts as a valid amount stays the service's decision.
      setRefusal({
        notice: {
          message: inBaseUnits
            ? 'Enter the amount as a whole number of the smallest units.'
            : `Enter an amount with at most ${scale} decimal places.`,
          requestId: undefined,
          forbidden: false,
        },
        code: undefined,
      })
      return
    }
    const intent: ConversionIntent = {
      fromAssetCode: assetCode,
      toAssetCode: DESK_BUYS,
      amount: units.toString(),
    }
    if (!pricing.take()) return
    setQuoting(true)
    const controller = new AbortController()
    quoteConversion(controller.signal, intent)
      .then((answer) => {
        // The key survives a re-price of the SAME intent, and only that. Editing the amount is a
        // different conversion and gets a different key, because one key over two bodies is a 409
        // from the service and would be this bundle's bug rather than the reader's.
        const key =
          minted && sameIntent(minted.intent, intent) ? minted.key : mintIdempotencyKey('convert')
        setMinted({ intent, key })
        setArmed({ intent, key, quote: answer.quote })
      })
      .catch((err: unknown) => {
        setRefusal(refusalOf(err, 'We could not price that conversion.'))
        setArmed(null)
      })
      .finally(() => {
        pricing.release()
        setQuoting(false)
      })
  }

  /**
   * One conversion per intent, and the latch is what enforces it.
   *
   * `busy` is state: two clicks in one tick both read `busy === false` and both post. On Send that
   * was survivable because wallet replayed the second under the shared key; it is survivable here
   * for the same reason and is guarded for the reason `lib/latch.ts` gives — how many times a
   * browser sends is squarely the client's own business, and a guard that only works because a
   * service cleans up after it is not a guard.
   */
  const submission = useLatch()

  const confirm = () => {
    if (!armed || !submission.take()) return
    setBusy(true)
    setRefusal(null)
    convert(armed.intent, armed.key)
      .then((receipt) => {
        setDone(receipt)
        setArmed(null)
        // This key has now bought something. See `minted`: carrying it into the next conversion
        // would replay this one and report money moving that did not.
        setMinted(null)
        setAmountText('')
        onConverted()
      })
      .catch((err: unknown) => {
        const failure = refusalOf(err, 'That conversion could not be made.')
        setRefusal(failure)
        // `idempotency_key_reuse` — two different bodies under one key, which is this bundle's bug
        // and not something the reader can fix by pressing again. The intent AND the key are
        // dropped, because the key is the thing the service is objecting to and re-sending it can
        // only produce the same 409 forever. Everything else keeps both: a reader refused for want
        // of inventory should be able to press again in a minute without retyping, and doing so
        // under the same key is exactly what idempotency is for.
        if (failure.code === 'idempotency_key_reuse') {
          setArmed(null)
          setMinted(null)
        }
      })
      .finally(() => {
        // The latch first, and both in the `finally`. Releasing on success only leaves the button
        // permanently dead the first time a conversion fails.
        submission.release()
        setBusy(false)
      })
  }

  if (sellable.length === 0) {
    return (
      <section className="wt-panel">
        <header className="wt-panel__head">
          <h2 className="wt-panel__title">Convert</h2>
        </header>
        {balanceAbsent ? (
          // NOT "you hold nothing". The tile did not answer, so this app does not know what the
          // balance is, and zero is the one wrong answer nobody questions.
          <p className="wt-note wt-note--caveat" role="alert">
            ▲ We could not read your balances — {balanceAbsent.reason}. Read that as ignorance on
            our part rather than emptiness on yours: this page does not know what you hold. Give it
            a moment and reload.
          </p>
        ) : (
          <p className="wt-note">
            There is nothing here the desk can take yet. It buys the coins the estate settles on a
            chain, and Shards; it pays in {DESK_BUYS}, so {DESK_BUYS} itself is not something it
            will buy from you.{' '}
            <Link className="wt-link" to="/wallet">
              Get a deposit address →
            </Link>
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="wt-panel">
      <header className="wt-panel__head">
        <h2 className="wt-panel__title">Convert</h2>
      </header>

      {done && <Receipt receipt={done} onDismiss={() => setDone(null)} />}
      {refusal && <RefusalNotice refusal={refusal} />}

      {armed ? (
        <ConfirmStep
          armed={armed}
          busy={busy}
          onEdit={() => setArmed(null)}
          onConfirm={confirm}
        />
      ) : (
        <form className="wt-form" onSubmit={askForAPrice} noValidate>
          <div className="wt-field">
            <label className="wt-field__label" htmlFor="convert-from">
              Convert from
            </label>
            <select
              className="cf-select"
              id="convert-from"
              value={assetCode}
              onChange={(event) => setAssetCode(event.target.value)}
            >
              {sellable.map((h) => (
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
            <label className="wt-field__label" htmlFor="convert-amount">
              Amount{inBaseUnits ? ` (${assetCode}, smallest units)` : ` (${assetCode})`}
            </label>
            <input
              className="cf-input cf-input--mono"
              id="convert-amount"
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
                ? 'This build cannot establish this asset’s decimal places from your balance, so the amount is taken in smallest units — exactly as the wallet service takes it.'
                : `Up to ${scale} decimal places.`}
            </p>
          </div>

          {/*
            THE OUTPUT IS A STATEMENT, NOT A MENU, AND THE HINT UNDER IT IS WHY.

            A `<select>` with one option is a control that cannot be operated, and a `<select>` with
            the other assets in it would offer pairs the desk refuses (see the file header). Saying
            it here — beside the control, before the button — is the difference between a reader who
            knows what this desk does and a reader who finds out from a 409.
          */}
          <div className="wt-field">
            {/*
              A `<span>` rather than a `<label>`, because there is no control here to label and a
              `<label>` pointing at nothing is a promise to a screen reader that something is
              focusable under it.
            */}
            <span className="wt-field__label">Convert into</span>
            <p className="wt-field__value cf-num">{DESK_BUYS}</p>
            <p className="wt-field__hint">
              The desk buys with {DESK_BUYS} and pays in nothing else at the moment, so this side is
              fixed. Converting {DESK_BUYS} back into another asset is not something it does yet.
            </p>
          </div>

          <div className="wt-form__actions">
            <button type="submit" className="cf-btn cf-btn--ember" disabled={quoting}>
              {quoting ? 'Pricing…' : 'Get a price'}
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
 * It renders `armed.quote` and nothing else — no form state is in scope here, which is what makes
 * "the figures you agreed to are the figures that were sent" a property of the code rather than a
 * promise. `Change it` discards the intent rather than editing it, so a change of mind always
 * produces a fresh price and, if anything about the intent moved, a fresh idempotency key.
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
  const { quote } = armed
  const priced = quotedStamp(quote.quotedAt)
  return (
    <div className="wt-confirm">
      <h3 className="wt-panel__title">Confirm this conversion</h3>
      <dl className="wt-facts wt-facts--mono">
        <dt>You give</dt>
        <dd className="cf-num">
          {quote.fromAmountFormatted} {quote.fromAssetCode}
          {' · '}
          {quote.fromAmount} smallest units
        </dd>
        <dt>You get</dt>
        <dd className="cf-num">
          {quote.toAmountFormatted} {quote.toAssetCode}
          {' · '}
          {quote.toAmount} smallest units
        </dd>
        <dt>Priced</dt>
        <dd className="cf-num">{priced ?? quote.quotedAt}</dd>
      </dl>

      {/*
        THE SERVICE'S OWN SENTENCE, PRINTED AS IT ARRIVED. See the file header: `holdNotice` is a
        field rather than API prose precisely so that no surface has to write this itself, and
        `role="alert"` because it is the one thing on this step a reader must not skim past.
      */}
      <p className="wt-confirm__warn" role="alert">
        ▲ {quote.holdNotice}
      </p>

      <div className="wt-form__actions">
        <button type="button" className="cf-btn cf-btn--ember" onClick={onConfirm} disabled={busy}>
          {busy ? 'Converting…' : 'Convert now'}
        </button>
        <button type="button" className="cf-btn" onClick={onEdit} disabled={busy}>
          Change it
        </button>
      </div>
    </div>
  )
}

/** What actually happened, read back off the service's own summary rather than off the quote. */
function Receipt({
  receipt,
  onDismiss,
}: {
  receipt: ConversionReceipt
  onDismiss: () => void
}) {
  const { summary, replayed } = receipt
  return (
    <div className="wt-confirm" role="status">
      <h3 className="wt-panel__title">{replayed ? 'Already converted' : 'Converted'}</h3>
      {replayed && (
        // NOT an error. hub-api answers 200 with `replayed: true` for a repeat of one idempotency
        // key and hands back the FIRST conversion, which is the mechanism working. Telling the
        // reader it failed would invite them to make a second one.
        <p className="wt-note">
          You are looking at the conversion you already made. Pressing the button again does not
          make a second one.
        </p>
      )}
      <dl className="wt-facts wt-facts--mono">
        <dt>You gave</dt>
        <dd className="cf-num">
          {summary.fromAmountFormatted} {summary.fromAssetCode}
        </dd>
        <dt>You got</dt>
        <dd className="cf-num">
          {summary.toAmountFormatted} {summary.toAssetCode}
        </dd>
        <dt>Priced</dt>
        <dd className="cf-num">{quotedStamp(summary.quotedAt) ?? summary.quotedAt}</dd>
      </dl>
      <p className="wt-note">
        Both sides are in your CloudsForge balance already — a conversion settles as one entry, so
        there is nothing to wait for and no chain to watch.
      </p>
      <div className="wt-form__actions">
        <button type="button" className="cf-btn" onClick={onDismiss}>
          Done
        </button>
      </div>
    </div>
  )
}

/**
 * A refusal, as the service's sentence plus what to do about it.
 *
 * ── WHY THE SENTENCE IS NOT WRITTEN HERE, AND THE NEXT STEP IS ────────────────────────────────
 *
 * `notice.message` is `micro-wallet`'s own words, forwarded through hub-api with its status and its
 * code intact — that forwarding is the whole point of micro-org#496's hub-api half, because a 409
 * `desk_inventory_short` arriving at a browser as a generic 500 turns "the desk is out of EMBER
 * right now" into "something went wrong". Restating those sentences here would put a second copy of
 * every refusal in a bundle that ships on a different cadence from the service that produces them.
 *
 * What the service cannot say is what to do NEXT, because that depends on the screen: the same
 * `insufficient_funds` means "deposit more" here and "reduce the withdrawal" on Send. So the code
 * is kept beside the sentence and answers exactly that, and only where there is something to add.
 */
function RefusalNotice({ refusal }: { refusal: Refusal }) {
  const next = nextStepFor(refusal.code)
  return (
    <p className="wt-formerror" role="alert">
      {refusal.notice.message}
      {next && <> {next}</>}
      {refusal.notice.requestId && (
        <>
          {' '}
          Quote <code className="cf-num wt-reqid">{refusal.notice.requestId}</code> to support.
        </>
      )}
    </p>
  )
}

/**
 * What to do about each refusal the desk can produce.
 *
 * Every code below is one `micro-wallet` raises on the quote or the conversion path
 * (`wallet/src/money.ts`, `wallet/src/server.ts`) and one hub-api forwards verbatim rather than
 * flattening to a 500. Two are deliberately absent:
 *
 *   - `conversion_not_found` (404) belongs to `GET /v1/conversions/:id`, which this bundle does not
 *     call at all — every field of that response is already on the row on screen (`lib/hub.ts`).
 *   - `bad_limit` (400) is this bundle sending a page size the service will not take, which is a
 *     bug here rather than anything a reader can act on. It renders as its own sentence with the
 *     request id and nothing else.
 *
 * `null` where the service's sentence already contains the next move: `desk_inventory_short` ends
 * with "try a smaller amount, or try again shortly", and appending advice to advice is how a
 * refusal turns into a paragraph nobody reads. What is added to that one instead is the fact the
 * sentence does NOT carry, which is whose shortfall it is.
 */
export function nextStepFor(code: string | undefined): string | null {
  switch (code) {
    case 'desk_inventory_short':
      // THE ONE THIS TICKET NAMES. It is our shortfall, not the reader's, and the difference
      // matters: read as "you do not have enough" it is alarming and wrong.
      return (
        'That is our holding being short rather than yours — nothing has left your balance, and ' +
        'nothing was reserved when you asked for the price.'
      )
    case 'insufficient_funds':
      return (
        'The figure beside the asset above is what is available to convert; anything already ' +
        'reserved for a withdrawal in flight is not part of it.'
      )
    case 'amount_too_small':
      return 'Convert more of it in one go — the amount you asked for rounds down to nothing.'
    case 'same_asset':
      return (
        'Choose a different asset to convert from. This form should not have offered that pair, ' +
        'so if you did not edit the address bar, please tell support.'
      )
    case 'not_convertible':
      return (
        'The desk takes the coins the estate settles on a chain, and Shards. It does not take ' +
        'dollars or the tokens minted on Forge Create.'
      )
    case 'rate_unavailable':
      return (
        'There is nothing wrong with your balance. Prices come from outside and one of them is ' +
        'missing, so the desk refuses rather than guessing a rate you would trade at. Try again ' +
        'in a few minutes.'
      )
    case 'invalid_amount':
      return 'Enter an amount above zero.'
    case 'bad_field':
      return 'Check the amount and the asset, then ask for a price again.'
    case 'idempotency_key_required':
      return (
        'That is a fault in this page rather than anything you did. Reload it and try once more.'
      )
    case 'idempotency_key_reuse':
      return (
        'This page sent two different conversions under one reference, which is a fault here ' +
        'rather than anything you did. Reload it and start again.'
      )
    case 'idempotency_in_flight':
      return (
        'The first attempt is still going through. Give it a moment and reload this page before ' +
        'trying again, rather than converting twice.'
      )
    case 'rate_limited':
      return 'Wait a few seconds before asking again.'
    default:
      return null
  }
}

/* ────────────────────────── what has been converted ────────────────────────── */

const countConversions = (page: { conversions: readonly ConversionRecord[] }) =>
  page.conversions.length

/**
 * The conversions this account has made, newest first.
 *
 * On this page rather than on Activity, and both are right: Activity carries the journal entry as
 * one line among everything else, and this list carries both sides of each trade and the price
 * behind it. It is also what stops the receipt above from being the only place a conversion is ever
 * seen — the objection the paragraph this ticket deleted from `pages/wallet.tsx` was built on.
 *
 * ONE PAGE, AND IT SAYS SO WHEN THERE ARE MORE. hub-api serves a cursor and this does not walk it:
 * a desk list is short by construction, and the Activity page is the feed that exists for reading
 * back through a history. A "show me more" here would be a second pager to keep in step with the
 * first for the sake of a list most accounts will never fill one page of.
 */
function ConversionsPanel() {
  const load = useCallback((signal: AbortSignal) => loadConversions(signal), [])
  const { state, data, error, reload } = useResource(
    load,
    countConversions,
    'We could not read your conversions.',
  )

  return (
    <section className="wt-panel">
      <header className="wt-panel__head">
        <h2 className="wt-panel__title">Conversions</h2>
      </header>

      {/*
        An unavailable list is not an empty one. hub-api answers 200 with `status: 'unavailable'`
        and an empty array when wallet is down, so that an outage costs this panel rather than the
        whole page — and rendering that array as "you have never converted anything" is how an
        outage reads as a quiet week. `FeedStatus` is the one place that decision is made.
      */}
      {data && (
        <FeedStatus
          page={data}
          fallbackReason="Nothing came back from the service that keeps your conversions."
        />
      )}

      {state === 'loading' && <Loading label="Reading your conversions" />}
      {state === 'forbidden' && <Forbidden notice={error ?? undefined} />}
      {state === 'failed' && error && <Failed notice={error} onRetry={reload} />}
      {state === 'empty' && data?.status !== 'unavailable' && (
        <p className="wt-note">
          You have not converted anything yet. What you do here appears in this list straight away —
          a conversion settles as one entry, so there is no pending state to sit through.
        </p>
      )}
      {state === 'ok' && data && (
        <>
          <ul className="wt-rows">
            {data.conversions.map((record) => (
              <ConversionRow key={record.id} record={record} />
            ))}
          </ul>
          {data.nextCursor !== null && (
            <p className="wt-note">
              Older ones than these exist. The{' '}
              <Link className="wt-link" to="/activity">
                Activity feed
              </Link>{' '}
              is where the whole history is read back.
            </p>
          )}
        </>
      )}
    </section>
  )
}

/**
 * One conversion.
 *
 * `quotedAt` is null for an entry booked before micro-org#495 gave the desk a price to record, and
 * the row leaves the field off rather than printing the entry's own timestamp in its place — a
 * conversion labelled with the wrong "priced at" is worse than one labelled with none.
 */
function ConversionRow({ record }: { record: ConversionRecord }) {
  return (
    <li className="wt-row">
      <span className="wt-dot wt-dot--active" aria-hidden="true" />
      <span className="wt-row__main">
        <span className="wt-row__title cf-num">
          {record.fromAmountFormatted} {record.fromAssetCode} → {record.toAmountFormatted}{' '}
          {record.toAssetCode}
        </span>
        {record.quotedAt !== null && (
          <span className="wt-row__sub cf-num">
            priced {quotedStamp(record.quotedAt) ?? record.quotedAt}
          </span>
        )}
      </span>
      <span className="wt-row__meta">
        <span className="wt-row__time cf-num">{utcDateTime(record.occurredAt)}</span>
      </span>
    </li>
  )
}

/* ──────────────────────── the other kind of swap ──────────────────────── */

/**
 * The seam to Forge Exchange, which is the same verb and a completely different arrangement.
 *
 * ── THE HOSTNAME IS RESOLVED, NEVER TYPED ─────────────────────────────────────────────────────
 *
 * `viewedSurfaceUrl('exchange')` composes it from the shared registry row and from the network the
 * reader is VIEWING, and self-checks its own composition against `hosts()` before trusting it
 * (`lib/viewed.ts`). So a reader looking at testnet is offered the testnet exchange, a preview
 * deployment is offered the address that actually answers, and no environment is written into this
 * bundle — which `test/no-build-time-config.test.ts` would fail the build over anyway.
 *
 * The NAME comes from the same row. A hand-typed "Forge Exchange" here is a second copy of a
 * product's name in a bundle that ships separately from the registry that owns it.
 *
 * No path is appended. Which address inside that surface is the swap screen is that repository's
 * decision, and a path composed here would be this bundle's guess about somebody else's router —
 * the failure `lib/hosts.ts` records for the reserved `account.<apex>` hostname, in the other
 * direction.
 */
function PoolsElsewhere() {
  const exchange = surface('exchange')
  return (
    <section className="wt-panel">
      <header className="wt-panel__head">
        <h2 className="wt-panel__title">The other way to swap</h2>
      </header>
      <p className="wt-note">
        {exchange.name} is a different arrangement, not a second door to this one. There, a swap is
        a transaction against pools that live on the EMBER chain: the price comes from what is in
        the pool rather than from us, the coins are yours in your own wallet, and CloudsForge holds
        nothing and can refuse nothing. Here, you are trading with CloudsForge and CloudsForge keeps
        custody of both sides.
      </p>
      <p className="wt-note">
        <a className="wt-link" href={viewedSurfaceUrl('exchange')} rel="noreferrer noopener">
          Open {exchange.name} →
        </a>
      </p>
    </section>
  )
}
