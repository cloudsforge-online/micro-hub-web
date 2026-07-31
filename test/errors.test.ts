/**
 * The estate's error envelope, which is NESTED — and used not to be read that way.
 *
 * ── The defect this file pins ──────────────────────────────────────────────────────────────────
 *
 * Every service in the estate answers a failure with the same three lines:
 *
 *     return { status, body: { error: { code, message, requestId } } }
 *
 * `hub-api/src/server.ts:589-591`, `identity/src/server.ts:1431-1433`, and
 * `service-template/src/server.ts:342`, which every other service is generated from.
 *
 * The version of `src/lib/api.ts` carried over from the web template read that body as FLAT —
 * `{ error?: string }` — and assigned `data.error` straight into the message. Against any real
 * CloudsForge service `data.error` is an OBJECT, so every server-side failure in this app would
 * have rendered on screen as `[object Object]`, with the real message, the error code and the
 * request id all present in the response and all thrown away. The request id is the one string a
 * user can quote that finds their request across every service at once, and `components/states.tsx`
 * exists largely to display it.
 *
 * It is a silent defect: it typechecks, it never throws, and the failure only appears on a screen
 * somebody was already having a bad day on.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { ApiError, __resetAuth, api, noticeFor, readErrorBody, setTokens } from '../src/lib/api.ts'
import { __resetObs } from '../src/lib/obs.ts'
import { installFetch, installStorage, installWindow, removeStorage, removeWindow, type FetchStub } from './browser-stubs.ts'

let stub: FetchStub | null = null

beforeEach(() => {
  installWindow('http://localhost:5180/')
  installStorage()
  __resetAuth()
})

afterEach(() => {
  stub?.restore()
  stub = null
  __resetObs()
  removeStorage()
  removeWindow()
})

describe('readErrorBody', () => {
  it('reads the nested envelope every CloudsForge service sends', () => {
    const parsed = readErrorBody({
      error: { code: 'forbidden', message: 'missing required authority: admin', requestId: 'req-1a2b' },
    })
    assert.equal(parsed.message, 'missing required authority: admin')
    assert.equal(parsed.code, 'forbidden')
    assert.equal(parsed.requestId, 'req-1a2b')
  })

  it('still reads a flat `error` string, which is what a proxy or a hand-written handler sends', () => {
    const parsed = readErrorBody({ error: 'upstream connect error', requestId: 'req-cdn' })
    assert.equal(parsed.message, 'upstream connect error')
    assert.equal(parsed.requestId, 'req-cdn')
  })

  it('prefers the nested message over a top-level one when both are present', () => {
    const parsed = readErrorBody({ message: 'outer', error: { message: 'inner' } })
    assert.equal(parsed.message, 'inner')
  })

  it('reports nothing rather than a stringified object for a body it does not understand', () => {
    // The regression itself: `String({})` is '[object Object]', and a message field holding that
    // is worse than no message, because the caller's honest fallback never gets a chance.
    for (const body of [null, undefined, 42, 'plain text', [], { error: {} }, { error: 123 }]) {
      const parsed = readErrorBody(body)
      assert.equal(parsed.message, undefined, `${JSON.stringify(body)} must yield no message`)
    }
  })

  it('ignores an empty string, which would otherwise blank out the status text', () => {
    assert.equal(readErrorBody({ error: { message: '' } }).message, undefined)
  })
})

describe('end to end, against hub-api’s actual error body', () => {
  it('shows the service’s sentence and the request id, not "[object Object]"', async () => {
    setTokens({ accessToken: 'a1', refreshToken: 'r1' })
    // Byte-for-byte the shape of hub-api/src/server.ts:589-591.
    stub = installFetch(
      () =>
        new Response(
          JSON.stringify({
            error: { code: 'verifier_unavailable', message: 'authentication is temporarily unavailable', requestId: 'req-7f3a' },
          }),
          { status: 503, headers: { 'content-type': 'application/json', 'x-request-id': 'req-7f3a' } },
        ),
    )

    const err = await api('/v1/dashboard').catch((e: unknown) => e)
    if (!(err instanceof ApiError)) throw new Error(`expected an ApiError, got ${String(err)}`)
    assert.equal(err.message, 'authentication is temporarily unavailable')
    assert.notEqual(err.message, '[object Object]')
    assert.equal(err.code, 'verifier_unavailable')
    assert.equal(err.requestId, 'req-7f3a')

    // …and it survives all the way to the sentence a failure state renders.
    const notice = noticeFor(err, 'Could not load your dashboard.')
    assert.equal(notice.message, 'authentication is temporarily unavailable')
    assert.equal(notice.requestId, 'req-7f3a')
  })

  it('marks hub-api’s 403 as forbidden, so the page refuses rather than offering a retry', async () => {
    setTokens({ accessToken: 'a1', refreshToken: 'r1' })
    stub = installFetch(
      () =>
        new Response(
          JSON.stringify({ error: { code: 'forbidden', message: 'missing required authority: admin', requestId: 'req-403' } }),
          { status: 403, headers: { 'content-type': 'application/json', 'x-request-id': 'req-403' } },
        ),
    )
    const notice = noticeFor(await api('/v1/dashboard').catch((e: unknown) => e), 'Could not load.')
    assert.equal(notice.forbidden, true)
    assert.equal(notice.message, 'missing required authority: admin')
  })

  it('falls back to the header’s request id when the body carries none', async () => {
    setTokens({ accessToken: 'a1', refreshToken: 'r1' })
    stub = installFetch(
      () => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'x-request-id': 'req-gw' } }),
    )
    const err = await api('/v1/dashboard').catch((e: unknown) => e)
    if (!(err instanceof ApiError)) throw new Error('expected an ApiError')
    // Every service sets the header on every response, so it is present even when the body came
    // from a gateway in front of the service and is not ours at all.
    assert.equal(err.requestId, 'req-gw')
    assert.equal(err.status, 502)
  })
})
