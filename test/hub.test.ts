/**
 * The client, checked against the surface hub-api actually serves.
 *
 * ── Why this file exists ───────────────────────────────────────────────────────────────────────
 *
 * `wallet/src/pricingclient.ts` calls `GET /v1/quotes`. Pricing has never served that route — the
 * rate board is `GET /rates` — and the mistake survived review, survived typecheck, and is item 7
 * on hub-api's own gap list. Nothing in a TypeScript build catches a wrong path: the types on both
 * sides are perfect and the string between them is fiction.
 *
 * So every request this bundle can make is asserted below against a fetch stub: the METHOD, the
 * PATH and the QUERY. Each expectation carries the `hub-api/src/server.ts` line the route was read
 * off. If hub-api moves a route, the citation says where to look; if this client invents one, the
 * last test in the file fails.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { __resetAuth, setTokens } from '../src/lib/api.ts'
import { __resetObs } from '../src/lib/obs.ts'
import {
  ACTIVITY_PAGE_SIZE,
  CONVERSION_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  convert,
  loadActivity,
  loadConversions,
  loadDashboard,
  loadFactors,
  loadNextActions,
  loadPortfolio,
  loadSessions,
  loadTransfers,
  quoteConversion,
  revokeAllSessions,
  revokeSession,
  search,
} from '../src/lib/hub.ts'
import {
  installFetch,
  installStorage,
  installWindow,
  removeStorage,
  removeWindow,
  type FetchStub,
} from './browser-stubs.ts'

let stub: FetchStub

/** Where hub-api and identity live under `pnpm dev`, per the surface registry. */
const HUB = 'http://localhost:3010'
const NIMBUS = 'http://localhost:4001'

beforeEach(() => {
  // Served from Vite's port, so this app's own API is cross-origin and the base is absolute —
  // which is exactly what makes the full URL assertable here.
  installWindow('http://localhost:5180/')
  installStorage()
  __resetAuth()
  setTokens({ accessToken: 'a1', refreshToken: 'r1' })
  stub = installFetch(() => body({}))
})

afterEach(() => {
  stub.restore()
  __resetObs()
  removeStorage()
  removeWindow()
})

function body(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-0001' },
  })
}

const only = () => {
  const call = stub.calls[0]
  if (!call) throw new Error('no request was made')
  assert.equal(stub.calls.length, 1, 'exactly one request')
  return call
}

const signal = () => new AbortController().signal

/* ──────────────────────────── the five hub-api routes ─────────────────────── */

describe('GET /v1/dashboard — hub-api/src/server.ts', () => {
  it('is a bare GET to the composed endpoint, with the bearer attached', async () => {
    stub.restore()
    stub = installFetch(() => body({ tiles: {}, degraded: [] }))
    await loadDashboard(signal())
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url, `${HUB}/v1/dashboard`)
    assert.equal(call.headers['authorization'], 'Bearer a1')
  })
})

describe('GET /v1/portfolio — hub-api/src/server.ts', () => {
  it('reads the tile from under the `portfolio` key, not from the top level', async () => {
    // server.ts returns `{ portfolio: composePortfolioTile(...) }`. A client typed against the
    // tile at the top level would compile and then read `undefined.status` at runtime.
    stub.restore()
    stub = installFetch(() =>
      body({ portfolio: { status: 'ok', upstream: 'ledger', reason: null, cached: false, ageMs: null, data: { totalUsd: '5' } } }),
    )
    const result = await loadPortfolio(signal())
    assert.equal(only().url, `${HUB}/v1/portfolio`)
    assert.equal(result.portfolio.status, 'ok')
    assert.equal(result.portfolio.data.totalUsd, '5')
  })
})

