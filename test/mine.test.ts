/**
 * `/mine` — the route, and the one state that must never become a button.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS FOR
 *
 * Two properties, and the second is the whole reason the file exists.
 *
 *   1. The address is declared in all three descriptions of this app's routes and is behind the
 *      session gate. `test/routes.test.ts` already cross-checks the three against each other, so
 *      what is added here is the part that check cannot make: that `mine` is one of them AND that
 *      it is gated. A route table agreeing with itself about an ungated `/mine` is a consistent,
 *      correct-looking configuration that exposes a page which mints mining tickets.
 *
 *   2. **A chain the pool has not published a WebSocket address for is listed, is explained, and
 *      has no Start control at all.** micro-org#285 is the defect where a plausible endpoint was
 *      derived from `window.location` and published; it could not connect, and the person holding
 *      it spent a day debugging their own machine. The three ways this page could bring that back
 *      are each asserted against below: a Start button that opens a constructed URL, a DISABLED
 *      Start button that says nothing (a control that says "not now" and never says why), and a
 *      chain quietly dropped from the list so nobody can ask about it.
 *
 * ── The addressing rule this file follows ─────────────────────────────────────────────────────
 *
 * Elements by accessible role and name, never by class or DOM path — `test/dom.ts` sets that rule
 * out and the reason applies here with unusual force: the assertion that matters most is the
 * ABSENCE of a button, and an absence asserted by CSS selector is an absence that a rename
 * silently manufactures. `allByRole('button')` cannot be fooled that way.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes } from './dom.ts'
import { MinePage } from '../src/pages/mine.tsx'
import { isMineable, miningBlocker, type PoolChain, type PoolSummary } from '../src/lib/pool.ts'
import { NON_INDEX_PATHS, ROUTES } from '../src/lib/routes.ts'

const ORIGIN = 'https://hub.cloudsforge.online'
const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const appSource = read('src/app.tsx')

const page = (element: ReactElement, path: string): ReactElement =>
  h(MemoryRouter, { initialEntries: [path] }, element)

/* ══════════════════════════════ the fixture ══════════════════════════════ */

/**
 * A pool reply built from THIS TEST'S inputs, never from anything the page exports.
 *
 * The two chains differ in exactly one field. That is deliberate: it is the only difference the
 * page is allowed to act on, so a scenario in which they differed in several would not be able to
 * say which one produced the outcome.
 */
const chain = (over: Partial<PoolChain> = {}): PoolChain => ({
  // The identifiers micro-pool actually reports: lower-case tickers, not chain names. Nothing in
  // this page reads them for meaning, which is the point of using the real ones here — if anything
  // ever starts pattern-matching on `chain`, this fixture is what it will be matched against.
  chain: 'ltc',
  name: 'Litecoin',
  asset: 'LTC',
  decimals: 8,
  algorithm: 'scrypt',
  stratumPort: 3333,
  stratumEndpoint: null,
  websocketEndpoint: 'wss://pool.cloudsforge.online/v1/pool/stratum/ltc',
  connections: 2,
  height: 2_900_001,
  networkDifficulty: 41_000_000,
  templateAgeSeconds: 4,
  ready: true,
  windowSeconds: 600,
  sharesInWindow: 128,
  workersInWindow: 3,
  hashrateEstimate: 51_200,
  ...over,
})

const summary = (over: Partial<PoolSummary> = {}): PoolSummary => ({
  network: 'testnet',
  feeBasisPoints: 100,
  pplnsWindowMultiplier: 2,
  payoutsImplemented: false,
  chains: [chain()],
  ...over,
})

const poolRoutes = (body: PoolSummary): Routes => ({ 'GET /v1/pool': { status: 200, body } })

/* ══════════════════════════════ 1. the address ══════════════════════════════ */

describe('the /mine address', () => {
  it('is declared in the route table, and is not indexable', () => {
    const entry = ROUTES.find((route) => route.path === 'mine')
    assert.ok(entry, 'src/lib/routes.ts declares no `mine` route, so nothing renders the page')
    assert.equal(entry.indexable, false, 'a signed-in mining page must not be offered to crawlers')
    assert.ok(
      NON_INDEX_PATHS.includes('mine'),
      'mine is missing from NON_INDEX_PATHS, which is what nginx and the sitemap are checked against',
    )
  })

  it('has a <Route> in app.tsx, and it is behind ProtectedRoute', () => {
    // `app.tsx` is read as text rather than imported for the reason `test/routes.test.ts` gives:
    // importing it pulls in React, the router and every page.
    const blocks = appSource.split('<Route').slice(1)
    const block = blocks.find((b) => /path="mine"/.test(b))
    assert.ok(block, 'app.tsx declares no <Route path="mine">, so the address 404s inside the app')
    assert.match(
      block,
      /<ProtectedRoute>/,
      'the mine route is not wrapped in ProtectedRoute — a signed-out visitor would reach a page ' +
        'whose Start button mints a mining ticket against a bearer that does not exist',
    )
  })

  it('is served the app shell by nginx, so a hard refresh on it is not a 404', () => {
    const nginx = read('nginx.conf')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')
    const match = /location\s+~\s+\^\/\(([^)]+)\)/.exec(nginx)
    assert.ok(match, 'nginx.conf has no enumerated route block')
    assert.ok(
      (match[1] ?? '').split('|').map((p) => p.trim()).includes('mine'),
      'nginx does not enumerate /mine, so the page works under `pnpm dev` and 404s on the first ' +
        'hard refresh in production',
    )
  })
})

