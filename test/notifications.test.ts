/**
 * THE BANNER THAT NEVER CLEARED, AND THE PANEL THAT WAS NOT THERE.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT — micro-org #415
 *
 * The Overview of every signed-in account on https://cloudsforge.online carried one sentence,
 * permanently: **"notifications is not showing current data. Everything else on this page is."**
 * It was reported as a stale-data bug. It was not: nothing was stale, because nothing had ever
 * been fetched. hub-api's `notifications` tile was a hard-coded `unavailable` — `notify` was not
 * one of its upstreams and `NOTIFY_URL` was not in its environment — so `dashboard.degraded`
 * contained `notifications` on every response, and `degradedSentence()` rendered that one-element
 * array into exactly the sentence above. Measured against both live networks on 2026-08-11,
 * `hub_tile_status_total{tile="notifications",status="unavailable"}` equalled the number of
 * dashboards composed since boot — 32 of 32 on mainnet, 29 of 29 on testnet, a hundred percent —
 * while notify held 172 real notifications for 85 users and 77 for 37.
 *
 * ── WHY THIS IS A RENDERED SCENARIO AND NOT A UNIT TEST ───────────────────────────────────────
 *
 * `test/tile.test.ts` already asserts that `degradedSentence(['notifications'])` produces that
 * sentence, and it passed throughout — correctly, because the function was right. The bug lived
 * in what was handed to it, which is a claim about a page and not about a function. Doc 22 §3.1
 * allows a scenario to assert what a reader can see relative to what the API returned in the SAME
 * run, and that is the shape of everything below.
 *
 * ── AND WHY EVERY CASE COMES IN A PAIR ────────────────────────────────────────────────────────
 *
 * micro-org#355/#356: the recurring defect here is a check that cannot fail. A scenario that only
 * asserted "no banner" would pass against a page that had deleted the banner component, which
 * would be a far worse bug wearing this one's clothes. So the healthy dashboard and the genuinely
 * unavailable one are rendered from the same page, and what is asserted is that a reader can tell
 * them apart.
 *
 * Nothing below imports a copy string from `src/`. The sentence is transcribed as a literal, per
 * the second banned shape in `test/journeys.test.ts`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes, type Screen } from './dom.ts'
import * as fx from './fixtures.ts'
import { __resetAuth } from '../src/lib/api.ts'
import { OverviewPage } from '../src/pages/overview.tsx'

const ORIGIN = 'https://hub.cloudsforge.online'
const SIGNED_IN = { 'cf.accessToken': 'held-access-token', 'cf.refreshToken': 'held-refresh-token' }

const page = (element: ReactElement, path: string): ReactElement =>
  h(MemoryRouter, { initialEntries: [path] }, element)

/** The sentence the owner reported, transcribed. Never imported from `src/`. */
const BANNER = 'notifications is not showing current data. Everything else on this page is.'

/**
 * The overview, with whatever the scenario puts in the notifications tile.
 *
 * `degraded` is derived here from the tiles rather than passed in, because that is what hub-api
 * does — it is computed from the same object that produced the tiles and therefore cannot
 * disagree with them. A fixture that let a scenario set `degraded` by hand could make the banner
 * appear over healthy tiles, which is the one arrangement the real service cannot produce.
 */
const overviewWith = (tiles: Parameters<typeof fx.dashboard>[0]) => {
  const dashboard = fx.dashboard(tiles)
  const degraded = Object.entries(dashboard.tiles)
    .filter(([, tile]) => tile.status !== 'ok')
    .map(([name]) => name)
  return {
    element: page(h(OverviewPage), '/'),
    options: {
      url: `${ORIGIN}/`,
      storage: SIGNED_IN,
      routes: { 'GET /v1/dashboard': { body: { ...dashboard, degraded } } } as Routes,
    },
  }
}

/* ══════════════════════════════ the banner ══════════════════════════════ */

describe('the Overview banner, against a dashboard hub-api actually composed', () => {
  it('says nothing at all when notify answered', async () => {
    __resetAuth()
    const { element, options } = overviewWith({
      notifications: fx.ok({ unread: 3, items: [fx.notification()] }, 'notify'),
    })
    await withScreen(element, options, async (screen: Screen) => {
      // The page rendered — without this the next assertion passes on a blank document.
      assert.match(screen.text(), /Overview/)
      assert.doesNotMatch(screen.text(), /not showing current data/)
      assert.equal(screen.document.querySelectorAll('.wt-banner--degraded').length, 0)
      screen.clean('overview with a composed notifications tile')
    })
  })

  it('says exactly that sentence when notify really is down, and names notify', async () => {
    // The other direction, and the one that keeps the assertion above honest: the banner must
    // still work. What was wrong was never the banner — it was being told the truth about a tile
    // that had never been asked a question.
    __resetAuth()
    const { element, options } = overviewWith({
      notifications: fx.unavailable(
        { unread: 0, items: [] },
        'notify',
        'notify did not answer within the deadline',
      ),
    })
    await withScreen(element, options, async (screen: Screen) => {
      assert.match(screen.text(), new RegExp(BANNER.replace(/[.]/g, '\\$&')))
      assert.equal(screen.document.querySelectorAll('.wt-banner--degraded').length, 1)
      // And the panel names the upstream, so an operator reading a screenshot knows where to look.
      assert.match(screen.text(), /notify did not answer/)
      screen.clean('overview with notify genuinely unavailable')
    })
  })
})

