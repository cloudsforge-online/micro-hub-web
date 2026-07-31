/**
 * Activity: the unified history, walked one opaque cursor at a time.
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
 * (`hub-api/src/server.ts:348-357`); neither does this page. Nothing here inspects it, decodes it,
 * or reconstructs one — a second cursor format would have to be kept in step with the first for
 * ever, and it would be this bundle that fell behind.
 *
 * ── An unavailable page is not an empty feed ───────────────────────────────────────────────────
 *
 * `GET /v1/activity` answers 200 with `status: 'unavailable'` and `records: []` when the activity
 * service is down (server.ts:377-387). Rendering that array is how an outage reads as a quiet
 * week. `appendPage` refuses to fold it in, and the note below the heading says which it was.
 */
import { useCallback, useEffect, useState } from 'react'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { ageLabel, formatAmount, utcDateTime, utcTime } from '../lib/format.ts'
import { noticeFor, type ErrorNotice } from '../lib/api.ts'
import { appendPage, canLoadMore, feedSummary, EMPTY_FEED, type FeedState } from '../lib/feed.ts'
import { loadActivity, type ActivityRecord } from '../lib/hub.ts'

export function ActivityPage() {
  const [feed, setFeed] = useState<FeedState>(EMPTY_FEED)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<ErrorNotice | null>(null)

  const fetchPage = useCallback((cursor: string | null, signal: AbortSignal) => {
    setLoading(true)
    setNotice(null)
    loadActivity(signal, cursor)
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
        setNotice(noticeFor(err, 'Could not load your activity.'))
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchPage(null, controller.signal)
    return () => controller.abort()
  }, [fetchPage])

  const loadMore = () => {
    const controller = new AbortController()
    fetchPage(feed.cursor, controller.signal)
  }

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
  if (loading && feed.pages === 0) return <Loading label="Loading your activity" />

  return (
    <>
      <header className="wt-page__head">
        <h1 className="wt-page__title">Activity</h1>
        <p className="wt-page__meta">{feedSummary(feed)}</p>
      </header>

      {feed.status === 'unavailable' && (
        <p className="wt-banner wt-banner--degraded" role="alert">
          <span className="wt-banner__icon" aria-hidden="true">
            ▲
          </span>
          {feed.reason ?? 'The activity service did not answer.'}{' '}
          {feed.records.length > 0
            ? 'What is listed below arrived before it stopped answering.'
            : 'Nothing could be loaded, which is not the same as nothing having happened.'}
        </p>
      )}
      {feed.status === 'degraded' && (
        <p className="wt-banner wt-banner--degraded" role="status">
          <span className="wt-banner__icon" aria-hidden="true">
            ▲
          </span>
          {feed.reason ?? 'This feed is not current.'}
        </p>
      )}
      {feed.status === 'ok' && feed.cached && ageLabel(feed.ageMs) && (
        <p className="wt-note">Served from cache, {ageLabel(feed.ageMs)}.</p>
      )}

      {feed.records.length === 0 ? (
        feed.status === 'unavailable' ? null : (
          <Empty
            title="Nothing has happened on this account yet"
            hint="Deposits, withdrawals, trades and rewards all appear here as they settle."
          />
        )
      ) : (
        <ul className="wt-rows wt-rows--feed">
          {feed.records.map((record) => (
            <ActivityRow key={record.id} record={record} showDate />
          ))}
        </ul>
      )}

      <div className="wt-feed__foot">
        {canLoadMore(feed) && (
          <button type="button" className="cf-btn" onClick={loadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
        {feed.exhausted && feed.records.length > 0 && (
          <p className="wt-note">That is the whole history for this account.</p>
        )}
        {/* A later page that failed: the list stays, the failure is stated under it. */}
        {notice && feed.pages > 0 && (
          <p className="wt-note wt-note--caveat" role="alert">
            {notice.message}
            {notice.requestId && (
              <>
                {' '}
                Quote <code className="cf-num wt-reqid">{notice.requestId}</code> to support.
              </>
            )}
          </p>
        )}
      </div>
    </>
  )
}

/**
 * One entry in the feed.
 *
 * The amount is rendered only when activity sent one. A record with `amount: null` is an event
 * without a quantity — a token deployed, a device added — and printing "0" beside it would invent
 * a figure for something that never had one.
 */
export function ActivityRow({
  record,
  showDate = false,
}: {
  record: ActivityRecord
  showDate?: boolean | undefined
}) {
  const amount = formatAmount(record.amount)
  return (
    <li className="wt-row">
      {/* The dashboard preview shows the time only; the feed page shows the date too, because a
          list that spans months and prints four identical clock times is unreadable. */}
      <span className="wt-row__time cf-num">
        {showDate ? utcDateTime(record.occurredAt) : utcTime(record.occurredAt)}
      </span>
      <span className="wt-row__main">
        <span className="wt-row__title">{record.summary}</span>
        <span className="wt-row__sub">
          {record.product} · {record.category}
        </span>
      </span>
      <span className="wt-row__meta">
        {amount !== null && (
          <span className="wt-row__amount cf-num">
            {amount}
            {record.assetCode ? ` ${record.assetCode}` : ''}
          </span>
        )}
      </span>
    </li>
  )
}
