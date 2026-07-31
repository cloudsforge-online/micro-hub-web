/**
 * A panel that tells the truth about the tile inside it.
 *
 * hub-api answers 200 with holes rather than 500 on a fault, and every hole names itself. That is
 * only worth anything if the client draws the name. This component is the single place that
 * decides how, so eleven tiles on seven pages cannot end up with seven different opinions about
 * what `degraded` looks like.
 *
 * Three renderings, and the middle one is the one that is easy to get wrong:
 *
 *   ok           — the panel, and a quiet "from cache, 4s ago" when the tile says it was cached.
 *   degraded     — the panel WITH ITS CONTENT, above a warning that says what is not current.
 *                  Hiding the content here would be the mistake: a portfolio with balances and no
 *                  prices still has every amount right, and blanking it throws away the part that
 *                  was never in doubt.
 *   unavailable  — no content at all, because there is none. The reason, and nothing that looks
 *                  like an answer. There is deliberately NO retry button: hub-api has already
 *                  retried, the breaker may be open, and a button that hammers a struggling peer
 *                  from every open dashboard in the estate is the cascade the tile design exists
 *                  to prevent. Reloading the page is the retry.
 */
import type { ReactNode } from 'react'
import { ageLabel } from '../lib/format.ts'
import { hasAnswer, tileNote, type Tile } from '../lib/tile.ts'

export function TilePanel({
  title,
  tile,
  children,
  empty,
  action,
}: {
  title: string
  tile: Tile<unknown>
  /** Rendered for `ok` and for `degraded`. Never for `unavailable`. */
  children: ReactNode
  /** Shown when the tile answered with nothing. Say what was asked, not "no data". */
  empty?: ReactNode | undefined
  /** A link out of the panel — "Everything →". Suppressed when there is nothing to go and see. */
  action?: ReactNode | undefined
}) {
  const note = tileNote(tile, ageLabel)
  const answered = hasAnswer(tile)

  return (
    <section className="wt-panel">
      <header className="wt-panel__head">
        <h2 className="wt-panel__title">{title}</h2>
        {answered && action}
      </header>

      {note.show && <TileNoteLine note={note} upstream={tile.upstream} />}

      {answered ? (children ?? empty) : null}
    </section>
  )
}

function TileNoteLine({
  note,
  upstream,
}: {
  note: ReturnType<typeof tileNote>
  upstream: string
}) {
  // `role="alert"` only for the warning tone. A cache age announced as an alert to a screen reader
  // on every page load is noise, and noise is how a real alert stops being heard.
  return (
    <p
      className={`wt-tilenote wt-tilenote--${note.status}`}
      role={note.tone === 'warning' ? 'alert' : 'status'}
    >
      <span className="wt-tilenote__icon" aria-hidden="true">
        {note.status === 'unavailable' ? '■' : note.status === 'degraded' ? '▲' : '◷'}
      </span>
      {/* The upstream is named because "the wallet panel is missing" and "wallet is down" are
          different facts, and only the second one tells an operator where to look. */}
      <span>
        {note.status === 'unavailable' ? `${upstream} did not answer. ` : ''}
        {note.text}
      </span>
    </p>
  )
}

/**
 * The page-level banner: what is missing from THIS page, in one sentence.
 *
 * Built from hub-api's own `degraded[]` rather than by walking the tiles here, because that array
 * is computed from the same object that produced the tiles and cannot disagree with them.
 */
export function DegradedBanner({ sentence }: { sentence: string | null }) {
  if (sentence === null) return null
  return (
    <p className="wt-banner wt-banner--degraded" role="status">
      <span className="wt-banner__icon" aria-hidden="true">
        ▲
      </span>
      {sentence}
    </p>
  )
}

/**
 * A fact this app cannot show, and why.
 *
 * Used wherever a screen has a region the estate does not yet serve — notification preferences,
 * transfers, conversions. It exists so that "not built" is visibly different from "empty" and
 * from "failed", which is the same three-way distinction `components/states.tsx` makes for a
 * request, applied to a capability.
 *
 * The alternative — omitting the region — is worse in the specific way hub-api's own
 * `notifications` tile documents: "a client given no tile at all shows nothing and nobody notices
 * the feature is missing" (dashboard.ts:588-589).
 */
export function NotComposed({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="wt-panel wt-panel--hole">
      <header className="wt-panel__head">
        <h2 className="wt-panel__title">{title}</h2>
        <span className="wt-chip wt-chip--hole">not composed</span>
      </header>
      <div className="wt-note">{children}</div>
    </section>
  )
}
