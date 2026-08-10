/**
 * ONE SESSION, AND WHICH CHAIN A BARE PRESS STARTS.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE OWNS THAT ITS NEIGHBOURS DO NOT
 *
 * `test/mining-bar.test.ts` is pure and asserts what the reader is TOLD. `test/journeys.test.ts`
 * mounts the whole shell and asserts what a reader can DO. Between them is the provider itself, and
 * two of its properties are invisible to both:
 *
 *   1. **What a bare `start()` constructs.** The bar's press and the mining page's press both end
 *      here, and the difference between "started EMBER" and "started the pool's first startable
 *      chain" is one line in this module. It used to be the second (micro-org#362): the estate's
 *      own chain was the one thing its own bar would not mine, on a deployment where the pool's
 *      first startable chain is LTC and only LTC because bitcoind and dogecoind are still in
 *      initial block download.
 *   2. **How many miners exist.** The EMBER miner used to live in `EmberPanel`'s local state, so
 *      the mining page owned one and — once the bar could start EMBER — the bar would own another.
 *      Two `Miner`s grinding at once is not a cosmetic duplicate: it is double the machine's load
 *      on a duty cycle the reader chose, two `EventSource`s against a node with a client cap, and
 *      two sweeps racing one nonce, which turns a block reward into a fee. A screen cannot see the
 *      difference between one miner and two; a constructor count can.
 *
 * The two seams are `create` and `createEmber`, which exist for exactly this. Nothing here fakes
 * proof-of-work: the fakes below record what they were asked to do and answer nothing.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { MINING_CAPABLE, withScreen, type Reply, type Routes } from './dom.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import { MinePage } from '../src/pages/mine.tsx'
import type { PoolChain, PoolSummary } from '../src/lib/pool.ts'
import {
  MiningProvider,
  useMining,
  type EmberMinerLike,
  type EmberMinerOptions,
  type MinerLike,
} from '../src/mining/session.tsx'

const ORIGIN = 'https://hub.cloudsforge.online'
const SIGNED_IN = { 'cf.accessToken': 'held-access-token', 'cf.refreshToken': 'held-refresh-token' }

/* ══════════════════════════════ the two seams ══════════════════════════════ */

/** Every pool miner this scenario's provider built, in the order it built them. */
interface PoolBuild {
  readonly chain: PoolChain
  started: number
  stopped: number
}

/** Every EMBER miner it built, with the options it was handed. */
interface EmberBuild {
  readonly options: EmberMinerOptions
  started: number
  stopped: number
}

const seams = () => {
  const pool: PoolBuild[] = []
  const ember: EmberBuild[] = []
  const create = (options: { chain: PoolChain }): MinerLike => {
    const record: PoolBuild = { chain: options.chain, started: 0, stopped: 0 }
    pool.push(record)
    return {
      chain: options.chain,
      start: async () => {
        record.started += 1
      },
      stop: () => {
        record.stopped += 1
      },
      running: false,
      setDuty: () => {},
      setPauseOnBattery: () => {},
    }
  }
  const createEmber = (options: EmberMinerOptions): EmberMinerLike => {
    const record: EmberBuild = { options, started: 0, stopped: 0 }
    ember.push(record)
    const listeners = new Map<string, (event: Event) => void>()
    return {
      start: async () => {
        record.started += 1
        // What `mining/miner.js` emits first, before it has asked hearth for anything. The session
        // renders `running` from it, so a fake that never emitted would let "the bar reports the
        // session" pass against a provider that started nothing.
        listeners.get('state')?.(new CustomEvent('state', { detail: { running: true } }))
      },
      stop: () => {
        record.stopped += 1
      },
      setDuty: () => {},
      setPauseOnBattery: () => {},
      addEventListener: (type, listener) => listeners.set(type, listener),
    }
  }
  return { pool, ember, create, createEmber }
}

/* ══════════════════════════════ the fixtures ══════════════════════════════ */

const chain = (over: Partial<PoolChain> = {}): PoolChain => ({
  chain: 'ltc',
  name: 'Litecoin',
  asset: 'LTC',
  decimals: 8,
  algorithm: 'scrypt',
  stratumPort: 3333,
  stratumEndpoint: null,
  websocketEndpoint: 'wss://pool.example.test/v1/pool/stratum/ltc',
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
  network: 'mainnet',
  feeBasisPoints: 100,
  pplnsWindowMultiplier: 2,
  payoutsImplemented: false,
  chains: [chain()],
  ...over,
})

