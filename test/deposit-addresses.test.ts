/**
 * The deposit addresses an account already holds are on the screen, without pressing anything.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS FILE EXISTS FOR
 *
 *   A ROUTE THAT IS SERVED AND A CLIENT FUNCTION THAT IS EXPORTED ARE NOT A RENDERED SURFACE.
 *
 * `wallet/src/server.ts` has answered `GET /v1/deposits` — "every assignment this account holds" —
 * since the route was written, and `lib/money.ts` has exported `loadDepositAddresses` for it since
 * the client was written. Nothing in this bundle called it. Every screen that showed an address
 * showed the one `POST /v1/deposits` had just returned, so the address existed on the page for
 * exactly as long as that response stayed in component state.
 *
 * The visible consequence, in the owner's words: *"I don't see on my account any bitcoin
 * address."* The row was in the database, the indexer was watching it, and the account page said
 * nothing about it, on every asset, for ever.
 *
 * ── WHY A TYPE-CHECK AND THE EXISTING SUITE BOTH PASSED THROUGH IT ────────────────────────────
 *
 * Because an unused export is valid TypeScript and an unrendered route is a passing test. There is
 * no assertion anywhere that can fail for "the bundle never asks". The only thing that catches
 * this shape is a scenario that arranges the SERVICE'S answer and then looks at the SCREEN — which
 * is what every test below does, and why they route `GET /v1/deposits` explicitly rather than
 * letting the harness's unrouted-request throw stand in for an assertion.
 *
 * ── THE THREE STATES, WHICH ARE THE POINT ─────────────────────────────────────────────────────
 *
 * `lib/tile.ts` states the rule this file enforces: *"an empty array is a field that renders
 * correctly by accident."* A read that FAILED and an account that genuinely has NO address are
 * different facts, and collapsing them means telling somebody they have no Bitcoin address at the
 * moment the service could not be asked. Two tests below are that pair, and each asserts the
 * absence of the other's sentence — a screen that said both would pass either one alone.
 *
 * ── AND WHICH ADDRESS TO USE ──────────────────────────────────────────────────────────────────
 *
 * `wallet/src/deposits.ts:listAssignments` returns every row for the network at every status. A
 * `rotated` row still credits the account — that is deliberate, so a payment already in flight is
 * not lost — but it is not the address to hand out today, and one flat list of destinations does
 * not say which one is. The split, and the order of the two, is asserted rather than assumed.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes } from './dom.ts'
import * as fx from './fixtures.ts'
import { __resetAuth } from '../src/lib/api.ts'
import { ReceivePanel } from '../src/components/receive.tsx'
import { OverviewPage } from '../src/pages/overview.tsx'
import type { DepositAssignment } from '../src/lib/money.ts'

const ORIGIN = 'https://hub.cloudsforge.online'
const fresh = (): void => __resetAuth()

/** The two shared token keys, for a scenario that starts signed in. `lib/api.ts`. */
const SIGNED_IN = { 'cf.accessToken': 'held-access-token', 'cf.refreshToken': 'held-refresh-token' }

/**
 * A real mainnet-shaped Bitcoin assignment.
 *
 * The address is a bech32 string of the right length and prefix rather than `0xdeadbeef`: this
 * panel prints the address verbatim and the scenarios below search the rendered text for it, so a
 * fixture that could not be a Bitcoin address would prove the panel renders SOMETHING and not that
 * it renders the destination.
 */
const btc = (over: Partial<DepositAssignment> = {}): DepositAssignment => ({
  id: 'dep-btc-1',
  assetCode: 'BTC',
  chain: 'btc',
  network: 'mainnet',
  walletId: 'wal-1',
  address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  status: 'active',
  assignedAt: '2026-08-01T10:00:00.000Z',
  watchedAt: '2026-08-01T10:00:04.000Z',
  ...over,
})

const ember = (over: Partial<DepositAssignment> = {}): DepositAssignment => ({
  id: 'dep-ember-1',
  assetCode: 'EMBER',
  chain: 'hearth',
  network: 'mainnet',
  walletId: 'wal-1',
  address: '0x9f2c4d1b7a3e5068c1d94b2f7e6a80351cd2fb47',
  status: 'active',
  assignedAt: '2026-07-14T08:30:00.000Z',
  watchedAt: '2026-07-14T08:30:02.000Z',
  ...over,
})

/** What the deployment will take a deposit in — the menu, which is a separate read. */
const ASSETS = {
  body: {
    assets: [
      { assetCode: 'EMBER', chain: 'hearth', depositable: true, reason: null },
      { assetCode: 'BTC', chain: 'btc', depositable: true, reason: null },
      { assetCode: 'LTC', chain: 'ltc', depositable: true, reason: null },
    ],
  },
}

