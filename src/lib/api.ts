/**
 * The auth client: tokens, one refresh at a time, and one error shape.
 *
 * Carried forward from Crucible's `src/lib/api.ts`, which is the version of this file that has
 * actually been run against Nimbus. The behaviour worth preserving verbatim is the SINGLE-FLIGHT
 * REFRESH: a dashboard that fires ten requests on mount, all of which 401 on an expired access
 * token, must perform ONE refresh. Ten refreshes against a rotating refresh token means nine of
 * them present a token that has just been superseded, and the user is signed out while holding a
 * valid session.
 */
import { consumeAuthCallback, signInRedirect, signOutRedirect } from '@cloudsforge/ui'
import { viewedApiOrigin } from './viewed.ts'
import { APP_NAME, apiBase, hosts, pageOrigin } from './hosts.ts'
import { report } from './obs.ts'

/** Nimbus issues and refreshes tokens; it is cross-origin from every app, always. */
function nimbusUrl(): string {
  return hosts().nimbus
}

/**
 * The shared CloudsForge token keys.
 *
 * Deliberately the same strings in every product: a session established at the Account portal is
 * picked up here without a second round trip, and signing out of one app on a shared machine
 * clears the tokens the next app would have read.
 */
const ACCESS_KEY = 'cf.accessToken'
const REFRESH_KEY = 'cf.refreshToken'

/** Fired when a refresh fails. `AuthProvider` listens and drops the session. */
export const AUTH_EXPIRED_EVENT = 'cf:auth-expired'

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

/* ---- token storage ------------------------------------------------- */

const memory = new Map<string, string>()

/**
 * Storage, with a memory fallback.
 *
 * `localStorage` throws rather than returning null in a Safari private window and in a
 * third-party iframe with storage blocked. A module that touched it directly would take the whole
 * bundle down at import time in both, and could not be unit tested outside a browser at all. The
 * fallback loses the session on reload, which is a worse experience than persistence and a much
 * better one than a blank page.
 */
function store(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof localStorage !== 'undefined') {
      // Probe rather than trust: the throw happens on ACCESS, not on the typeof check.
      localStorage.getItem(ACCESS_KEY)
      return localStorage
    }
  } catch {
    // Fall through to memory.
  }
  return {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, v),
    removeItem: (k) => void memory.delete(k),
  }
}

export const getAccessToken = (): string | null => store().getItem(ACCESS_KEY)
export const getRefreshToken = (): string | null => store().getItem(REFRESH_KEY)

export function setTokens(tokens: AuthTokens): void {
  store().setItem(ACCESS_KEY, tokens.accessToken)
  store().setItem(REFRESH_KEY, tokens.refreshToken)
}

export function clearTokens(): void {
  store().removeItem(ACCESS_KEY)
  store().removeItem(REFRESH_KEY)
}

export const hasSession = (): boolean => Boolean(getAccessToken() && getRefreshToken())

/* ---- errors -------------------------------------------------------- */

/**
 * One field the server refused, in the shape identity sends it.
 *
 * `identity/src/server.ts` puts a `fields` array of `{ field, code, message }` inside the
 * error envelope for every validation failure. Nothing in this app decides what is valid — the
 * rules live in `@cloudsforge/contracts-auth` and are enforced server-side — so a form's job is to
 * put the server's sentence next to the server's field and keep everything else the user typed.
 */
export interface FieldError {
  readonly field: string
  readonly code: string
  readonly message: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined
  /**
   * The server's id for the exact request that failed, echoed in both the `x-request-id` header
   * and the error body. Quoted by the user, it is what finds their request across every service
   * at once — which is why every failure state in this app displays it.
   */
  readonly requestId: string | undefined
  /** Per-field refusals, when the service sent any. Empty for everything else. */
  readonly fields: readonly FieldError[]

  constructor(
    status: number,
    message: string,
    code?: string,
    requestId?: string,
    fields: readonly FieldError[] = [],
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.fields = fields
  }
}

/**
 * Read a CloudsForge error body.
 *
 * ── The estate's error envelope is NESTED, and this file used to assume it was flat ────────────
 *
 * Every service in the estate answers a failure with
 *
 *     { "error": { "code": "forbidden", "message": "…", "requestId": "cf-1a2b" } }
 *
 * — `hub-api/src/server.ts`, `identity/src/server.ts` and
 * `service-template/src/server.ts` are the same three lines, and every other service is
 * generated from that template. The version of this function carried over from the web template
 * read `data.error` as a STRING. Against a real service `data.error` is an object, so
 * `message = data.error` assigned an object to a string field and every server-side failure in
 * this app would have rendered, on screen, as `[object Object]` — with the real message, the
 * code and the request id all present in the response and all discarded.
 *
 * Both shapes are accepted rather than the nested one only: the flat form is what a plain
 * `{ "error": "…" }` from a proxy or a hand-written handler looks like, and there is nothing to
 * be gained by refusing to read a message somebody did send.
 */
