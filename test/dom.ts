/**
 * A DOM, so that the tier-1 and tier-2 scenarios of `docs/ecosystem/22-browser-journeys.md` can be
 * written against this surface at all.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS ALONGSIDE `browser-stubs.ts`, WHICH SAYS THE OPPOSITE
 *
 * `test/browser-stubs.ts` states the estate's position: "There is no DOM in this suite on
 * purpose: jsdom is a second browser implementation to keep current, it disagrees with real ones
 * in exactly the places that matter, and a test that renders a component in it proves the
 * component renders in jsdom."
 *
 * That position is correct about what it was written for — the PURE layer: token storage, the
 * single-flight refresh, host resolution, the money formatters. Every one of those is a function,
 * and putting a DOM under a function is pure cost. Doc 22 quotes this very file as the estate's
 * position (§1, the row "Frontends have tests, but none renders a component").
 *
 * It is not correct as a rule for the whole suite, and this surface is the reason. Doc 22 §4
 * defines tier 1 as "the bundle, a browser, and stubbed responses", and the two screens this
 * harness exists for are not function-shaped:
 *
 *   - **Sign-in.** "An existing session is handed over with no second credential prompt"
 *     (BJ-ACC-04) is a statement about an effect that runs once under StrictMode and then
 *     navigates. "The `return` parameter survives the round trip" (BJ-ACC-03) is a statement about
 *     where the browser ENDED UP. Neither is a return value.
 *   - **The wallet.** "The destination submitted is byte-identical to the destination rendered on
 *     the confirmation step" (BJ-WAL-08) is a statement relating one rendered node to one request
 *     body. It cannot be written without both.
 *
 * The alternative the estate already had was a real browser — `playwright-core` driving Chromium,
 * as `web-template/test/journeys/browser.ts` does. It is rejected here for one mechanical reason:
 * this repository's CI runs `pnpm test` BEFORE `pnpm build` (`.github/workflows/ci.yml`), so at
 * the moment the suite runs there is no bundle to serve and no server to serve it from — and the
 * workflow is out of scope for this change. A real browser belongs in `micro-beacon`'s tier 3,
 * which is where doc 22 §4 puts it.
 *
 * SO THE BOUNDARY THIS FILE ACCEPTS, WRITTEN DOWN SO IT IS NOT QUIETLY CROSSED:
 *
 *   - Nothing here asserts layout, geometry, computed style, or anything a second DOM
 *     implementation would be likely to get wrong. `happy-dom` does not lay pages out and this
 *     suite never asks it to.
 *   - What is asserted is TEXT, DOCUMENT ORDER, ACCESSIBLE ROLES AND NAMES, WHAT WENT OVER THE
 *     WIRE, and WHERE THE BROWSER WAS SENT — which doc 22 §3.1 allows and a DOM implementation
 *     cannot plausibly differ on.
 *   - Elements are addressed by accessible role and name, never by class or DOM path, per doc 22
 *     §2.4.3. A markup change must not break these tests; an accessible-name change must.
 *
 * Modelled on `market-web/test/dom.ts`, which is the version of this harness that has been run.
 * The two additions this surface needed are recorded where they are made: `navigations`, because
 * a sign-in's whole outcome is a full navigation, and `storageSnapshot`, because "the reveal token
 * and the material never touch storage" is a claim about storage.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── The failure this harness is built to make impossible ──────────────────────────────────────
 *
 * `stack/infra/beacon/src/journeys/web.js` records it: "domcontentloaded fires before a SPA
 * has mounted anything ... A networkidle wait is not enough either — a bundle that 404s leaves the
 * network perfectly idle." Its answer was to assert the rendered body was longer than forty
 * characters and to collect console errors and failed requests.
 *
 * `mount()` does the same three things and refuses to hand back a screen that fails any of them,
 * so a scenario CANNOT be written against a blank page: `assertMounted` runs on every mount, and
 * `screen.clean()` is the `assertClean` of the legacy harness. A test that passes against nothing
 * rendered is worse than no test, and this is where that is stopped.
 */
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { StrictMode, createElement, type ReactElement } from 'react'

/* ── the globals a React tree touches ───────────────────────────────────────────────────────── */

/**
 * The globals installed for the duration of a mount.
 *
 * Assigned with `defineProperty` rather than `=` because `globalThis.navigator` is a getter-only
 * accessor on Node 22 and later, and a plain assignment throws before the first test runs.
 */
const GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'matchMedia',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLSelectElement',
  'HTMLButtonElement',
  'HTMLAnchorElement',
  'Element',
  'Node',
  'DocumentFragment',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'FocusEvent',
  'InputEvent',
  'SubmitEvent',
  'NodeFilter',
  'CSS',
] as const

/* ── a browser that can mine ────────────────────────────────────────────────────────────────── */

/**
 * `windowExtras` for a device the mining control will offer itself on.
 *
 * happy-dom implements `WebSocket` and does not implement `Worker`. `src/mining/session.tsx`'s
 * `deviceRefusal()` reads BOTH off `window` — deliberately, so a harness can say what this browser
 * is — which means every mount of `AppShell` renders the bar's Mine control in the `unavailable`
 * phase unless the scenario supplies this. That phase is `aria-disabled` and does nothing when
 * pressed, so a scenario that forgot it would assert against a control that cannot be operated and
 * would go on passing after the control stopped working.
 *
 * The constructor is INERT: it takes what a real one takes and answers nothing. Nothing here fakes
 * proof-of-work. A scenario that needs a worker to REPLY passes `PoolMiner`'s own `spawn`, which is
 * the seam that exists for it; this one exists only to make the capability check true.
 */
export const MINING_CAPABLE: Record<string, unknown> = {
  Worker: class InertWorker {
    onmessage: unknown = null
    onmessageerror: unknown = null
    onerror: unknown = null
    postMessage(): void {}
    terminate(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
    dispatchEvent(): boolean {
      return false
    }
  },
}

/* ── what went over the wire ────────────────────────────────────────────────────────────────── */

export interface Wire {
  readonly method: string
  readonly url: string
  /** Path and query only, so an assertion does not have to know which origin the page was on. */
  readonly path: string
  /** Scheme and host, for the scenarios about which SERVICE a request went to. */
  readonly origin: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string | undefined
  /** The parsed JSON body, or undefined when there was not one. */
  readonly json: unknown
}

/** One stubbed response. `status` defaults to 200 and the request id is always present. */
export interface Reply {
  status?: number
  body?: unknown
  requestId?: string
  /** Delay before answering, for the "degraded, not down" scenarios (doc 22 BJ-ADV-22). */
  delayMs?: number
  /** Throw instead of answering — the shape of a request that never landed. */
  networkError?: string
}

/**
 * A route table for the stubbed API.
 *
 * The key is `"<METHOD> <path prefix>"`, matched longest-prefix-first so a nested path beats the
 * collection it hangs off. The value is either a fixed reply or a function of the request, which
 * is what the idempotency and replay scenarios need: a service that has already done the work
 * answers the second call differently from the first, and a stub that could not would make every
 * double-submit scenario assert the same thing twice.
 */
export type Routes = Record<string, Reply | ((wire: Wire, n: number) => Reply)>

export interface Api {
  /** Every request, in order. */
  readonly wire: Wire[]
  /** Requests that were answered with a status outside 2xx, or that threw. */
  readonly failed: Wire[]
  /** Requests matching `"<METHOD> <prefix>"`. */
  matching(key: string): Wire[]
}

/* ── mounting ───────────────────────────────────────────────────────────────────────────────── */

export interface MountOptions {
  /** The address the browser is at. `BrowserRouter` and `cloudsforgeHosts()` both read it. */
  url?: string
  /** The stubbed API. A request with no matching route is a test bug and throws. */
  routes?: Routes
  /** Seed `localStorage`, e.g. the two `cf.*` token keys for a signed-in scenario. */
  storage?: Record<string, string>
  /**
   * Skip the "did anything render" assertion.
   *
   * Only for a scenario whose subject IS an empty render. Never as a way past a red test — the
   * whole point of `assertMounted` is that a scenario cannot pass against a blank page.
   */
  allowEmpty?: boolean
  /**
   * Replace the forty-character rule with a NAMED expectation, for a screen that is genuinely
   * shorter than forty characters.
   *
   * `pages/account.tsx` SignOutPage renders thirty-four: "Signing you out" and "Ending your
   * session", and nothing else — it is a spinner and a live region, and by the time it has
   * anything more to say the browser has left. The forty-character rule is a heuristic from
   * `stack/infra/beacon/src/journeys/web.js` for "a bundle that 404'd", and a heuristic that
   * fails on correct code is one somebody deletes.
   *
   * So it is replaced rather than lowered, and replaced by something STRICTER: a blank page has no
   * text at all and fails this too, while a page that rendered the wrong screen fails it where the
   * length rule would have passed. It is not `allowEmpty` under another name — supplying it still
   * asserts, and `journeys.test.ts` has a meta-test that no scenario passes both.
   */
  mountedText?: string | RegExp
  /** `prefers-reduced-motion: reduce` for the media-query scenarios. */
  reducedMotion?: boolean
  /**
   * What `window.confirm` answers.
   *
   * `components/receive.tsx` guards the rotate button with one, deliberately: minting a
   * second deposit address is an explicit ask. happy-dom does not implement `confirm`, and a
   * scenario that could not answer it could not press the button at all.
   */
  confirm?: boolean
  /**
   * `<meta name=… content=…>` tags in the head, the way `index.html` declares them.
   *
   * The harness document is built from nothing and has an empty head, so a component that reads the
   * shell reads nothing. Two in this estate do: `@cloudsforge/ui/consent` takes the analytics
   * measurement ID from `<meta name="cf-analytics">`, and `src/lib/obs.ts` takes the release from
   * `<meta name="cf-release">`. Both are identities the SHELL supplies, so a scenario that needs
   * one supplies it here rather than the component defaulting to something no browser would see.
   */
  meta?: Record<string, string>
  /** Extra properties on `window`, for the things a page reads off it that no API returns. */
  windowExtras?: Record<string, unknown>
  /**
   * Mount inside `<StrictMode>`, the way `src/main.tsx` actually mounts this app.
   *
   * Default `false`, because most scenarios do not care and StrictMode doubles every render. It
   * matters for one class: a guard held in a `useRef` is CREATED TWICE on a StrictMode mount, so a
   * latch proven only here has never been run the way the app runs it.
   *
   * This flag is load-bearing rather than decorative, and `test/double-submit.test.ts` has a
   * meta-test that proves it: a probe counts its own render passes and asserts the count DIFFERS
   * between the two modes. Without that meta-test a `strict` option that silently did nothing
   * would turn every paired scenario into the same test written twice — which is how three repos
   * in the previous estate-wide sweep shipped a StrictMode assertion that had never once
   * exercised StrictMode.
   */
  strict?: boolean
}

export interface Screen {
  readonly window: Window
  readonly document: Document
  readonly api: Api
  /**
   * Every full navigation the page asked for, in order.
   *
   * ── WHY THIS IS RECORDED RATHER THAN FOLLOWED ────────────────────────────────────────────────
   *
   * A completed sign-in is a FULL navigation in both of its cases —
   * `pages/account.tsx` explains why it must be — so "where did the browser end up" is
   * this array and nothing else. It is the assertion BJ-ACC-03 and BJ-ACC-04 turn on.
   *
   * It is captured rather than executed because the point of the scenario is the URL, and a
   * harness that navigated would throw the URL away and mount a second page that answers a
   * different question. The trap this is written against is real and recent: a test pinning the
   * SSO callback compared a URL with a copy of itself, and therefore could never fail. Every
   * assertion on this array must compare it against a value built from the SCENARIO'S OWN inputs,
   * never against something read back off the page.
   */
  readonly navigations: string[]
  /** Console errors and warnings the tree produced, including React's own. */
  readonly consoleErrors: string[]
  /** The visible text of the whole tree, whitespace-collapsed. */
  text(): string
  /** The text of one element, whitespace-collapsed. */
  textOf(el: Element | null | undefined): string
  /** Every element with this accessible role. */
  allByRole(role: Role): Element[]
  /** The one element with this role and accessible name. Throws when there is not exactly one. */
  byRole(role: Role, name: string | RegExp): Element
  /** The element with this role and name, or null. */
  queryByRole(role: Role, name: string | RegExp): Element | null
  /** The element with `data-testid`, or null. */
  queryByTestId(id: string): Element | null
  /** Document order: the index of the first occurrence of `needle` in the rendered text. */
  orderOf(needle: string | RegExp): number
  /** Assert `a` appears before `b` in document order, naming both when it does not. */
  before(a: string | RegExp, b: string | RegExp, why: string): void
  /** Click, and flush React. */
  click(el: Element): Promise<void>
  /** Click without awaiting the flush — for the double-submit scenarios. */
  clickNoFlush(el: Element): void
  /** Set a controlled input's or select's value the way a keystroke or a pick does. */
  type(el: Element, value: string): Promise<void>
  /** Press a key on the focused element. */
  press(key: string, opts?: { shift?: boolean }): Promise<void>
  /** The element that currently has focus. */
  focused(): Element | null
  /** Tab forward (or back), the way a browser moves focus through the tabbable set. */
  tab(back?: boolean): Promise<Element | null>
  /** Every tabbable element, in tab order. */
  tabbables(): Element[]
  /** Let effects, promises and timers settle. */
  settle(ms?: number): Promise<void>
  /** Re-render with a different element, keeping the same document. */
  rerender(element: ReactElement): Promise<void>
  /** Navigate, the way the back button does, and flush. */
  back(): Promise<void>
  /**
   * Everything in `localStorage` and `sessionStorage`, as one string.
   *
   * For the one claim `components/keyexport.tsx` makes that is a claim about storage: "the
   * reveal token and the material never touch storage". A search of the rendered page cannot prove
   * it — the material is rendered, on purpose, once — so the assertion has to be made here.
   */
  storageSnapshot(): string
  /** The legacy harness's `assertClean`: no console errors left unexplained. */
  clean(context: string, allow?: RegExp): void
  unmount(): Promise<void>
}

export type Role =
  | 'alert'
  | 'button'
  | 'dialog'
  | 'heading'
  | 'link'
  | 'listitem'
  | 'status'
  | 'textbox'
  | 'combobox'
  | 'checkbox'
  | 'radio'
  | 'table'
  | 'main'
  | 'region'
  | 'searchbox'

const squeeze = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * The accessible name of an element, by the subset of accname this estate's markup uses:
 * `aria-label`, then `aria-labelledby`, then a wrapping or associated `<label>`, then the
 * element's own text, then `title`.
 *
 * The `<label>` step is not in `market-web`'s copy and is needed here: every control on the wallet
 * and sign-in forms is labelled with `<label for>` (`pages/account.tsx`), and without it
 * an `<input>` has no accessible name at all — so `byRole('textbox', 'Destination address')` would
 * find nothing and the scenario would be addressing controls by index, which is the DOM-path
 * addressing doc 22 §2.4.3 forbids.
 */
function accessibleName(el: Element): string {
  const label = el.getAttribute('aria-label')
  if (label) return squeeze(label)
  const by = el.getAttribute('aria-labelledby')
  if (by) {
    const parts = by
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
    if (squeeze(parts)) return squeeze(parts)
  }
  if (LABELLABLE.has(el.tagName.toLowerCase())) {
    const id = el.getAttribute('id')
    const associated = id
      ? el.ownerDocument.querySelector(`label[for="${cssEscape(id)}"]`)
      : null
    if (associated) return squeeze(associated.textContent ?? '')
    const wrapping = el.closest('label')
    if (wrapping) return squeeze(wrapping.textContent ?? '')
  }
  const text = squeeze(el.textContent ?? '')
  if (text) return text
  return squeeze(el.getAttribute('title') ?? '')
}

const LABELLABLE = new Set(['input', 'select', 'textarea', 'button'])

/** Enough of `CSS.escape` for the ids this estate writes, which are `[a-z0-9-]`. */
const cssEscape = (value: string): string => value.replace(/["\\]/g, '\\$&')

/** The implicit-or-explicit role of an element, for the roles this suite addresses. */
function rolesOf(el: Element): string[] {
  const explicit = el.getAttribute('role')
  const tag = el.tagName.toLowerCase()
  const roles = explicit ? explicit.split(/\s+/) : []
  if (tag === 'button') roles.push('button')
  if (tag === 'a' && el.hasAttribute('href')) roles.push('link')
  if (/^h[1-6]$/.test(tag)) roles.push('heading')
  if (tag === 'li') roles.push('listitem')
  if (tag === 'main') roles.push('main')
  if (tag === 'section' && (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby'))) {
    roles.push('region')
  }
  if (tag === 'table') roles.push('table')
  if (tag === 'select') roles.push('combobox')
  if (tag === 'textarea') roles.push('textbox')
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()
    if (type === 'checkbox') roles.push('checkbox')
    else if (type === 'radio') roles.push('radio')
    else if (type === 'submit' || type === 'button') roles.push('button')
    else if (type === 'search') roles.push('searchbox', 'textbox')
    // `type="password"` has NO role in the ARIA mapping and is deliberately not given one here.
    // Inventing `textbox` for it would let a scenario address a password field by a role a screen
    // reader will never report, and the sign-in scenarios address it by its label instead.
    else if (type !== 'password' && type !== 'hidden') roles.push('textbox')
  }
  return roles
}

const matches = (name: string, want: string | RegExp): boolean =>
  typeof want === 'string' ? name.toLowerCase().includes(want.toLowerCase()) : want.test(name)

/**
 * Set a form control's value the way a keystroke does, past React's value tracker.
 *
 * React defines its own `value` accessor ON THE NODE when it mounts a controlled input, wrapping
 * the prototype's. Assigning through it updates the tracker as a side effect, so by the time the
 * `input` event is dispatched React's `updateValueIfChanged` sees no change and never calls
 * `onChange` — the field goes back to the state value on the next render and the test silently
 * asserts nothing. Writing through the PROTOTYPE's setter leaves the tracker holding the old
 * value, which is exactly the state a real keystroke leaves it in.
 *
 * Getting this wrong is the "check that cannot fail" of DOM testing: every assertion downstream of
 * an input that never took still passes, because it is asserting the empty form.
 */
function setNativeValue(el: Element, value: string): void {
  const proto = Object.getPrototypeOf(el) as object
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
  if (descriptor?.set) descriptor.set.call(el, value)
  else (el as unknown as { value: string }).value = value
  assert.equal(
    (el as unknown as { value: string }).value,
    value,
    `the value did not take on <${el.tagName.toLowerCase()}>. For a <select> this means there is ` +
      `no <option> with that value, which is itself the thing worth knowing.`,
  )
}

/** The tabbable set, in document order, honouring `tabindex` and the disabled attribute. */
function tabbablesIn(doc: Document): Element[] {
  const candidates = [
    ...doc.querySelectorAll(
      'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]',
    ),
  ]
  return candidates.filter((el) => {
    if (el.hasAttribute('disabled')) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    const index = el.getAttribute('tabindex')
    if (index !== null && Number(index) < 0) return false
    if (el.tagName.toLowerCase() === 'input' && el.getAttribute('type') === 'hidden') return false
    // An element inside `[hidden]` or `display:none` is not tabbable. happy-dom does not lay out,
    // so only the attribute and the inline style are checked — which is all this estate uses.
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (node.hasAttribute('hidden')) return false
      if (/display\s*:\s*none/.test(node.getAttribute('style') ?? '')) return false
    }
    return true
  })
}

export async function mount(element: ReactElement, options: MountOptions = {}): Promise<Screen> {
  const url = options.url ?? 'https://hub.cloudsforge.online/'
  /*
   * NO SCRIPT IN THIS HARNESS IS EVER FETCHED.
   *
   * `stubbed fetch` above covers what the APP asks for; it does not cover a `<script src>` the app
   * appends, which happy-dom loads through its own client. One page does append one:
   * `src/lib/turnstile.ts` adds Cloudflare's widget script. Left alone, every scenario that mounts
   * the register page would make a real request to `challenges.cloudflare.com` — a suite that needs
   * the internet, and a third party that decides whether CI is green.
   *
   * Turned off rather than routed, because there is nothing useful to serve: the real script's job
   * is to install `window.turnstile`, and a scenario that needs it installs its own through
   * `windowExtras` (which is also the only way to drive a widget's callbacks). happy-dom fires
   * `error` on the element, which is precisely the "a content blocker ate the script" case the
   * register page has a branch for.
   */
  const win = new Window({ url, settings: { disableJavaScriptFileLoading: true } })
  const doc = win.document as unknown as Document

  for (const [k, v] of Object.entries(options.storage ?? {})) {
    win.localStorage.setItem(k, v)
  }

  /* -- navigation capture -------------------------------------------------------------------- */

  // `location.assign` is the only way this bundle leaves a page (`pages/account.tsx`,
  // `lib/api.ts`). Recorded rather than followed; see the note on `Screen.navigations`.
  const navigations: string[] = []
  const location = win.location as unknown as { assign(url: string): void; replace(url: string): void }
  Object.defineProperty(location, 'assign', {
    configurable: true,
    writable: true,
    value: (next: string) => void navigations.push(String(next)),
  })
  Object.defineProperty(location, 'replace', {
    configurable: true,
    writable: true,
    value: (next: string) => void navigations.push(String(next)),
  })

  const reduced = options.reducedMotion === true
  ;(win as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
    matches: /prefers-reduced-motion/.test(query) ? reduced : false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })

  const confirmAnswer = options.confirm ?? true
  ;(win as unknown as { confirm: unknown }).confirm = () => confirmAnswer

  for (const [k, v] of Object.entries(options.windowExtras ?? {})) {
    ;(win as unknown as Record<string, unknown>)[k] = v
  }

  const saved = new Map<string, PropertyDescriptor | undefined>()
  const g = globalThis as unknown as Record<string, unknown>
  for (const key of GLOBALS) {
    saved.set(key, Object.getOwnPropertyDescriptor(g, key))
    Object.defineProperty(g, key, {
      configurable: true,
      writable: true,
      value: (win as unknown as Record<string, unknown>)[key],
    })
  }
  Object.defineProperty(g, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    writable: true,
    value: true,
  })

  /* -- console capture ---------------------------------------------------------------------- */

  const consoleErrors: string[] = []
  const realError = console.error
  const realWarn = console.warn
  console.error = (...args: unknown[]) => void consoleErrors.push(args.map(String).join(' '))
  console.warn = (...args: unknown[]) => void consoleErrors.push(args.map(String).join(' '))

  /* -- the stubbed API ---------------------------------------------------------------------- */

  const wire: Wire[] = []
  const failed: Wire[] = []
  const counts = new Map<string, number>()
  const routes = options.routes ?? {}
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length)
  const realFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(input)
    const parsed = new URL(raw, url)
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers: Record<string, string> = {}
    const given = init?.headers
    if (given instanceof Headers) given.forEach((v, k) => void (headers[k.toLowerCase()] = v))
    else if (Array.isArray(given)) for (const [k, v] of given) headers[k.toLowerCase()] = String(v)
    else if (given) for (const [k, v] of Object.entries(given)) headers[k.toLowerCase()] = String(v)

    const body = typeof init?.body === 'string' ? init.body : undefined
    let json: unknown
    if (body !== undefined) {
      try {
        json = JSON.parse(body)
      } catch {
        json = undefined
      }
    }
    const call: Wire = {
      method,
      url: raw,
      path: `${parsed.pathname}${parsed.search}`,
      origin: parsed.origin,
      headers,
      body,
      json,
    }
    wire.push(call)

    const key = keys.find((k) => {
      const [m, prefix] = k.split(' ')
      return m === method && call.path.startsWith(prefix ?? '')
    })
    if (key === undefined) {
      // Loud rather than a 404: an unrouted request means the test does not know what the page
      // does, and a silent 404 would let the scenario assert a degraded state it never set up.
      throw new Error(
        `no stub for ${method} ${call.path} — add it to the scenario's routes, or the scenario ` +
          `is asserting a failure it did not arrange`,
      )
    }
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    const entry = routes[key] as Reply | ((w: Wire, n: number) => Reply)
    const reply = typeof entry === 'function' ? entry(call, n) : entry
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs))
    if (reply.networkError) {
      failed.push(call)
      throw new TypeError(reply.networkError)
    }
    const status = reply.status ?? 200
    if (status < 200 || status > 299) failed.push(call)
    /*
     * A NULL-BODY STATUS TAKES `null`, NOT `''`.
     *
     * `new Response('', { status: 204 })` throws `TypeError: Response constructor: Invalid
     * response status code 204` — the Fetch standard forbids a body on 204, 205 and 304, and an
     * empty string is a body. The throw happened INSIDE the stubbed `fetch`, so it arrived at
     * `lib/api.ts` as a request that never landed and every scenario stubbing a 204 was
     * silently testing a network outage instead: the page under test rendered "Cannot reach the
     * server", which is a perfectly plausible screen and passes any assertion loose enough.
     *
     * Four routes this bundle calls answer 204 — `POST /auth/logout`, `POST /auth/password/reset`,
     * and hub-api's two dismissals — so this was not a corner. It was found by the reset scenario,
     * which is the first to stub one.
     */
    const nullBody = status === 204 || status === 205 || status === 304
    return new Response(nullBody ? null : reply.body === undefined ? '' : JSON.stringify(reply.body), {
      status,
      headers: {
        'content-type': 'application/json',
        'x-request-id': reply.requestId ?? 'req-stub-0001',
      },
    })
  }) as typeof fetch

  /* -- what the SHELL declares ---------------------------------------------------------------- */

  /*
   * `index.html`'s meta tags, seeded into the harness document BEFORE the first render.
   *
   * This document is built by happy-dom from nothing, so it has no head at all — and until this
   * existed, no scenario could reach any component that reads one. `CookieBanner` is exactly that:
   * it renders `null` unless `analyticsId()` finds `<meta name="cf-analytics">`, so a test that
   * mounted the shell and looked for a banner found nothing and could only have concluded, wrongly,
   * that the banner was absent from the tree.
   *
   * Seeded before `createRoot`, not after, because the components that read the head read it in a
   * mount effect and never again.
   */
  for (const [name, content] of Object.entries(options.meta ?? {})) {
    const tag = doc.createElement('meta')
    tag.setAttribute('name', name)
    tag.setAttribute('content', content)
    doc.head.appendChild(tag)
  }

  /* -- render ------------------------------------------------------------------------------- */

  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { act } = React as unknown as { act: (fn: () => Promise<void> | void) => Promise<void> }

  const host = doc.createElement('div')
  doc.body.appendChild(host)
  const root = createRoot(host as unknown as HTMLElement)

  const flush = async (ms = 0): Promise<void> => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms))
    })
  }

  // Wrapped for BOTH the first render and every `rerender`, so a scenario cannot start in
  // StrictMode and silently leave it half way through.
  const wrap = (node: ReactElement): ReactElement =>
    options.strict === true ? createElement(StrictMode, null, node) : node

  await act(async () => {
    root.render(wrap(element))
  })
  await flush()

  const text = (): string => squeeze(doc.body.textContent ?? '')

  const api: Api = {
    wire,
    failed,
    matching(k: string) {
      const [m, prefix] = k.split(' ')
      return wire.filter((c) => c.method === m && c.path.startsWith(prefix ?? ''))
    },
  }

  const allByRole = (role: Role): Element[] =>
    [...doc.querySelectorAll('*')].filter((el) => rolesOf(el).includes(role))

  const queryByRole = (role: Role, name: string | RegExp): Element | null => {
    const found = allByRole(role).filter((el) => matches(accessibleName(el), name))
    return found[0] ?? null
  }

  const byRole = (role: Role, name: string | RegExp): Element => {
    const found = allByRole(role).filter((el) => matches(accessibleName(el), name))
    if (found.length === 1) return found[0] as Element
    const names = allByRole(role).map((el) => JSON.stringify(accessibleName(el)))
    assert.fail(
      `expected exactly one ${role} named ${String(name)}, found ${found.length}. ` +
        `The ${role}s on the page are: ${names.join(', ') || '(none)'}`,
    )
  }

  /**
   * Dispatch a happy-dom event on a happy-dom node.
   *
   * `unknown` rather than `Event`: the events this file constructs come from the `Window` instance
   * and are happy-dom's classes, which are structurally close to but not assignable to the
   * `lib.dom` `Event` this repository's tsconfig declares. Naming either type here would be
   * asserting a compatibility that does not hold; the dispatch is the only place the two meet.
   */
  const dispatch = (el: Element, event: unknown): void => {
    ;(el as unknown as { dispatchEvent(e: unknown): boolean }).dispatchEvent(event)
  }

  const screen: Screen = {
    window: win,
    document: doc,
    api,
    navigations,
    consoleErrors,
    text,
    textOf: (el) => squeeze(el?.textContent ?? ''),
    allByRole,
    byRole,
    queryByRole,
    queryByTestId: (id) => doc.querySelector(`[data-testid="${cssEscape(id)}"]`),
    orderOf(needle) {
      const body = text()
      return typeof needle === 'string' ? body.indexOf(needle) : (body.match(needle)?.index ?? -1)
    },
    before(a, b, why) {
      const ia = screen.orderOf(a)
      const ib = screen.orderOf(b)
      assert.ok(ia >= 0, `${String(a)} is not on the page at all — ${why}`)
      assert.ok(ib >= 0, `${String(b)} is not on the page at all — ${why}`)
      assert.ok(ia < ib, `${String(a)} must come before ${String(b)} in document order — ${why}`)
    },
    async click(el) {
      await act(async () => {
        dispatch(el, new win.MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      await flush()
    },
    clickNoFlush(el) {
      dispatch(el, new win.MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    async type(el, value) {
      await act(async () => {
        setNativeValue(el, value)
        dispatch(el, new win.Event('input', { bubbles: true }))
        dispatch(el, new win.Event('change', { bubbles: true }))
      })
      await flush()
    },
    async press(key, opts = {}) {
      const target = (doc.activeElement ?? doc.body) as Element
      await act(async () => {
        dispatch(
          target,
          new win.KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            shiftKey: opts.shift === true,
          }),
        )
        dispatch(
          target,
          new win.KeyboardEvent('keyup', { key, bubbles: true, shiftKey: opts.shift === true }),
        )
      })
      await flush()
    },
    focused: () => (doc.activeElement === doc.body ? null : (doc.activeElement as Element | null)),
    tabbables: () => tabbablesIn(doc),
    async tab(back = false) {
      // A real browser moves focus itself, then the page's own keydown handler may move it back —
      // which is exactly what a focus trap does. So the default move happens first and the event
      // is dispatched second, and a handler that calls preventDefault is honoured by re-reading
      // activeElement afterwards.
      const order = tabbablesIn(doc)
      const here = doc.activeElement as Element | null
      let at = here ? order.indexOf(here) : -1
      if (at < 0 && here) {
        const following = order.findIndex(
          (el) => (here.compareDocumentPosition(el) & 4) !== 0, // DOCUMENT_POSITION_FOLLOWING
        )
        at = following < 0 ? order.length - 1 : following - 1
      }
      const next = back
        ? order[(at <= 0 ? order.length : at) - 1]
        : order[(at + 1) % Math.max(order.length, 1)]
      let prevented = false
      await act(async () => {
        const event = new win.KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
          shiftKey: back,
        })
        dispatch((here ?? doc.body) as Element, event)
        prevented = (event as { defaultPrevented: boolean }).defaultPrevented
      })
      if (!prevented && next) (next as unknown as HTMLElement).focus()
      await flush()
      return screen.focused()
    },
    settle: flush,
    async rerender(next) {
      await act(async () => {
        root.render(wrap(next))
      })
      await flush()
    },
    async back() {
      await act(async () => {
        win.history.back()
      })
      await flush()
    },
    storageSnapshot() {
      const dump = (s: Storage): string => {
        const out: string[] = []
        for (let i = 0; i < s.length; i += 1) {
          const k = s.key(i)
          if (k !== null) out.push(`${k}=${s.getItem(k) ?? ''}`)
        }
        return out.join('\n')
      }
      return `${dump(win.localStorage as unknown as Storage)}\n${dump(
        win.sessionStorage as unknown as Storage,
      )}`
    },
    clean(context, allow) {
      const noise = consoleErrors.filter((line) => (allow ? !allow.test(line) : true))
      assert.deepEqual(
        noise,
        [],
        `${context} produced console errors, which the legacy harness treated as a failure ` +
          `(stack/infra/beacon/src/journeys/web.js): ${noise.join(' | ')}`,
      )
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      console.error = realError
      console.warn = realWarn
      globalThis.fetch = realFetch
      for (const key of GLOBALS) {
        const descriptor = saved.get(key)
        if (descriptor) Object.defineProperty(g, key, descriptor)
        else delete g[key]
      }
      win.close()
    },
  }

  if (options.allowEmpty === true && options.mountedText !== undefined) {
    assert.fail('allowEmpty and mountedText are mutually exclusive — pick the one that asserts')
  }
  if (options.allowEmpty !== true) assertMounted(screen, options.mountedText)
  return screen
}

