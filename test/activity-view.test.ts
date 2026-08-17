/**
 * The Activity page, after micro-org#482 — *"it is just text"*.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS FOR, AND WHAT IT REFUSES TO DO
 *
 * The redesign makes four claims a screenshot cannot keep true:
 *
 *   1. **Every type the estate can emit has a shape here.** `activity/src/classify.ts` maps its
 *      registered topics onto 79 `type` values. A row whose type this bundle has never been taught
 *      still has to render, and a row whose type it HAS been taught must not render as the raw
 *      identifier. Both are asserted below against a list transcribed from the SERVICE.
 *   2. **A row says more than its sentence.** `identity.session.created` carries `deviceId` where
 *      `classify.ts` reads `device`, so every sign-in in the estate is summarised as the four words
 *      `Signed in.` — which is the second half of #482 in one line. A row built on the summary is
 *      therefore a row that says nothing, and `detailFor` is the countermeasure.
 *   3. **A row carrying money names its network.** §3: *"mainnet and testnet rows in one
 *      undifferentiated list is how somebody misreads a testnet amount as real."*
 *   4. **The empty state is an invitation.** §4.
 *
 * ── THE TWO SELF-REFERENTIAL SHAPES `journeys.test.ts` BANS ARE BANNED HERE TOO ───────────────
 *
 * Every string this file asserts on screen was put into the fixture by this file, or transcribed
 * from a service outside this repository. Nothing below imports a display constant from `src/` and
 * checks the page equals it — a test written that way is green for every possible value, including
 * the wrong one, and this estate has already shipped one of those.
 *
 * The one deliberate exception is the completeness pair: `EMITTED` is transcribed from
 * `activity/src/classify.ts` and compared with `KINDS` in BOTH directions. That is a comparison of
 * two independent transcriptions of one external fact, which is the opposite of a value compared
 * with itself — it is exactly how the two drift apart that the pair is there to catch.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes, type Screen } from './dom.ts'
import { __resetAuth } from '../src/lib/api.ts'
import { ActivityPage, groupByDay } from '../src/pages/activity.tsx'
import { GLYPHS, KINDS, LENSES, carriesMoney, detailFor, inLens, kindOf } from '../src/lib/activitykind.ts'
import type { ActivityRecord } from '../src/lib/hub.ts'

/**
 * The two estates, named by HOSTNAME rather than by calling `setViewedNetwork`.
 *
 * `viewedNetwork()` answers `viewed ?? deploymentNetwork()`, and `deploymentNetwork()` is
 * `currentNetwork()` — read off `window.location.hostname` at render, inside the mount. Driving
 * the network from the address the browser is at therefore needs no module state at all: nothing
 * is set, so nothing has to be reset, and no scenario in this file can leak a network into the
 * next one. (`viewed` stays null throughout: it is initialised from `?net=` at import, when there
 * is no window, and this file never sets it.)
 */
const MAINNET = 'https://hub.cloudsforge.online'
const TESTNET = 'https://hub-testnet.cloudsforge.online'

const fresh = (): void => __resetAuth()

/** The two shared token keys, for a scenario that starts signed in. `lib/api.ts`. */
const SIGNED_IN = { 'cf.accessToken': 'held-access-token', 'cf.refreshToken': 'held-refresh-token' }

/**
 * Every `type` value `activity/src/classify.ts` can assign, transcribed from the service.
 *
 * Sixty-one are literals in its classifier table and eighteen more come out of the ten `type:
 * (event) => …` branches, which pick between two values on a payload field. Seventy-nine in total,
 * which is the number the service's own header states.
 *
 * This is a TRANSCRIPTION and not an import: `micro-activity` is a separate repository and this
 * bundle cannot depend on it (nor should it — the estate's frontends do not import service code).
 * Two transcriptions of one table can disagree, and the pair of tests below is what notices.
 */