export function readErrorBody(body: unknown): {
  message: string | undefined
  code: string | undefined
  requestId: string | undefined
  fields: readonly FieldError[]
} {
  const none = { message: undefined, code: undefined, requestId: undefined, fields: [] }
  if (typeof body !== 'object' || body === null) return none

  const outer = body as { error?: unknown; code?: unknown; requestId?: unknown; message?: unknown }
  const inner = typeof outer.error === 'object' && outer.error !== null
    ? (outer.error as { code?: unknown; message?: unknown; requestId?: unknown; fields?: unknown })
    : null

  const str = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined

  return {
    // The nested `message` wins over a top-level one; the flat `error` string is the fallback.
    message: str(inner?.message) ?? str(outer.error) ?? str(outer.message),
    code: str(inner?.code) ?? str(outer.code),
    requestId: str(inner?.requestId) ?? str(outer.requestId),
    fields: readFieldErrors(inner?.fields),
  }
}

/**
 * The `fields` array, or nothing.
 *
 * An entry missing any of the three strings is dropped rather than rendered with a blank message:
 * a form control marked invalid with no sentence beside it tells the user their input is wrong and
 * not why, which is worse than showing the summary alone.
 */
function readFieldErrors(raw: unknown): readonly FieldError[] {
  if (!Array.isArray(raw)) return []
  const out: FieldError[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const { field, code, message } = entry as Record<string, unknown>
    if (typeof field !== 'string' || field === '') continue
    if (typeof message !== 'string' || message === '') continue
    out.push({ field, code: typeof code === 'string' ? code : 'invalid', message })
  }
  return out
}

/** What a failure state needs: the sentence, and the id to quote at support. */
export interface ErrorNotice {
  message: string
  requestId: string | undefined
  /** 403 is its own screen: the request was understood and refused, and retrying will not help. */
  forbidden: boolean
}

/**
 * Normalise a caught error for display.
 *
 * `fallback` covers the non-ApiError case, which is a bug in this bundle rather than a server
 * response — so it is also the only case worth reporting from here. An ApiError has already been
 * logged by the service that produced it, under the request id shown to the user.
 */
export function noticeFor(err: unknown, fallback: string): ErrorNotice {
  if (err instanceof ApiError) {
    return { message: err.message, requestId: err.requestId, forbidden: err.status === 403 }
  }
  report({
    app: APP_NAME,
    type: err instanceof Error ? err.name : 'UnknownError',
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? (err.stack ?? null) : null,
    context: { fallback },
  })
  return { message: fallback, requestId: undefined, forbidden: false }
}

/* ---- the single-flight refresh ------------------------------------- */

let inflightRefresh: Promise<boolean> | null = null

/**
 * Refresh the session, at most once concurrently.
 *
 * Every caller that arrives while a refresh is in flight awaits THE SAME promise; the slot is
 * cleared when it settles, so the next 401 after this one starts a fresh attempt rather than
 * replaying a stale answer.
 */
export function refreshSession(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return Promise.resolve(false)
  if (!inflightRefresh) {
    inflightRefresh = performRefresh(refreshToken).finally(() => {
      inflightRefresh = null
    })
  }
  return inflightRefresh
}

async function performRefresh(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${nimbusUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) {
      // Returning false signs the user out either way, but the two causes are not the same event:
      // a 401 is an expired refresh token and routine, anything else is Nimbus failing. They were
      // indistinguishable for as long as neither was written down.
      if (res.status !== 401) {
        report({
          app: APP_NAME,
          type: 'RefreshFailed',
          message: `Token refresh failed (${res.status})`,
          statusCode: res.status,
          requestId: res.headers.get('x-request-id'),
        })
      }
      return false
    }
    setTokens((await res.json()) as AuthTokens)
    return true
  } catch (err) {
    report({
      app: APP_NAME,
      type: 'RefreshUnreachable',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? null) : null,
      context: { nimbus: nimbusUrl() },
    })
    return false
  }
}

function expireSession(): void {
  clearTokens()
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
}

/* ---- the request core ---------------------------------------------- */

export interface RequestOptions {
  method?: string
  body?: unknown
  /** Default true: attach the bearer token and refresh once on 401. */
  auth?: boolean
  query?: Record<string, string | number | boolean | undefined | null>
  signal?: AbortSignal
  /**
   * Extra request headers.
   *
   * Exists for exactly one thing: `Idempotency-Key`, which `micro-wallet` REQUIRES on every
   * money-moving route (`wallet/src/idempotency.ts` — "without one a retry moves money
   * twice"). It is merged under the three this function sets rather than over them, so nothing
   * passed here can replace the bearer token or the content type.
   */
  headers?: Record<string, string>
}

/**
 * The request core.
 *
 * Exported so a client for a service that is NOT this app's own API can be built on it —
 * `nimbus()` below, and `lib/money.ts` for wallet and custody — rather than each growing its own
 * fetch with its own idea of what an error body looks like and its own missing refresh.
 */