describe('GET /v1/activity — hub-api/src/server.ts', () => {
  it('OMITS the cursor on the first page, which is the page hub-api caches', async () => {
    // hub-api/src/server.ts decides cacheability with `searchParams.get('cursor') === null`.
    // Sending `cursor=` or `cursor=null` defeats the cache on every first load in the estate.
    await loadActivity(signal(), null)
    const url = new URL(only().url)
    assert.equal(url.pathname, '/v1/activity')
    assert.equal(url.searchParams.get('cursor'), null)
    assert.equal(url.searchParams.get('limit'), String(ACTIVITY_PAGE_SIZE))
  })

  it('passes a cursor through verbatim, including characters that need encoding', async () => {
    // The cursor is activity's opaque keyset position. hub-api does not parse it and neither does
    // this client; a re-encoded cursor is a second format to keep in step for ever.
    const opaque = 'eyJhdCI6IjIwMjYtMDMtMTQifQ==+/'
    await loadActivity(signal(), opaque)
    assert.equal(new URL(only().url).searchParams.get('cursor'), opaque)
  })

  it('sends a limit inside hub-api’s accepted range', async () => {
    // server.ts rejects anything that is not a whole number in 1..100 with a 400.
    assert.ok(Number.isInteger(ACTIVITY_PAGE_SIZE))
    assert.ok(ACTIVITY_PAGE_SIZE >= 1 && ACTIVITY_PAGE_SIZE <= 100)
    await loadActivity(signal(), null, 100)
    assert.equal(new URL(only().url).searchParams.get('limit'), '100')
  })

  it('parses the FLAT page shape, not a tile wrapper', async () => {
    // server.ts puts `records`/`nextCursor` beside `status`/`reason`/`cached`/`ageMs` at
    // the top level. This is the one hub-api response that is not a `Tile<T>`.
    stub.restore()
    stub = installFetch(() =>
      body({ records: [{ id: 'a' }], nextCursor: 'c1', status: 'degraded', reason: 'stale', cached: true, ageMs: 900 }),
    )
    const page = await loadActivity(signal(), null)
    assert.equal(page.records.length, 1)
    assert.equal(page.nextCursor, 'c1')
    assert.equal(page.status, 'degraded')
    assert.equal(page.ageMs, 900)
  })
})

describe('GET /v1/next-actions — hub-api/src/server.ts', () => {
  it('uses the hyphenated path', async () => {
    // `/v1/nextActions` and `/v1/next_actions` both look right and both 404.
    await loadNextActions(signal())
    assert.equal(only().url, `${HUB}/v1/next-actions`)
  })
})

describe('GET /v1/search — hub-api/src/server.ts', () => {
  it('sends the query as `q`', async () => {
    await search(signal(), 'ember1q')
    const url = new URL(only().url)
    assert.equal(url.pathname, '/v1/search')
    assert.equal(url.searchParams.get('q'), 'ember1q')
  })

  it('agrees with hub-api’s own length cap', async () => {
    // hub-api/src/server.ts caps `q` at 128. The bar's input carries the same maxLength, so an over-long query is
    // refused where the reader can see it rather than by a 400 they cannot act on.
    assert.equal(MAX_SEARCH_LENGTH, 128)
  })
})

/* ─────────────────────────── the conversion desk ──────────────────────────── */

describe('POST /v1/conversions/quote — hub-api/src/server.ts, 557', () => {
  it('posts the intent and asks for no idempotency key', async () => {
    // The quote books nothing, and wallet's quote route takes no key. Sending one would put a key
    // in play that the conversion is then either forced to reuse or forced to abandon.
    stub.restore()
    stub = installFetch(() => body({ quote: { toAssetCode: 'EMBER', hold: false, holdNotice: 'x' } }))
    const answer = await quoteConversion(signal(), {
      fromAssetCode: 'BTC',
      toAssetCode: 'EMBER',
      amount: '100000',
    })
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url, `${HUB}/v1/conversions/quote`)
    assert.equal(call.headers['idempotency-key'], undefined)
    assert.deepEqual(JSON.parse(call.body ?? 'null'), {
      fromAssetCode: 'BTC',
      toAssetCode: 'EMBER',
      amount: '100000',
    })
    assert.equal(answer.quote.hold, false)
  })

  it('reads the quote from under the `quote` key, not from the top level', async () => {
    // Same class of defect as the portfolio tile above: a client typed against the quote at the
    // top level compiles and then renders `undefined` where the amounts go.
    stub.restore()
    stub = installFetch(() => body({ quote: { toAmountFormatted: '12.5', holdNotice: 'not held' } }))
    const answer = await quoteConversion(signal(), {
      fromAssetCode: 'LTC',
      toAssetCode: 'EMBER',
      amount: '1',
    })
    assert.equal(answer.quote.toAmountFormatted, '12.5')
    assert.equal(answer.quote.holdNotice, 'not held')
  })
})