const EMITTED: readonly string[] = Object.freeze([
  'account.deleted',
  'account.email_verification_requested',
  'account.registered',
  'aetherholm.battle_resolved',
  'aetherholm.building_completed',
  'aetherholm.city_founded',
  'aetherholm.research_completed',
  'aetherholm.season_opened',
  'aetherholm.season_sealed',
  'aetherholm.skerry_provisioned',
  'aetherholm.spire_captured',
  'api.key_issued',
  'api.key_revoked',
  'api.key_revoked_by_platform',
  'billing.entitlement_granted',
  'billing.entitlement_revoked',
  'community.ward_opened',
  'deposit.address_assigned',
  'deposit.confirmed',
  'deposit.token_uncredited',
  'emberkin.achievement_unlocked',
  'emberkin.battle_resolved',
  'emberkin.cosmetic_equipped',
  'emberkin.reward_granted',
  'emberkin.save_started',
  'emberkin.season_started',
  'governance.proposal_executed',
  'governance.proposal_opened',
  'governance.vote_cast',
  'market.listing_sold',
  'market.offer_made',
  'market.venue_booked',
  'ownership.object_anchored',
  'ownership.object_fired',
  'ownership.parcel_claimed',
  'ownership.parcel_contested',
  'ownership.parcel_lost',
  'ownership.parcel_transferred',
  'security.device_added',
  'security.key_export_requested',
  'security.key_exported',
  'security.mfa_added',
  'security.mfa_removed',
  'security.password_reset_requested',
  'security.session_created',
  'security.session_revoked',
  'security.signed_out',
  'token.deploy_confirmed',
  'token.deploy_funding_requested',
  'trading.bot_created',
  'trading.bot_paused',
  'trading.bot_started',
  'trading.bot_started_paper',
  'trading.fee_settled',
  'trading.fee_settled_partial',
  'trading.fill_settled',
  'trading.order_bought',
  'trading.order_sold',
  'transfer.entry_posted',
  'transfer.exchange_deposit',
  'transfer.exchange_withdrawal',
  'wallet.authorisation_revoked',
  'wallet.created',
  'wallet.link_revoked',
  'wallet.link_verified',
  'wallet.reconciliation_completed',
  'wallet.sweep_completed',
  'withdrawal.completed',
  'withdrawal.failed_held',
  'withdrawal.failed_refunded',
  'withdrawal.outbound_confirmed',
  'withdrawal.refunded',
  'withdrawal.requested',
  'withdrawal.stuck',
  'withdrawal.stuck_no_settlement',
  'worlds.provision_completed',
  'worlds.provision_failed',
  'worlds.reward_granted',
  'worlds.title_registered',
])

/**
 * The sixteen categories, transcribed from `activity/src/categories.ts`, plus its quarantine.
 *
 * The service's own note: the set "is closed — a seventeenth would appear in a filter menu the
 * frontend derives from this list". This is that frontend, and `unclassified` is the seventeenth
 * value the column may hold, which is why it is here and separate.
 */
const CATEGORIES: readonly string[] = Object.freeze([
  'account',
  'security',
  'wallet',
  'deposit',
  'withdrawal',
  'transfer',
  'conversion',
  'token',
  'ownership',
  'trading',
  'market',
  'reward',
  'community',
  'governance',
  'api',
  'billing',
])

const record = (over: Partial<ActivityRecord> & { readonly id: string }): ActivityRecord => ({
  userId: 'user-1',
  occurredAt: '2026-08-14T14:02:00.000Z',
  category: 'deposit',
  type: 'deposit.confirmed',
  subjectUrn: 'urn:cf:deposit:dep-1',
  summary: 'A deposit was credited.',
  amount: null,
  assetCode: null,
  product: 'wallet',
  visibility: 'user',
  ...over,
})

/** The page under a router, with the feed the scenario supplies. */
const feedPage = (
  records: readonly ActivityRecord[],
  over: Record<string, unknown> = {},
  origin: string = MAINNET,
) => ({
  element: h(MemoryRouter, { initialEntries: ['/activity'] }, h(ActivityPage)),
  options: {
    url: `${origin}/activity`,
    storage: SIGNED_IN,
    routes: {
      'GET /v1/activity': {
        body: { records, nextCursor: null, status: 'ok', reason: null, cached: false, ageMs: null, ...over },
      },
    } as Routes,
  },
})

