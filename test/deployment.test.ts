/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE NETWORK THAT HAS NO MINING POOL — micro-org#406.
 *
 * MEASURED, 2026-08-11. `https://hub-testnet.cloudsforge.online/mine` could not load pool status:
 * `GET https://pool-testnet.cloudsforge.online/v1/pool` answers **502** and always will, because
 * this estate runs no pool container at all — micro-pool is behind `profiles: ["pool"]` in
 * `deploy/compose/docker-compose.estate.yml` and `compose/testnet.env` does not name that profile.
 * Deliberate and permanent: micro-pool validates `POOL_NETWORK` against what its node reports and
 * requires a node URL and a payout address per chain, so a pool started on a testnet estate refuses
 * to boot.
 *
 * What that cost was not the pool. `MinePage` rendered `<Failed>` for the WHOLE PAGE when the read
 * failed, so on the one network where EMBER is the only thing a browser can usefully mine, EMBER
 * was behind an error about a service the reader had not asked for and a Try again button that
 * could never succeed.
 *
 * So this file asserts two properties, and the second is the one that is easy to lose in a later
 * edit:
 *
 *   1. A DELIBERATE ABSENCE IS EXPLAINED, NOT REPORTED AS A FAULT — with the address of the
 *      network that does run a pool, and with no `/v1/pool` request made at all.
 *   2. THE ABSENCE COSTS THE READER NOTHING BUT THE POOL. The picker, the EMBER panel and the
 *      Start control are all still there, on both the "no pool here" path and the "the pool is
 *      down" path, because none of them goes anywhere near micro-pool.
 *
 * Three groups, in the order the answer travels: reading the document, fetching it, and what a
 * reader ends up looking at.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { AuthProvider } from '../src/lib/auth.tsx'
import {
  DEPLOYMENT_PATH,
  DEPLOYMENT_TIMEOUT_MS,
  DeploymentProvider,
  fetchPresence,
  poolApiWorthAsking,
  readPresence,
} from '../src/lib/deployment.tsx'
import { unlabelledSurfaceUrl } from '../src/lib/hosts.ts'
import type { PoolSummary } from '../src/lib/pool.ts'
import { MinePage } from '../src/pages/mine.tsx'
import { MiningProvider } from '../src/mining/session.tsx'
import { installFetch, installWindow, json, removeWindow } from './browser-stubs.ts'
import { withScreen, type Routes } from './dom.ts'

const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const withoutComments = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. READING THE DOCUMENT
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

