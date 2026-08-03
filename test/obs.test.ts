/**
 * The two parts of the browser reporter that are pure. The listeners themselves need a browser
 * and are listed as untested in the README.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { __resetObs, enqueueBounded, envelope, flush, kindFor, report } from '../src/lib/obs.ts'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { installFetch, installWindow, json, removeWindow } from './browser-stubs.ts'

afterEach(() => {
  __resetObs()
  removeWindow()
})

const event = (n: number) => envelope({ app: 'trade', type: 'T', message: `m${n}` })

describe('the queue bound', () => {
  it('keeps the newest events when a page is throwing in a loop', () => {
    installWindow('https://trade.cloudsforge.online/')
    let queue = [] as ReturnType<typeof envelope>[]
    for (let i = 0; i < 40; i += 1) queue = enqueueBounded(queue, event(i))
    // A loop's thousandth exception is identical to its first; the state just before the tab was
    // closed is not, so the queue drops from the front.
    assert.equal(queue.length, 32)
    assert.equal(queue[0]?.attributes['message'], 'm8')
    assert.equal(queue[31]?.attributes['message'], 'm39')
  })
})

describe('the envelope', () => {
  it('stamps the page the event came from', () => {
    installWindow('https://trade.cloudsforge.online/reports?tab=1')
    const wrapped = event(1)
    assert.equal(wrapped.attributes['url'], 'https://trade.cloudsforge.online/reports?tab=1')
    assert.equal(wrapped.route, '/reports', 'the route is the column Lantern groups on')
    assert.equal(
      wrapped.attributes['release'],
      'unknown',
      'no document, so the release is honestly unknown',
    )
    assert.ok(!Number.isNaN(Date.parse(String(wrapped.attributes['at']))))
  })

  /**
   * These are the two defects that made every send a silent no-op. They are asserted against the
   * literal key names because that is the contract — `lantern/src/rum.ts:99` reads `kind` and
   * nothing else, and `fromWire` returns null for a record without one, which the sink then
   * reports as `202 {"stored":0}`.
   */
  it('carries a kind from Lantern’s closed set, never a bare type', () => {
    installWindow('https://trade.cloudsforge.online/')
    const wrapped = envelope({ app: 'trade', type: 'NetworkError', message: 'boom' })
    assert.equal(wrapped.kind, 'fetch_error')
    assert.ok(!('type' in wrapped), 'there is no `type` column; it must not sit at the top level')
    assert.equal(wrapped.attributes['type'], 'NetworkError', 'the precise classifier survives')
  })

  it('keeps the columnless fields inside attributes, where the jsonb column is', () => {
    installWindow('https://trade.cloudsforge.online/')
    const wrapped = envelope({
      app: 'trade',
      type: 'WindowError',
      message: 'boom',
      stack: 'at x',
      context: { line: 1 },
    })
    for (const columnless of ['message', 'stack', 'context', 'release', 'userAgent']) {
      assert.ok(!(columnless in wrapped), `${columnless} has no column and must not be top level`)
      assert.ok(columnless in wrapped.attributes, `${columnless} belongs in attributes`)
    }
    // The nine keys `fromWire` reads, and nothing else.
    assert.deepEqual(Object.keys(wrapped).sort(), [
      'app',
      'attributes',
      'kind',
      'requestId',
      'route',
      'session',
      'statusCode',
      'traceId',
      'valueMs',
    ])
  })

  it('rounds a duration to a whole millisecond, because value_ms is an INTEGER column', () => {
    installWindow('https://trade.cloudsforge.online/')
    const wrapped = envelope({ app: 'trade', type: 'PageLoad', message: '/', valueMs: 12.7 })
    assert.equal(wrapped.valueMs, 13)
    assert.equal(wrapped.kind, 'page_load')
  })
})

describe('kindFor', () => {
  it('maps every classifier this bundle emits onto a kind the CHECK constraint accepts', () => {
    // Mirrors `RUM_KINDS` in lantern/src/rum.ts:25 and the constraint at migrations.ts:222.
    const accepted = new Set([
      'page_load',
      'first_contentful_paint',
      'largest_contentful_paint',
      'fetch_error',
      'unhandled_rejection',
      'error',
    ])
    assert.equal(kindFor('PageLoad'), 'page_load')
    assert.equal(kindFor('ResourceError'), 'error')
    assert.equal(kindFor('WindowError'), 'error')
    assert.equal(kindFor('UnhandledRejection'), 'unhandled_rejection')
    assert.equal(kindFor('FirstContentfulPaint'), 'first_contentful_paint')
    // Every classifier used anywhere in the bundle, plus an unknown one, must land in the set —
    // anything outside it is dropped at ingest with reason `unknown_kind`.
    for (const type of [
      'UnknownError',
      'RefreshFailed',
      'RefreshUnreachable',
      'NetworkError',
      'NonJsonErrorBody',
      'AuthCallbackFailed',
      'TypeError',
      'ResourceError',
      'something nobody has written yet',
    ]) {
      assert.ok(accepted.has(kindFor(type)), `${type} maps outside the accepted set`)
    }
  })
})

/**
 * The send itself — the two defects that made every previous send a no-op, pinned at the boundary
 * where they actually mattered. `envelope` being right is not enough: the path and the envelope KEY
 * are chosen in `flush`, and both were wrong.
 */
