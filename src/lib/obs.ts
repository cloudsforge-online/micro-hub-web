/**
 * Browser observability: what the bundle saw, sent to Lantern.
 *
 * Server-side logs describe what the estate did. They cannot describe a chunk that 404ed after a
 * deploy, a promise rejected in a component, or a page that took nine seconds to paint on a
 * connection the server never noticed was slow. Those only exist in the browser, and until they
 * are posted somewhere they exist nowhere.
 *
 * This file replaces a 261-line one that was copied byte-identical into six frontends, where it
 * had already begun to drift: two copies queued, two did not, and one still pointed at a hostname
 * that had been renamed. It lives in the template so that a seventh copy is never made.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG HERE, AND WHY NOTHING NOTICED FOR MONTHS.
 *
 * Not one browser event ever reached Lantern. Three separate defects, each of which alone was
 * enough, and every one of them invisible:
 *
 *   1. The PATH was `/ingest/browser`. Lantern serves `/ingest/client`. A cross-origin POST that
 *      404s carries no CORS headers, so the page is told `TypeError: Failed to fetch` — which is
 *      byte-for-byte what it is told when the host does not exist.
 *   2. The ENVELOPE key was `events`. Lantern reads `samples`.
 *   3. The RECORD key was `type`, and there is no `type` column. `kind` is a CHECK-constrained
 *      column of six values.
 *
 * Fixing only (1) is worse than fixing none, because the answer becomes `202 {"stored":0}`: the
 * batch is accepted, discarded in full, and reported as a success. That is why this file now reads
 * the response body instead of ignoring it — see `flush`.
 *
 * The contract below is taken from `lantern/src/rum.ts` (`fromWire`, `RUM_KINDS`) and the CHECK
 * constraints in `lantern/src/migrations.ts`, not from any document describing them.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Four rules hold it together:
 *
 *   1. IT NEVER THROWS. Telemetry that can break the page it measures is worse than no telemetry.
 *      Every entry point is wrapped, and a failed send never propagates.
 *   2. IT NEVER REPORTS ITSELF. A failed report must not produce a report — that is an outage
 *      amplifier, and a browser can generate it faster than an ingest can shed it. It may WARN to
 *      the console, which costs nothing and is where a developer will actually look.
 *   3. IT BATCHES, AND FLUSHES ON PAGEHIDE. The interesting error is usually the last one before
 *      the user gave up and closed the tab, which is exactly the one a plain fetch loses.
 *   4. IT IS BOUNDED. A render loop throwing on every frame must cost a fixed number of requests,
 *      not one per frame.
 */
import { hosts, APP_NAME } from './hosts.ts'

/**
 * The kinds Lantern will store, and the ONLY strings its `kind` column accepts.
 *
 * This is not a convention — it is a CHECK constraint (`lantern/src/migrations.ts:222`, mirrored by
 * `RUM_KINDS` at `lantern/src/rum.ts:25`). A record carrying anything else is dropped at ingest
 * with reason `unknown_kind`, and for months every record this file sent was dropped exactly so.
 */
export type RumKind =
  | 'page_load'
  | 'first_contentful_paint'
  | 'largest_contentful_paint'
  | 'fetch_error'
  | 'unhandled_rejection'
  | 'error'

/** One thing that happened in the browser, as a CALLER describes it. */
export interface ObsEvent {
  /** Which app. Constant per bundle; Lantern groups on it. */
  app: string
  /**
   * A short, STABLE classifier — `NetworkError`, `UnhandledRejection`. Never the message.
   *
   * Deliberately still free-form, and deliberately NOT the wire `kind`. Lantern's set is six
   * values wide because it is a metric label; this is the detail that makes an error triageable.
   * `kindFor` narrows it at the boundary and `attributes.type` carries the original through, so
   * nothing is dropped and nothing is lost.
   */
  type: string
  message: string
  stack?: string | null
  /** HTTP status, when this event describes a response. A column: `status_code`. */
  statusCode?: number | undefined
  /** The `x-request-id` of the failed response, which is what joins this to the server's logs. */
  requestId?: string | null | undefined
  /** A duration in milliseconds, when this event measures one. A column: `value_ms`. */
  valueMs?: number | undefined
  /** Anything else worth having. Kept small: this is posted from a phone on mobile data. */
  context?: Record<string, unknown> | undefined
}