/** A watched custodial EMBER deposit address — the one precondition a bare press turns on. */
const WATCHED = {
  id: 'dep_01J000000000000000000000',
  assetCode: 'EMBER',
  chain: 'ember',
  network: 'mainnet',
  walletId: 'wal_01J000000000000000000000',
  address: '0x1111111111111111111111111111111111111111',
  status: 'active',
  assignedAt: '2026-08-10T00:00:00.000Z',
  watchedAt: '2026-08-10T00:00:01.000Z',
}

const routes = (deposit: Reply = { body: { assignment: WATCHED } }): Routes => ({
  'GET /auth/me': { body: { user: { id: 'u1', handle: 'miner', roles: ['player'] } } },
  'GET /v1/pool': { body: summary() },
  'POST /v1/deposits': deposit,
})

/* ══════════════════════════════ the harness ══════════════════════════════ */

/**
 * A stand-in for the bar, under the SAME provider as the real mining page.
 *
 * It presses `start()` with no argument, which is precisely what `components/shell.tsx` wires the
 * bar's `onStart` to. Rendering the real `AppShell` instead would be a heavier mount that could not
 * take the two seams — `AppShell` owns the provider — and the thing being asserted here is what the
 * provider constructs, which the shell cannot reach.
 */
function BarProbe(): ReactElement {
  const session = useMining()
  return h(
    'div',
    null,
    h('button', { type: 'button', onClick: () => session.start() }, 'Bare press in the bar'),
    h('button', { type: 'button', onClick: () => session.start(chain()) }, 'Named press in the bar'),
    h('button', { type: 'button', onClick: () => session.stop() }, 'Stop from the bar'),
    h('output', null, `target=${String(session.target)} running=${String(session.running)}`),
  )
}

const tree = (create: ReturnType<typeof seams>): ReactElement =>
  h(
    MemoryRouter,
    { initialEntries: ['/mine'] },
    h(
      AuthProvider,
      null,
      // `children` in the props rather than as trailing arguments, because `MiningProviderProps`
      // declares it required and `createElement`'s variadic overload cannot satisfy that.
      h(MiningProvider, {
        create: create.create,
        createEmber: create.createEmber,
        children: [h(BarProbe, { key: 'bar' }), h(MinePage, { key: 'page' })],
      }),
    ),
  )

const mounted = (deposit?: Reply) => ({
  url: `${ORIGIN}/mine`,
  storage: SIGNED_IN,
  routes: routes(deposit),
  windowExtras: MINING_CAPABLE,
})

/* ══════════════════════════════ 1. what a bare press builds ══════════════════════════════ */