describe('the send', () => {
  it('posts to /ingest/client under a "samples" key', async () => {
    installWindow('http://localhost:5173/reports')
    const fetch = installFetch(() => json(202, { stored: 1, dropped: 0, reasons: {} }))
    try {
      report({ app: 'trade', type: 'NetworkError', message: 'boom' })
      await flush()

      assert.equal(fetch.calls.length, 1)
      const call = fetch.calls[0]
      assert.ok(call)
      // The path Lantern serves (`lantern/src/server.ts:442`). `/ingest/browser` is served by
      // nothing and 404s without CORS headers, which the page cannot even read.
      assert.equal(new URL(call.url).pathname, '/ingest/client')

      const body = JSON.parse(call.body ?? 'null') as Record<string, unknown>
      assert.ok(Array.isArray(body['samples']), 'the key Lantern reads is "samples"')
      assert.equal(body['events'], undefined, '"events" is explicitly refused with a 400')
      const sample = (body['samples'] as Record<string, unknown>[])[0]
      assert.ok(sample)
      assert.equal(sample['kind'], 'fetch_error')
      assert.equal(sample['type'], undefined, 'there is no `type` column')
    } finally {
      fetch.restore()
    }
  })

  it('warns when a 2xx stored fewer samples than it was sent', async () => {
    installWindow('http://localhost:5173/')
    const warnings: unknown[][] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => void warnings.push(args)
    // The exact answer Lantern gives a correct path carrying a wrong record shape. A 202 is NOT
    // success, and treating it as one is what hid this for months.
    const fetch = installFetch(() =>
      json(202, { stored: 0, dropped: 1, reasons: { unknown_kind: 1 } }),
    )
    try {
      report({ app: 'trade', type: 'NetworkError', message: 'boom' })
      await flush()
      assert.equal(warnings.length, 1, 'a fully dropped batch must not pass in silence')
      assert.match(String(warnings[0]?.[0]), /stored 0 of 1/)
    } finally {
      console.warn = originalWarn
      fetch.restore()
    }
  })

  it('warns on a refusal but never throws, because telemetry may not break the page', async () => {
    installWindow('http://localhost:5173/')
    const warnings: unknown[][] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => void warnings.push(args)
    const fetch = installFetch(() => json(404, { error: { code: 'unknown_ingest_path' } }))
    try {
      report({ app: 'trade', type: 'NetworkError', message: 'boom' })
      // Must resolve, not reject. Rule 1.
      await flush()
      assert.equal(warnings.length, 1)
      assert.match(String(warnings[0]?.[0]), /ingest rejected this batch — 404/)
    } finally {
      console.warn = originalWarn
      fetch.restore()
    }
  })

  it('swallows a network failure entirely, and still does not throw', async () => {
    installWindow('http://localhost:5173/')
    const fetch = installFetch(() => {
      throw new Error('connection refused')
    })
    try {
      report({ app: 'trade', type: 'NetworkError', message: 'boom' })
      await flush()
    } finally {
      fetch.restore()
    }
  })
})
/**
 * THE JOURNEY MOCK MUST INTERCEPT
 THE PATH THE BUNDLE ACTUALLY POSTS TO.
 *
 * `test/journeys/browser.ts` fulfils Lantern's ingest for every scenario so that none of them
 * fails on a connection it did not arrange. It intercepted `/ingest/browser` for exactly as long
 * as the bundle posted there — and when the bundle moved, the intercept went on matching NOTHING
 * while still reading as coverage. That is this estate's signature defect in miniature: a check
 * that cannot fail. Nothing went red when the two drifted apart, because a mock that matches no
 * request is indistinguishable from a mock that was never needed.
 *
 * So the two are compared against each other rather than each being pinned to a literal. Pinning
 * both to `/ingest/client` separately would be two copies of one decision, which is the same
 * failure wearing a different coat.
 */
describe('the journey mock and the bundle agree about the ingest path', () => {
  it('intercepts exactly the path obs.ts posts to', (t) => {
    const journeys = fileURLToPath(new URL('./journeys/browser.ts', import.meta.url))
    if (!existsSync(journeys)) {
      // `t.skip`, never a bare `return`: a return marks this GREEN, and a silently-green check on
      // a file that does not exist is precisely the thing being guarded against here.
      t.skip('this repository carries no journey harness')
      return
    }
    const obs = readFileSync(fileURLToPath(new URL('../src/lib/obs.ts', import.meta.url)), 'utf8')
    const declared = /const INGEST_PATH = '([^']+)'/.exec(obs)?.[1]
    assert.ok(declared, 'obs.ts no longer declares INGEST_PATH; this check has stopped measuring')

    const mock = readFileSync(journeys, 'utf8')
    const intercepted = [...mock.matchAll(/url\.pathname === '(\/ingest\/[^']*)'/g)].map((m) => m[1])
    assert.ok(intercepted.length > 0, 'the journey harness intercepts no /ingest/ path at all')
    assert.deepEqual(
      intercepted,
      [declared],
      `the harness intercepts ${intercepted.join(', ')} but the bundle posts to ${declared}`,
    )
  })
})