/**
 * The assertion that makes every scenario worth running.
 *
 * Forty characters, from `stack/infra/beacon/src/journeys/web.js`, and for the reason given
 * there: a bundle that fails to mount produces an empty body and a perfectly idle network, so a
 * smoke test that waits for the network and then asserts nothing goes green against a blank page.
 */
export function assertMounted(screen: Screen, expected?: string | RegExp): void {
  const body = screen.text()
  if (expected !== undefined) {
    const found = typeof expected === 'string' ? body.includes(expected) : expected.test(body)
    assert.ok(
      found,
      `the screen this scenario named did not mount: expected ${String(expected)} in the body, ` +
        `which holds ${JSON.stringify(body.slice(0, 120))}. ` +
        `${screen.api.failed.length} request(s) failed, and the console said: ` +
        `${screen.consoleErrors.slice(0, 2).join(' | ') || '(nothing)'}`,
    )
    return
  }
  assert.ok(
    body.length > 40,
    `nothing mounted: the document body holds ${body.length} characters (${JSON.stringify(
      body.slice(0, 80),
    )}), ${screen.api.failed.length} request(s) failed, and the console said: ` +
      `${screen.consoleErrors.slice(0, 2).join(' | ') || '(nothing)'}`,
  )
}

/** Run `body` with a mounted screen and always unmount, so one failure cannot poison the next. */
export async function withScreen(
  element: ReactElement,
  options: MountOptions,
  body: (screen: Screen) => Promise<void>,
): Promise<void> {
  const screen = await mount(element, options)
  try {
    await body(screen)
  } finally {
    await screen.unmount()
  }
}
