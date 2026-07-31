/**
 * The cursor walk, and the four ways it goes wrong.
 *
 * Each of these is invisible inside a component and obvious here, which is the entire argument for
 * `lib/feed.ts` being a pure reducer rather than four `useState` calls on the Activity page.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { appendPage, canLoadMore, EMPTY_FEED, feedSummary, type FeedState } from '../src/lib/feed.ts'
import type { ActivityPageResponse, ActivityRecord } from '../src/lib/hub.ts'

const record = (id: string): ActivityRecord => ({
  id,
  userId: 'u1',
  occurredAt: '2026-03-14T14:02:00.000Z',
  category: 'wallet',
  type: 'deposit_credited',
  subjectUrn: `urn:cf:deposit:${id}`,
  summary: `Deposit ${id}`,
  amount: '0.5',
  assetCode: 'ETH',
  product: 'hub',
  visibility: 'user',
})

const page = (over: Partial<ActivityPageResponse>): ActivityPageResponse => ({
  records: [],
  nextCursor: null,
  status: 'ok',
  reason: null,
  cached: false,
  ageMs: null,
  ...over,
})

describe('the happy walk', () => {
  it('accumulates pages rather than replacing them', () => {
    let feed = appendPage(EMPTY_FEED, page({ records: [record('a'), record('b')], nextCursor: 'c1' }), null)
    assert.equal(feed.records.length, 2)
    assert.equal(feed.cursor, 'c1')
    assert.equal(feed.exhausted, false)
    assert.equal(canLoadMore(feed), true)

    feed = appendPage(feed, page({ records: [record('c')], nextCursor: null }), 'c1')
    assert.deepEqual(feed.records.map((r) => r.id), ['a', 'b', 'c'])
    assert.equal(feed.exhausted, true)
    assert.equal(canLoadMore(feed), false)
    assert.equal(feed.pages, 2)
  })

  it('offers no "load more" before the first page has been fetched', () => {
    // `EMPTY_FEED` has a null cursor and is not exhausted; without the page count, that reads as
    // "there is more" and the button appears above an empty list.
    assert.equal(canLoadMore(EMPTY_FEED), false)
  })
})

describe('hazard 1: a record arriving twice', () => {
  it('folds a repeated id in once', () => {
    // Duplicate React keys are the visible symptom; the reader counting one transaction twice is
    // the actual cost.
    let feed = appendPage(EMPTY_FEED, page({ records: [record('a'), record('b')], nextCursor: 'c1' }), null)
    feed = appendPage(feed, page({ records: [record('b'), record('c')], nextCursor: 'c2' }), 'c1')
    assert.deepEqual(feed.records.map((r) => r.id), ['a', 'b', 'c'])
  })

  it('keeps the FIRST copy, so a row does not move when a later page repeats it', () => {
    const first = record('b')
    const later = { ...record('b'), summary: 'Rewritten' }
    let feed = appendPage(EMPTY_FEED, page({ records: [first], nextCursor: 'c1' }), null)
    feed = appendPage(feed, page({ records: [later], nextCursor: null }), 'c1')
    assert.equal(feed.records.length, 1)
    assert.equal(feed.records[0]?.summary, 'Deposit b')
  })

  it('does not allocate a new array when a page adds nothing', () => {
    // Identity matters: a new array on every no-op page re-renders the whole list for nothing.
    const feed = appendPage(EMPTY_FEED, page({ records: [record('a')], nextCursor: 'c1' }), null)
    const again = appendPage(feed, page({ records: [record('a')], nextCursor: null }), 'c1')
    assert.equal(again.records, feed.records)
  })
})

describe('hazard 2: a server that echoes the cursor', () => {
  it('stops rather than paging for ever', () => {
    // Handed back the cursor it just spent, "load more" would fetch the same page until the tab
    // died. Treating it as the end is the only reading that terminates.
    const feed = appendPage(EMPTY_FEED, page({ records: [record('a')], nextCursor: 'c1' }), 'c1')
    assert.equal(feed.cursor, null)
    assert.equal(feed.exhausted, true)
    assert.equal(canLoadMore(feed), false)
  })

  it('does not mistake a genuinely new cursor for an echo', () => {
    const feed = appendPage(EMPTY_FEED, page({ records: [record('a')], nextCursor: 'c2' }), 'c1')
    assert.equal(feed.cursor, 'c2')
    assert.equal(feed.exhausted, false)
  })
})

describe('hazard 3: an unavailable page', () => {
  it('keeps the records already held and does NOT fold in the empty array', () => {
    // hub-api answers 200 with `status: 'unavailable'` and `records: []` when activity is down.
    // Folding that in is how an outage reads as a quiet week.
    const loaded = appendPage(EMPTY_FEED, page({ records: [record('a'), record('b')], nextCursor: 'c1' }), null)
    const degraded = appendPage(
      loaded,
      page({ records: [], nextCursor: null, status: 'unavailable', reason: 'activity answered 503' }),
      'c1',
    )
    assert.equal(degraded.records.length, 2, 'the good records survive')
    assert.equal(degraded.status, 'unavailable')
    assert.equal(degraded.reason, 'activity answered 503')
  })

  it('does not declare the feed exhausted because a page failed', () => {
    // `nextCursor: null` on an unavailable page means "we have nothing", not "there is no more".
    const loaded = appendPage(EMPTY_FEED, page({ records: [record('a')], nextCursor: 'c1' }), null)
    const failed = appendPage(loaded, page({ status: 'unavailable', nextCursor: null }), 'c1')
    assert.equal(failed.exhausted, false)
    assert.equal(failed.cursor, 'c1', 'the cursor is still spendable on a retry')
  })

  it('does not count an unavailable answer as a page', () => {
    const failed = appendPage(EMPTY_FEED, page({ status: 'unavailable' }), null)
    assert.equal(failed.pages, 0)
    assert.equal(failed.records.length, 0)
  })
})

describe('hazard 4: an empty page that is not the end', () => {
  it('keeps walking when the page is empty but the cursor is not null', () => {
    // Activity filters by visibility, so a page can legitimately come back with nothing in it.
    // Stopping on emptiness would hide everything behind the first invisible record.
    const feed = appendPage(EMPTY_FEED, page({ records: [], nextCursor: 'c2' }), 'c1')
    assert.equal(feed.exhausted, false)
    assert.equal(canLoadMore(feed), true)
  })
})

describe('degraded and cached pages', () => {
  it('carries a degraded status and its reason through without dropping the records', () => {
    const feed = appendPage(
      EMPTY_FEED,
      page({
        records: [record('a')],
        nextCursor: null,
        status: 'degraded',
        reason: 'activity did not answer within its deadline; showing a cached value',
        cached: true,
        ageMs: 4200,
      }),
      null,
    )
    assert.equal(feed.records.length, 1)
    assert.equal(feed.status, 'degraded')
    assert.equal(feed.cached, true)
    assert.equal(feed.ageMs, 4200)
  })
})

describe('feedSummary', () => {
  it('says whether there is more, because "247 entries" alone is ambiguous', () => {
    const partial: FeedState = { ...EMPTY_FEED, records: [record('a'), record('b')], pages: 1, cursor: 'c1' }
    assert.equal(feedSummary(partial), '2 entries so far, and there are more')

    const whole: FeedState = { ...partial, exhausted: true, cursor: null }
    assert.equal(feedSummary(whole), '2 entries, the whole history')
  })

  it('agrees with itself in the singular', () => {
    const one: FeedState = { ...EMPTY_FEED, records: [record('a')], pages: 1, exhausted: true }
    assert.equal(feedSummary(one), '1 entry, the whole history')
  })

  it('says nothing rather than "0 entries"', () => {
    assert.equal(feedSummary(EMPTY_FEED), 'Nothing yet')
  })
})