describe('reading /deployment.json', () => {
  it('treats ONLY the exact string "absent" as absent, and everything else as present', () => {
    /*
     * The asymmetry is the whole safety of the mechanism, and it is worth stating which way round
     * and why. A false `absent` tells somebody with hardware pointed at a working pool that the
     * pool does not exist; a false `present` shows them the page they have always had, which fails
     * a read and says so. The first is a lie, the second is a bad minute.
     *
     * The empty string is the case that will actually occur: `POOL_API_PRESENCE` unset renders as
     * `{"poolApi":""}` through envsubst, which — but for the `ENV` default in the Dockerfile —
     * would be what every host that has never heard of this flag serves.
     */
    assert.equal(readPresence({ poolApi: 'absent' }), 'absent')

    for (const body of [
      { poolApi: '' },
      { poolApi: 'present' },
      { poolApi: 'Absent' }, // a typo must not blank the pool out of this page
      { poolApi: ' absent' },
      { poolApi: false },
      { poolApi: null },
      {}, // an image that predates the field
      { pool: 'absent' }, // the wrong field entirely
      null,
      'absent', // a bare string, not the document shape
      42,
      [],
    ] as const) {
      assert.equal(
        readPresence(body),
        'present',
        `${JSON.stringify(body)} was read as "there is no pool here", which is the expensive error`,
      )
    }
  })

  it('asks the pool for nothing until the answer is in, and never when it is "absent"', () => {
    // `unknown` blocks rather than allows, and that is the point rather than an oversight: the wait
    // is one same-origin round trip, and a request fired during it lands on the 502 this whole
    // mechanism exists to stop rendering.
    assert.equal(poolApiWorthAsking('present'), true)
    assert.equal(poolApiWorthAsking('absent'), false)
    assert.equal(poolApiWorthAsking('unknown'), false)
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * 2. FETCHING IT
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

describe('fetching /deployment.json', () => {
  it('reads it from this origin, without credentials, and never under /v1', async () => {
    installWindow('https://hub-testnet.cloudsforge.online/mine')
    const stub = installFetch(() => json(200, { poolApi: 'absent' }))
    try {
      assert.equal(await fetchPresence(), 'absent')
      assert.equal(stub.calls.length, 1)
      const call = stub.calls[0]
      assert.ok(call)
      assert.equal(call.url, `https://hub-testnet.cloudsforge.online${DEPLOYMENT_PATH}`)
      assert.equal(call.method, 'GET')
      // Not `/v1`: on this surface that prefix is hub-api's, and on the pool's it is the service
      // whose absence this document reports — a `/v1` address would be answered by the very 502 it
      // exists to explain.
      assert.ok(!call.url.includes('/v1'))
      assert.ok(!call.url.includes('pool.'), 'a cross-origin read would need a CORS grant to work')
    } finally {
      stub.restore()
      removeWindow()
    }
  })

  it('answers "present" for every failure there is, and never throws', async () => {
    installWindow('https://hub.cloudsforge.online/mine')
    const failures: Array<[string, () => Response | Promise<Response>]> = [
      ['404 from an image that predates the document', () => json(404, { error: 'not_found' })],
      ['500 from a broken container', () => json(500, { error: 'boom' })],
      ['HTML instead of JSON', () => new Response('<!doctype html>', { status: 200 })],
      ['an empty body', () => new Response('', { status: 200 })],
      [
        'a network fault',
        () => {
          throw new TypeError('Failed to fetch')
        },
      ],
    ]
    try {
      for (const [what, handler] of failures) {
        const stub = installFetch(handler)
        try {
          assert.equal(
            await fetchPresence(),
            'present',
            `${what} was read as "there is no pool here"`,
          )
        } finally {
          stub.restore()
        }
      }
    } finally {
      removeWindow()
    }
  })

  it('resolves rather than rejects when the caller aborts', async () => {
    installWindow('https://hub.cloudsforge.online/mine')
    const controller = new AbortController()
    const stub = installFetch(async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    try {
      assert.equal(await fetchPresence(controller.signal), 'present')
    } finally {
      stub.restore()
      removeWindow()
    }
  })

  it('gives itself a shorter budget than any API read', () => {
    // Two seconds, against `lib/api.ts`'s eight. This is nginx answering a `return 200` from the
    // origin that just served the page; a longer budget would spend a reader's time on the one
    // outcome that changes nothing, because a timeout resolves to `present` anyway.
    assert.ok(DEPLOYMENT_TIMEOUT_MS > 0)
    assert.ok(DEPLOYMENT_TIMEOUT_MS <= 3000, 'the page waits too long for its own container')
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * 3. THE MECHANISM THAT PUTS THE ANSWER THERE
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

describe('the container serves the document from its environment', () => {
  it('templates it at container start, into an .inc, with a default in the image', () => {
    /*
     * Four things have to line up, and each has a way of failing quietly except the last, which
     * fails loudly and totally:
     *
     *   1. THE TEMPLATE IS IN THE IMAGE, or the location includes a file that does not exist.
     *   2. IT IS EXPANDED INTO `.inc`, NOT `.conf`. Everything matching `/etc/nginx/conf.d/*.conf`
     *      is included at HTTP level by the stock config, so a `.conf` full of bare directives
     *      would be parsed outside any server block.
     *   3. THE VARIABLE IS NAMED IN THE TEMPLATE, or the mechanism configures nothing.
     *   4. THE VARIABLE HAS A DEFAULT IN THE IMAGE. MEASURED 2026-08-11 on micro-pool-web's
     *      identical mechanism: with `POOL_API_PRESENCE` unset the container EXITED 1 with
     *      `nginx: [emerg] unknown "pool_api_presence" variable`. envsubst substitutes only
     *      variables that are SET and implements no `${VAR:-default}`, so an unset one is left
     *      verbatim and reaches nginx as an nginx variable. Without the `ENV` line this change
     *      would take down every deployment that had not been told about the flag.
     */
    const template = read('deployment.inc.template')
    const dockerfile = read('Dockerfile')
    const nginx = withoutComments(read('nginx.conf'))

    assert.match(template, /\$\{POOL_API_PRESENCE\}/, 'the template does not read the flag')
    assert.match(template, /"poolApi"/, 'the template does not emit the field the bundle reads')
    assert.match(
      dockerfile,
      /COPY\s+deployment\.inc\.template\s+\/etc\/nginx\/templates\/deployment\.inc\.template/,
      'the template is not in the image, so nginx will not start',
    )
    assert.match(
      dockerfile,
      /^ENV\s+POOL_API_PRESENCE=\S+/m,
      'the image has no default for POOL_API_PRESENCE; an unset variable makes nginx refuse to start',
    )
    assert.ok(
      !/templates\/deployment\.inc\.template\s+\/etc\/nginx\/conf\.d\//.test(dockerfile),
      'the template is copied straight to conf.d, where it would never be expanded',
    )
    // The path the bundle asks for and the path nginx answers are the same string, asserted against
    // the constant rather than restated — they live in two languages in two files.
    assert.match(nginx, new RegExp(`location\\s*=\\s*${DEPLOYMENT_PATH}\\b`))
    assert.match(nginx, /include\s+\/etc\/nginx\/conf\.d\/deployment\.inc;/)
    assert.match(nginx, /default_type\s+application\/json;/)
  })

  it('is mounted above the router, so both readers get one answer', () => {
    // Two consumers read it — `/mine` and the mining session in the shell, which outlives the page
    // — and two fetches of one deploy fact are two chances to disagree about it on one screen.
    const app = read('src/app.tsx')
    assert.match(app, /<DeploymentProvider>/, 'nothing mounts the provider, so the flag does nothing')
    assert.ok(
      app.indexOf('<DeploymentProvider>') < app.indexOf('<Routes>'),
      'the provider is inside the router, so a navigation would re-ask its own container',
    )
  })

  it('composes the other network’s pool address rather than naming one', () => {
    // A literal apex in `src/` fails the `rules` job in CI, and rightly: an image that names one
    // estate is an image that works on one estate. The apex comes off the address of the page.
    assert.equal(
      unlabelledSurfaceUrl('hub-testnet.cloudsforge.online', 'pool'),
      'https://pool.cloudsforge.online',
    )
    assert.equal(
      unlabelledSurfaceUrl('hub-staging.example.test', 'pool'),
      'https://pool.example.test',
    )
    // Null everywhere a composed address would resolve to nothing, or to this same estate.
    assert.equal(unlabelledSurfaceUrl('hub.cloudsforge.online', 'pool'), null)
    assert.equal(unlabelledSurfaceUrl('localhost', 'pool'), null)
    assert.equal(unlabelledSurfaceUrl('cloudsforge.online', 'pool'), null)
    assert.equal(unlabelledSurfaceUrl('preview-42.pages.dev', 'pool'), null)
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * 4. WHAT THE READER GETS
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

const SIGNED_IN = { 'cf.accessToken': 'held-access-token', 'cf.refreshToken': 'held-refresh-token' }

const summary = (): PoolSummary => ({
  network: 'mainnet',
  feeBasisPoints: 100,
  pplnsWindowMultiplier: 2,
  payoutsImplemented: false,
  chains: [
    {
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
    },
  ],
})

/** The page under the providers the application mounts it under, this time including the one this
 * file is about. */
const page = (): ReactElement =>
  h(
    MemoryRouter,
    { initialEntries: ['/mine'] },
    h(
      DeploymentProvider,
      null,
      h(AuthProvider, null, h(MiningProvider, null, h(MinePage))),
    ),
  )

const routes = (presence: 'present' | 'absent', pool?: Routes[string]): Routes => ({
  'GET /deployment.json': { status: 200, body: { poolApi: presence } },
  'GET /v1/pool': pool ?? { status: 200, body: summary() },
  'POST /v1/deposits': {
    status: 200,
    body: {
      assignment: {
        id: 'dep_01J000000000000000000000',
        assetCode: 'EMBER',
        chain: 'ember',
        network: 'mainnet',
        walletId: 'wal_01J000000000000000000000',
        address: '0x1111111111111111111111111111111111111111',
        status: 'active',
        assignedAt: '2026-08-10T00:00:00.000Z',
        watchedAt: '2026-08-10T00:00:01.000Z',
      },
    },
  },
  'GET /auth/me': { status: 200, body: { user: { id: 'u1', handle: 'miner', roles: ['player'] } } },
})

describe('/mine on a network with no pool', () => {
  it('explains the absence, points at the network that has one, and asks the pool for nothing', async () => {
    await withScreen(
      page(),
      {
        url: 'https://hub-testnet.cloudsforge.online/mine',
        storage: SIGNED_IN,
        routes: routes('absent'),
      },
      async (s) => {
        await s.settle()

        assert.match(
          s.text(),
          /this network does not run a mining pool/i,
          'the page does not say, in words, that the absence is what it is',
        )
        // THE ASSERTION THAT MAKES THIS A FIX RATHER THAN A REDECORATION. Not "the error was
        // styled better" — no request was made. `/v1/pool` on this network is a 502 that will
        // never be anything else, from the page AND from the session in the bar.
        assert.equal(
          s.api.matching('GET /v1/pool').length,
          0,
          'the page asked a pool that this network does not have',
        )
        // Nothing that reads as a fault: no retry, and no report of an unanswered request.
        assert.ok(
          !/try again/i.test(s.text()),
          'a permanent, deliberate absence was given a retry that can never succeed',
        )
        assert.ok(!/could not/i.test(s.text()), 'a deliberate absence is reported as a failure')

        const onward = s
          .allByRole('link')
          .map((el) => el.getAttribute('href'))
          .filter((href): href is string => href !== null)
        assert.ok(
          onward.includes('https://pool.cloudsforge.online'),
          `no link to the network that does run a pool; found ${JSON.stringify(onward)}`,
        )
        s.clean('the no-pool explanation')
      },
    )
  })

  it('still offers EMBER, which never went through the pool in the first place', async () => {
    await withScreen(
      page(),
      {
        url: 'https://hub-testnet.cloudsforge.online/mine',
        storage: SIGNED_IN,
        routes: routes('absent'),
      },
      async (s) => {
        await s.settle()
        // The defect this whole change exists to end: on the one network where EMBER is the only
        // thing a browser can usefully mine, EMBER was behind a full-page error about the pool.
        assert.ok(s.queryByRole('radio', /EMBER/), 'the EMBER choice is gone from the picker')
        assert.ok(
          s.allByRole('button').some((el) => /start/i.test(s.textOf(el))),
          'there is no way to start mining EMBER on a page whose only fault is that the pool is elsewhere',
        )
        assert.ok(
          !/answered with no chains/i.test(s.text()),
          'the picker reported an answer nobody received — there was no pool to answer',
        )
        s.clean('EMBER on a network with no pool')
      },
    )
  })

  it('says something different, with a retry, when the pool exists and did not answer', async () => {
    await withScreen(
      page(),
      {
        url: 'https://hub.cloudsforge.online/mine',
        storage: SIGNED_IN,
        // A deployment that HAS a pool, whose pool is down. The two states must not read alike:
        // this one may be over in a minute and the reader's move is to try again.
        routes: routes('present', { status: 502, body: { error: 'bad_gateway' } }),
      },
      async (s) => {
        await s.settle()
        assert.ok(
          !/does not run a mining pool/i.test(s.text()),
          'an outage was reported as a deliberate absence, which tells a miner to go away for good',
        )
        assert.ok(
          s.allByRole('button').some((el) => /try again/i.test(s.textOf(el))),
          'a pool that is down offers no way to retry',
        )
        // And still not at the cost of EMBER, which is the half that was lost when this branch
        // rendered <Failed> for the whole page.
        assert.ok(s.queryByRole('radio', /EMBER/), 'a pool outage removed EMBER from the page')
        s.clean('the pool outage')
      },
    )
  })

  it('leaves a deployment WITH a pool exactly as it was', async () => {
    await withScreen(
      page(),
      { url: 'https://hub.cloudsforge.online/mine', storage: SIGNED_IN, routes: routes('present') },
      async (s) => {
        await s.settle()
        assert.ok(s.queryByRole('radio', /Litecoin/), 'the pool chain is missing from the picker')
        assert.ok(
          !/does not run a mining pool/i.test(s.text()),
          'a deployment with a pool was told it has none',
        )
        assert.ok(
          s.api.matching('GET /v1/pool').length > 0,
          'the pool was never read on a deployment that has one',
        )
        s.clean('the ordinary page')
      },
    )
  })
})
