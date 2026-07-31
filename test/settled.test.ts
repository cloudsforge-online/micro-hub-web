/**
 * Two independent reads, and the rule that neither may take the other down.
 *
 * The Security page needs identity's session list, which hub-api does not compose, alongside the
 * dashboard tiles that it does. `Promise.all` would reject on the first rejection, so identity
 * being unwell would blank a page whose other half arrived intact — the same failure hub-api's
 * per-tile design prevents on the server, recreated in the browser and made invisible.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { ApiError, __resetAuth } from '../src/lib/api.ts'
import { __resetObs } from '../src/lib/obs.ts'
import { allFailed, firstNotice, settle, settleBoth } from '../src/lib/settled.ts'
import { installStorage, installWindow, removeStorage, removeWindow } from './browser-stubs.ts'

beforeEach(() => {
  installWindow('http://localhost:5180/')
  installStorage()
  __resetAuth()
})

afterEach(() => {
  // `noticeFor` reports non-ApiError rejections, and the reporter batches on a timer.
  __resetObs()
  removeStorage()
  removeWindow()
})

describe('settle', () => {
  it('turns a fulfilled read into a value with no error', () => {
    const result = settle({ status: 'fulfilled', value: 42 }, 'nope')
    assert.equal(result.value, 42)
    assert.equal(result.error, null)
  })

  it('carries an ApiError’s own message and request id onto the notice', () => {
    const rejected: PromiseSettledResult<number> = {
      status: 'rejected',
      reason: new ApiError(503, 'identity is unavailable', 'upstream', 'req-9f2'),
    }
    const result = settle(rejected, 'Could not load your sessions.')
    assert.equal(result.value, null)
    assert.equal(result.error?.message, 'identity is unavailable')
    assert.equal(result.error?.requestId, 'req-9f2')
    assert.equal(result.error?.forbidden, false)
  })

  it('marks a 403 as forbidden, which is a different screen from a failure', () => {
    const result = settle(
      { status: 'rejected', reason: new ApiError(403, 'missing scope', undefined, 'req-403') },
      'nope',
    )
    assert.equal(result.error?.forbidden, true)
  })

  it('falls back to the caller’s sentence for a rejection that is not an ApiError', () => {
    // A TypeError here is a bug in this bundle rather than a server response, which is why
    // `noticeFor` reports it: nothing server-side has logged it.
    const result = settle({ status: 'rejected', reason: new TypeError('x.y is not a function') }, 'Could not load your sessions.')
    assert.equal(result.error?.message, 'Could not load your sessions.')
    assert.equal(result.error?.requestId, undefined)
  })
})

describe('settleBoth', () => {
  it('keeps the half that arrived when the other rejects', async () => {
    const { first, second } = await settleBoth(
      Promise.resolve({ tiles: 11 }),
      Promise.reject(new ApiError(503, 'identity is unavailable')),
      { first: 'a', second: 'b' },
    )
    assert.deepEqual(first.value, { tiles: 11 })
    assert.equal(second.value, null)
    assert.equal(second.error?.message, 'identity is unavailable')
  })

  it('keeps the half that arrived when the FIRST rejects — the direction is not special', async () => {
    const { first, second } = await settleBoth(
      Promise.reject(new ApiError(500, 'hub-api fell over')),
      Promise.resolve({ sessions: [] }),
      { first: 'a', second: 'b' },
    )
    assert.equal(first.value, null)
    assert.deepEqual(second.value, { sessions: [] })
  })

  it('runs the two concurrently rather than one after the other', async () => {
    // Awaiting one before starting the other makes the slower one's latency additive for no
    // reason. Observed through start order, which is what "started before the first resolved"
    // actually means.
    const started: string[] = []
    const slow = new Promise<string>((resolve) => {
      started.push('slow')
      setTimeout(() => resolve('slow'), 10)
    })
    const quick = new Promise<string>((resolve) => {
      started.push('quick')
      resolve('quick')
    })
    await settleBoth(slow, quick, { first: 'a', second: 'b' })
    assert.deepEqual(started, ['slow', 'quick'])
  })
})

describe('allFailed and firstNotice', () => {
  it('is true only when there is nothing at all left to render', async () => {
    const both = await settleBoth(
      Promise.reject(new ApiError(500, 'hub-api fell over')),
      Promise.reject(new ApiError(503, 'identity is unavailable')),
      { first: 'a', second: 'b' },
    )
    assert.equal(allFailed(both.first, both.second), true)
    assert.equal(firstNotice(both.first, both.second)?.message, 'hub-api fell over')
  })

  it('is false while any half is in hand, so the page renders rather than showing an error', async () => {
    const both = await settleBoth(
      Promise.resolve(1),
      Promise.reject(new ApiError(503, 'identity is unavailable')),
      { first: 'a', second: 'b' },
    )
    assert.equal(allFailed(both.first, both.second), false)
    assert.equal(firstNotice(both.first, both.second)?.message, 'identity is unavailable')
  })

  it('is false for no results at all, rather than vacuously true', () => {
    // `[].every()` is true, and a page-level failure state drawn because nothing was asked for is
    // a blank page with a heading on it.
    assert.equal(allFailed(), false)
    assert.equal(firstNotice(), null)
  })
})