/* ══════════════════════════════ 2. the picker ══════════════════════════════ */

describe('the chain picker', () => {
  it('offers EMBER and every chain the pool reported', async () => {
    const bitcoin = chain({ chain: 'btc', name: 'Bitcoin', asset: 'BTC', algorithm: 'sha256d' })
    await withScreen(
      page(h(MinePage), '/mine'),
      { url: `${ORIGIN}/mine`, routes: poolRoutes(summary({ chains: [chain(), bitcoin] })) },
      async (s) => {
        await s.settle()
        // Names built from this test's own fixture, never read back off the page.
        assert.ok(s.queryByRole('radio', /EMBER/), 'EMBER is not offered')
        assert.ok(s.queryByRole('radio', /Litecoin/), 'a chain the pool reported is not offered')
        assert.ok(s.queryByRole('radio', /Bitcoin/), 'a chain the pool reported is not offered')
        s.clean('the chain picker')
      },
    )
  })

  it('still lists a chain with no published endpoint, rather than hiding it', async () => {
    const unpublished = chain({ websocketEndpoint: null })
    assert.equal(isMineable(unpublished), false, 'the fixture is not the case this scenario is about')
    await withScreen(
      page(h(MinePage), '/mine'),
      { url: `${ORIGIN}/mine`, routes: poolRoutes(summary({ chains: [unpublished] })) },
      async (s) => {
        await s.settle()
        assert.ok(
          s.queryByRole('radio', /Litecoin/),
          'a chain the pool mines was dropped from the picker because a browser cannot reach it — ' +
            'which leaves nobody able to ask why',
        )
        s.clean('the picker with an unpublished chain')
      },
    )
  })
})

/* ══════════════════════════════ 3. the unpublished state ══════════════════════════════ */

describe('a chain with no published WebSocket endpoint', () => {
  it('reads as not published here, and has no start control of any kind', async () => {
    await withScreen(
      page(h(MinePage), '/mine'),
      {
        url: `${ORIGIN}/mine`,
        routes: poolRoutes(summary({ chains: [chain({ websocketEndpoint: null })] })),
      },
      async (s) => {
        await s.settle()
        await s.click(s.byRole('radio', /Litecoin/))
        await s.settle()

        assert.match(
          s.text(),
          /browser mining has not been published on this deployment/i,
          'the unpublished state does not say, in words, that this is a deployment setting',
        )

        // The assertion this file exists for. Not "the button is disabled" — NO BUTTON.
        const starts = s
          .allByRole('button')
          .filter((el) => /start/i.test(s.textOf(el)))
        assert.equal(
          starts.length,
          0,
          'a Start control was rendered for a chain with no published endpoint. Either it opens a ' +
            'socket to an address this page invented (micro-org#285) or it is a disabled button ' +
            'that says "not now" and never says why',
        )
        s.clean('the unpublished chain')
      },
    )
  })

  it('never asks the network for anything but the pool summary', async () => {
    await withScreen(
      page(h(MinePage), '/mine'),
      {
        url: `${ORIGIN}/mine`,
        routes: poolRoutes(summary({ chains: [chain({ websocketEndpoint: null })] })),
      },
      async (s) => {
        await s.settle()
        await s.click(s.byRole('radio', /Litecoin/))
        await s.settle()
        // A ticket is a credential and this chain cannot be mined; minting one here would spend a
        // real authorisation on a connection that can never be opened.
        assert.equal(
          s.api.matching('POST /v1/pool/ticket').length,
          0,
          'a mining ticket was minted for a chain that cannot be connected to',
        )
        s.clean('the unpublished chain')
      },
    )
  })
})

/* ══════════════════════════════ 3b. published, but with no work ══════════════════════════════ */

/**
 * The second blocked state, and the reason it is not folded into the first.
 *
 * A chain can have a perfectly good published endpoint and still have nothing to hand out: the
 * pool's node for it holds no block template, which today means BTC, whose bitcoind was measured on
 * 2026-08-09 at 885,650 of 961,712 blocks and still in initial block download. `pool/src/wsstratum.ts`
 * refuses the upgrade with a 503 in that case, so a Start button here would spend a real mining
 * ticket — a single-use credential — to earn a connection failure.
 *
 * The distinction is worth a separate state because the two lead to different behaviour from the
 * reader: one is an operator decision that will not change by waiting, and the other resolves
 * itself. A single sentence covering both would be true and useless.
 */
