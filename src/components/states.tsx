/**
 * The four states a screen can be in, as four visibly different things.
 *
 * They are separated because collapsing any two of them destroys information the user needs:
 *
 *   LOADING   — we do not know yet. Waiting is the correct action.
 *   EMPTY     — the query answered, with nothing. Nothing is wrong; there is something to DO.
 *   FAILED    — the query did not answer. Retrying may work. The request id is what support needs.
 *   FORBIDDEN — the query was understood and refused. Retrying will never work, and the honest
 *               response is to say who to ask, not to offer a button that cannot succeed.
 *
 * A spinner that never resolves, an empty list that was actually a timeout, and a "no results"
 * that was actually a missing scope are the three failures this file exists to prevent.
 */
import type { ReactNode } from 'react'
import type { ErrorNotice } from '../lib/api.ts'

// Every optional prop is spelled `?: T | undefined`. Under `exactOptionalPropertyTypes` those are
// two different types, and only the second one accepts the `value ?? undefined` a caller writes
// when it may or may not have something to pass.
export function Loading({ label = 'Loading' }: { label?: string | undefined }) {
  return (
    <div className="wt-state wt-state--loading" role="status" aria-live="polite">
      <span className="wt-spinner" aria-hidden="true" />
      <p className="wt-state__title">{label}</p>
    </div>
  )
}

export function Empty({
  title,
  hint,
  action,
}: {
  /** Say what was asked and found nothing. "No data" describes the screen, not the answer. */
  title: string
  hint?: string | undefined
  action?: ReactNode | undefined
}) {
  return (
    <div className="wt-state wt-state--empty" role="status">
      <span className="wt-state__icon" aria-hidden="true">
        ◇
      </span>
      <p className="wt-state__title">{title}</p>
      {hint && <p className="wt-state__hint">{hint}</p>}
      {action && <div className="wt-state__action">{action}</div>}
    </div>
  )
}

/**
 * A failure, with the request id on screen.
 *
 * The id is what the user quotes and what finds their exact request across every service at once.
 * It is rendered in the monospace token and made selectable on its own line, because it is going
 * to be read aloud down a phone line or pasted into a support form, and a `cf-1a2b…` embedded
 * mid-sentence is neither.
 */
export function Failed({
  notice,
  onRetry,
  title = 'That did not load',
}: {
  notice: ErrorNotice
  onRetry?: (() => void) | undefined
  title?: string | undefined
}) {
  return (
    <div className="wt-state wt-state--failed" role="alert">
      <span className="wt-state__icon" aria-hidden="true">
        ■
      </span>
      <p className="wt-state__title">{title}</p>
      <p className="wt-state__hint">{notice.message}</p>
      {notice.requestId && (
        <p className="wt-state__meta">
          Quote this to support:{' '}
          <code className="cf-num wt-reqid">{notice.requestId}</code>
        </p>
      )}
      {onRetry && (
        <div className="wt-state__action">
          <button type="button" className="cf-btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Refused, not broken.
 *
 * No retry button: the request was understood and denied, and a button that cannot succeed is a
 * button that teaches the user the app is unreliable. The request id is still shown — an
 * unexpected 403 is usually a misconfigured scope, and that is diagnosed from the server side.
 */
export function Forbidden({
  notice,
  title = 'You do not have access to this',
}: {
  notice?: ErrorNotice | undefined
  title?: string | undefined
}) {
  return (
    <div className="wt-state wt-state--forbidden" role="alert">
      <span className="wt-state__icon" aria-hidden="true">
        ⊘
      </span>
      <p className="wt-state__title">{title}</p>
      <p className="wt-state__hint">
        {notice?.message ?? 'Your account is missing the role this page needs.'} Ask an
        administrator to grant it.
      </p>
      {notice?.requestId && (
        <p className="wt-state__meta">
          Reference: <code className="cf-num wt-reqid">{notice.requestId}</code>
        </p>
      )}
    </div>
  )
}
