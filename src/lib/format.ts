/**
 * Turning what hub-api sends into what a person reads — without ever going through a float.
 *
 * ── Money is a decimal STRING all the way to the DOM ───────────────────────────────────────────
 *
 * Every monetary field in hub-api's responses is a decimal string, and `hub-api/src/portfolio.ts`
 * says why in its header: "a float rate applied to an 18-decimal amount loses precision in the
 * least significant digits, which is exactly where a reconciliation drift shows up". A frontend
 * that does `Number(holding.usd)` to add a thousands separator has thrown away the property the
 * whole chain of BigInt arithmetic behind it existed to preserve. So the formatters below are
 * STRING operations: split on the dot, group the integer half, cut the fraction. Nothing here
 * calls `parseFloat`, `Number()` or `toLocaleString` on an amount.
 *
 * ── Truncation, never rounding ─────────────────────────────────────────────────────────────────
 *
 * A fraction longer than the display precision is CUT, not rounded. Rounding £0.999 up to £1.00
 * shows a user a penny they do not have, and a balance that reads higher than it is, is the one
 * rounding error nobody forgives. Cutting understates by less than the last displayed digit,
 * which is the safe direction.
 *
 * ── A missing value is missing ─────────────────────────────────────────────────────────────────
 *
 * Every function here returns `null` for absent or malformed input, and no caller may turn that
 * into `0`. `wallet/src/pricingclient.ts`: "an asset absent from it means 'no usable price'
 * rather than zero. A zero would be a valuation, and a valuation of zero is a lie about a holding
 * that exists." The UI renders the holding without a value instead — `StatTile` takes
 * `value: string | null` for exactly this reason.
 *
 * ── Times are UTC, with a fixed locale ─────────────────────────────────────────────────────────
 *
 * The same timestamp must read identically on a developer's machine, in CI and in a screenshot
 * attached to a bug report. A stamp rendered in the viewer's zone makes two people reading the
 * same portfolio disagree about when it was priced, which is the one thing a pricing stamp exists
 * to settle.
 */

/** Anything that is not `-?digits(.digits)?`. Rejected rather than coerced. */
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/

export interface DecimalOptions {
  /** Digits after the point. Longer fractions are CUT; shorter ones are padded to `minDecimals`. */
  maxDecimals?: number | undefined
  /** Pad the fraction out to this length. USD wants 2; a token amount wants 0 and trims. */
  minDecimals?: number | undefined
}

/**
 * Group an integer digit string in threes. Pure string work — `12345678` → `12,345,678`.
 *
 * Written out rather than delegated to `Intl.NumberFormat`, which takes a `number` and therefore
 * silently rounds anything past 2^53 — which a balance in smallest units routinely is.
 */
export function groupDigits(digits: string): string {
  let out = ''
  for (let i = 0; i < digits.length; i += 1) {
    // Separator before every third digit counted from the RIGHT, and never leading.
    const fromRight = digits.length - i
    if (i > 0 && fromRight % 3 === 0) out += ','
    out += digits[i]
  }
  return out
}

/**
 * Format a decimal string for display.
 *
 * Returns null — not '0' and not '—' — when there is nothing to format. The caller decides what
 * absence looks like, because "no price yet" and "could not load" are different sentences and
 * this function knows neither.
 */
export function formatDecimal(
  value: string | null | undefined,
  options: DecimalOptions = {},
): string | null {
  if (value === null || value === undefined) return null
  const match = DECIMAL.exec(value.trim())
  if (!match) return null

  const sign = match[1] ?? ''
  const whole = match[2] ?? '0'
  const fraction = match[3] ?? ''

  const max = options.maxDecimals ?? 2
  const min = options.minDecimals ?? 0
  // Cut, do not round. See the header.
  let shown = fraction.slice(0, max)
  // Trim to the minimum, then pad up to it: '1.2500' with min 2 is '1.25', '1.2' with min 2 is
  // '1.20', and '1.000' with min 0 is '1'.
  while (shown.length > min && shown.endsWith('0')) shown = shown.slice(0, -1)
  while (shown.length < min) shown += '0'

  const grouped = groupDigits(whole)
  // '-0' is not a number anybody wants to read. It happens whenever a small negative is cut away.
  const body = shown.length > 0 ? `${grouped}.${shown}` : grouped
  if (sign === '-' && /^[0.,]*$/.test(body)) return body
  return `${sign}${body}`
}