/**
 * One record exactly as Lantern stores it — `lantern/src/rum.ts:34-44`, one field per column.
 *
 * The fields a caller supplies that have NO column — `message`, `stack`, `context`, `release`,
 * `userAgent`, and the original `type` — live in `attributes`, which is the `jsonb` column that
 * exists for them. Promoting them to top level is what made every previous send a silent no-op:
 * `fromWire` reads the nine keys below and ignores every other one.
 */
export interface RumSample {
  app: string
  kind: RumKind
  route: string | null
  valueMs: number | null
  statusCode: number | null
  requestId: string | null
  traceId: string | null
  session: string | null
  attributes: Record<string, unknown>
}

/**
 * A caller's classifier onto Lantern's closed set.
 *
 * Anything unrecognised becomes `error` rather than being passed through, because passing it
 * through is precisely the bug: an unknown `kind` is dropped at ingest, and a coarsely labelled
 * error beats a dropped one. The precise classifier survives in `attributes.type`.
 */
export function kindFor(type: string): RumKind {
  switch (type) {
    case 'PageLoad':
      return 'page_load'
    case 'FirstContentfulPaint':
      return 'first_contentful_paint'
    case 'LargestContentfulPaint':
      return 'largest_contentful_paint'
    case 'UnhandledRejection':
      return 'unhandled_rejection'
    // Each of these describes a request that did not come back usable, which is what `fetch_error`
    // names. Keeping them apart from `error` is what lets a dashboard separate "the network is
    // bad" from "this bundle throws".
    case 'NetworkError':
    case 'RefreshFailed':
    case 'RefreshUnreachable':
    case 'NonJsonErrorBody':
      return 'fetch_error'
    default:
      return 'error'
  }
}

/** Lantern's browser ingest path. Unauthenticated by design: an error before sign-in is still one. */
const INGEST_PATH = '/ingest/client'

/** Events per flush. Above this the queue drops, oldest first — see rule 4. */
const MAX_QUEUE = 32

/** How long a batch waits for company. Long enough to group a burst, short enough to arrive. */
const FLUSH_MS = 2000

/**
 * The lifetime cap on requests to the ingest.
 *
 * A page that has already sent two hundred events is a page in a loop, and the two hundred and
 * first tells nobody anything the first ten did not.
 */
const MAX_SENDS = 200