/**
 * The panel, mounted the way the Wallet page mounts it.
 *
 * `holdings` is EMBER only and stays that way in every scenario. It is the fixture that makes the
 * point: an account holding no Bitcoin still HAS a Bitcoin deposit address, and that address is
 * exactly what the owner could not find. A scenario that handed this panel a BTC holding would be
 * arranging the easy case.
 */
const panel = () => h(ReceivePanel, { holdings: [fx.holding()] })

/** Every request the page made for the held-address list, and only that one. */
const listReads = (wire: readonly { method: string; path: string }[]) =>
  wire.filter((c) => c.method === 'GET' && c.path === '/v1/deposits')

describe('the deposit addresses an account already holds', () => {
  it('shows the Bitcoin address on mount, with nothing pressed', async () => {
    fresh()
    await withScreen(
      panel(),
      {
        url: `${ORIGIN}/wallet`,
        storage: SIGNED_IN,
        routes: {
          'GET /v1/deposits/assets': ASSETS,
          'GET /v1/deposits': { body: { assignments: [btc(), ember()] } },
        },
      },
      async (s) => {
        await s.settle()

        assert.ok(
          s.text().includes(btc().address),
          'the account holds a Bitcoin deposit address and the panel never printed it. This is the ' +
            'whole defect: the route answers, `loadDepositAddresses` exists, and no screen asked.',
        )
        assert.ok(s.text().includes('btc · mainnet'), 'the address was printed without its chain')

        // Nothing was pressed, and nothing was minted. A panel that only shows an address after a
        // POST is the broken one — it hands back a destination the account already had, and calls
        // it new.
        assert.equal(
          s.api.matching('POST /v1/deposits').length,
          0,
          'the panel posted for an address it had already been told about',
        )
        assert.equal(listReads(s.api.wire).length, 1, 'the held-address list was not read on mount')
        assert.ok(
          s.queryByRole('button', /deposit address/i) !== null,
          'the button that gets an address for something not on the list should still be there',
        )
      },
    )
  })

  it('reads the list before the reader can press anything', async () => {
    fresh()
    await withScreen(
      panel(),
      {
        url: `${ORIGIN}/wallet`,
        storage: SIGNED_IN,
        routes: {
          'GET /v1/deposits/assets': ASSETS,
          /*
            A LONG delay, not a token one. This scenario asserts the state BEFORE the answer, and
            the harness's own mount does real work — `act`, the mount assertion, StrictMode's
            second pass — before the callback runs. Twenty milliseconds is shorter than that on a
            loaded machine, which made this pass alone and fail in the full suite. The number has
            to be longer than the mount, not longer than the network.
          */
          'GET /v1/deposits': { body: { assignments: [btc()] }, delayMs: 400 },
        },
      },
      async (s) => {
        // Before the answer lands the panel says it is looking, which is neither "you have none"
        // nor an address. A spinnerless mount that drew the empty sentence for 20ms would be
        // telling the truth for the wrong reason and then contradicting itself.
        assert.ok(
          s.text().includes('Looking up the addresses you already have'),
          'the in-flight state must not be drawn as an answer',
        )
        assert.ok(
          !s.text().includes('You have no deposit address yet'),
          'an unanswered read was rendered as an empty account',
        )

        await s.settle(500)
        assert.ok(s.text().includes(btc().address), 'the address never arrived on the page')
      },
    )
  })

  it('says the read failed, and never that the account has no address', async () => {
    fresh()
    await withScreen(
      panel(),
      {
        url: `${ORIGIN}/wallet`,
        storage: SIGNED_IN,
        routes: {
          'GET /v1/deposits/assets': ASSETS,
          'GET /v1/deposits': { status: 503, body: { error: 'unavailable' } },
        },
      },
      async (s) => {
        await s.settle()

        assert.ok(
          s.text().includes('could not read the deposit addresses'),
          'a failed read has to say so — it is the state the reader can do something about',
        )
        assert.ok(
          !s.text().includes('You have no deposit address yet'),
          'THE DEFECT `lib/tile.ts` NAMES: an unanswerable read was rendered as an empty account, ' +
            'which tells somebody with a funded Bitcoin address that they have none.',
        )
        // And the panel is still usable: asking again returns the address that already exists
        // rather than minting a second one, which is why this is a note and not a dead end.
        assert.ok(
          s.queryByRole('button', /deposit address/i) !== null,
          'the failure notice replaced the control instead of sitting above it',
        )
      },
    )
  })

  it('says the account has none, and never that the read failed', async () => {
    fresh()
    await withScreen(
      panel(),
      {
        url: `${ORIGIN}/wallet`,
        storage: SIGNED_IN,
        routes: {
          'GET /v1/deposits/assets': ASSETS,
          'GET /v1/deposits': { body: { assignments: [] } },
        },
      },
      async (s) => {
        await s.settle()

        assert.ok(
          s.text().includes('You have no deposit address yet'),
          'a genuinely empty account should be told how to get its first address',
        )
        assert.ok(
          !s.text().includes('could not read'),
          'an answered read was drawn as a failure',
        )
      },
    )
  })

  it('warns that an unwatched address would swallow a payment', async () => {
    fresh()
    await withScreen(
      panel(),
      {
        url: `${ORIGIN}/wallet`,
        storage: SIGNED_IN,
        routes: {
          'GET /v1/deposits/assets': ASSETS,
          'GET /v1/deposits': { body: { assignments: [btc({ watchedAt: null })] } },
        },
      },
      async (s) => {
        await s.settle()

        assert.ok(s.text().includes(btc().address), 'the address should still be listed')
        assert.ok(
          s.text().includes('Not watched yet'),
          '`wallet/src/deposits.ts`: "an unwatched address produces no events". Listing it without ' +
            'that state hands somebody a destination that takes money and credits nobody.',
        )
      },
    )
  })

  it('says a retired address must not be paid', async () => {
    fresh()
    await withScreen(
      panel(),
      {
        url: `${ORIGIN}/wallet`,
        storage: SIGNED_IN,
        routes: {
          'GET /v1/deposits/assets': ASSETS,
          'GET /v1/deposits': { body: { assignments: [ember(), btc({ status: 'retired' })] } },
        },
      },
      async (s) => {
        await s.settle()

        // Dropping it from the screen was the other option and is worse: a destination that
        // vanishes is one somebody asks support about, having already copied it.
        assert.ok(s.text().includes(btc().address), 'a retired address was hidden rather than labelled')
        assert.ok(
          s.text().includes('do not send to it'),
          'a retired address was listed beside usable ones with nothing to tell them apart',
        )
      },
    )
  })

  it('keeps a rotated address, and does not offer it as the current one', async () => {
    fresh()
    const current = btc({ id: 'dep-btc-2', address: 'bc1qnew0srrr7xfkvy5l643lydnw9re59gtzzabcde' })
    const previous = btc({ id: 'dep-btc-1', status: 'rotated' })
    await withScreen(
      panel(),
      {
        url: `${ORIGIN}/wallet`,
        storage: SIGNED_IN,
        routes: {
          'GET /v1/deposits/assets': ASSETS,
          // `order by id desc`, as the service returns them — so the fixture cannot be passing
          // because the component happened to render its input in order.
          'GET /v1/deposits': { body: { assignments: [current, previous] } },
        },
      },
      async (s) => {
        await s.settle()

        assert.ok(s.text().includes(current.address), 'the active address is missing')
        assert.ok(
          s.text().includes(previous.address),
          'a rotated address still credits the account, so hiding it loses a payment in flight',
        )
        s.before(
          'Your deposit addresses',
          'Older addresses',
          'the address to use today has to come first — one flat list of destinations does not say ' +
            'which one to hand out',
        )
        s.before(current.address, previous.address, 'the rotated address was listed above the active one')
        assert.ok(
          s.text().includes('still credits you'),
          'the older list has to explain why a replaced address is kept, or it reads as clutter',
        )
      },
    )
  })

  it('re-reads the list after getting an address, so the new one is on it', async () => {
    fresh()
    const minted = btc()
    await withScreen(
      panel(),
      {
        url: `${ORIGIN}/wallet`,
        storage: SIGNED_IN,
        routes: {
          'GET /v1/deposits/assets': ASSETS,
          // First read: nothing. Second read, after the POST: the address that was just assigned.
          'GET /v1/deposits': (_w, n) => ({ body: { assignments: n === 1 ? [] : [minted] } }),
          'POST /v1/deposits': { body: { assignment: minted } },
        },
      },
      async (s) => {
        await s.settle()
        assert.ok(s.text().includes('You have no deposit address yet'), 'the empty state did not draw')

        await s.click(s.byRole('button', /deposit address/i))
        await s.settle()

        assert.equal(
          listReads(s.api.wire).length,
          2,
          'the list was not re-read after an assignment, so the panel above and the list below are ' +
            'two answers to one question — and the list is the one that survives a reload',
        )
        assert.ok(
          !s.text().includes('You have no deposit address yet'),
          'the panel showed an address and the list under it still said the account had none',
        )
      },
    )
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE SAME DEFECT, REPORTED A THIRD TIME, ON A DIFFERENT PAGE
 *
 *   *"in overview no bitcoin address exist again (i already discuss this with you twice)"*
 *
 * The scenarios above fixed the first half honestly and put the list on the RECEIVE panel, which
 * lives on the Wallet page. The Overview — the page somebody means when they say "my account" —
 * still carried no deposit address of any kind, so a reader who never opened Wallet saw exactly
 * what they saw before the fix, and reported it again.
 *
 * ── AND THE HALF NOBODY FIXED, WHICH IS THE ONE THAT PRODUCES THE SENTENCE ────────────────────
 *
 * `wallet/src/deposits.ts` assigns ON DEMAND and nothing pre-creates anything, so an account has
 * a Bitcoin address only if somebody explicitly asked for one. Measured on mainnet 2026-08-14:
 *
 *     EMBER 237    BTC 3    LTC 3    XRP 3    ETH 2    SOL 2
 *
 * Every one of those 237 came from the Receive selector, which defaults to `assets[0]` — EMBER.
 * So the FIRST scenario below is the one the owner actually hit, and it is the one a list-shaped
 * panel can never pass: the account holds no Bitcoin address, and Bitcoin must still be on the
 * screen, by name, with the way to get one inside it. A test that only ever arranges an account
 * that already HAS a BTC row is arranging the easy case and would have passed throughout.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
describe('the Overview, which is the page the owner meant', () => {
  const overview = () => h(MemoryRouter, { initialEntries: ['/'] }, h(OverviewPage))

  const routes = (assignments: readonly DepositAssignment[], extra: Routes = {}): Routes => ({
    'GET /v1/dashboard': { body: fx.dashboard() },
    'GET /v1/deposits/assets': ASSETS,
    'GET /v1/deposits': { body: { assignments } },
    ...extra,
  })

  it('names Bitcoin, and offers the address, on an account that holds only EMBER', async () => {
    fresh()
    await withScreen(
      overview(),
      { url: `${ORIGIN}/`, storage: SIGNED_IN, routes: routes([ember()]) },
      async (s) => {
        await s.settle()

        // The page rendered at all — without this the assertions below pass on a blank document.
        assert.match(s.text(), /Overview/)

        assert.ok(
          s.text().includes('Bitcoin'),
          'the Overview does not contain the word Bitcoin. This is the reported defect verbatim: ' +
            'the estate takes Bitcoin deposits and the account page never mentions it',
        )
        assert.ok(
          s.byRole('button', /Get my Bitcoin address/i),
          'Bitcoin is named but there is no way to get an address from this page, which leaves the ' +
            'reader exactly where they were — behind a select on another page that defaults to EMBER',
        )
        // And the one they DO hold is printed, in full, rather than behind a press.
        assert.ok(
          s.text().includes(ember().address),
          'the EMBER address this account holds was not printed on the Overview',
        )
      },
    )
  })

  it('prints the Bitcoin address in full once the account has one', async () => {
    fresh()
    await withScreen(
      overview(),
      { url: `${ORIGIN}/`, storage: SIGNED_IN, routes: routes([btc(), ember()]) },
      async (s) => {
        await s.settle()
        assert.ok(
          s.text().includes(btc().address),
          'the account holds a Bitcoin address and the Overview did not print it',
        )
        // NO TRUNCATION, the same rule the Receive panel is held to: a shortened deposit address
        // is a destination somebody can copy and lose money to.
        assert.ok(!s.text().includes('…'), 'an ellipsis appeared in a screen that prints addresses')
        assert.ok(
          s.byRole('button', /Copy the Bitcoin deposit address/i),
          'a 42-character address was printed with no way to copy it but by hand',
        )
      },
    )
  })

  it('mints nothing by being looked at', async () => {
    // wallet's own rule, and the reason this panel does not just assign what is missing:
    // "Defaulting to it would mint a new address on every page load and leave a trail of
    // addresses nobody was told about." A panel that provisioned all three on mount would be that,
    // once per coin, for every reader who came to look at their balance.
    fresh()
    await withScreen(
      overview(),
      { url: `${ORIGIN}/`, storage: SIGNED_IN, routes: routes([ember()]) },
      async (s) => {
        await s.settle()
        assert.equal(
          s.api.wire.filter((c) => c.method === 'POST' && c.path === '/v1/deposits').length,
          0,
          'the Overview assigned a deposit address without anybody asking for one',
        )
      },
    )
  })

  it('says so when the read failed, rather than showing an account with no addresses', async () => {
    // `lib/tile.ts`: "an empty array is a field that renders correctly by accident." Drawing a
    // failed read as an empty one tells somebody they have no Bitcoin address while the row sits
    // in the database — and they may then go and mint a second one.
    fresh()
    await withScreen(
      overview(),
      {
        url: `${ORIGIN}/`,
        storage: SIGNED_IN,
        routes: routes([], {
          'GET /v1/deposits': {
            status: 503,
            body: fx.errorBody('upstream_unavailable', 'The wallet did not answer.'),
          },
        }),
      },
      async (s) => {
        await s.settle()
        assert.ok(
          s.text().includes('could not read your deposit addresses'),
          'a failed read was drawn as an account that has no addresses',
        )
      },
    )
  })
})
