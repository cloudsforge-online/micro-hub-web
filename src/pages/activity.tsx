/**
 * Activity: the unified history, walked one opaque cursor at a time.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── WHAT THIS PAGE WAS, AND WHY IT WAS REDESIGNED (micro-org#482) ─────────────────────────────
 *
 *   *"It is just text. Also it might be good to have more information except 'signed in (my
 *   account)'."*
 *
 * It WAS just text. One flat `<ul>`, every row the same weight, the same grey, the same shape:
 * a timestamp, one sentence, and `wallet · deposit` under it. Two hundred rows of that is a wall
 * a person scans by reading, which is the slowest way there is. Three things fix it and none of
 * them is decoration:
 *
 *   1. **The day is a heading, not a repeated prefix.** A feed spanning months printed `14 Mar
 *      09:12` two hundred times, and the eye has to parse a date on every row to find where
 *      yesterday ends. Grouping puts the date once and leaves the row with a clock time.
 *   2. **Every row is TYPED.** `lib/activitykind.ts` turns `record.type` — a value activity
 *      assigns from a frozen topic table — into a title, a direction, a standing meaning and a
 *      destination. The marker down the left says in / out / needs you / access / noted in a
 *      glyph and a colour at once, so the shape of a month is visible before a word is read.
 *   3. **Money is in its own column, and it names its network.** A right-aligned tabular figure
 *      is comparable down the page; the same figure inside a sentence is not. And #482 §3 is the
 *      reason for the label beside it — *"mainnet and testnet rows in one undifferentiated list
 *      is how somebody misreads a testnet amount as real"*.
 *
 * ── THE NETWORK ON A MONEY ROW IS THE VIEWED NETWORK, AND THAT IS PROVABLE ────────────────────
 *
 * `activity_record` has no network column: the estate runs one activity service per network and
 * the row's network is the estate it was read from. This page reads through `viewedApiOrigin()`,
 * so every record on screen came from the network `viewedNetwork()` names — the same value the
 * bar's switcher shows and the amber band follows. Labelling the row with it is a statement about
 * where the figure was read, which is exactly the claim being made. What it is NOT is a
 * per-record historical fact: a row cannot say which network it happened on independently of the
 * fetch that produced it, and it does not pretend to.
 *
 * ── THE FILTER IS OVER WHAT HAS BEEN LOADED, AND SAYS SO ──────────────────────────────────────
 *
 * `micro-activity` serves a `category` query parameter and hub-api does not forward it. Rather
 * than add a filter that silently means something different from what it says, this one narrows
 * the rows already folded in and prints the count it is narrowing from. A reader who filters to
 * Money and sees "12 of 40 loaded" knows both that there are 12 and that there may be more behind
 * the button. See `lib/activitykind.ts` for why there are four lenses and not fifteen.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── Why this page does not use `useResource` ───────────────────────────────────────────────────
 *
 * `useResource` models one fetch with four outcomes, and it re-runs from scratch on reload. A
 * cursored feed accumulates: the second page must be ADDED to the first, and a failed third page
 * must not take the first two off the screen. Folding pages together is `lib/feed.ts`, which is a
 * pure reducer for the reason given in its header — every hazard it handles is invisible in a
 * component and obvious in a test.
 *
 * ── The cursor is opaque here too ──────────────────────────────────────────────────────────────
 *
 * It is activity's keyset position. hub-api passes it through byte-for-byte and does not parse it
 * (`hub-api/src/server.ts`); neither does this page. Nothing here inspects it, decodes it,
 * or reconstructs one — a second cursor format would have to be kept in step with the first for
 * ever, and it would be this bundle that fell behind.
 *
 * ── An unavailable page is not an empty feed ───────────────────────────────────────────────────
 *
 * `GET /v1/activity` answers 200 with `status: 'unavailable'` and `records: []` when the activity
 * service is down (server.ts). Rendering that array is how an outage reads as a quiet
 * week. `appendPage` refuses to fold it in, and the note below the heading says which it was.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { FeedStatus } from '../components/tile.tsx'
import {
  formatAmount,
  utcDay,
  utcDayLabel,
  utcDateTime,
  utcTime,
} from '../lib/format.ts'
import { noticeFor, type ErrorNotice } from '../lib/api.ts'
import { appendPage, canLoadMore, feedSummary, EMPTY_FEED, type FeedState } from '../lib/feed.ts'
import { useLatch } from '../lib/latch.ts'
import { loadActivity, type ActivityRecord } from '../lib/hub.ts'
import { viewedNetwork } from '../lib/viewed.ts'
import {
  carriesMoney,
  destinationName,
  detailFor,
  GLYPHS,
  inLens,
  kindOf,
  LENSES,
  productName,
  type Lens,
} from '../lib/activitykind.ts'

export function ActivityPage() {
  const [feed, setFeed] = useState<FeedState>(EMPTY_FEED)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<ErrorNotice | null>(null)
  const [lens, setLens] = useState<Lens>('all')

  const fetchPage = useCallback((cursor: string | null, signal: AbortSignal): Promise<void> => {
    setLoading(true)
    setNotice(null)
    return loadActivity(signal, cursor)
      .then((page) => {
        if (signal.aborted) return
        // `cursor` is passed back in as `spent` so the reducer can tell a server that moved from
        // one that echoed the cursor it was given.
        setFeed((current) => appendPage(current, page, cursor))
        setLoading(false)
      })
      .catch((err: unknown) => {
        // An abort is this component going away, not a failure.
        if (signal.aborted) return
        setNotice(noticeFor(err, 'We could not read your history.'))
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void fetchPage(null, controller.signal)
    return () => controller.abort()
  }, [fetchPage])

  /**
   * Load more is a READ, and it still may not go out twice.
   *
   * `disabled={loading}` is state, so two same-tick presses both read `loading === false` and both
   * fetch the same cursor. `appendPage` deduplicates by record id, so no row is doubled — but two
   * requests still leave the browser for one press, and `feed.pages` counts two pages for one, so
   * "loaded 3 pages" stops being true.
   *
   * The latch is taken here rather than inside `fetchPage` on purpose. `fetchPage` is also called
   * from the mount effect, and under `<StrictMode>` that effect runs twice: the first run is
   * aborted by the cleanup and the second starts in the same tick, so a latch held by the first
   * would block the second and the page would never load at all. Guarding only the control the
   * user can press twice is the narrow, correct scope.
   */
  const more = useLatch()

  const loadMore = () => {
    if (!more.take()) return
    const controller = new AbortController()
    void fetchPage(feed.cursor, controller.signal).finally(() => more.release())
  }

  const shown = useMemo(
    () => feed.records.filter((record) => inLens(record, lens)),
    [feed.records, lens],
  )
  const days = useMemo(() => groupByDay(shown), [shown])

  if (notice?.forbidden) return <Forbidden notice={notice} />
  // A failure on the FIRST page is a failure state. A failure on a later page is not: the records
  // already on screen are still true, so the error goes under them and the button stays.
  if (notice && feed.pages === 0) {
    return (
      <Failed
        notice={notice}
        onRetry={() => {
          const controller = new AbortController()
          fetchPage(null, controller.signal)
        }}
      />
    )
  }
  if (loading && feed.pages === 0) return <Loading label="Reading your history" />

  const lensLabel = LENSES.find((l) => l.id === lens)?.label ?? 'Everything'

  return (
    <>
      <header className="wt-page__head">
        <h1 className="wt-page__title">Activity</h1>
        <p className="wt-page__meta cf-num">{feedSummary(feed)}</p>
        <p className="wt-page__lede">
          Everything this account has done, from every product, newest first. Nothing here is ever
          edited — a correction arrives as a further entry, so the record can be read as a record.
        </p>
      </header>

      {/*
        Lifted into `components/tile.tsx` by micro-org#496, unchanged word for word. Conversions
        and transfers are paged the same flat way and needed the same three sentences, and three
        hand-written copies of "what an unavailable list means" is the drift `TilePanel` was
        written to stop — arrived at from the side hub-api's non-tile routes come in on.
      */}
      <FeedStatus
        page={feed}
        fallbackReason="Nothing came back from the service that keeps your history."
        partial={feed.records.length > 0}
      />

      {feed.records.length === 0 ? (
        feed.status === 'unavailable' ? null : (
          <FirstMove />
        )
      ) : (
        <>
          <div className="wt-lens" role="radiogroup" aria-label="Narrow this history">
            {LENSES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={lens === option.id}
                className={`wt-lens__opt${lens === option.id ? ' wt-lens__opt--on' : ''}`}
                onClick={() => setLens(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/*
            The count the filter is narrowing FROM. Without it "3 entries" reads as the whole
            account, and the reader stops looking for the fourth.
          */}
          {lens !== 'all' && (
            <p className="wt-lens__count cf-num" role="status">
              {shown.length} of {feed.records.length} loaded {feed.records.length === 1 ? 'entry' : 'entries'}
              {feed.exhausted ? '' : ' — there are older ones behind the button below'}
            </p>
          )}

          {shown.length === 0 ? (
            <p className="wt-note" role="status">
              Nothing under {lensLabel.toLowerCase()} in what has been loaded so far.
              {feed.exhausted
                ? ' That is the whole history, so there is none.'
                : ' Load more below, or go back to Everything.'}
            </p>
          ) : (
            days.map((day) => (
              <section className="wt-day" key={day.key}>
                <h2 className="wt-day__label">{day.label}</h2>
                <ul className="wt-tape">
                  {day.records.map((record) => (
                    <ActivityRow key={record.id} record={record} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}

      <div className="wt-feed__foot">
        {canLoadMore(feed) && (
          <button type="button" className="cf-btn" onClick={loadMore} disabled={loading}>
            {loading ? 'Fetching…' : 'Show me more'}
          </button>
        )}
        {feed.exhausted && feed.records.length > 0 && (
          <p className="wt-note">You have reached the beginning. There is nothing older.</p>
        )}
        {/* A later page that failed: the list stays, the failure is stated under it. */}
        {notice && feed.pages > 0 && (
          <p className="wt-note wt-note--caveat" role="alert">
            {notice.message}
            {notice.requestId && (
              <>
                {' '}
                Give support this reference:{' '}
                <code className="cf-num wt-reqid">{notice.requestId}</code>.
              </>
            )}
          </p>
        )}
      </div>
    </>
  )
}

/**
 * The empty state, which is an invitation rather than an apology.
 *
 * "Nothing has been recorded against this account" is a true sentence that leaves the reader
 * exactly where they were. A history is empty because nothing has been DONE yet, and the three
 * things worth doing first are all one click away in this app — so they are offered, by name,
 * with the verb on each one.
 *
 * `.wt-invite` is the vocabulary the Access page already uses for the same job, so an account with
 * nothing in it looks like one product rather than two.
 */
function FirstMove() {
  return (
    <section className="wt-invite">
      <p className="wt-invite__title">Nothing has happened here yet</p>
      <p className="wt-invite__body">
        This is where every deposit, withdrawal, trade, sale, reward and sign-in lands, from every
        CloudsForge product, as it happens. Three ways to put the first entry on it:
      </p>
      <p className="wt-invite__links">
        <Link className="cf-btn cf-btn--ember" to="/wallet">
          Get a deposit address
        </Link>
        <Link className="cf-btn" to="/mine">
          Mine EMBER in this tab
        </Link>
        <Link className="cf-btn" to="/portfolio">
          See what you hold
        </Link>
      </p>
    </section>
  )
}

interface Day {
  readonly key: string
  readonly label: string
  readonly records: readonly ActivityRecord[]
}

/**
 * Split a feed into UTC days, in the order the records arrived in.
 *
 * The order is preserved rather than re-sorted: activity's keyset is `(occurred_at, id)` descending
 * and re-sorting here would be this bundle asserting an ordering the service already owns. A
 * record whose timestamp will not parse gets its own group headed "Undated" instead of being
 * dropped — a row that vanishes because its clock is wrong is worse than one with no heading.
 */
export function groupByDay(records: readonly ActivityRecord[]): readonly Day[] {
  const days: Day[] = []
  let current: { key: string; label: string; records: ActivityRecord[] } | null = null
  for (const record of records) {
    const key = utcDay(record.occurredAt) ?? 'undated'
    if (current === null || current.key !== key) {
      current = { key, label: utcDayLabel(record.occurredAt) ?? 'Undated', records: [] }
      days.push(current)
    }
    current.records.push(record)
  }
  return days
}

/**
 * One entry in the feed.
 *
 * ── The title comes from `type`, not from the sentence ────────────────────────────────────────
 *
 * `lib/activitykind.ts` records why at length, and the short version is that the sentence cannot
 * be relied on: `identity.session.created` carries `deviceId` where the classifier reads `device`,
 * so every sign-in in the estate is summarised as the four words `Signed in.` and the `ipPrefix`
 * that IS on the payload is dropped with it. A row built on the summary alone therefore says
 * nothing, which is the second half of micro-org#482. This one gets its title, its direction, its
 * meaning and its destination from the type, and uses the summary as the detail line only where
 * the summary adds something the title did not.
 *
 * ── The amount is rendered only when activity sent one ────────────────────────────────────────
 *
 * A record with `amount: null` is an event without a quantity — a token deployed, a device added —
 * and printing "0" beside it would invent a figure for something that never had one. Where there
 * IS one, the network is named beside it: see the page header for why the viewed network is the
 * honest answer and what it does not claim.
 */
export function ActivityRow({
  record,
  showDate = false,
}: {
  record: ActivityRecord
  showDate?: boolean | undefined
}) {
  const shape = kindOf(record)
  const detail = detailFor(record, shape)
  const amount = formatAmount(record.amount)
  const network = viewedNetwork()
  return (
    <li className={`wt-entry wt-entry--${shape.tone}`}>
      {/* Colour is never the only channel: the glyph differs in outline per tone and the title
          says the same thing in words. */}
      <span className="wt-entry__mark" aria-hidden="true">
        {GLYPHS[shape.tone]}
      </span>
      {/* The day is a heading on this page, so the row keeps a clock time. The dashboard preview
          has no day headings and asks for the date here instead. */}
      <span className="wt-entry__when cf-num">
        {showDate ? utcDateTime(record.occurredAt) : utcTime(record.occurredAt)}
      </span>
      <span className="wt-entry__body">
        <span className="wt-entry__title">{shape.title}</span>
        {detail !== null && <span className="wt-entry__detail">{detail}</span>}
        <span className="wt-entry__tags">
          <span className="wt-chip">{productName(record.product)}</span>
          {shape.to !== null && (
            <Link className="wt-link" to={shape.to}>
              {destinationName(shape.to)} →
            </Link>
          )}
        </span>
      </span>
      {amount !== null && carriesMoney(record) && (
        <span className="wt-entry__sum">
          <span className="wt-entry__amount cf-num">
            {amount}
            {record.assetCode ? ` ${record.assetCode}` : ''}
          </span>
          <span className={`wt-net wt-net--${network}`}>{network}</span>
        </span>
      )}
    </li>
  )
}