/* ══════════════════════════════ the panel ══════════════════════════════ */

describe('the Notifications panel', () => {
  it('renders the sentence notify wrote, not a template id', async () => {
    __resetAuth()
    const item = fx.notification({ title: 'A new device signed in', href: '/security' })
    const { element, options } = overviewWith({
      notifications: fx.ok({ unread: 1, items: [item] }, 'notify'),
    })
    await withScreen(element, options, async (screen: Screen) => {
      assert.ok(screen.text().includes(item.title), 'the notification title is not on the page')
      // The template id must NOT be: the words are notify's, and a client that rendered an id
      // would be a client that had started composing its own.
      assert.ok(
        !screen.text().includes(item.templateId),
        'a template id reached the reader instead of a sentence',
      )
      const link = [...screen.document.querySelectorAll('a')].find(
        (a) => (a.textContent ?? '').trim() === item.title,
      )
      assert.ok(link, 'a notification with an href was rendered without a link')
      assert.equal(link.getAttribute('href'), item.href)
      screen.clean('overview with one linked notification')
    })
  })

  it('shows a row whose link is a redacted credential, WITHOUT a link', async () => {
    // `account.verify_email` carries its destination in a single-use credential, which notify has
    // already redacted by the time anything reads the row — so it answers `href: null`. Linking it
    // anyway would point at `/[redacted]` while looking like it works, on the single most
    // important notification the platform sends. Dropping the row would be the other wrong answer.
    __resetAuth()
    const item = fx.notification({
      id: 'ntf-verify',
      templateId: 'account.verify_email',
      title: 'Confirm your email address',
      href: null,
      params: { handle: 'ash', verifyUrl: '[redacted]' },
    })
    const { element, options } = overviewWith({
      notifications: fx.ok({ unread: 1, items: [item] }, 'notify'),
    })
    await withScreen(element, options, async (screen: Screen) => {
      assert.ok(screen.text().includes(item.title), 'the unlinkable row was dropped')
      const link = [...screen.document.querySelectorAll('a')].find(
        (a) => (a.textContent ?? '').trim() === item.title,
      )
      assert.equal(link, undefined, 'a row with no honest destination was given a link')
      assert.ok(!screen.text().includes('redacted'), 'a redacted value was printed to the reader')
      screen.clean('overview with an unlinkable notification')
    })
  })

  it('reports the unread count from the inbox, not from the rows on screen', async () => {
    // The invariant that is easiest to "simplify" away. notify counts unread across the whole
    // inbox; the tile carries a preview. Deriving the badge from `items` would silently cap every
    // badge in the estate at the page size, and it would do it while looking entirely correct on
    // any fixture where the two happen to agree — so here they deliberately do not.
    __resetAuth()
    const items = [fx.notification({ id: 'a' }), fx.notification({ id: 'b', readAt: null })]
    const { element, options } = overviewWith({
      notifications: fx.ok({ unread: 12, items }, 'notify'),
    })
    await withScreen(element, options, async (screen: Screen) => {
      // The chip itself rather than the page text: "12 unread" CONTAINS "2 unread", so a
      // substring search here would have passed against a badge derived from `items.length`.
      const badge = screen.document.querySelector('.wt-panel__head .wt-chip')
      assert.ok(badge, 'the unread badge is not on the page')
      assert.equal((badge.textContent ?? '').trim(), '12 unread')
      assert.notEqual(items.length, 12, 'the fixture must not let a derived count look correct')
      screen.clean('overview with more unread than shown')
    })
  })

  it('says what was asked when the inbox is empty, rather than looking broken', async () => {
    __resetAuth()
    const { element, options } = overviewWith({
      notifications: fx.ok({ unread: 0, items: [] }, 'notify'),
    })
    await withScreen(element, options, async (screen: Screen) => {
      assert.match(screen.text(), /Nothing has been sent to you yet/)
      assert.doesNotMatch(screen.text(), /unread/)
      assert.doesNotMatch(screen.text(), /not showing current data/)
      screen.clean('overview with an empty inbox')
    })
  })
})
