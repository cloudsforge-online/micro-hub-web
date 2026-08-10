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

import { withScreen, type Reply, type Routes } from './dom.ts'
import { MinePage } from '../src/pages/mine.tsx'
import { AuthProvider } from '../src/lib/auth.tsx'
import type { DepositAssignment } from '../src/lib/money.ts'
import { isMineable, miningBlocker, type PoolChain, type PoolSummary } from '../src/lib/pool.ts'
import { NON_INDEX_PATHS, ROUTES } from '../src/lib/routes.ts'
import { MiningProvider } from '../src/mining/session.tsx'

const ORIGIN = 'https://hub.cloudsforge.online'
const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const appSource = read('src/app.tsx')

/**
 * The page, under the two providers the application mounts it under.
 *
 * `MiningProvider` is not scenery. The mining session outlives this page now — that is the whole of
 * the change that put a Start control in the bar of every address — so the page reads the session
 * from a context rather than holding a `PoolMiner` of its own, and a mount without the provider is
 * a mount of a page that cannot exist. `AuthProvider` is under it because the provider ends a
 * session when the account does; no scenario in this file seeds a token, so nothing is asked of
 * identity.
 *
 * The provider reads `GET /v1/pool` for the bar as well, so every scenario here sees that route
 * called twice. Only the ticket route is counted below, and deliberately: the count that matters is
 * of the CREDENTIAL, not of a public description of the pool.
 */
const page = (element: ReactElement, path: string): ReactElement =>
  h(
    MemoryRouter,
    { initialEntries: [path] },
    h(AuthProvider, null, h(MiningProvider, null, element)),
  )

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

/**
 * The custodial EMBER deposit address, as `wallet/src/deposits.ts` reports one.
 *
 * `watchedAt` is a real date by default because that is the ordinary case for a signed-in account,
 * and because it is the field the page is allowed to act on: a null one means the indexer was never
 * told to watch the address, so EMBER swept to it would arrive on chain and never be credited.
 */
const assignment = (over: Partial<DepositAssignment> = {}): DepositAssignment => ({
  id: 'dep_01J000000000000000000000',
  assetCode: 'EMBER',
  chain: 'ember',
  network: 'mainnet',
  walletId: 'wal_01J000000000000000000000',
  address: '0x1111111111111111111111111111111111111111',
  status: 'active',
  assignedAt: '2026-08-10T00:00:00.000Z',
  watchedAt: '2026-08-10T00:00:01.000Z',
  ...over,
})

/**
 * Both routes the page reads, because since micro-org#299 it reads both.
 *
 * The deposit stub defaults to a WATCHED address — the ordinary signed-in case — rather than to a
 * refusal, so a scenario that is about the pool is not silently exercising EMBER's fallback path.
 * Every scenario that IS about the fallback overrides it explicitly and says which reason it is
 * testing. Before this existed, `POST /v1/deposits` was unrouted and every mount in this file was
 * relying on `dom.ts`'s "an unrouted request means the test does not know what the page does".
 */
const poolRoutes = (body: PoolSummary, deposit?: Reply): Routes => ({
  'GET /v1/pool': { status: 200, body },
  'POST /v1/deposits': deposit ?? { status: 200, body: { assignment: assignment() } },
})

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

/**
 * ── WHAT THIS SECTION IS ABOUT, AFTER micro-org#299 ────────────────────────────────────────────
 *
 * This page has TWO EMBER modes and the difference between them is what a reader is told about their
 * own money, so the assertions here are about which one is shown and, in every case, that only one
 * is. The mode turns on the account's custodial EMBER deposit address:
 *
 *   - **A watched address** → the reward is swept to it, the throwaway key is never displayed, and
 *     Start is not gated. The private-key controls MUST be absent: a page that both promises to
 *     forward the reward and asks you to write down a bearer credential has told you two different
 *     things, and somebody will act on the wrong one.
 *   - **No usable address** → the old self-custody flow, exactly as it was, including the checkbox.
 *
 * The `watchedAt: null` case is the sharp one and gets its own scenario. There IS an address, it
 * looks perfectly good, and sweeping to it would send EMBER on chain to somewhere the indexer was
 * never told to watch — arriving, and never being credited. wallet's own note: "an unwatched address
 * produces no events". Losing a sweep is recoverable; that is not.
 */