describe('a chain the pool has published but has no work for', () => {
  it('says there is no work, and offers no way to start', async () => {
    const syncing = chain({ chain: 'btc', name: 'Bitcoin', asset: 'BTC', algorithm: 'sha256d', ready: false })
    assert.equal(
      miningBlocker(syncing),
      'not-ready',
      'the fixture is not the case this scenario is about — it has an endpoint and is not ready',
    )
    await withScreen(
      page(h(MinePage), '/mine'),
      { url: `${ORIGIN}/mine`, routes: poolRoutes(summary({ chains: [syncing] })) },
      async (s) => {
        await s.settle()
        await s.click(s.byRole('radio', /Bitcoin/))
        await s.settle()

        assert.match(
          s.text(),
          /has no work for Bitcoin right now/i,
          'a chain whose node holds no template does not say so, so the only way to find out is a ' +
            'Start button that fails',
        )
        // Not the other state's sentence. Confusing the two tells a reader to give up on something
        // that will be working again by itself.
        assert.doesNotMatch(
          s.text(),
          /has not been published on this deployment/i,
          'a chain that is merely catching up is described as an operator decision it is not',
        )
        assert.equal(
          s.allByRole('button').filter((el) => /start/i.test(s.textOf(el))).length,
          0,
          'a Start control was rendered for a chain the pool cannot serve, which spends a ' +
            'single-use mining ticket to earn a 503 on the upgrade',
        )
        assert.equal(
          s.api.matching('POST /v1/pool/ticket').length,
          0,
          'a mining ticket was minted for a chain with no work',
        )
        s.clean('the chain with no work')
      },
    )
  })
})

/* ══════════════════════════════ 4. the published state ══════════════════════════════ */

describe('a chain the pool has published an endpoint for', () => {
  it('offers a start control, and says payouts do not exist before it', async () => {
    await withScreen(
      page(h(MinePage), '/mine'),
      { url: `${ORIGIN}/mine`, routes: poolRoutes(summary({ payoutsImplemented: false })) },
      async (s) => {
        await s.settle()
        await s.click(s.byRole('radio', /Litecoin/))
        await s.settle()

        assert.ok(
          s.queryByRole('button', /Start mining LTC/),
          'a chain with a published endpoint has no way to start',
        )
        // Item 6 of the wire contract, in the page's own words.
        assert.match(
          s.text(),
          /nothing spendable accrues yet/i,
          'the page does not say that shares credit nothing spendable, which is the one sentence ' +
            'that stops a share count being read as a balance',
        )
        // Before, not after. A caveat below the Start button is a caveat read after the decision.
        s.before(
          'Payouts are not implemented',
          'Start mining LTC',
          'the payout caveat must precede the control it qualifies',
        )
        s.clean('the published chain')
      },
    )
  })

  it('states every quantitative claim with its unit', async () => {
    await withScreen(
      page(h(MinePage), '/mine'),
      { url: `${ORIGIN}/mine`, routes: poolRoutes(summary()) },
      async (s) => {
        await s.settle()
        await s.click(s.byRole('radio', /Litecoin/))
        await s.settle()
        const text = s.text()
        // The pool's own figures, each labelled as the pool's and each carrying its window.
        assert.match(text, /1\.00% \(100 basis points\)/, 'the fee is shown without its unit')
        assert.match(text, /600 seconds/, 'the pool hashrate window is not stated in seconds')
        assert.match(text, /51\.2 kH\/s/, 'the pool hashrate is shown without a unit')
        assert.match(text, /Payouts implemented/, 'the payout flag is not stated as a fact')
        s.clean('the numbers')
      },
    )
  })
})

/* ══════════════════════════════ 5. EMBER ══════════════════════════════ */

describe('EMBER on the same page', () => {
  it('will not start until a key exists and has been saved', async () => {
    await withScreen(
      page(h(MinePage), '/mine'),
      { url: `${ORIGIN}/mine`, routes: poolRoutes(summary()) },
      async (s) => {
        await s.settle()
        // EMBER is the default selection, so this is the page as it first renders.
        assert.match(
          s.text(),
          /not to the EMBER address on your CloudsForge account/i,
          'the page does not say where the block reward actually goes. EMBER binds the coinbase ' +
            'key into the proof, and the account address is custodial, so a reader who assumes ' +
            'otherwise is spending electricity on an address they cannot reach',
        )
        assert.equal(
          s.queryByRole('button', /Start mining EMBER/),
          null,
          'EMBER can be started before a mining key exists, so the reward would have no payee',
        )
        assert.ok(s.queryByRole('button', /Create a mining address/), 'there is no way to make a key')
        s.clean('EMBER before a key')
      },
    )
  })
})
