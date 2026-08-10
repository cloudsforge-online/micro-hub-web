/**
 * WHAT A READER IS TOLD ABOUT A FIGURE NO MARKET EVER AGREED TO.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT
 *
 * EMBER has no exchange listing. A wallet holding a few thousand of them showed a four- or
 * five-figure dollar total, formatted identically to the BTC row beside it, with nothing on the
 * page distinguishing a median of four venues from a number an operator typed into
 * `PUT /admin/prices/:asset`. Pricing has always labelled the difference — `source: "administered"`
 * — and every layer between it and the screen dropped the label.
 *
 * `test/portfolio.test.ts` owns the decision (which holdings are estimates, and what the sentence
 * says). This file owns the only question that file cannot answer: **whether the sentence reaches
 * the page, attached to the right figure, without an interaction.**
 *
 * ── WHY IT IS RENDERED RATHER THAN INSPECTED ──────────────────────────────────────────────────
 *
 * Because "the reader can learn this" is a claim about a page and not about a function. A unit
 * test of `estimateNotice` passes just as happily if nobody ever calls it. Doc 22 §3.1 allows a
 * browser scenario to assert what a human can see relative to what the API returned in the SAME
 * run, and that is exactly the shape of every assertion below: the fixture says `administered`,
 * and the page is searched for a consequence.
 *
 * ── AND WHY EVERY CASE COMES IN A PAIR ────────────────────────────────────────────────────────
 *
 * micro-org#355/#356: the recurring defect in this codebase is a check that cannot fail. A test
 * that only asserted the note is PRESENT would pass against a component that renders the note
 * unconditionally, on every asset — which is the failure mode that matters most here, because
 * putting "not listed on any exchange" next to a BTC balance is a lie in the other direction and a
 * worse one. So each case renders an administered holding and a market-priced holding and asserts
 * the difference between the two.
 *
 * Nothing below imports a copy string from `src/` and compares the page to it. The sentence is
 * transcribed as a literal, per the second banned shape in `test/journeys.test.ts`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes, type Screen } from './dom.ts'
import * as fx from './fixtures.ts'
import { __resetAuth } from '../src/lib/api.ts'
import { PortfolioPage } from '../src/pages/portfolio.tsx'
import { OverviewPage } from '../src/pages/overview.tsx'

const ORIGIN = 'https://hub.cloudsforge.online'
const SIGNED_IN = { 'cf.accessToken': 'held-access-token', 'cf.refreshToken': 'held-refresh-token' }

const page = (element: ReactElement, path: string): ReactElement =>
  h(MemoryRouter, { initialEntries: [path] }, element)

/**
 * One EMBER holding priced by an operator, and one BTC holding priced by four venues.
 *
 * The two differ in `priceSource` and in nothing else that matters here — both carry a value, both
 * carry a timestamp — so an assertion that separates them can only be separating them on the field
 * under test.
 */
const EMBER = fx.holding({
  assetCode: 'EMBER',
  usd: '12480.22',
  usdScaled: '12480220000',
  priceSource: 'administered',
})

const BITCOIN = fx.holding({
  assetCode: 'BTC',
  amount: '100000000',
  amountFormatted: '1',
  available: '100000000',
  usd: '60000.00',
  usdScaled: '60000000000',
  priceSource: 'market',
})

const portfolioAt = (holdings: readonly ReturnType<typeof fx.holding>[]) => ({
  element: page(h(PortfolioPage), '/portfolio'),
  options: {
    url: `${ORIGIN}/portfolio`,
    storage: SIGNED_IN,
    routes: {
      'GET /v1/portfolio': {
        body: { portfolio: fx.ok(fx.portfolio({ holdings: [...holdings] }), 'ledger+pricing') },
      },
    } as Routes,
  },
})