describe('EMBER, and where the reward is told to go', () => {
  it('sweeps into the account when there is a watched deposit address, and shows no private key', async () => {
    const custody = assignment({ address: '0x2222222222222222222222222222222222222222' })
    await withScreen(
      page(h(MinePage), '/mine'),
      {
        url: `${ORIGIN}/mine`,
        routes: poolRoutes(summary(), { status: 200, body: { assignment: custody } }),
      },
      async (s) => {
        await s.settle()
        // EMBER is the default selection, so this is the page as it first renders.
        assert.match(
          s.text(),
          /paid into your CloudsForge EMBER balance/i,
          'the page does not say the reward reaches the account balance, which since #299 it does',
        )
        // The address from THIS scenario's fixture, never read back off the page.
        assert.match(s.text(), new RegExp(custody.address), 'the destination is not shown at all')

        // The two controls of the self-custody flow, both of which would be a contradiction here.
        assert.equal(
          s.queryByRole('button', /Show the private key/),
          null,
          'a private key is offered on a page that has just promised to forward the reward for you',
        )
        assert.doesNotMatch(
          s.text(),
          /I have saved this private key/i,
          'the reader is asked to save a key they are never shown and do not need',
        )
        assert.doesNotMatch(
          s.text(),
          /unreachable by anyone, including us/i,
          'the self-custody warning is shown alongside the custodial one, so the page says both',
        )

        // Start, with nothing in front of it: there is no key for the reader to look after.
        const start = s.byRole('button', /Start mining EMBER/)
        assert.equal(
          start.hasAttribute('disabled'),
          false,
          'Start is gated in a mode where there is nothing for the reader to do first',
        )
        s.before(
          'paid into your CloudsForge EMBER balance',
          'Start mining EMBER',
          'what happens to the reward must precede the control that starts earning it',
        )
        s.clean('EMBER with a watched deposit address')
      },
    )
  })

  it('asks for the address once, and never asks for a new one', async () => {
    await withScreen(
      page(h(MinePage), '/mine'),
      { url: `${ORIGIN}/mine`, routes: poolRoutes(summary()), strict: true },
      async (s) => {
        await s.settle()
        const calls = s.api.matching('POST /v1/deposits')
        assert.equal(
          calls.length,
          1,
          'the deposit address was asked for more than once on a single mount — under StrictMode, ' +
            'which is how this app really mounts',
        )
        // `rotate` is what mints a NEW address. wallet's own comment: defaulting to it "would mint a
        // new address on every page load and leave a trail of addresses nobody was told about" —
        // and this call happens on every page load, so it is precisely the caller that must not.
        assert.deepEqual(
          calls[0]?.json,
          { assetCode: 'EMBER' },
          'the mining page asked wallet to rotate the account deposit address',
        )
        s.clean('the deposit lookup')
      },
    )
  })

  it('falls back to the self-custody flow, unchanged, when there is no address to forward to', async () => {
    await withScreen(
      page(h(MinePage), '/mine'),
      {
        // `not_depositable` is what `wallet/src/deposits.ts` answers for an asset this deployment
        // does not take deposits in; a signed-out session and a wallet outage arrive the same way.
        url: `${ORIGIN}/mine`,
        routes: poolRoutes(summary(), { status: 400, body: { error: 'not_depositable' } }),
      },
      async (s) => {
        await s.settle()
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
        assert.doesNotMatch(
          s.text(),
          /paid into your CloudsForge EMBER balance/i,
          'the page promises to credit the account while having no address to credit it through',
        )
        s.clean('EMBER with no deposit address')
      },
    )
  })

  it('treats an unwatched address as no address, because sending to one loses the money', async () => {
    const unwatched = assignment({ watchedAt: null })
    await withScreen(
      page(h(MinePage), '/mine'),
      {
        url: `${ORIGIN}/mine`,
        routes: poolRoutes(summary(), { status: 200, body: { assignment: unwatched } }),
      },
      async (s) => {
        await s.settle()
        assert.doesNotMatch(
          s.text(),
          /paid into your CloudsForge EMBER balance/i,
          'the page offered to sweep the reward to an address the indexer was never told to ' +
            'watch. It would arrive on chain, produce no event, and never be credited — which is ' +
            'worse than the self-custody flow it replaced, because nobody would be looking for it',
        )
        assert.doesNotMatch(
          s.text(),
          new RegExp(unwatched.address),
          'an unwatched address is displayed as somewhere money is going',
        )
        assert.ok(
          s.queryByRole('button', /Create a mining address/),
          'neither mode is offered, so the page is unusable rather than merely degraded',
        )
        s.clean('EMBER with an unwatched deposit address')
      },
    )
  })

  it('says nothing about the reward until it knows which is true', async () => {
    await withScreen(
      page(h(MinePage), '/mine'),
      {
        url: `${ORIGIN}/mine`,
        // Slow enough that the mount's own flush cannot reach the answer. The scenario is the gap.
        routes: poolRoutes(summary(), { status: 200, body: { assignment: assignment() }, delayMs: 200 }),
      },
      async (s) => {
        // Deliberately no `settle()` before this: the page as it is while the question is open.
        assert.doesNotMatch(
          s.text(),
          /unreachable by anyone, including us/i,
          'the self-custody warning is shown while the answer is still in flight, and will be ' +
            'replaced by its opposite a moment later — a reader who acted on the first was misled',
        )
        assert.doesNotMatch(
          s.text(),
          /paid into your CloudsForge EMBER balance/i,
          'the custodial promise is made before anything has confirmed it can be kept',
        )
        assert.equal(
          s.allByRole('button').filter((el) => /mining address|Start mining EMBER/i.test(s.textOf(el)))
            .length,
          0,
          'a control that starts one of the two modes exists before the mode is known',
        )
        await s.settle(300)
        assert.match(
          s.text(),
          /paid into your CloudsForge EMBER balance/i,
          'the answer arrived and the page never acted on it',
        )
        s.clean('EMBER while the address is in flight')
      },
    )
  })
})