let queue: RumSample[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let sends = 0
let started = false
/** Set while a send is in flight: a fetch failure inside a send must not enqueue another event. */
let sending = false

function ingestUrl(): string {
  return `${hosts().lantern}${INGEST_PATH}`
}

/**
 * The release identifier.
 *
 * Read from a meta tag rather than a build-time constant, because a build-time constant would be
 * the one piece of environment baked into the image — see vite.config.ts. The Docker build writes
 * the tag; absent, the string below is honest about not knowing.
 */
function release(): string {
  if (typeof document === 'undefined') return 'unknown'
  const meta = document.querySelector('meta[name="cf-release"]')
  return meta?.getAttribute('content') ?? 'unknown'
}

/**
 * A pseudonymous per-TAB identifier, so two samples from one session can be joined.
 *
 * `sessionStorage`, so it dies with the tab and never follows a user between visits; random, so it
 * says nothing about who they are. Lantern treats it as opaque and it expires with the row at
 * thirty days. This is the only reason the `session` column can be filled without filling it with
 * an identity — and by policy that service has no `user_id` column anywhere, so an identity sent
 * here would be dropped rather than stored.
 */
function sessionId(): string | null {
  try {
    if (typeof sessionStorage === 'undefined') return null
    const existing = sessionStorage.getItem('cf-obs-session')
    if (existing) return existing
    const minted =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `s-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    sessionStorage.setItem('cf-obs-session', minted)
    return minted
  } catch {
    // Storage can be disabled outright. A missing session id costs a join, not a sample.
    return null
  }
}

/**
 * A caller's event to the record Lantern stores. Exported for the test that pins the shape.
 *
 * The whole correction lives here: nine keys, `kind` from the closed set, and everything without a
 * column pushed down into `attributes` rather than sent alongside them and ignored.
 */
export function envelope(event: ObsEvent): RumSample {
  const attributes: Record<string, unknown> = {
    // The caller's precise classifier. Narrowed away in `kind`, kept whole here.
    type: event.type,
    message: event.message,
    at: new Date().toISOString(),
    url: typeof window === 'undefined' ? '' : window.location.href,
    release: release(),
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
  }
  if (event.stack != null) attributes['stack'] = event.stack
  if (event.context !== undefined) attributes['context'] = event.context

  return {
    app: event.app,
    kind: kindFor(event.type),
    route: typeof window === 'undefined' ? null : window.location.pathname,
    // Whole milliseconds only: `value_ms` is an INTEGER column, and a float is rejected by the
    // insert rather than rounded by it.
    valueMs: event.valueMs === undefined ? null : Math.round(event.valueMs),
    statusCode: event.statusCode ?? null,
    requestId: event.requestId ?? null,
    // No browser-side trace context today. Lantern requires exactly 32 hex characters and nulls
    // anything else, so null is the honest value rather than a fabricated one.
    traceId: null,
    session: sessionId(),
    attributes,
  }
}

/**
 * Apply the queue bound.
 *
 * Drops from the FRONT. The newest events are kept because a loop's thousandth exception is
 * identical to its first, whereas the state of the page just before the tab closed is not.
 */
export function enqueueBounded(current: readonly RumSample[], event: RumSample): RumSample[] {
  const next = [...current, event]
  return next.length > MAX_QUEUE ? next.slice(next.length - MAX_QUEUE) : next
}

/** Queue one event. Safe to call from anywhere, including an error handler. */
export function report(event: ObsEvent): void {
  try {
    if (sending || sends >= MAX_SENDS) return
    queue = enqueueBounded(queue, envelope(event))
    if (timer === null) timer = setTimeout(() => void flush(), FLUSH_MS)
  } catch {
    // Rule 1. There is nowhere left to report a failure of the reporter.
  }
}

/**
 * Send what is queued.
 *
 * `keepalive` is what makes this survive the navigation that usually follows the error worth
 * reading; `sendBeacon` is used on pagehide because keepalive fetches are not guaranteed once the
 * document is being discarded.
 */
export async function flush(useBeacon = false): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  if (queue.length === 0 || sends >= MAX_SENDS) return
  const batch = queue
  queue = []
  sends += 1
  // `samples`, which is the key Lantern reads (`lantern/src/server.ts:480`). It answers a body
  // shaped `{"events":[…]}` with an explicit 400 naming this exact mistake, because that is the
  // envelope this file sent for months.
  const body = JSON.stringify({ samples: batch })

  try {
    sending = true
    if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(ingestUrl(), new Blob([body], { type: 'application/json' }))
      return
    }
    const res = await fetch(ingestUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
      // No credentials: the ingest is unauthenticated, and sending cookies to it would make it a
      // CSRF surface for no gain.
      credentials: 'omit',
    })

    // ────────────────────────────────────────────────────────────────────────────────────────
    // SAY SO WHEN THE SINK REFUSES — but still never throw.
    //
    // This used to be a bare `catch {}` around a call whose result was not even read, so a 404 on
    // the wrong path and a 400 naming the wrong envelope were both indistinguishable from success.
    // Lantern answers `{stored,dropped,reasons}` explaining the precise defect; throwing that away
    // is how the defect survives another six months.
    //
    // A console warning, never a throw and never a `report()`: rule 1 says telemetry may not break
    // the page, and rule 2 says a failed report must not produce a report.
    // ────────────────────────────────────────────────────────────────────────────────────────
    if (!res.ok) {
      // Worded WITHOUT the string "refused" followed by a colon, deliberately. A sibling surface's
      // render guard forbids that pattern anywhere under src/, to stop a retired refusal-state UI
      // reappearing. A telemetry log line is not that UI, but the guard is worth more than the
      // wording, so this bends rather than the check.
      console.warn(`[obs] ingest rejected this batch — ${res.status} ${res.statusText}`, await safeBody(res))
      return
    }

    // A 2xx is NOT success. `202 {"stored":0}` is the shape of a batch accepted and discarded in
    // full, and believing it is what this whole change exists to stop.
    const outcome = (await safeBody(res)) as { stored?: number; reasons?: unknown } | null
    if (outcome && typeof outcome === 'object' && typeof outcome.stored === 'number') {
      if (outcome.stored < batch.length) {
        console.warn(
          `[obs] ingest stored ${outcome.stored} of ${batch.length} samples`,
          outcome.reasons ?? {},
        )
      }
    }
  } catch {
    // Rule 2: a dropped batch is dropped. Retrying into an ingest that is already refusing is how
    // a browser turns a degraded service into an offline one.
  } finally {
    sending = false
  }
}

/** Read a response body without ever throwing out of the reporter. */
async function safeBody(res: Response): Promise<unknown> {
  try {
    return await res.clone().json()
  } catch {
    try {
      return await res.text()
    } catch {
      return null
    }
  }
}

/**
 * Attach the browser-level listeners. Call once, from main.tsx, before the app renders — an error
 * thrown during the first render is the one most worth catching.
 */
export function initObs(app: string = APP_NAME): void {
  if (started || typeof window === 'undefined') return
  started = true

  window.addEventListener('error', (e: ErrorEvent) => {
    // A resource that failed to load (a chunk, a font) arrives here with no `error` and a target
    // that is not the window. It is reported as its own type: a 404 on a hashed chunk means a
    // deploy removed the file a loaded page still expects, and that is a rollback, not a bug.
    if (e.target && e.target !== window) {
      const el = e.target as Partial<HTMLScriptElement & HTMLLinkElement>
      report({ app, type: 'ResourceError', message: `Failed to load ${el.src ?? el.href ?? 'a subresource'}` })
      return
    }
    report({
      app,
      type: e.error instanceof Error ? e.error.name : 'WindowError',
      message: e.message || 'Uncaught error',
      stack: e.error instanceof Error ? (e.error.stack ?? null) : null,
      context: { line: e.lineno, column: e.colno, source: e.filename },
    })
  }, true)

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason: unknown = e.reason
    report({
      app,
      // `UnhandledRejection` regardless of the reason's constructor name: this is the one classifier
      // Lantern has a dedicated kind for, and reading `reason.name` here would send `TypeError` and
      // land the sample in the generic `error` bucket instead.
      type: 'UnhandledRejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? (reason.stack ?? null) : null,
      context: { reason: reason instanceof Error ? reason.name : typeof reason },
    })
  })

  // Page-load timing, once, after the load event has settled so the numbers are final.
  window.addEventListener('load', () => {
    setTimeout(() => {
      try {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
        if (!nav) return
        const paint = performance.getEntriesByName('first-contentful-paint')[0]
        report({
          app,
          type: 'PageLoad',
          message: window.location.pathname,
          // The headline number goes in the COLUMN, so a p95 is a query rather than a jsonb dig.
          valueMs: Math.round(nav.loadEventEnd),
          context: {
            // Rounded to whole milliseconds: sub-millisecond precision here is a fingerprinting
            // surface and tells nobody anything about a page load.
            ttfb: Math.round(nav.responseStart),
            domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
            loaded: Math.round(nav.loadEventEnd),
            navigationType: nav.type,
          },
        })
        // Its own sample rather than an attribute of the one above: `first_contentful_paint` is a
        // kind the schema declares, and a paint time buried in a jsonb bag cannot be aggregated
        // next to the other apps' paint times.
        if (paint) {
          report({
            app,
            type: 'FirstContentfulPaint',
            message: window.location.pathname,
            valueMs: Math.round(paint.startTime),
          })
        }
      } catch {
        // Rule 1.
      }
    }, 0)
  })

  // The last chance to send. `pagehide` fires on the bfcache path too, where `unload` does not.
  window.addEventListener('pagehide', () => void flush(true))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush(true)
  })
}

/** Reset module state. Tests only; nothing in the app calls it. */
export function __resetObs(): void {
  queue = []
  sends = 0
  sending = false
  started = false
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}