export async function request<T>(base: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, query, signal, headers: extra } = opts

  // `base` may be '' (relative, same origin), so resolve against the page origin.
  const url = new URL(base + path, pageOrigin())
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
  }

  const send = async (): Promise<Response> => {
    // `extra` first, so the three below win. A caller must not be able to replace the bearer
    // token or the content type by passing a header of the same name.
    const headers: Record<string, string> = { ...extra, accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const token = getAccessToken()
    if (auth && token) headers['authorization'] = `Bearer ${token}`
    return fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    })
  }

  let res: Response
  try {
    res = await send()
  } catch (err) {
    // The user-facing sentence is the right one whether the cause is their wifi or our container.
    // The cause itself, though, only exists here — discarding it is how a service being down
    // looked exactly like a bad connection, for everyone, for as long as it lasted.
    report({
      app: APP_NAME,
      type: 'NetworkError',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? null) : null,
      context: { method, url: url.toString() },
    })
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.')
  }

  // One silent refresh and retry on expiry. Ten of these at once share one refresh.
  if (res.status === 401 && auth && getRefreshToken()) {
    if (await refreshSession()) {
      res = await send()
    } else {
      expireSession()
      throw new ApiError(
        401,
        'Your session expired. Sign in again.',
        'session_expired',
        res.headers.get('x-request-id') ?? undefined,
      )
    }
  }

  if (!res.ok) {
    // Every service sets this header on every response, error or not, so it is present even when
    // the body is a proxy's HTML page rather than ours.
    let requestId = res.headers.get('x-request-id') ?? undefined
    let message = res.statusText || `Request failed (${res.status})`
    let code: string | undefined
    let fields: readonly FieldError[] = []
    try {
      const parsed = readErrorBody(await res.json())
      if (parsed.message) message = parsed.message
      if (parsed.code) code = parsed.code
      if (parsed.requestId) requestId = parsed.requestId
      fields = parsed.fields
    } catch (err) {
      // A non-JSON error body means something in FRONT of the service answered — a gateway, a
      // CDN, a misrouted deploy — and the request never reached it. Nothing server-side logs
      // that, so it has to be reported from here.
      report({
        app: APP_NAME,
        type: 'NonJsonErrorBody',
        message: `${res.status} response from ${url.pathname} was not JSON`,
        stack: err instanceof Error ? (err.stack ?? null) : null,
        statusCode: res.status,
        requestId,
        context: { method, contentType: res.headers.get('content-type') },
      })
    }
    if (res.status === 401 && auth) expireSession()
    throw new ApiError(res.status, message, code, requestId, fields)
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return undefined as T
  return (await res.json()) as T
}

/** This app's own API: relative in production, the registry's dev port under `pnpm dev`. */
/**
 * This app's own API — and the SIBLING ESTATE's when the reader views the other network
 * (micro-org#459, the combined view). Unlike the read-only surfaces the bearer IS forwarded:
 * hub's data is the reader's own, one identity mints their token, and the `net` claim lives on
 * service tokens only so a person's token crosses. Until the testnet estate trusts the shared
 * identity, a cross-estate read answers 401 and pages render their ordinary error states.
 */
export const api = <T,>(path: string, opts?: RequestOptions): Promise<T> => {
  const crossEstate = viewedApiOrigin()
  return request<T>(crossEstate === '' ? apiBase() : crossEstate, path, opts)
}

/** Nimbus, which is cross-origin from everywhere. */
export const nimbus = <T,>(path: string, opts?: RequestOptions): Promise<T> =>
  request<T>(nimbusUrl(), path, opts)

/* ---- boot and sign-in --------------------------------------------- */

/**
 * Redeem an SSO hand-off code, if the Account portal sent us back with one.
 *
 * Called once from main.tsx BEFORE React renders, so the first paint already knows whether there
 * is a session and no screen flashes signed-out and then signed-in.
 *
 * The strip-then-exchange ordering inside `consumeAuthCallback` is load-bearing and is documented
 * where it is implemented: the code leaves the address bar before it goes over the wire, so it is
 * never in the history, in a referrer, or in a screenshot taken while the request is in flight.
 * Nothing here may reorder that, and nothing here may re-read `location.hash` afterwards.
 */
export async function bootstrapSession(): Promise<boolean> {
  try {
    const tokens = await consumeAuthCallback()
    if (tokens) {
      setTokens(tokens)
      return true
    }
  } catch (err) {
    // A failed exchange is a signed-out boot, not a broken app: the sign-in button is right there.
    report({
      app: APP_NAME,
      type: 'AuthCallbackFailed',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? null) : null,
    })
  }
  return hasSession()
}

/**
 * Send the browser to the Account portal, returning here afterwards.
 *
 * `returnTo` defaults to the CURRENT URL including its path and query, which is what puts a user
 * who deep-linked into a protected page back on that page rather than on a dashboard they then
 * have to navigate out of.
 */
export function signIn(returnTo?: string): void {
  signInRedirect(returnTo ?? (typeof window === 'undefined' ? undefined : window.location.href))
}

/** Clear this app's tokens FIRST — the portal cannot reach them — then end the shared session. */
export function signOut(returnTo?: string): void {
  clearTokens()
  signOutRedirect(returnTo ?? (typeof window === 'undefined' ? undefined : window.location.origin))
}

/** Reset module state. Tests only. */
export function __resetAuth(): void {
  inflightRefresh = null
  memory.clear()
}