describe('the mining session — what a bare press builds', () => {
  it('builds an EMBER miner, and no pool miner, when a block has somewhere to go', async () => {
    // THE MUTATION PROOF at the provider. Restore the old body of `start()` — the unconditional
    // `startPool(firstMineable(summary))` — and `ember.length` is 0 and `pool.length` is 1, with
    // `pool[0].chain.chain === 'ltc'`. Both halves are asserted, because a provider that started
    // NOTHING would satisfy the pool half alone and would be a different defect wearing this fix.
    const s2 = seams()
    await withScreen(tree(s2), mounted(), async (s) => {
      await s.settle()
      await s.click(s.byRole('button', 'Bare press in the bar'))
      await s.settle()

      assert.equal(s2.ember.length, 1, 'a bare press did not build an EMBER miner')
      assert.equal(s2.ember[0]?.started, 1, 'the EMBER miner was built and never started')
      assert.deepEqual(
        s2.pool.map((p) => p.chain.chain),
        [],
        'a bare press built a POOL miner. On this deployment that is Litecoin and only Litecoin, ' +
          'so the estate’s own bar mines somebody else’s chain by default',
      )
    })
  })

  it('hands that miner the account’s own deposit address to pay into, not a reader-held key', async () => {
    // The key is generated here and never shown, because in sweep mode it is an implementation
    // detail of a transfer. What makes that honest is that the reward LEAVES it — so the address
    // the session is paying into is read back out of the fixture this scenario supplied.
    const s2 = seams()
    await withScreen(tree(s2), mounted(), async (s) => {
      await s.settle()
      await s.click(s.byRole('button', 'Bare press in the bar'))
      await s.settle()

      const options = s2.ember[0]?.options
      assert.ok(options, 'no EMBER miner was built')
      assert.ok(options.key.privHex.length > 0, 'the miner was built with no key to pay the coinbase')
      assert.match(s.text(), new RegExp(WATCHED.address), 'the page does not say where the reward goes')
      assert.doesNotMatch(
        s.text(),
        new RegExp(options.key.address),
        'the throwaway mining address is on screen in a mode where the reader never needs it, ' +
          'which is the contradiction micro-org#299 removed: a page that promises to forward the ' +
          'reward and also shows you the key it is being forwarded from',
      )
    })
  })

  it('builds nothing at all when there is nowhere on the account for a block to go', async () => {
    // The bar never offers this press in that state — `mining/bar.ts` renders a link instead — so
    // reaching it is a caller that has stopped agreeing with the bar. Starting nothing is the safe
    // way to disagree; the two unsafe ways are starting a pool chain nobody asked for and minting a
    // bearer key nobody was told about.
    const s2 = seams()
    const unwatched = { body: { assignment: { ...WATCHED, watchedAt: null } } }
    await withScreen(tree(s2), mounted(unwatched), async (s) => {
      await s.settle()
      await s.click(s.byRole('button', 'Bare press in the bar'))
      await s.settle()

      assert.equal(s2.ember.length, 0, 'a miner was built for an account with nowhere to put a block')
      assert.equal(s2.pool.length, 0, 'a bare press fell back to a pool chain the reader did not pick')
    })
  })

  it('still starts a named pool chain, because a reader who wants LTC picks LTC', async () => {
    // Point 3 of the brief. This change is about what a BARE press does; the picker's press names
    // its chain and must be untouched by it.
    const s2 = seams()
    await withScreen(tree(s2), mounted(), async (s) => {
      await s.settle()
      await s.click(s.byRole('button', 'Named press in the bar'))
      await s.settle()

      assert.deepEqual(
        s2.pool.map((p) => p.chain.chain),
        [chain().chain],
        'a named pool chain no longer starts, so the fix took the pool with it',
      )
      assert.equal(s2.ember.length, 0, 'naming a pool chain started EMBER as well')
    })
  })
})

/* ══════════════════════════════ 2. one session, not two ══════════════════════════════ */

describe('the mining session — one miner, however many surfaces press it', () => {
  it('does not build a second EMBER miner when the page and the bar are both pressed', async () => {
    // THE MUTATION PROOF for item 4. Put the miner back in `EmberPanel`'s local state and this
    // reads 2: the page's Start builds one and the bar's builds another, both grinding, both
    // sweeping, on one machine whose duty cycle the reader set once.
    const s2 = seams()
    await withScreen(tree(s2), mounted(), async (s) => {
      await s.settle()
      await s.click(s.byRole('button', /^Start mining EMBER$/))
      await s.settle()
      await s.click(s.byRole('button', 'Bare press in the bar'))
      await s.settle()

      assert.equal(
        s2.ember.length,
        1,
        'the mining page and the bar built one EMBER miner each. That is double the machine’s ' +
          'load, two event streams against a node that caps them, and two sweeps racing one ' +
          'nonce — of which the chain takes one and the other pays a fee for nothing',
      )
    })
  })

  it('shows the page and the bar the same running session, so either can stop it', async () => {
    const s2 = seams()
    await withScreen(tree(s2), mounted(), async (s) => {
      await s.settle()
      await s.click(s.byRole('button', 'Bare press in the bar'))
      await s.settle()

      // Started from the bar, and the PAGE's control is the one that reads as running.
      assert.ok(
        s.queryByRole('button', /^Stop mining$/),
        'a session started in the bar leaves the mining page offering to start it again, which is ' +
          'the press that builds the second miner',
      )

      await s.click(s.byRole('button', /^Stop mining$/))
      await s.settle()
      assert.equal(s2.ember[0]?.stopped, 1, 'the page’s Stop did not reach the session’s miner')
    })
  })

  it('stops the EMBER miner when a pool chain is started, rather than running both', async () => {
    const s2 = seams()
    await withScreen(tree(s2), mounted(), async (s) => {
      await s.settle()
      await s.click(s.byRole('button', 'Bare press in the bar'))
      await s.settle()
      await s.click(s.byRole('button', 'Named press in the bar'))
      await s.settle()

      assert.equal(
        s2.ember[0]?.stopped,
        1,
        'switching to a pool chain left the EMBER miner hashing. Two miners are two sets of ' +
          'threads on one budget, and the bar can only stop the one it thinks is running',
      )
      assert.equal(s2.pool.length, 1, 'the pool chain did not start')
    })
  })
})
