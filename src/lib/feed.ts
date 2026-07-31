/**
 * Walking the activity feed, one opaque cursor at a time.
 *
 * A pure reducer rather than four `useState` calls inside the page, because every one of the
 * hazards below is invisible in a component and obvious in a test:
 *
 *   1. **A record can arrive twice.** The cursor is a keyset position, so a new record landing at
 *      the head between two requests shifts nothing — but a user who scrolls, waits, and scrolls
 *      again can still be handed a row they already have when a page boundary lands on a
 *      same-instant tie. React would then warn about duplicate keys and, worse, the reader would
 *      see the same transaction listed twice and count their money twice.
 *   2. **A server that echoes the cursor pages for ever.** If `nextCursor` comes back equal to
 *      the cursor just spent, "load more" would fetch the same page until the tab died. It is
 *      treated as the end of the feed, which is the only reading of it that terminates.
 *   3. **A failed page must not erase the good ones.** hub-api answers 200 with
 *      `status: 'unavailable'` when activity is down (server.ts:377-387), and the records already
 *      on screen are still true. Replacing them with the empty array that arrives alongside that
 *      status would delete a correct answer because a later request failed.
 *   4. **The end of the feed is `nextCursor === null`, not an empty page.** A page can legitimately
 *      come back empty with a cursor — activity filters by visibility — and stopping on emptiness
 *      would hide everything behind the first invisible record.
 */
import type { ActivityPageResponse, ActivityRecord } from './hub.ts'
import type { TileStatus } from './tile.ts'

export interface FeedState {
  readonly records: readonly ActivityRecord[]
  /** The cursor to spend next. Null means there is nothing after what is held. */
  readonly cursor: string | null
  /** True once the feed has been walked to its end. `cursor === null` and this agree, always. */
  readonly exhausted: boolean
  /** The status of the most recent page. Drives the note above the list. */
  readonly status: TileStatus
  readonly reason: string | null
  readonly cached: boolean
  readonly ageMs: number | null
  /** How many pages have been folded in. Zero means nothing has been asked for yet. */
  readonly pages: number
}

export const EMPTY_FEED: FeedState = Object.freeze({
  records: Object.freeze([]),
  cursor: null,
  exhausted: false,
  status: 'ok',
  reason: null,
  cached: false,
  ageMs: null,
  pages: 0,
})

/**
 * Fold one page into the feed.
 *
 * `spent` is the cursor that was used to fetch this page — null for the first. It is what makes
 * hazard 2 detectable: nothing else in the response says whether the server moved.
 */
export function appendPage(
  state: FeedState,
  page: ActivityPageResponse,
  spent: string | null,
): FeedState {
  // Hazard 3. An unavailable page carries `records: []`; folding it in would be indistinguishable
  // from reaching the end of a feed that is in fact still there.
  if (page.status === 'unavailable') {
    return {
      ...state,
      status: 'unavailable',
      reason: page.reason,
      cached: page.cached,
      ageMs: page.ageMs,
    }
  }

  const seen = new Set(state.records.map((record) => record.id))
  const added: ActivityRecord[] = []
  for (const record of page.records) {
    if (seen.has(record.id)) continue // Hazard 1.
    seen.add(record.id)
    added.push(record)
  }

  // Hazard 2. A cursor that has not moved cannot produce a new page, so the walk is over.
  const stuck = page.nextCursor !== null && page.nextCursor === spent
  const next = stuck ? null : page.nextCursor

  return {
    records: added.length === 0 ? state.records : [...state.records, ...added],
    cursor: next,
    exhausted: next === null, // Hazard 4: emptiness is not the end; a null cursor is.
    status: page.status,
    reason: page.reason,
    cached: page.cached,
    ageMs: page.ageMs,
    pages: state.pages + 1,
  }
}

/** Whether a "load more" control should be offered at all. */
export function canLoadMore(state: FeedState): boolean {
  return state.pages > 0 && !state.exhausted && state.cursor !== null
}

/**
 * One line describing how far the walk has got.
 *
 * "247 entries" alone is ambiguous — it could be all of them or the first of many — and the
 * difference matters to somebody looking for a transaction that is not on screen.
 */
export function feedSummary(state: FeedState): string {
  const count = state.records.length
  const noun = count === 1 ? 'entry' : 'entries'
  if (count === 0) return 'Nothing yet'
  return state.exhausted
    ? `${count} ${noun}, the whole history`
    : `${count} ${noun} so far, and there are more`
}
