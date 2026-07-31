/**
 * Two independent reads, and neither one may take the other down.
 *
 * hub-api degrades per tile because "one slow upstream must cost one tile, not the page". A page
 * that needs a second source — the Security page needs identity's session list, which hub-api
 * does not compose — recreates the problem in the browser the moment it writes
 * `Promise.all([dashboard, sessions])`: `Promise.all` rejects on the first rejection, so identity
 * being unwell would blank a page whose other half arrived intact. That is the same failure the
 * BFF was designed to prevent, moved one layer out and made invisible.
 *
 * `Promise.allSettled` is the fix and this file is the shape of it: each read becomes a value OR a
 * notice, never both and never neither, and the page renders whichever halves it got.
 */
import { noticeFor, type ErrorNotice } from './api.ts'

/** One read's outcome. A discriminated pair, so a caller cannot forget to check the error. */
export type Settled<T> = { readonly value: T; readonly error: null } | { readonly value: null; readonly error: ErrorNotice }

/**
 * Reduce a settled promise to a value or a notice.
 *
 * `fallback` is the sentence shown when the rejection is not an `ApiError` — a bug in this bundle
 * rather than a server response — and `noticeFor` reports that case to Lantern, because nothing
 * server-side has logged it.
 */
export function settle<T>(result: PromiseSettledResult<T>, fallback: string): Settled<T> {
  return result.status === 'fulfilled'
    ? { value: result.value, error: null }
    : { value: null, error: noticeFor(result.reason, fallback) }
}

/**
 * Run two reads concurrently and settle both.
 *
 * Concurrently, not in sequence: they are independent, and awaiting one before starting the other
 * makes the slower one's latency additive for no reason. This is the same "the budget is the
 * slowest read, not the sum" that hub-api's fan-out is built on.
 */
export async function settleBoth<A, B>(
  first: Promise<A>,
  second: Promise<B>,
  fallbacks: { first: string; second: string },
): Promise<{ first: Settled<A>; second: Settled<B> }> {
  const [a, b] = await Promise.allSettled([first, second])
  return {
    first: settle(a as PromiseSettledResult<A>, fallbacks.first),
    second: settle(b as PromiseSettledResult<B>, fallbacks.second),
  }
}

/**
 * Did EVERYTHING fail?
 *
 * The one case where a page-level failure state is honest. With one half in hand there is
 * something to show and something to say about the rest; with neither there is nothing but the
 * error, and pretending otherwise is a blank page with a heading on it.
 */
export function allFailed(...results: readonly Settled<unknown>[]): boolean {
  return results.length > 0 && results.every((r) => r.error !== null)
}

/** The first notice, for the page-level failure state. Null when at least one read succeeded. */
export function firstNotice(...results: readonly Settled<unknown>[]): ErrorNotice | null {
  for (const result of results) {
    if (result.error !== null) return result.error
  }
  return null
}
