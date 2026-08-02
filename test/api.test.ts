/**
 * The auth client, without a browser.
 *
 * Three behaviours are load-bearing and each has cost somebody a session at least once:
 *
 *   1. TEN CONCURRENT 401s CAUSE ONE REFRESH. Refresh tokens rotate; ten parallel refreshes means
 *      nine of them present a token that has just been superseded, and a user holding a perfectly
 *      valid session is signed out.
 *   2. THE CALLBACK CODE LEAVES THE ADDRESS BAR BEFORE IT GOES OVER THE WIRE. Not after: a code
 *      that is still on screen during a network round trip is in the history, in the referrer of
 *      whatever loads next, and in any screenshot taken meanwhile.
 *   3. A FAILED REFRESH CLEARS THE TOKENS AND SAYS SO, once, so the tree can drop the session
 *      instead of every screen discovering it independently.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { IDENTITY_AUTH_ROUTES } from '@cloudsforge/ui'
import {
  AUTH_EXPIRED_EVENT,
  ApiError,
  __resetAuth,
  api,
  bootstrapSession,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  hasSession,
  noticeFor,
  refreshSession,
  setTokens,
} from '../src/lib/api.ts'
import { __resetObs } from '../src/lib/obs.ts'
import {
  installFetch,
  installStorage,
  installWindow,
  json,
  removeStorage,
  removeWindow,
  type Browser,
  type FetchStub,
} from './browser-stubs.ts'

let browser: Browser
let stub: FetchStub | null = null

beforeEach(() => {
  browser = installWindow('http://localhost:5180/')
  installStorage()
  __resetAuth()
})

afterEach(() => {
  stub?.restore()
  stub = null
  // The reporter batches on a timer. Left running, it would outlive the test that queued it and
  // then post to a Lantern that is not there.
  __resetObs()
  removeStorage()
  removeWindow()
})

/* ---------------------------- token storage ------------------------- */

describe('token storage', () => {
  it('round-trips the shared CloudsForge keys', () => {
    setTokens({ accessToken: 'a1', refreshToken: 'r1' })
    assert.equal(getAccessToken(), 'a1')
    assert.equal(getRefreshToken(), 'r1')
    assert.equal(hasSession(), true)
  })

  it('clears both tokens, not just the access token', () => {
    // Clearing only the access token leaves a refresh token that silently signs the user back in
    // on the next request, which is not what "sign out" means on a shared machine.
    setTokens({ accessToken: 'a1', refreshToken: 'r1' })
    clearTokens()
    assert.equal(getAccessToken(), null)
    assert.equal(getRefreshToken(), null)
    assert.equal(hasSession(), false)
  })

  it('has no session when only one of the two tokens is present', () => {
    setTokens({ accessToken: 'a1', refreshToken: 'r1' })
    clearTokens()
    setTokens({ accessToken: 'a1', refreshToken: '' })
    assert.equal(hasSession(), false)
  })

  it('falls back to memory when localStorage is unavailable', () => {
    // Safari's private mode and a storage-blocked iframe THROW on access. A module that took that
    // literally would take the whole bundle down at import time in both.
    removeStorage()
    setTokens({ accessToken: 'a-mem', refreshToken: 'r-mem' })
    assert.equal(getAccessToken(), 'a-mem')
    clearTokens()
    assert.equal(getAccessToken(), null)
  })
})

/* -------------------------- single-flight refresh ------------------- */

describe('single-flight refresh', () => {
  it('performs ONE refresh for ten concurrent 401s, and retries all ten', async () => {
    setTokens({ accessToken: 'stale', refreshToken: 'r1' })
    let refreshes = 0
    let dataCalls = 0

    stub = installFetch((call) => {
      if (call.url.includes('/auth/refresh')) {
        refreshes += 1
        return json(200, { accessToken: 'fresh', refreshToken: 'r2' })
      }
      dataCalls += 1
      const token = call.headers['authorization']
      return token === 'Bearer fresh'
        ? json(200, { ok: true })
        : json(401, { error: 'token expired' })
    })

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => api<{ ok: boolean }>(`/v1/thing/${i}`)),
    )

    assert.equal(refreshes, 1, 'ten 401s must share one refresh')
    assert.equal(dataCalls, 20, 'each of the ten is sent once, then retried once')
    assert.equal(results.every((r) => r.ok), true)
    assert.equal(getAccessToken(), 'fresh')
  })

  it('starts a NEW refresh once the previous one has settled', async () => {
    // The slot is cleared when the promise settles, not held for the life of the page: an access
    // token that expires again an hour later must be refreshable again.
    setTokens({ accessToken: 'a1', refreshToken: 'r1' })
    let refreshes = 0
    stub = installFetch(() => {
      refreshes += 1
      return json(200, { accessToken: `a${refreshes + 1}`, refreshToken: `r${refreshes + 1}` })
    })

    assert.equal(await refreshSession(), true)
    assert.equal(await refreshSession(), true)
    assert.equal(refreshes, 2)
  })

  it('reports false without calling Nimbus when there is no refresh token', async () => {
    let called = 0
    stub = installFetch(() => {
      called += 1
      return json(200, {})
    })
    assert.equal(await refreshSession(), false)
    assert.equal(called, 0)
  })

  it('clears the session and announces it once when the refresh token has expired', async () => {
    setTokens({ accessToken: 'stale', refreshToken: 'r-expired' })
    stub = installFetch((call) =>
      call.url.includes('/auth/refresh')
        ? json(401, { error: 'refresh token expired' })
        : json(401, { error: 'token expired' }, 'req-abc'),
    )

    await assert.rejects(
      () => api('/v1/thing'),
      (err: unknown) => err instanceof ApiError && err.status === 401 && err.code === 'session_expired',
    )
    assert.equal(hasSession(), false)
    assert.deepEqual(browser.dispatched, [AUTH_EXPIRED_EVENT])
  })
})