describe('POST /v1/conversions — hub-api/src/server.ts, 587', () => {
  it('carries the caller’s idempotency key in the header the service reads', async () => {
    // `micro-wallet` answers 400 `idempotency_key_required` without it, and the whole
    // one-intent-one-conversion mechanism is this header. The spelling is the one thing about it a
    // type cannot check.
    stub.restore()
    stub = installFetch(() => body({ entryId: 'e1', replayed: false, summary: {} }))
    const receipt = await convert(
      { fromAssetCode: 'DOGE', toAssetCode: 'EMBER', amount: '5000' },
      'convert:2026-08-17:abcdefgh',
    )
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url, `${HUB}/v1/conversions`)
    assert.equal(call.headers['idempotency-key'], 'convert:2026-08-17:abcdefgh')
    assert.deepEqual(JSON.parse(call.body ?? 'null'), {
      fromAssetCode: 'DOGE',
      toAssetCode: 'EMBER',
      amount: '5000',
    })
    assert.equal(receipt.replayed, false)
  })

  it('sends the intent it was handed and nothing else', async () => {
    // The frozen object from the confirm step goes on the wire unchanged. A client that added a
    // field — a display amount, a client timestamp — would be a second body under one key the
    // moment anything about the display changed, which is a 409 the reader cannot act on.
    await convert({ fromAssetCode: 'BTC', toAssetCode: 'EMBER', amount: '1' }, 'convert:k')
    assert.deepEqual(Object.keys(JSON.parse(only().body ?? '{}')).sort(), [
      'amount',
      'fromAssetCode',
      'toAssetCode',
    ])
  })
})

describe('GET /v1/conversions — hub-api/src/server.ts, 631', () => {
  it('OMITS the cursor on the first page, which is the page hub-api caches', async () => {
    // Same cache key rule as activity: hub-api keys the cached branch on the cursor being absent,
    // so `cursor=` defeats the cache on every first load of this panel in the estate.
    await loadConversions(signal())
    const url = new URL(only().url)
    assert.equal(url.pathname, '/v1/conversions')
    assert.equal(url.searchParams.get('cursor'), null)
    assert.equal(url.searchParams.get('limit'), String(CONVERSION_PAGE_SIZE))
  })

  it('sends a limit inside hub-api’s accepted range', async () => {
    assert.ok(Number.isInteger(CONVERSION_PAGE_SIZE))
    assert.ok(CONVERSION_PAGE_SIZE >= 1 && CONVERSION_PAGE_SIZE <= 100)
  })

  it('parses the FLAT page shape, so an outage is not read as an empty history', async () => {
    // `status` sits beside the records rather than wrapping them. A client that dropped it would
    // render hub-api's `empty: { conversions: [] }` fallback as "you have never converted
    // anything" on the one screen where that is a statement about somebody's money.
    stub.restore()
    stub = installFetch(() =>
      body({ conversions: [], nextCursor: null, status: 'unavailable', reason: 'wallet did not answer', cached: false, ageMs: null }),
    )
    const page = await loadConversions(signal())
    assert.equal(page.conversions.length, 0)
    assert.equal(page.status, 'unavailable')
    assert.equal(page.reason, 'wallet did not answer')
  })
})

describe('GET /v1/transfers — hub-api/src/server.ts, 681', () => {
  it('is its own path, paged the same way', async () => {
    await loadTransfers(signal(), 'cursor-1')
    const url = new URL(only().url)
    assert.equal(url.pathname, '/v1/transfers')
    assert.equal(url.searchParams.get('cursor'), 'cursor-1')
    assert.equal(url.searchParams.get('limit'), String(CONVERSION_PAGE_SIZE))
  })

  it('carries the direction, which is the only thing that makes a transfer readable', async () => {
    // `out` and `in` are the same row otherwise. A list that drops it shows the reader a set of
    // amounts with no sign.
    stub.restore()
    stub = installFetch(() =>
      body({ transfers: [{ id: 't1', direction: 'in', assetCode: 'EMBER' }], nextCursor: null, status: 'ok', reason: null, cached: false, ageMs: null }),
    )
    const page = await loadTransfers(signal())
    assert.equal(page.transfers[0]?.direction, 'in')
  })
})

/* ──────────────────────── identity, called directly ───────────────────────── */

