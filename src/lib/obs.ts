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
 * Four rules hold it together:
 *
 *   1. IT NEVER THROWS. Telemetry that can break the page it measures is worse than no telemetry.
 *      Every entry point is wrapped, and a failed send is dropped in silence.
 *   2. IT NEVER REPORTS ITSELF. A failed report must not produce a report — that is an outage
 *      amplifier, and a browser can generate it faster than an ingest can shed it.
 *   3. IT BATCHES, AND FLUSHES ON PAGEHIDE. The interesting error is usually the last one before
 *      the user gave up and closed the tab, which is exactly the one a plain fetch loses.
 *   4. IT IS BOUNDED. A render loop throwing on every frame must cost a fixed number of requests,
 *      not one per frame.
 */
import { hosts, APP_NAME } from './hosts.ts'

/** One thing that happened in the browser. Shape is Lantern's browser ingest contract. */
export interface ObsEvent {
  /** Which app. Constant per bundle; Lantern groups on it. */
  app: string
  /** A short, STABLE classifier — `NetworkError`, `UnhandledRejection`. Never the message. */
  type: string
  message: string
  stack?: string | null
  /** HTTP status, when this event describes a response. */
  statusCode?: number | undefined
  /** The `x-request-id` of the failed response, which is what joins this to the server's logs. */
  requestId?: string | null | undefined
  /** Anything else worth having. Kept small: this is posted from a phone on mobile data. */
  context?: Record<string, unknown> | undefined
}

interface QueuedEvent extends ObsEvent {
  at: string
  url: string
  /** The bundle's build id, so an error can be pinned to the deploy that introduced it. */
  release: string
  userAgent: string
}

/** Lantern's browser ingest path. Unauthenticated by design: an error before sign-in is still one. */
const INGEST_PATH = '/ingest/browser'

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

let queue: QueuedEvent[] = []
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

/** Add envelope fields to a caller's event. Exported for the test that pins the shape. */
export function envelope(event: ObsEvent): QueuedEvent {
  return {
    ...event,
    at: new Date().toISOString(),
    url: typeof window === 'undefined' ? '' : window.location.href,
    release: release(),
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
  }
}

/**
 * Apply the queue bound.
 *
 * Drops from the FRONT. The newest events are kept because a loop's thousandth exception is
 * identical to its first, whereas the state of the page just before the tab closed is not.
 */
export function enqueueBounded(current: readonly QueuedEvent[], event: QueuedEvent): QueuedEvent[] {
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
  const body = JSON.stringify({ events: batch })

  try {
    sending = true
    if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(ingestUrl(), new Blob([body], { type: 'application/json' }))
      return
    }
    await fetch(ingestUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
      // No credentials: the ingest is unauthenticated, and sending cookies to it would make it a
      // CSRF surface for no gain.
      credentials: 'omit',
    })
  } catch {
    // Rule 2: a dropped batch is dropped. Retrying into an ingest that is already refusing is how
    // a browser turns a degraded service into an offline one.
  } finally {
    sending = false
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
      type: reason instanceof Error ? reason.name : 'UnhandledRejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? (reason.stack ?? null) : null,
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
          context: {
            // Rounded to whole milliseconds: sub-millisecond precision here is a fingerprinting
            // surface and tells nobody anything about a page load.
            ttfb: Math.round(nav.responseStart),
            domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
            loaded: Math.round(nav.loadEventEnd),
            firstContentfulPaint: paint ? Math.round(paint.startTime) : null,
            navigationType: nav.type,
          },
        })
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