const overviewAt = (holdings: readonly ReturnType<typeof fx.holding>[]) => ({
  element: page(h(OverviewPage), '/'),
  options: {
    url: `${ORIGIN}/`,
    storage: SIGNED_IN,
    routes: {
      'GET /v1/dashboard': {
        body: fx.dashboard({
          portfolio: fx.ok(fx.portfolio({ holdings: [...holdings] }), 'ledger+pricing'),
        }),
      },
    } as Routes,
  },
})

/** The sentence, transcribed. Never imported from `src/`. */
const SENTENCE =
  'EMBER is not listed on any exchange. Its value here is an estimate set by CloudsForge, ' +
  'not a market price.'

/* ══════════════════════════════ the portfolio page ══════════════════════════════ */

describe('the portfolio page, beside an administered figure', () => {
  it('states that the asset is unlisted and that the figure is an estimate', async () => {
    __resetAuth()
    const { element, options } = portfolioAt([EMBER])
    await withScreen(element, options, async (screen: Screen) => {
      // The figure the fixture asked for is on screen — without this the next assertion could pass
      // on a page that rendered the note and no money at all.
      assert.match(screen.text(), /\$12,480\.22/, 'the estimated figure is not on the page')
      assert.match(screen.text(), new RegExp(SENTENCE.replace(/[.$]/g, '\\$&')))
      screen.clean('portfolio with an administered holding')
    })
  })

  it('says NOTHING of the sort beside a figure four venues agreed on', async () => {
    // The other direction, and the one that matters more: BTC is listed everywhere, and telling a
    // reader it is not would be the same defect pointing the other way.
    __resetAuth()
    const { element, options } = portfolioAt([BITCOIN])
    await withScreen(element, options, async (screen: Screen) => {
      assert.match(screen.text(), /\$60,000\.00/, 'the market figure is not on the page')
      assert.doesNotMatch(screen.text(), /not listed on any exchange/)
      assert.doesNotMatch(screen.text(), /\bestimate\b/)
      screen.clean('portfolio with only market-priced holdings')
    })
  })

  it('marks the estimated row and only the estimated row, in words', async () => {
    // Both holdings in ONE render, so the assertion is about a difference the page draws rather
    // than about two pages that happen to differ.
    __resetAuth()
    const { element, options } = portfolioAt([BITCOIN, EMBER])
    await withScreen(element, options, async (screen: Screen) => {
      // Rows are found by their ROW HEADER — the `<th scope="row">` a screen reader announces to
      // say which holding it is reading — rather than by index, so reordering the table cannot
      // silently swap which asset each assertion is about.
      const rows = [...screen.document.querySelectorAll('tbody tr')]
      const cellFor = (asset: string): Element => {
        const row = rows.find((r) => screen.textOf(r.querySelector('th')) === asset)
        assert.ok(row, `no row for ${asset}`)
        const cells = [...row.querySelectorAll('td')]
        // The value cell is the one carrying the dollar figure.
        const cell = cells.find((c) => screen.textOf(c).includes('$'))
        assert.ok(cell, `no value cell for ${asset}`)
        return cell
      }

      assert.match(screen.textOf(cellFor('EMBER')), /estimate/)
      assert.doesNotMatch(
        screen.textOf(cellFor('BTC')),
        /estimate/,
        'a market-priced figure was marked as an estimate',
      )
      screen.clean('portfolio with one of each')
    })
  })

  it('points the estimated cell at the statement, and points nothing else at it', async () => {
    /*
      The association, which is what a screen reader uses to answer "an estimate of what?". It is
      `aria-describedby` from the value cell to the visible statement — the pattern
      `ui/packages/ui/src/mining.tsx` uses for its control's description.

      Asserted by RESOLVING the reference rather than by checking an attribute exists: an
      `aria-describedby` naming an id that is not in the document is worse than none at all, and it
      is the failure a refactor introduces silently.
    */
    __resetAuth()
    const { element, options } = portfolioAt([BITCOIN, EMBER])
    await withScreen(element, options, async (screen: Screen) => {
      const described = [...screen.document.querySelectorAll('td[aria-describedby]')]
      assert.equal(described.length, 1, 'exactly one value cell should carry the description')

      const cell = described[0] as Element
      assert.match(screen.textOf(cell), /\$12,480\.22/, 'the wrong cell was described')

      const id = cell.getAttribute('aria-describedby') ?? ''
      const target = screen.document.getElementById(id)
      assert.ok(target, `aria-describedby="${id}" resolves to nothing in the document`)
      assert.equal(screen.textOf(target), SENTENCE)
      screen.clean('portfolio aria wiring')
    })
  })

  it('needs no hover, no press and no focus — the statement is on the page already', async () => {
    /*
      A hover tooltip fails a keyboard user, a touch user, and a screen reader for which `title` is
      inconsistently announced. So the check is that the sentence is in the rendered text of a page
      nobody has interacted with, and that the marker beside the figure is not a control somebody
      has to find and press.

      `tabbables()` is the harness's model of the browser's tab order. Nothing carrying this wording
      may appear in it: a read-only number must not become a tab stop on every row of a table, and a
      note a keyboard user has to press for is a note most readers never see.

      `title` is checked too, because `title` IS the hover tooltip — it is announced
      inconsistently, it is unreachable on touch, and this page already uses one for the raw-units
      figure, so reaching for it here would have been the path of least resistance.
    */
    __resetAuth()
    const { element, options } = portfolioAt([EMBER])
    await withScreen(element, options, async (screen: Screen) => {
      // No click, no focus, no hover has happened — the mount is the whole interaction.
      assert.match(screen.text(), /not listed on any exchange/)
      assert.match(screen.text(), /estimate/)

      for (const el of screen.tabbables()) {
        assert.doesNotMatch(
          screen.textOf(el),
          /not listed on any exchange|\bestimate\b/,
          'the statement is inside something a reader has to reach and operate',
        )
      }
      for (const el of [...screen.document.querySelectorAll('[title]')]) {
        assert.doesNotMatch(
          el.getAttribute('title') ?? '',
          /not listed on any exchange|\bestimate\b/,
          'the statement is hidden behind a hover tooltip',
        )
      }
      screen.clean('portfolio without interaction')
    })
  })

  it('puts the statement ahead of the figures it qualifies', async () => {
    // Document order is reading order for a screen reader and for anyone using the page from the
    // top. A note underneath the table is a note met after the number it was meant to qualify.
    __resetAuth()
    const { element, options } = portfolioAt([EMBER])
    await withScreen(element, options, async (screen: Screen) => {
      screen.before(
        'not listed on any exchange',
        'Every holding',
        'the statement appears after the holdings table',
      )
      screen.clean('portfolio ordering')
    })
  })
})

/* ══════════════════════════════ the overview page ══════════════════════════════ */

describe('the overview page, whose one figure is a SUM', () => {
  it('qualifies "Total held" when an estimate is inside it', async () => {
    // This page prints no per-holding figures. The estimate is folded into one number, which makes
    // it easier to miss rather than harder — so the statement is under the tile it is inside of.
    __resetAuth()
    const { element, options } = overviewAt([EMBER])
    await withScreen(element, options, async (screen: Screen) => {
      assert.match(screen.text(), /Total held/)
      assert.match(screen.text(), new RegExp(SENTENCE.replace(/[.$]/g, '\\$&')))
      screen.clean('overview with an administered holding')
    })
  })

  it('leaves a wholly market-priced total unqualified', async () => {
    __resetAuth()
    const { element, options } = overviewAt([BITCOIN])
    await withScreen(element, options, async (screen: Screen) => {
      assert.match(screen.text(), /Total held/)
      assert.doesNotMatch(screen.text(), /not listed on any exchange/)
      screen.clean('overview with only market-priced holdings')
    })
  })
})
