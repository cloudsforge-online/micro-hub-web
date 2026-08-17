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
 * The UTC day an instant falls in, as a grouping key.
 *
 * `2026-08-17`, sortable and comparable, and UTC for the same reason every other clock in this
 * file is: a feed grouped by the reader's local midnight would put one record under two different
 * headings for two readers looking at the same account.
 */
export function utcDay(iso: string | null | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return at.toISOString().slice(0, 10)
}

/** `17 August 2026` UTC — the heading over one day of a feed. */
export function utcDayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return at.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
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

/* ══════════════════════════════ smallest units ══════════════════════════════ */

/**
 * How many decimal places an asset has, DERIVED from a balance the server already sent.
 *
 * ── Why this is derived and not looked up ──────────────────────────────────────────────────────
 *
 * `micro-wallet` takes an amount in SMALLEST UNITS and nothing else — "amount must be a
 * non-negative integer in smallest units, as a string" (`wallet/src/server.ts`). A
 * person types `0.5`. Something has to know that EMBER has eighteen decimals and XRP has six.
 *
 * That table is `@cloudsforge/contracts-chain`, and this bundle cannot have it: adding the
 * dependency means a second sibling checkout in the Docker build and in CI, and this app's CI is
 * not something this change may touch. hub-api knows the answer internally
 * (`hub-api/src/portfolio.ts`) and publishes it in no response. Writing the table out
 * here would be a second, unversioned copy of a contract — the exact defect class that has cost
 * this estate three wrong dev ports and a client for a route nobody serves.
 *
 * So it is recovered from the pair the dashboard ALREADY sends for every holding: `amount` in
 * smallest units and `amountFormatted` in human units, both produced from the same value by
 * `formatAmount(units, decimals)` in contracts-chain. For a fixed human string, `parse(text, d)`
 * is strictly increasing in `d`, so AT MOST ONE `d` reproduces `amount` — the answer is unique
 * where it exists, and this returns null where it does not rather than guessing:
 *
 *   - a zero balance, where every scale reproduces `0`. Ambiguous, and unsendable anyway.
 *   - a `TOKEN:` asset, whose `amountFormatted` is null because nothing in the fan-out knows its
 *     decimals either (`hub-api/src/portfolio.ts`).
 *
 * A null answer is not a dead end: the form falls back to asking for smallest units, which is
 * what the API takes and is never wrong. It is worse to read and impossible to misinterpret.
 */
export function scaleOf(amount: string | null | undefined, formatted: string | null | undefined): number | null {
  if (typeof amount !== 'string' || typeof formatted !== 'string') return null
  if (!/^\d+$/.test(amount.trim())) return null
  const units = BigInt(amount.trim())
  // Zero is reproduced by every scale, so no scale is established by it.
  if (units === 0n) return null
  // 30 covers every chain in the estate with room to spare; the largest is 18.
  for (let decimals = 0; decimals <= 30; decimals += 1) {
    const parsed = toBaseUnits(formatted, decimals)
    if (parsed !== null && parsed === units) return decimals
  }
  return null
}

/**
 * A human decimal string to smallest units, exactly.
 *
 * BigInt throughout, never a float: `0.1 * 1e18` in IEEE 754 is `100000000000000000.00000001`,
 * and the difference is real money in the least significant digits — the same reason
 * `hub-api/src/portfolio.ts` does all of its arithmetic this way.
 *
 * Returns null for anything that is not a plain non-negative decimal, and for a fraction longer
 * than the asset can hold. It does NOT round a too-long fraction down: silently dropping a digit
 * off an amount somebody typed is how a person sends a different number from the one they meant.
 */
export function toBaseUnits(text: string | null | undefined, decimals: number): bigint | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim().replace(/,/g, '')
  const match = /^(\d*)(?:\.(\d*))?$/.exec(trimmed)
  if (!match) return null
  const whole = match[1] ?? ''
  const fraction = match[2] ?? ''
  if (whole === '' && fraction === '') return null
  if (fraction.length > decimals) return null
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) return null
  return BigInt(`${whole === '' ? '0' : whole}${fraction.padEnd(decimals, '0')}`)
}