describe('identity', () => {
  it('reads the session list from Nimbus, cross-origin, with the user’s own bearer', async () => {
    // hub-api composes no session list: identity's `GET /sessions` is behind `authenticateUser`,
    // which refuses a service token, so no credential hub-api could hold would reach it.
    stub.restore()
    stub = installFetch(() => body({ sessions: [] }))
    await loadSessions(signal())
    const call = only()
    assert.equal(call.url, `${NIMBUS}/sessions`)
    assert.equal(call.headers['authorization'], 'Bearer a1')
  })

  it('revokes ONE session by id, url-encoded', async () => {
    stub.restore()
    stub = installFetch(() => new Response(null, { status: 204 }))
    await revokeSession('a b/c')
    const call = only()
    assert.equal(call.method, 'DELETE')
    assert.equal(call.url, `${NIMBUS}/sessions/a%20b%2Fc`)
  })

  it('signs out everywhere with a DELETE on the collection, not on a member', async () => {
    // identity/src/server.ts. The difference between this and the route above is one path
    // segment and every session the user has.
    stub.restore()
    stub = installFetch(() => body({ revoked: 3 }))
    const result = await revokeAllSessions()
    const call = only()
    assert.equal(call.method, 'DELETE')
    assert.equal(call.url, `${NIMBUS}/sessions`)
    assert.equal(result.revoked, 3)
  })

  it('reads the MFA factors from identity, not from hub-api', async () => {
    stub.restore()
    stub = installFetch(() => body({ factors: [], recoveryCodesRemaining: 5 }))
    const factors = await loadFactors(signal())
    assert.equal(only().url, `${NIMBUS}/mfa/factors`)
    assert.equal(factors.recoveryCodesRemaining, 5)
  })
})

/* ───────────────────────── the surface, as a whole ────────────────────────── */

describe('the request surface', () => {
  it('touches ONLY paths hub-api and identity actually serve', async () => {
    // The guard against the `/v1/quotes` class of defect. Every path this bundle can produce is
    // exercised and compared with the two route tables, read off:
    //   hub-api/src/server.ts, 251, 265, 285, 312, 347, 396, 421, 557, 587, 631, 681
    //   identity/src/server.ts, 1082, 1092, 1104
    //
    // `/v1/conversions/:id` (server.ts, 728) is deliberately absent: this bundle never calls it,
    // because every field of that response is already on the row the list rendered. A route in
    // this set that nothing below produces would assert nothing at all.
    const HUB_ROUTES = new Set([
      '/v1/dashboard',
      '/v1/portfolio',
      '/v1/activity',
      '/v1/search',
      '/v1/next-actions',
      '/v1/conversions/quote',
      '/v1/conversions',
      '/v1/transfers',
    ])
    const IDENTITY_ROUTES = new Set(['/sessions', '/mfa/factors', '/auth/me', '/auth/refresh', '/auth/exchange'])

    stub.restore()
    stub = installFetch(() =>
      body({ portfolio: {}, quote: {}, summary: {}, sessions: [], factors: [], recoveryCodesRemaining: 0 }),
    )

    const intent = { fromAssetCode: 'BTC', toAssetCode: 'EMBER', amount: '1' }
    await Promise.all([
      loadDashboard(signal()),
      loadPortfolio(signal()),
      loadActivity(signal(), null),
      loadActivity(signal(), 'c1'),
      loadNextActions(signal()),
      search(signal(), 'x'),
      quoteConversion(signal(), intent),
      convert(intent, 'convert:surface'),
      loadConversions(signal()),
      loadConversions(signal(), 'c1'),
      loadTransfers(signal()),
      loadSessions(signal()),
      loadFactors(signal()),
      revokeSession('s1'),
      revokeAllSessions(),
    ])

    assert.ok(stub.calls.length >= 15)
    for (const call of stub.calls) {
      const url = new URL(call.url)
      const origin = `${url.protocol}//${url.host}`
      if (origin === HUB) {
        assert.ok(HUB_ROUTES.has(url.pathname), `hub-api serves no ${url.pathname}`)
      } else if (origin === NIMBUS) {
        // A session revoke is `/sessions/<id>`; compare the collection prefix.
        const base = url.pathname.startsWith('/sessions/') ? '/sessions' : url.pathname
        assert.ok(IDENTITY_ROUTES.has(base), `identity serves no ${url.pathname}`)
      } else {
        assert.fail(`unexpected origin ${origin}`)
      }
    }
  })
})