/* ------------------------------ failures ---------------------------- */

describe('failures', () => {
  it('carries the request id from the header onto the error', async () => {
    setTokens({ accessToken: 'a1', refreshToken: 'r1' })
    stub = installFetch(() => json(500, { error: 'the ledger is unavailable' }, 'req-7f3a'))

    const err = await api('/v1/thing').catch((e: unknown) => e)
    if (!(err instanceof ApiError)) throw new Error(`expected an ApiError, got ${String(err)}`)
    assert.equal(err.status, 500)
    assert.equal(err.message, 'the ledger is unavailable')
    assert.equal(err.requestId, 'req-7f3a')

    // …and the notice a failure state renders carries it through to the screen, because that id
    // is the only thing a user can quote that finds their request across every service at once.
    const notice = noticeFor(err, 'Could not load.')
    assert.equal(notice.requestId, 'req-7f3a')
    assert.equal(notice.forbidden, false)
  })

  it('marks a 403 as forbidden, which is a different screen from a failure', async () => {
    setTokens({ accessToken: 'a1', refreshToken: 'r1' })
    stub = installFetch(() => json(403, { error: 'missing scope trade:read' }, 'req-403'))
    const err = await api('/v1/thing').catch((e: unknown) => e)
    assert.equal(noticeFor(err, 'Could not load.').forbidden, true)
  })

  it('turns an unreachable server into a status 0 ApiError rather than a raw TypeError', async () => {
    stub = installFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    const err = await api('/v1/thing', { auth: false }).catch((e: unknown) => e)
    if (!(err instanceof ApiError)) throw new Error(`expected an ApiError, got ${String(err)}`)
    assert.equal(err.status, 0)
  })
})

/* --------------------------- the auth callback ---------------------- */

describe('auth callback', () => {
  /**
   * A stand-in for identity that serves ONLY its redemption route.
   *
   * This test used to assert `trace[1].includes('/auth/exchange')` — a string lifted out of the
   * implementation and compared with itself, green for every possible value, including the wrong
   * one it was pinning. **identity has never served `/auth/exchange`**; it serves
   * `POST /auth/handoff/redeem` (`identity/src/server.ts:1084`), so the SSO callback 404'd in
   * every surface in the estate and this line stayed green throughout.
   *
   * Now a wrong path gets a 404 from the stub, `consumeAuthCallback` returns null,
   * `bootstrapSession()` is false and no token is stored — three assertions go red instead of
   * none. The path comes from `@cloudsforge/ui`'s own declaration rather than from a literal here,
   * so this file holds no second opinion about what identity serves.
   */
  const identityRedemption = (call: { url: string }) =>
    new URL(call.url).pathname === IDENTITY_AUTH_ROUTES.handoffRedeem
      ? json(200, { accessToken: 'a-new', refreshToken: 'r-new', expiresIn: 900 })
      : json(404, { error: { code: 'not_found', message: 'identity serves no such route' } })

  it('strips the code from the address bar BEFORE the redemption is sent', async () => {
    browser = installWindow('https://hub.cloudsforge.online/reports?tab=1#cf_code=abc123&view=grid')
    stub = installFetch(identityRedemption, browser.trace)

    assert.equal(await bootstrapSession(), true)

    // The ORDER is the assertion. Reverse the two side effects in @cloudsforge/ui and this fails.
    assert.equal(browser.trace[0], 'replaceState:/reports?tab=1#view=grid')
    assert.ok(browser.trace[1]?.startsWith('fetch:'))

    // The rest of the fragment survives: an app may keep its own route there.
    assert.deepEqual(browser.replaced, ['/reports?tab=1#view=grid'])
    assert.equal(browser.window.location.hash, '#view=grid')
    assert.equal(getAccessToken(), 'a-new')
  })

  it('redeems at the route identity serves, on identity’s host', async () => {
    browser = installWindow('https://hub.cloudsforge.online/#cf_code=abc123')
    stub = installFetch(identityRedemption, browser.trace)

    assert.equal(await bootstrapSession(), true, 'the redemption was refused')
    const sent = new URL(stub.calls[0]?.url ?? 'about:blank')
    assert.equal(sent.origin, 'https://nimbus.cloudsforge.online')
    assert.equal(sent.pathname, IDENTITY_AUTH_ROUTES.handoffRedeem)
    assert.equal(stub.calls[0]?.method, 'POST')
  })

  it('still strips the code when the redemption fails', async () => {
    // An "after the exchange resolves" implementation never strips it at all on this path, and
    // the code stays in the address bar for as long as the tab is open.
    browser = installWindow('https://hub.cloudsforge.online/#cf_code=dead')
    stub = installFetch(() => json(400, { error: 'code expired' }), browser.trace)

    assert.equal(await bootstrapSession(), false)
    assert.deepEqual(browser.replaced, ['/'])
    assert.equal(getAccessToken(), null)
  })

  it('does nothing to a URL that carries no code', async () => {
    browser = installWindow('https://hub.cloudsforge.online/#section-2')
    let calls = 0
    stub = installFetch(() => {
      calls += 1
      return json(200, {})
    })

    assert.equal(await bootstrapSession(), false)
    assert.equal(calls, 0, 'no code means no redemption request')
    assert.deepEqual(browser.replaced, [], 'and no history rewrite either')
  })

  it('reports an existing session when there is no code but tokens are stored', async () => {
    setTokens({ accessToken: 'a1', refreshToken: 'r1' })
    stub = installFetch(() => json(200, {}))
    assert.equal(await bootstrapSession(), true)
  })
})
