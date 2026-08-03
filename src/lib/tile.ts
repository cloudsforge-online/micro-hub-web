/**
 * The tile, as the client sees it.
 *
 * hub-api's central idea, restated here because the whole of this app's behaviour hangs off it.
 * `hub-api/src/tiles.ts` (lines 34-62) defines three statuses and one guarantee:
 *
 *   - `ok`          — a fresh answer. Possibly a cache hit inside its TTL, in which case
 *                     `cached` is true and `ageMs` says how old it is.
 *   - `degraded`    — data, but not current data. A stale cache entry served through an outage,
 *                     or a portfolio with balances and no prices. Always with a reason.
 *   - `unavailable` — nothing. `data` still holds the tile's EMPTY value, so a client renders an
 *                     empty state rather than branching on null.
 *
 * > "**`data` is never null and never absent.** An optional field is a field every consumer
 * > forgets to check; an empty array is a field that renders correctly by accident. The tile's
 * > own `status` is the single place a client asks whether to draw a warning."
 *
 * That last sentence is the contract this file exists to honour. The three helpers below are the
 * only place in this bundle that reads `tile.status`, so the three cannot be handled
 * inconsistently on eight pages.
 *
 * ── The one thing a client must not do with an unavailable tile ────────────────────────────────
 *
 * Render its `data` as though it were an answer. An `unavailable` wallets tile carries `[]`, and
 * `[]` drawn without its status reads as "you have no wallets" — a confident, wrong statement
 * about somebody's money, produced by a client that was handed the truth and dropped it.
 * `hasAnswer()` is the guard, and every list on every page goes through it.
 */

export type TileStatus = 'ok' | 'degraded' | 'unavailable'

export interface Tile<T> {
  readonly status: TileStatus
  /** Which service this tile came from — `wallet`, `ledger`, `identity+policy`. */
  readonly upstream: string
  /** Present exactly when the status is not `ok`. Never an upstream response body. */
  readonly reason: string | null
  readonly cached: boolean
  readonly ageMs: number | null
  readonly data: T
}

/**
 * Did this tile answer at all?
 *
 * `degraded` counts as an answer: it has data, and the data is right as far as it goes. What it
 * does not have is confidence, and that is what `TilePanel` renders the note for.
 */
export function hasAnswer(tile: Tile<unknown> | null | undefined): boolean {
  return tile !== null && tile !== undefined && tile.status !== 'unavailable'
}

/** A tile that did not answer, reduced to what a panel needs in order to say so. */
export interface Absence {
  readonly upstream: string
  readonly reason: string
}

/**
 * The absence behind an unavailable tile, or null when the tile answered.
 *
 * ── Why the panels that take a LIST need this as well as the list ──────────────────────────────
 *
 * `hasAnswer()` is the guard for a panel that renders the tile itself — `TilePanel` draws no
 * content for an unavailable tile and names the upstream instead. It is not enough for the two
 * panels that take a DERIVED list as a plain prop: `SendPanel` receives `holdings` and
 * `KeyExportPanel` receives `wallets`, and `hasAnswer(tile) ? tile.data : []` collapses "the
 * ledger did not answer" and "you hold nothing" into the same empty array on the way in.
 *
 * Both then said so out loud — "There is no balance to send", "There is no managed wallet to
 * export" — which is the header's own rule broken by the two screens that can least afford it:
 * "an `unavailable` wallets tile carries `[]`, and `[]` drawn without its status reads as 'you
 * have no wallets' — a confident, wrong statement about somebody's money, produced by a client
 * that was handed the truth and dropped it."
 *
 * The empty array still goes down, because a Send form with nothing to send is a Send form with
 * nothing to send either way. What travels with it is WHY it is empty, so the sentence can be the
 * true one. `test/journeys.test.ts` BJ-WAL-07 asserts the two sentences are different.
 */
export function absenceOf(tile: Tile<unknown> | null | undefined): Absence | null {
  if (tile === null || tile === undefined) return null
  if (tile.status !== 'unavailable') return null
  return { upstream: tile.upstream, reason: tile.reason ?? `${tile.upstream} did not answer` }
}

/** Everything a panel header needs in order to say how much to trust what is under it. */
export interface TileNote {
  /** Whether to draw a note at all. False for a fresh, uncached, `ok` tile. */
  readonly show: boolean
  readonly status: TileStatus
  /** The sentence. Never invented here — it is hub-api's `reason`, or the cache age. */
  readonly text: string
  /** `unavailable` is an alert; `degraded` and a cache age are status. */
  readonly tone: 'info' | 'warning'
}

/**
 * What to say about a tile.
 *
 * A cached-but-`ok` tile still gets a note, quietly. hub-api carries `ageMs` on every cache hit
 * for exactly one reason — so a reader can tell a number fetched now from a number fetched three
 * seconds ago — and a client that receives that field and drops it has re-created the problem the
 * field was added to solve.
 */
export function tileNote(tile: Tile<unknown>, ageWords: (ms: number | null) => string | null): TileNote {
  if (tile.status === 'unavailable') {
    return {
      show: true,
      status: 'unavailable',
      tone: 'warning',
      text: tile.reason ?? `${tile.upstream} did not answer`,
    }
  }
  if (tile.status === 'degraded') {
    return {
      show: true,
      status: 'degraded',
      tone: 'warning',
      text: tile.reason ?? `${tile.upstream} answered, but not with current data`,
    }
  }
  const age = tile.cached ? ageWords(tile.ageMs) : null
  return age === null
    ? { show: false, status: 'ok', tone: 'info', text: '' }
    : { show: true, status: 'ok', tone: 'info', text: `from cache, ${age}` }
}

/**
 * One sentence naming what the page is missing, from the `degraded[]` list hub-api computes.
 *
 * The banner it feeds is the difference between "the dashboard is broken" and "the dashboard is
 * here, minus the wallet panel". Rule 5 of design-system §6 makes the second an exit criterion,
 * and a page that degrades correctly but says nothing about it looks exactly like one that did
 * not fetch anything.
 */
export function degradedSentence(names: readonly string[]): string | null {
  const listed = [...names].filter((n) => n.length > 0).sort()
  if (listed.length === 0) return null
  const readable = listed.map(readableTileName)
  const last = readable[readable.length - 1] ?? ''
  const body =
    readable.length === 1 ? last : `${readable.slice(0, -1).join(', ')} and ${last}`
  return readable.length === 1
    ? `${body} is not showing current data. Everything else on this page is.`
    : `${body} are not showing current data. Everything else on this page is.`
}

/** The tile keys hub-api uses, in the words a reader would use. Unknown keys pass through. */
const TILE_NAMES: Readonly<Record<string, string>> = {
  portfolio: 'the portfolio',
  prices: 'prices',
  wallets: 'the wallet list',
  deposits: 'incoming deposits',
  withdrawals: 'withdrawals',
  activity: 'activity',
  security: 'account security',
  restrictions: 'account restrictions',
  entitlements: 'entitlements',
  alerts: 'security alerts',
  notifications: 'notifications',
}

export function readableTileName(key: string): string {
  return TILE_NAMES[key] ?? key
}