/** A USD figure, always two decimal places. Null in, null out. */
export function formatUsd(value: string | null | undefined): string | null {
  const formatted = formatDecimal(value, { maxDecimals: 2, minDecimals: 2 })
  return formatted === null ? null : `$${formatted}`
}

/**
 * A token amount. Up to eight decimals and no padding — EMBER has eighteen and a dashboard row
 * showing all of them is a column nobody can scan.
 */
export function formatAmount(value: string | null | undefined): string | null {
  return formatDecimal(value, { maxDecimals: 8, minDecimals: 0 })
}

/**
 * Basis points as a percentage. `allocationBps` is an integer from hub-api, so this one genuinely
 * is integer arithmetic and not a money value.
 */
export function formatBps(bps: number | null | undefined): string | null {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return null
  const whole = Math.trunc(bps / 100)
  const tenths = Math.abs(bps % 100)
  return `${whole}.${String(Math.trunc(tenths / 10))}%`
}

/**
 * An address or a transaction hash, shortened for a list.
 *
 * Both ends are kept: the head identifies the chain and the tail is what a user actually compares
 * against the one on their device. A truncation that keeps only the head lets two different
 * addresses look identical, which on a withdrawal screen is how money goes to the wrong place.
 */
export function shortHash(text: string | null | undefined, head = 8, tail = 4): string | null {
  if (!text) return null
  if (text.length <= head + tail + 1) return text
  return `${text.slice(0, head)}…${text.slice(-tail)}`
}

/** `14:22` UTC, fixed locale. Null for anything unparseable. */
export function utcTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return at.toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** `14 Mar 14:22` UTC, for a feed where the day matters. */
export function utcDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const date = at.toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short' })
  return `${date} ${utcTime(iso)}`
}

/**
 * The pricing stamp, rendered beside any valuation.
 *
 * `undefined` rather than null, because it is spread into `StatTile`'s optional `pricedAt` and
 * under `exactOptionalPropertyTypes` an explicit `undefined` is not the same as an absent key.
 *
 * `hub-api/src/portfolio.ts` guarantees this instant is the OLDEST contributing observation, not
 * the newest and not now, so a total valued from one two-second-old quote and one four-minute-old
 * quote is stamped four minutes old. Displaying it unmodified is the whole of rule 1 of §6.
 */
export function pricedStamp(iso: string | null | undefined): string | undefined {
  const time = utcTime(iso)
  return time === null ? undefined : `priced ${time} UTC`
}

/** The per-quote stamp on one holding's own row. */
export function quotedStamp(iso: string | null | undefined): string | null {
  const time = utcTime(iso)
  return time === null ? null : `as of ${time} UTC`
}

/**
 * How old a cached tile is, in words.
 *
 * Shown wherever a tile reports `cached: true`. A number served from cache and a number fetched
 * for this request look identical on screen unless one of them says so, and hub-api goes to the
 * trouble of carrying `ageMs` precisely so that a client can.
 */
export function ageLabel(ageMs: number | null | undefined): string | null {
  if (ageMs === null || ageMs === undefined || !Number.isFinite(ageMs) || ageMs < 0) return null
  const seconds = Math.floor(ageMs / 1000)
  if (seconds < 1) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

/**
 * A confirmation count as `41/60`, or the bare count when the depth is unknown.
 *
 * hub-api emits `progress: null` for a chain whose depth policy this build does not know, and the
 * reason is in `nextactions.ts`: "'41/0' is worse than '41 confirmations'". This mirrors it rather
 * than inventing a denominator.
 */
export function confirmationLabel(done: number, total: number | null): string {
  return total === null || total <= 0 ? `${done} confirmations` : `${done}/${total} confirmations`
}
