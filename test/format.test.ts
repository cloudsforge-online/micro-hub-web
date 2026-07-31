/**
 * Formatting, which in this app is a correctness concern rather than a cosmetic one.
 *
 * Every monetary value in hub-api's responses is a decimal STRING, because the arithmetic behind
 * it is BigInt and "a float rate applied to an 18-decimal amount loses precision in the least
 * significant digits, which is exactly where a reconciliation drift shows up". The one way a
 * frontend can undo all of that is `Number(holding.usd)` in a formatter, so the tests below pin
 * the two properties that make `lib/format.ts` safe:
 *
 *   1. A value larger than `Number.MAX_SAFE_INTEGER` survives intact. This is the test that fails
 *      the moment somebody reaches for `Intl.NumberFormat`, which takes a number.
 *   2. A fraction longer than the display precision is CUT, never rounded. Rounding £0.999 up to
 *      £1.00 shows a user a penny they do not have.
 *
 * And the third, which is the estate's rule rather than this file's: absence stays absent. Every
 * formatter returns null for missing input, so that a caller physically cannot render a zero.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  ageLabel,
  confirmationLabel,
  formatAmount,
  formatBps,
  formatDecimal,
  formatUsd,
  groupDigits,
  pricedStamp,
  quotedStamp,
  shortHash,
  utcDateTime,
  utcTime,
} from '../src/lib/format.ts'
import { removeWindow } from './browser-stubs.ts'

afterEach(removeWindow)

describe('groupDigits', () => {
  it('groups in threes from the right', () => {
    assert.equal(groupDigits('1'), '1')
    assert.equal(groupDigits('123'), '123')
    assert.equal(groupDigits('1234'), '1,234')
    assert.equal(groupDigits('1234567'), '1,234,567')
  })

  it('never leads with a separator', () => {
    // The off-by-one that produces ',123' is the reason this is its own assertion.
    assert.equal(groupDigits('123456'), '123,456')
  })
})

describe('formatDecimal', () => {
  it('carries a value far past 2^53 without losing a digit', () => {
    // 18-decimal EMBER in smallest units. `Number()` cannot hold this, and a formatter that goes
    // through one silently returns 1,234,567,890,123,456,800 — a different amount of money.
    const raw = '1234567890123456789'
    assert.equal(formatDecimal(raw, { maxDecimals: 0 }), '1,234,567,890,123,456,789')
    assert.notEqual(String(Number(raw)), '1234567890123456789')
  })

  it('CUTS the fraction rather than rounding it', () => {
    // 0.999 must not become 1.00. Understating by less than the last displayed digit is the safe
    // direction; overstating a balance is the one rounding error nobody forgives.
    assert.equal(formatDecimal('0.999', { maxDecimals: 2, minDecimals: 2 }), '0.99')
    assert.equal(formatDecimal('12.34999', { maxDecimals: 2, minDecimals: 2 }), '12.34')
  })

  it('pads to the minimum and trims past it', () => {
    assert.equal(formatDecimal('1.2', { maxDecimals: 2, minDecimals: 2 }), '1.20')
    assert.equal(formatDecimal('1.2500', { maxDecimals: 8, minDecimals: 0 }), '1.25')
    assert.equal(formatDecimal('1.000', { maxDecimals: 8, minDecimals: 0 }), '1')
  })

  it('drops the sign when a small negative truncates away to zero', () => {
    // '-0.00' is not a number anybody wants to read on a balance sheet.
    assert.equal(formatDecimal('-0.001', { maxDecimals: 2, minDecimals: 2 }), '0.00')
    assert.equal(formatDecimal('-4.5', { maxDecimals: 2, minDecimals: 2 }), '-4.50')
  })

  it('returns null for anything that is not a decimal, rather than coercing it', () => {
    for (const bad of ['', 'abc', '1.2.3', '1e6', '0x10', ' ', 'NaN', 'Infinity', '1,000']) {
      assert.equal(formatDecimal(bad), null, `${bad} must not format`)
    }
    assert.equal(formatDecimal(null), null)
    assert.equal(formatDecimal(undefined), null)
  })
})

describe('formatUsd', () => {
  it('always shows two decimal places', () => {
    assert.equal(formatUsd('12480'), '$12,480.00')
    assert.equal(formatUsd('12480.2'), '$12,480.20')
    assert.equal(formatUsd('12480.229'), '$12,480.22')
  })

  it('is null for a missing price, and NEVER $0.00', () => {
    // The whole rule, in one assertion. A holding with no usable quote arrives with `usd: null`,
    // and "a valuation of zero is a lie about a holding that exists".
    assert.equal(formatUsd(null), null)
    assert.equal(formatUsd(undefined), null)
    // A genuine zero still formats: an account that holds nothing is a different fact.
    assert.equal(formatUsd('0'), '$0.00')
  })
})

describe('formatAmount', () => {
  it('shows up to eight decimals and trims trailing zeros', () => {
    assert.equal(formatAmount('1.500000000000000000'), '1.5')
    assert.equal(formatAmount('0.123456789'), '0.12345678')
    assert.equal(formatAmount('42'), '42')
  })

  it('is null for an absent amount', () => {
    assert.equal(formatAmount(null), null)
  })
})

describe('formatBps', () => {
  it('renders basis points as a percentage to one decimal', () => {
    assert.equal(formatBps(4200), '42.0%')
    assert.equal(formatBps(1), '0.0%')
    assert.equal(formatBps(10_000), '100.0%')
  })

  it('is null for an unpriced holding, whose share of an unknown total is not a number', () => {
    assert.equal(formatBps(null), null)
    assert.equal(formatBps(undefined), null)
    assert.equal(formatBps(Number.NaN), null)
  })
})

describe('shortHash', () => {
  it('keeps BOTH ends, so two different addresses cannot look identical', () => {
    const a = 'ember1qzzzzzzzzzzzzzzzzzzzzzzzzzz4f2'
    const b = 'ember1qzzzzzzzzzzzzzzzzzzzzzzzzzz9k7'
    assert.notEqual(shortHash(a), shortHash(b))
    assert.equal(shortHash(a), 'ember1qz…z4f2')
    // Head-only truncation is what this guards against: it makes the two above identical.
    assert.equal(a.slice(0, 8), b.slice(0, 8))
  })

  it('leaves a string that is already short alone', () => {
    assert.equal(shortHash('0xabc'), '0xabc')
  })

  it('is null for a missing address', () => {
    assert.equal(shortHash(null), null)
    assert.equal(shortHash(''), null)
  })
})

describe('timestamps', () => {
  it('renders UTC regardless of the machine running it', () => {
    // 23:30 UTC is the NEXT day in Sydney and the same day in London. A stamp that moved with the
    // reader would make two people looking at one portfolio disagree about when it was priced.
    assert.equal(utcTime('2026-03-14T23:30:00.000Z'), '23:30')
    assert.equal(utcDateTime('2026-03-14T23:30:00.000Z'), '14 Mar 23:30')
  })

  it('is null for an unparseable instant rather than "Invalid Date"', () => {
    assert.equal(utcTime('not a date'), null)
    assert.equal(utcTime(null), null)
    assert.equal(utcDateTime(undefined), null)
  })

  it('gives pricedStamp as undefined, which is what an optional prop needs', () => {
    // `StatTile.pricedAt` is `?: string`, and under exactOptionalPropertyTypes an explicit
    // `undefined` is a different type from an absent key. Returning null here would not spread.
    assert.equal(pricedStamp(null), undefined)
    assert.equal(pricedStamp('2026-03-14T14:22:00.000Z'), 'priced 14:22 UTC')
  })

  it('distinguishes the summary stamp from a single quote stamp', () => {
    // Two different numbers on the portfolio page: the summary carries the OLDEST contributing
    // observation, each row carries its own. Different words so they cannot be confused.
    assert.equal(pricedStamp('2026-03-14T14:22:00.000Z'), 'priced 14:22 UTC')
    assert.equal(quotedStamp('2026-03-14T14:26:00.000Z'), 'as of 14:26 UTC')
    assert.equal(quotedStamp(null), null)
  })
})

describe('ageLabel', () => {
  it('says how stale a cached tile is, in units a reader can act on', () => {
    assert.equal(ageLabel(0), 'just now')
    assert.equal(ageLabel(4_000), '4s ago')
    assert.equal(ageLabel(90_000), '1 min ago')
    assert.equal(ageLabel(7_200_000), '2h ago')
  })

  it('is null when the tile was not cached, so no note is drawn', () => {
    assert.equal(ageLabel(null), null)
    assert.equal(ageLabel(undefined), null)
    assert.equal(ageLabel(-1), null)
  })
})

describe('confirmationLabel', () => {
  it('omits the denominator when the depth policy is unknown', () => {
    // hub-api does the same, and for the stated reason: "41/0 is worse than 41 confirmations".
    assert.equal(confirmationLabel(41, null), '41 confirmations')
    assert.equal(confirmationLabel(41, 0), '41 confirmations')
    assert.equal(confirmationLabel(41, 60), '41/60 confirmations')
  })
})
