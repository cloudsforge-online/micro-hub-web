/**
 * The smallest browser these tests need.
 *
 * There is no DOM in this suite on purpose: jsdom is a second browser implementation to keep
 * current, it disagrees with real ones in exactly the places that matter, and a test that renders
 * a component in it proves the component renders in jsdom. What IS tested here is the pure layer
 * — token storage, the single-flight refresh, the auth callback, host resolution and the chart
 * maths — and that layer touches only four globals, all stubbed below.
 */

export interface StubLocation {
  href: string
  origin: string
  hostname: string
  pathname: string
  search: string
  hash: string
  assign: (url: string) => void
}

export interface StubWindow {
  location: StubLocation
  history: { replaceState: (state: unknown, title: string, url: string) => void }
  addEventListener: () => void
  removeEventListener: () => void
  dispatchEvent: (event: Event) => boolean
}

export interface Browser {
  window: StubWindow
  /** Every side effect, in the order it happened. The auth-callback ordering test reads this. */
  trace: string[]
  /** URLs passed to history.replaceState. */
  replaced: string[]
  /** Event types dispatched on the window. */
  dispatched: string[]
  /** URLs passed to location.assign — where a sign-in redirect would have sent the browser. */
  assigned: string[]
}

/** Install a window at `url`, returning the record of what the code under test did to it. */
export function installWindow(url: string): Browser {
  const parsed = new URL(url)
  const trace: string[] = []
  const replaced: string[] = []
  const dispatched: string[] = []
  const assigned: string[] = []

  const location: StubLocation = {
    href: parsed.href,
    origin: parsed.origin,
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    assign(next: string) {
      assigned.push(next)
      trace.push(`assign:${next}`)
    },
  }

  const window: StubWindow = {
    location,
    history: {
      replaceState(_state, _title, next) {
        replaced.push(next)
        trace.push(`replaceState:${next}`)
        // A real history.replaceState updates location as well, and the ordering guarantee is
        // only meaningful if the hash is genuinely gone afterwards.
        const resolved = new URL(next, location.origin)
        location.href = resolved.href
        location.pathname = resolved.pathname
        location.search = resolved.search
        location.hash = resolved.hash
      },
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent(event: Event) {
      dispatched.push(event.type)
      trace.push(`dispatch:${event.type}`)
      return true
    },
  }

  ;(globalThis as unknown as { window?: StubWindow }).window = window
  return { window, trace, replaced, dispatched, assigned }
}

export function removeWindow(): void {
  delete (globalThis as unknown as { window?: StubWindow }).window
}

/** An in-memory Storage, so the storage path under test is the real one rather than the fallback. */
export function installStorage(seed: Record<string, string> = {}): Map<string, string> {
  const map = new Map<string, string>(Object.entries(seed))
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
  ;(globalThis as { localStorage?: unknown }).localStorage = storage
  return map
}

export function removeStorage(): void {
  delete (globalThis as { localStorage?: unknown }).localStorage
}

export interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
}

export interface FetchStub {
  calls: FetchCall[]
  restore: () => void
}

/** Replace global fetch with `handler`, recording every call. */
export function installFetch(
  handler: (call: FetchCall) => Response | Promise<Response>,
  trace?: string[],
): FetchStub {
  const original = globalThis.fetch
  const calls: FetchCall[] = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    }
    calls.push(call)
    trace?.push(`fetch:${call.url}`)
    return handler(call)
  }) as typeof fetch

  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

/** A JSON response, with the request id header every CloudsForge service sets. */
export function json(status: number, body: unknown, requestId = 'req-0000'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
  })
}
