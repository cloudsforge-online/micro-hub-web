/**
 * Cloudflare Turnstile in the browser — the widget, and nothing that decides anything.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── WHAT THIS FILE IS, AND THE THING IT MUST NEVER BECOME ─────────────────────────────────────
 *
 * It renders a widget and hands back the string the widget produces. That is all. **It never
 * calls `siteverify`, and it never decides whether a registration may proceed.** Both would be
 * theatre: the secret that redeems a token cannot exist in a bundle every visitor downloads, so a
 * browser asking Cloudflare "was this solved?" is a browser asking a question it cannot act on,
 * and any answer it acted on could be forged by editing the same bundle. The only verification
 * that counts is `identity/src/turnstile.ts`, server-side, before an account is created.
 *
 * ── THE SITE KEY IS NOT IN THIS FILE, AND THAT IS THE POINT ───────────────────────────────────
 *
 * micro-org#361 suggests compiling it into the bundle — safe, because it is public, and wrong for
 * this repository. `test/no-build-time-config.test.ts` greps every source file for a build-time
 * constant, because an artefact with an environment frozen into it has to be rebuilt to be
 * promoted, which means what reaches production is not what passed CI. One image serves localhost,
 * the micro network and mainnet. So the key arrives at runtime from `GET /auth/challenge` and is
 * passed in below.
 *
 * ── A TOKEN IS SINGLE USE, WHICH IS WHY `reset` IS EXPORTED ───────────────────────────────────
 *
 * Cloudflare redeems a token when identity verifies it, and a widget hands out ONE token per
 * solve. After any failed submit the token in hand is either spent or worthless, so the widget has
 * to be reset before the person can try again — otherwise the second press sends the same dead
 * string and earns the same refusal, for ever. That is why this renders EXPLICITLY and keeps the
 * widget id: `turnstile.reset()` with no argument only works when there is exactly one widget on
 * the page, and relying on that is relying on a page that has not been written yet.
 *
 * ── NO TIMERS ────────────────────────────────────────────────────────────────────────────────
 *
 * Rule 8: there is no `setInterval` in this estate and CI greps for one. The script is awaited
 * through its own `load` event and the widget reports through Cloudflare's callbacks; nothing here
 * polls for anything.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * `render=explicit`, deliberately.
 *
 * The default (implicit) mode scans the document for `.cf-turnstile` elements when the script
 * loads and renders whatever it finds. In a single-page app the form is mounted long after any
 * script tag, and again on every navigation back to it, so implicit rendering races the router and
 * silently renders nothing about half the time. Explicit mode makes the moment of rendering ours.
 */
export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** The `action` identity asserts on the way back. See `REGISTER_ACTION` in identity. */
export const REGISTER_ACTION = 'signup'

/** The parts of Cloudflare's global this app uses, and no more. */
export interface TurnstileApi {
  render(
    element: HTMLElement,
    options: {
      sitekey: string
      action?: string
      callback?: (token: string) => void
      'expired-callback'?: () => void
      'error-callback'?: () => void
      'timeout-callback'?: () => void
    },
  ): string | undefined
  reset(widgetId?: string): void
  remove(widgetId?: string): void
}

function existing(): TurnstileApi | null {
  // `window`, not `globalThis`. They are the same object in a browser, and they are NOT the same
  // object in this repository's test harness (`test/dom.ts` installs a happy-dom `Window` as
  // `globalThis.window`), so reading the wrong one makes the widget unreachable from every scenario
  // and the whole of this file untestable without a network.
  const api = (window as unknown as { turnstile?: unknown }).turnstile
  if (typeof api !== 'object' || api === null) return null
  const candidate = api as Partial<TurnstileApi>
  // Checked rather than cast. A `window.turnstile` that is present but not this shape is a script
  // that half-loaded or a name collision, and calling `render` on it throws inside a React effect
  // — which in this suite's harness is a console error and a failed mount, a long way from here.
  return typeof candidate.render === 'function' && typeof candidate.reset === 'function'
    ? (candidate as TurnstileApi)
    : null
}

/**
 * Single-flight, because two mounts must not append two script tags.
 *
 * `RegisterPage` mounts twice under StrictMode and again on every return to `/account/register`.
 * Loading the script per mount would add a `<script>` each time; Cloudflare's own guidance is one.
 */
let pending: Promise<TurnstileApi> | null = null

/**
 * Load Cloudflare's script and hand back its API.
 *
 * Rejects rather than resolving with `null` on a failure, so the caller has to say what a page with
 * no challenge widget does — see `RegisterPage`. A blocked script, an offline browser and a
 * content blocker all land here, and none of them may become "registration silently works without
 * a challenge": identity refuses a tokenless registration whatever this file does.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
  const already = existing()
  if (already) return Promise.resolve(already)
  if (pending) return pending

  pending = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT_URL
    script.async = true
    script.defer = true
    script.addEventListener('load', () => {
      const api = existing()
      if (api) resolve(api)
      else reject(new Error('the Turnstile script loaded without installing window.turnstile'))
    })
    script.addEventListener('error', () => {
      // Cleared so a later mount can try again — a reader who turns off a content blocker and
      // presses reload should not be held to the first attempt for the life of the tab.
      pending = null
      reject(new Error('the Turnstile script could not be loaded'))
    })
    document.head.appendChild(script)
  })
  return pending
}

/** For the suite: forget the memoised load so each scenario starts from an empty document. */
export function forgetTurnstile(): void {
  pending = null
}
