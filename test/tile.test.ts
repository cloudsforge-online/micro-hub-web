/**
 * Reading a tile's status, which is the one field a client must not ignore.
 *
 * hub-api: "**`data` is never null and never absent.** An optional field is a field every consumer
 * forgets to check; an empty array is a field that renders correctly by accident. The tile's own
 * `status` is the single place a client asks whether to draw a warning."
 *
 * The consequence is the first test below. An `unavailable` wallets tile carries `[]`, and `[]`
 * rendered without its status reads as "you have no wallets" — a confident, wrong statement about
 * somebody's money, produced by a client that was handed the truth and dropped it.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ageLabel } from '../src/lib/format.ts'
import { degradedSentence, hasAnswer, readableTileName, tileNote, type Tile } from '../src/lib/tile.ts'

const tile = <T>(over: Partial<Tile<T>> & { data: T }): Tile<T> => ({
  status: 'ok',
  upstream: 'wallet',
  reason: null,
  cached: false,
  ageMs: null,
  ...over,
})

describe('hasAnswer', () => {
  it('is false for an unavailable tile even though its data is a perfectly good empty array', () => {
    const dead = tile<readonly string[]>({
      status: 'unavailable',
      reason: 'wallet answered 503',
      data: [],
    })
    assert.equal(dead.data.length, 0, 'the empty value is present, as hub-api guarantees')
    assert.equal(hasAnswer(dead), false, 'and it must not be rendered as an answer')
  })

  it('is TRUE for a degraded tile: it has data, and the data is right as far as it goes', () => {
    // Blanking a degraded portfolio would throw away every amount, which was never in doubt —
    // only the valuation was.
    assert.equal(hasAnswer(tile({ status: 'degraded', reason: 'no usable price', data: [1] })), true)
  })

  it('is false for a tile that is not there at all', () => {
    assert.equal(hasAnswer(null), false)
    assert.equal(hasAnswer(undefined), false)
  })
})

describe('tileNote', () => {
  it('draws nothing for a fresh, uncached, ok tile', () => {
    assert.equal(tileNote(tile({ data: [] }), ageLabel).show, false)
  })

  it('says so, quietly, when an ok tile came from cache', () => {
    // hub-api carries `ageMs` on every cache hit for exactly one reason: so a reader can tell a
    // number fetched now from a number fetched three seconds ago.
    const note = tileNote(tile({ data: [], cached: true, ageMs: 4_000 }), ageLabel)
    assert.equal(note.show, true)
    assert.equal(note.tone, 'info', 'a cache age is not an alert; announcing it as one is noise')
    assert.equal(note.text, 'from cache, 4s ago')
  })

  it('warns with hub-api’s own reason for a degraded tile', () => {
    const note = tileNote(
      tile({ status: 'degraded', reason: 'pricing did not answer within its deadline', data: [] }),
      ageLabel,
    )
    assert.equal(note.tone, 'warning')
    assert.equal(note.text, 'pricing did not answer within its deadline')
  })

  it('never invents a reason, but is never silent either', () => {
    // hub-api sets a reason on every non-ok tile. If one ever arrives without, the note still has
    // to say something — an unavailable panel with no explanation is a blank space.
    const note = tileNote(tile({ status: 'unavailable', reason: null, upstream: 'ledger', data: [] }), ageLabel)
    assert.equal(note.show, true)
    assert.equal(note.tone, 'warning')
    assert.equal(note.text, 'ledger did not answer')
  })
})

describe('degradedSentence', () => {
  it('is null when nothing is degraded, so no banner is drawn', () => {
    assert.equal(degradedSentence([]), null)
  })

  it('names one tile in the singular', () => {
    assert.equal(
      degradedSentence(['wallets']),
      'the wallet list is not showing current data. Everything else on this page is.',
    )
  })

  it('names several, in a stable order, and closes with "and"', () => {
    // Sorted rather than left in hub-api's key order: a banner whose wording shuffles between two
    // loads of the same broken state reads as two different problems.
    assert.equal(
      degradedSentence(['wallets', 'activity', 'prices']),
      'activity, prices and the wallet list are not showing current data. Everything else on this page is.',
    )
    assert.equal(degradedSentence(['prices', 'activity', 'wallets']), degradedSentence(['wallets', 'activity', 'prices']))
  })

  it('says what else is fine, which is the half that makes a degraded page usable', () => {
    assert.match(degradedSentence(['prices']) ?? '', /Everything else on this page is\.$/)
  })

  it('passes an unknown tile key through rather than dropping it', () => {
    // A tile added to hub-api that this bundle has no word for must still be named. Dropping it
    // would mean a degraded page that claims everything is fine.
    assert.match(degradedSentence(['newtile']) ?? '', /^newtile is not showing/)
    assert.equal(readableTileName('newtile'), 'newtile')
  })
})
