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
import { hasAnswer, tileNote, type Tile, type TileStatus } from '../lib/tile.ts'

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
 * The same three-way honesty, for hub-api's FLAT paged responses.
 *
 * `/v1/activity`, `/v1/conversions` and `/v1/transfers` are the routes that are not `Tile<T>`:
 * they put `status`, `reason`, `cached` and `ageMs` beside the records at the top level, because a
 * cursor and a tile envelope do not compose. `TilePanel` therefore cannot draw them, and each of
 * the three screens wrote the banner out by hand — which is precisely the "seven different
 * opinions about what `degraded` looks like" this file's header exists to prevent, arrived at from
 * the other direction.
 *
 * ── THE ONE THAT MATTERS IS `unavailable` ─────────────────────────────────────────────────────
 *
 * hub-api answers 200 with an EMPTY LIST when the upstream is down, so an unavailable page and an
 * account that has never done anything are the same array. Rendering the first as the second is
 * how an outage reads as a quiet week, on the three screens that are somebody's financial history.
 * `partial` is the second half of that: a feed that already holds records from an earlier page has
 * shown the reader something true, and telling them they can see nothing would be its own lie.
 */
export function FeedStatus({
  page,
  fallbackReason,
  partial = false,
}: {
  page: {
    readonly status: TileStatus
    readonly reason: string | null
    readonly cached: boolean
    readonly ageMs: number | null
  }
  /** What to say when the service went quiet without saying why. Name the list, not "data". */
  fallbackReason: string
  /** True when records from an earlier page are already on screen beneath this banner. */
  partial?: boolean | undefined
}) {
  if (page.status === 'unavailable') {
    return (
      <p className="wt-banner wt-banner--degraded" role="alert">
        <span className="wt-banner__icon" aria-hidden="true">
          ▲
        </span>
        {page.reason ?? fallbackReason}{' '}
        {partial
          ? 'What you can see below reached us before it went quiet, so treat it as partial.'
          : 'We could read none of it, which is a different thing entirely from nothing having happened.'}
      </p>
    )
  }
  if (page.status === 'degraded') {
    return (
      <p className="wt-banner wt-banner--degraded" role="status">
        <span className="wt-banner__icon" aria-hidden="true">
          ▲
        </span>
        {page.reason ?? 'What follows is behind. Something newer may have happened since.'}
      </p>
    )
  }
  const age = page.cached ? ageLabel(page.ageMs) : null
  if (age) return <p className="wt-note">Held over from an earlier read, {age}.</p>
  return null
}

/**
 * A fact this app cannot show, and why.
 *
 * Used wherever a screen has a region the estate does not yet serve — notification preferences,
 * an external wallet nothing in this bundle can ask to sign. It exists so that "not built" is
 * visibly different from "empty" and from "failed", which is the same three-way distinction
 * `components/states.tsx` makes for a request, applied to a capability.
 *
 * The alternative — omitting the region — is worse in the specific way hub-api's `notifications`
 * tile used to document: "a client given no tile at all shows nothing and nobody notices the
 * feature is missing". That tile has since been composed, and its own history is the caveat to
 * keep with this component: a stated hole is only honest while it stays a hole. hub-api's
 * `notifications` tile said "not composed" for months, in the voice of a degraded tile, and so
 * every Overview in the estate carried an incident banner about a feature that was working
 * upstream the whole time (micro-org #415). Use this for a capability that does not exist; never
 * for one nobody has got round to wiring.
 *
 * It has now happened twice. The Wallet page carried a "Transfers and conversions" hole saying
 * neither had anywhere to list a result — true when it was written, and the reason micro-org#496
 * exists. `micro-wallet` grew both read routes, hub-api composed them, and the paragraph outlived
 * the hole by long enough to become the thing telling readers a shipped feature was missing. When
 * you write one of these, write down what would have to become true for it to be deleted.
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
