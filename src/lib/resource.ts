/**
 * One fetch, four states.
 *
 * Every screen in the estate needs the same four-way answer — loading, empty, failed, forbidden —
 * and every screen that computes it by hand eventually gets one of the cases wrong: an empty
 * array rendered for a timeout, or a 403 rendered as a retryable error. The decision is made once
 * here, as a pure function, so the wrong version cannot be written a seventh time.
 */
import { useCallback, useEffect, useState } from 'react'
import { noticeFor, type ErrorNotice } from './api.ts'

export type ResourceState = 'loading' | 'ok' | 'empty' | 'failed' | 'forbidden'

/**
 * Which state a resource is in.
 *
 * FAILURE OUTRANKS EMPTINESS, in both directions. A request that threw has told us nothing about
 * whether data exists, so reporting "nothing here" for a timeout is how an outage reads as a
 * quiet week. And a 403 outranks a generic failure, because the two have different remedies.
 */
export function resourceState(opts: {
  loading: boolean
  error: ErrorNotice | null
  count: number | null
}): ResourceState {
  if (opts.error) return opts.error.forbidden ? 'forbidden' : 'failed'
  if (opts.loading) return 'loading'
  if (opts.count === null) return 'loading'
  return opts.count > 0 ? 'ok' : 'empty'
}

export interface Resource<T> {
  state: ResourceState
  data: T | null
  error: ErrorNotice | null
  reload: () => void
}

/**
 * Run `load` on mount and on demand, and reduce the outcome to one of the four states.
 *
 * `count` exists because "empty" is a property of the DATA, not of the response: an object with
 * an empty list inside it is a 200 that should render the empty state.
 */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  count: (data: T) => number,
  fallbackMessage: string,
): Resource<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ErrorNotice | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    load(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        setData(value)
        setLoading(false)
      })
      .catch((err: unknown) => {
        // An abort is this component going away, not a failure. Rendering the failed state for it
        // is how a fast double-navigation leaves an error on a screen nobody is looking at.
        if (controller.signal.aborted) return
        setError(noticeFor(err, fallbackMessage))
        setLoading(false)
      })
    return () => controller.abort()
    // `load` is recreated every render by most callers, so it is deliberately not a dependency;
    // `nonce` is what re-runs this, and it changes only when reload() is called.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return {
    state: resourceState({ loading, error, count: data === null ? null : count(data) }),
    data,
    error,
    reload,
  }
}
