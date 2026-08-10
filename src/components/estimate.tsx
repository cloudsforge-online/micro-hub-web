/**
 * The statement that goes beside a fiat figure no market ever agreed to.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * EMBER has no exchange listing. Its USD figure is a number an operator typed into
 * `PUT /admin/prices/:asset` and pricing labels it `source: "administered"` for exactly that
 * reason — "a conversion settled against an administered price was priced by a person, not by a
 * market" (`pricing/src/migrations.ts`). Until this component existed, that label travelled from
 * pricing as far as hub-api and stopped: a reader saw "$12,480.00" against a balance of EMBER and
 * had nothing on the page telling them it was not a price anyone would pay.
 *
 * That is the same class of defect `pool-web/src/components/notices.tsx` was written for — a
 * screen implying a value that has no mechanism behind it — so this follows its three rules:
 *
 *   * **PRESENT TENSE, NO SCHEDULE.** "not yet listed" describes a date that does not exist.
 *   * **NO NUMBER IN THE STATEMENT.** The figure beside it is the only number in view; the
 *     statement's job is to say what kind of number that is, not to offer a second one.
 *   * **DERIVED FROM THE API.** The condition is `priceSource === 'administered'`, and the asset
 *     names in the sentence are the assets that reported it. Nothing here knows the string
 *     `'EMBER'`, so nothing here can be wrong about it. See `lib/portfolio.ts`.
 *
 * ── AND WHY IT IS NOT A TOOLTIP ───────────────────────────────────────────────────────────────
 *
 * A hover tooltip fails three readers at once: a keyboard user who never hovers, a touch user who
 * has no hover, and a screen-reader user for whom `title` is inconsistently announced. So the
 * statement is ORDINARY VISIBLE TEXT, in document order ahead of the figures it qualifies, on
 * every render where an estimate is present. There is nothing to open, so there is nothing that
 * can be unreachable.
 *
 * What remains is the association — which of the figures on screen the statement is about — and
 * that is `aria-describedby` from the value itself to the statement, the pattern
 * `ui/packages/ui/src/mining.tsx` uses for the mining control's per-state description. A sighted
 * reader gets the same association from the `estimate` marker beside the figure, which is a WORD
 * rather than a colour or an icon, so it survives being read aloud, printed, or copied.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { estimateNotice } from '../lib/portfolio.ts'

/**
 * The standing statement. Renders nothing when no figure on the page is an estimate — an absent
 * note and a note saying "none of these is an estimate" are different claims, and only the first
 * is true of a portfolio that happens to hold nothing administered today.
 *
 * `id` comes from the page rather than from `useId` here, because the elements that point at it
 * live in a different component and a different section of the page.
 */
export function EstimateNotice({ id, assets }: { id: string; assets: readonly string[] }) {
  const notice = estimateNotice(assets)
  if (notice === null) return null
  return (
    // Not `role="alert"` and not a live region, for the reason `pool-web`'s notice gives: this is a
    // standing property of the asset, true on first paint, not an event that has just happened. An
    // alert would interrupt a reader mid-sentence to announce something that was already the case.
    <p className="wt-note wt-note--caveat wt-note--estimate" id={id}>
      {notice}
    </p>
  )
}

/**
 * The marker beside one estimated figure.
 *
 * One word, lower case, in the flow of the cell. It is not an asterisk: a footnote mark sends a
 * reader hunting for a matching mark somewhere below, and the sentence it would send them to is
 * four lines up the page.
 */
export function EstimateMark() {
  return <span className="wt-estimate"> estimate</span>
}