/** The text of the one `<li>` whose title is `title`. Rows are list items, not divs. */
function row(s: Screen, title: string): string {
  const found = s.allByRole('listitem').filter((li) => s.textOf(li).includes(title))
  assert.equal(found.length, 1, `expected exactly one row saying "${title}", found ${found.length}`)
  return s.textOf(found[0])
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   1. Every type has a shape, and nothing has a shape the estate cannot produce.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('every row type the estate can emit', () => {
  it('has a title that is not the identifier, a tone with a glyph, and no full stop', () => {
    for (const type of EMITTED) {
      const shape = kindOf(record({ id: type, type, category: type.split('.')[0] as string }))
      assert.ok(shape.title.length > 0, `${type} renders with no title at all`)
      assert.notEqual(
        shape.title,
        type,
        `${type} renders as its own identifier, which is the "just text" defect with extra dots`,
      )
      assert.ok(
        Object.prototype.hasOwnProperty.call(GLYPHS, shape.tone),
        `${type} has tone "${shape.tone}", which has no glyph — colour would be the only channel`,
      )
      // Sentence case, no full stop: the title is a headline and the detail line under it is the
      // sentence. Two full stops stacked reads as one paragraph broken in half.
      assert.ok(!shape.title.endsWith('.'), `${type} ends its title with a full stop`)
    }
  })

  it('is in the table — all 79, in both directions', () => {
    const known = Object.keys(KINDS)
    const missing = EMITTED.filter((type) => !known.includes(type))
    assert.deepEqual(missing, [], 'the estate emits these and this bundle draws them as a fallback')
    const invented = known.filter((type) => !EMITTED.includes(type))
    assert.deepEqual(invented, [], 'this bundle has shapes for types no service can produce')
    assert.equal(known.length, EMITTED.length)
  })

  it('lands in exactly one narrow lens, so no row is unreachable by the filter', () => {
    // A row that no lens contains can be shown the ABSENCE of and never the presence: filter to
    // Money and it is missing, filter to Products and it is missing, and the reader concludes it
    // never happened. `unclassified` is in this list on purpose — it is the seventeenth value the
    // column may hold, and it must fall somewhere rather than out.
    for (const category of [...CATEGORIES, 'unclassified', 'a-category-invented-tomorrow']) {
      const one = record({ id: category, category, type: 'nothing.this.bundle.knows' })
      const narrow = LENSES.filter((lens) => lens.id !== 'all' && inLens(one, lens.id))
      assert.equal(
        narrow.length,
        1,
        `"${category}" is in ${narrow.length} lenses (${narrow.map((l) => l.label).join(', ') || 'none'})`,
      )
      assert.ok(inLens(one, 'all'), `"${category}" is missing from Everything`)
    }
  })

  it('falls back to the category, and then to something readable, rather than to a blank row', () => {
    // A service shipped after this bundle emits a type the table has never seen. The row must still
    // read — a blank title on a money row is worse than a vague one.
    const future = kindOf(record({ id: 'x', type: 'deposit.some_future_topic', category: 'deposit' }))
    assert.ok(future.title.length > 0)
    assert.notEqual(future.title, 'deposit.some_future_topic')

    const wholly = kindOf(record({ id: 'y', type: 'nobody.knows', category: 'nobody-knows' }))
    assert.ok(wholly.title.length > 0, 'an unrecognised category renders a blank row')
    assert.notEqual(wholly.title, 'nobody.knows')
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   2. "More information except 'signed in'". The second half of #482.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('a row says more than the sentence it arrived with', () => {
  it('does not print "Signed in" twice in two type sizes', () => {
    // The exact record the estate produces. `identity.session.created` carries `deviceId` — a UUID
    // — where `activity/src/classify.ts` reads `device`, so the classifier falls back to this
    // string for EVERY sign-in in the estate and drops the `ipPrefix` that IS on the payload.
    const signIn = record({
      id: 'sess-1',
      category: 'security',
      type: 'security.session_created',
      summary: 'Signed in.',
      product: 'identity',
    })
    const shape = kindOf(signIn)
    const detail = detailFor(signIn, shape)

    assert.notEqual(detail, signIn.summary, 'the row repeats its own title as its detail')
    assert.ok(detail !== null && detail.length > shape.title.length, 'the row adds nothing')
    // And what it says is worth the space: the standing meaning of a sign-in, with the move to
    // make if it was not you.
    assert.match(detail, /sign-in/i)
  })

  it('keeps the service’s sentence whenever the service said something the title did not', () => {
    const carried = 'Deposit of 0.5 ETH credited after 12 confirmations.'
    const credited = record({ id: 'dep-1', summary: carried })
    assert.equal(
      detailFor(credited, kindOf(credited)),
      carried,
      'a summary carrying a fact the title cannot was thrown away',
    )
  })

  it('is not fooled by a trailing full stop or a difference in case', () => {
    // The de-duplication has to survive the two ways one string is written twice, or half the
    // estate's rows get their own title back as a second line.
    const shouted = record({ id: 'so-1', category: 'security', type: 'security.signed_out', summary: 'SIGNED OUT' })
    assert.notEqual(detailFor(shouted, kindOf(shouted)), 'SIGNED OUT')
  })

  it('stands on the title alone rather than inventing a sentence', () => {
    // `trading.bot_created` has no standing meaning worth a line, and this module has no payload to
    // read a fact out of. Null is the honest answer; a generic sentence would be filler.
    const bare = record({ id: 'bot-1', category: 'trading', type: 'trading.bot_created', summary: '' })
    assert.equal(detailFor(bare, kindOf(bare)), null)
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   3. The day is a heading, not a prefix repeated two hundred times.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('grouping a feed into days', () => {
  it('keeps the order the service sent, and splits on the UTC day', () => {
    const feed = [
      record({ id: 'a', occurredAt: '2026-08-14T23:59:59.000Z' }),
      record({ id: 'b', occurredAt: '2026-08-14T00:00:00.000Z' }),
      record({ id: 'c', occurredAt: '2026-08-13T22:00:00.000Z' }),
    ]
    const days = groupByDay(feed)
    assert.equal(days.length, 2, 'three records over two UTC days did not make two groups')
    assert.deepEqual(days[0]?.records.map((r) => r.id), ['a', 'b'])
    assert.deepEqual(days[1]?.records.map((r) => r.id), ['c'])
    // NOT re-sorted. activity's keyset is `(occurred_at, id)` descending and re-sorting here would
    // be this bundle asserting an ordering the service already owns.
    assert.deepEqual(days.flatMap((d) => d.records.map((r) => r.id)), ['a', 'b', 'c'])
  })

  it('re-opens a day rather than merging two runs of it', () => {
    // Out-of-order input is the service's business, not this function's. Merging would silently
    // move a row up the page past rows that happened after it.
    const days = groupByDay([
      record({ id: 'a', occurredAt: '2026-08-14T10:00:00.000Z' }),
      record({ id: 'b', occurredAt: '2026-08-13T10:00:00.000Z' }),
      record({ id: 'c', occurredAt: '2026-08-14T09:00:00.000Z' }),
    ])
    assert.equal(days.length, 3)
  })

  it('heads an unreadable timestamp rather than dropping the row', () => {
    const days = groupByDay([record({ id: 'a', occurredAt: 'not-a-timestamp' })])
    assert.equal(days.length, 1)
    assert.equal(days[0]?.records.length, 1, 'a row with a broken clock vanished off the page')
    assert.equal(days[0]?.label, 'Undated')
  })

  it('makes no groups out of nothing', () => {
    assert.deepEqual(groupByDay([]), [])
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   4. The page itself.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('the rendered feed', () => {
  it('puts the date in one heading and leaves the rows a clock time', async () => {
    fresh()
    const { element, options } = feedPage([
      record({ id: 'a', occurredAt: '2026-08-14T14:02:00.000Z', summary: 'The first thing.' }),
      record({ id: 'b', occurredAt: '2026-08-14T09:30:00.000Z', summary: 'The second thing.' }),
      record({ id: 'c', occurredAt: '2026-08-13T18:15:00.000Z', summary: 'The third thing.' }),
    ])

    await withScreen(element, options, async (s) => {
      await s.settle()
      const headings = s.allByRole('heading').map((el) => s.textOf(el))
      // Two days, two headings — not three rows each carrying their own date.
      const dated = headings.filter((text) => /August 2026/.test(text))
      assert.equal(dated.length, 2, `expected two day headings, got ${JSON.stringify(headings)}`)
      assert.ok(dated[0] !== dated[1], 'the two day headings are the same day')

      // And the rows say a time rather than repeating the date beside it.
      const first = row(s, 'The first thing.')
      assert.match(first, /\d{2}:\d{2}/, 'a row carries no clock time')
      assert.ok(!/August 2026/.test(first), 'the row repeats the date the heading already gave')
      s.clean('the activity feed')
    })
  })

  it('names the network beside an amount, and names the one the reader is viewing', async () => {
    // Two mounts, one per estate, rather than one mount and a switch: `viewedNetwork()` is read
    // during render and the page tree is remounted by the shell on a switch (`components/shell.tsx`
    // keys the outlet on it). Mounting twice is what the app actually does.
    for (const [origin, network] of [
      [MAINNET, 'mainnet'],
      [TESTNET, 'testnet'],
    ] as const) {
      fresh()
      const { element, options } = feedPage(
        [
          record({
            id: 'dep-1',
            type: 'deposit.confirmed',
            category: 'deposit',
            amount: '0.5',
            assetCode: 'ETH',
            summary: 'A deposit was credited.',
          }),
        ],
        {},
        origin,
      )
      await withScreen(element, options, async (s) => {
        await s.settle()
        const line = row(s, 'A deposit was credited.')
        // The figure and the ticker are the scenario's own inputs.
        assert.match(line, /0\.5 ETH/, `the amount is missing from the row: "${line}"`)
        // §3: a figure with no network beside it is how a testnet amount is read as real.
        assert.ok(
          line.includes(network),
          `a money row on ${network} does not say so: "${line}"`,
        )
        s.clean(`the ${network} feed`)
      })
    }
  })

  it('does not print the other network’s name on a testnet row', async () => {
    // The pair above passes if the label is a constant containing both words. This one does not.
    fresh()
    const { element, options } = feedPage(
      [record({ id: 'dep-1', amount: '2', assetCode: 'LTC', summary: 'A deposit was credited.' })],
      {},
      TESTNET,
    )
    await withScreen(element, options, async (s) => {
      await s.settle()
      const line = row(s, 'A deposit was credited.')
      assert.ok(line.includes('testnet'))
      assert.ok(
        !line.replace(/testnet/g, '').includes('mainnet'),
        `a testnet row also says mainnet: "${line}"`,
      )
      s.clean('a testnet money row')
    })
  })

  it('prints no figure and no network on a row that never had one', async () => {
    fresh()
    // A sign-in has no quantity. Printing "0" beside it would invent a figure, and a network label
    // on a row with nothing to misread is noise that makes the labels on money rows cheaper.
    const { element, options } = feedPage([
      record({
        id: 'sess-1',
        category: 'security',
        type: 'security.session_created',
        summary: 'Signed in.',
        product: 'identity',
        amount: null,
      }),
    ])
    await withScreen(element, options, async (s) => {
      await s.settle()
      const line = row(s, 'Signed in')
      assert.ok(!line.includes('mainnet'), `a row with no money named a network: "${line}"`)
      // The row still says something: the whole point of #482's second half.
      assert.ok(line.length > 'Signed in.'.length * 2, `the sign-in row is still four words: "${line}"`)
      s.clean('a security row')
    })
  })

  it('carriesMoney follows the amount and nothing else', () => {
    // Mechanical on purpose: `amount` is non-null exactly when activity extracted a quantity, so
    // the label beside a figure cannot fall out of step with whether a figure is printed.
    assert.equal(carriesMoney(record({ id: 'a', amount: '1' })), true)
    assert.equal(carriesMoney(record({ id: 'b', amount: null })), false)
    assert.equal(carriesMoney(record({ id: 'c', amount: '0' })), true)
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   5. The filter, and what it says about what it is filtering.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('narrowing the history', () => {
  const mixed = [
    record({ id: 'dep', category: 'deposit', type: 'deposit.confirmed', amount: '0.5', assetCode: 'ETH', summary: 'Money came in.' }),
    record({ id: 'sec', category: 'security', type: 'security.mfa_added', summary: 'A second factor was added.' }),
    record({ id: 'own', category: 'ownership', type: 'ownership.parcel_claimed', summary: 'A parcel was claimed.' }),
  ]

  it('offers the lenses as radios with exactly one chosen', async () => {
    fresh()
    const { element, options } = feedPage(mixed)
    await withScreen(element, options, async (s) => {
      await s.settle()
      const radios = s.allByRole('radio')
      assert.equal(radios.length, LENSES.length, 'the lens control is not the set of lenses')
      const chosen = radios.filter((el) => el.getAttribute('aria-checked') === 'true')
      assert.equal(chosen.length, 1, `${chosen.length} lenses are marked chosen`)
      s.clean('the lens control')
    })
  })

  it('shows only the rows in the chosen lens, and says what it is narrowing from', async () => {
    fresh()
    const { element, options } = feedPage(mixed)
    await withScreen(element, options, async (s) => {
      await s.settle()
      assert.ok(s.text().includes('A parcel was claimed.'), 'the unfiltered feed is already short')

      await s.click(s.byRole('radio', 'Money'))
      assert.ok(s.text().includes('Money came in.'), 'Money hid a deposit')
      assert.ok(!s.text().includes('A parcel was claimed.'), 'Money kept a parcel claim')
      assert.ok(!s.text().includes('A second factor was added.'), 'Money kept a security change')

      // The count it is narrowing FROM. Without it "1 entry" reads as the whole account and the
      // reader stops looking for the other two. Both numbers are this scenario's own fixture.
      assert.match(s.text(), /1 of 3 loaded/, 'the filter does not say what it narrowed from')

      await s.click(s.byRole('radio', 'Everything'))
      assert.ok(s.text().includes('A parcel was claimed.'), 'Everything did not come back')
      s.clean('filtering')
    })
  })

  it('says nothing is under a lens rather than looking like an empty account', async () => {
    fresh()
    const { element, options } = feedPage([mixed[0] as ActivityRecord])
    await withScreen(element, options, async (s) => {
      await s.settle()
      await s.click(s.byRole('radio', 'Security'))
      assert.match(s.text(), /Nothing under security/i, 'an empty lens says nothing at all')
      // And it is not the empty-account invitation, which would be a different and false claim.
      assert.ok(
        !s.text().includes('Nothing has happened here yet'),
        'a filter with no matches claimed the account is empty',
      )
      s.clean('an empty lens')
    })
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   6. The empty state, which #482 §4 asks to be an invitation and not an apology.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('an account that has done nothing yet', () => {
  it('offers three things to do, each a link into this app', async () => {
    fresh()
    const { element, options } = feedPage([])
    await withScreen(element, options, async (s) => {
      await s.settle()
      // Addressed by role and accessible name. The destinations are the three places a first entry
      // can come from, and each link is checked for going where its own words say.
      const wallet = s.byRole('link', /deposit address/i)
      const mine = s.byRole('link', /Mine EMBER/i)
      const hold = s.byRole('link', /what you hold/i)
      assert.equal(wallet.getAttribute('href'), '/wallet')
      assert.equal(mine.getAttribute('href'), '/mine')
      assert.equal(hold.getAttribute('href'), '/portfolio')

      // Not an apology, and not a dead end.
      assert.ok(!/sorry|unfortunately/i.test(s.text()), 'the empty state apologises')
      // And no filter control above nothing: five radios over an empty list is furniture.
      assert.equal(s.allByRole('radio').length, 0, 'the lens control is offered over an empty feed')
      s.clean('the empty feed')
    })
  })

  it('does not offer the invitation when the history could not be READ', async () => {
    fresh()
    // `GET /v1/activity` answers 200 with `status: 'unavailable'` and `records: []` when the
    // service is down. Drawing the invitation for it would tell somebody with two years of history
    // that they have never done anything — an outage rendered as a quiet week.
    const reason = 'the activity service did not answer'
    const { element, options } = feedPage([], { status: 'unavailable', reason })
    await withScreen(element, options, async (s) => {
      await s.settle()
      assert.ok(s.text().includes(reason), 'the outage does not carry the service’s own reason')
      assert.ok(
        !s.text().includes('Nothing has happened here yet'),
        'an unread history was drawn as an empty one',
      )
      assert.ok(s.allByRole('alert').length > 0, 'the outage is not announced')
      s.clean('an unread history')
    })
  })
})
