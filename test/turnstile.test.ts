/**
 * The registration challenge, in a browser — micro-org#361.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── WHAT THIS FILE MAY AND MAY NOT ASSERT ─────────────────────────────────────────────────────
 *
 * Doc 22 §3 forbids a browser scenario from asserting a business rule, and "may this person
 * register" is the most server-side rule on the estate. So nothing below decides whether a token
 * is good: every scenario asserts one of the three things §3.1 allows — WHAT THE CLIENT SENT, WHAT
 * A HUMAN CAN SEE relative to what the stubbed API returned in the same run, and WHERE THE BROWSER
 * ENDED UP. Whether a token holds is `identity/src/turnstile.test.ts`, which is the only place the
 * secret exists and the only place `siteverify` is called.
 *
 * ── THE FAKE WIDGET CAN SAY NO ────────────────────────────────────────────────────────────────
 *
 * The recurring defect this estate keeps shipping (micro-org#355, #356) is a check that cannot
 * fail. A fake Turnstile that always hands out a token, always renders, and never expires would
 * make every scenario below green against a page with no challenge in it at all. `fakeTurnstile`
 * therefore does none of that by itself: it renders NOTHING until the scenario says `solve()`, it
 * mints a DIFFERENT string each time so a stale token is visible in the request body, it records
 * every `reset` and `remove` with the widget id it was given, and it can be told to fail to render
 * at all. Two scenarios do not use it and let the real loader run into a script that never arrives.
 *
 * ── THE SITE KEY IN HERE IS NOT THE REAL ONE, ON PURPOSE ──────────────────────────────────────
 *
 * Every scenario invents its own key and asserts the page rendered THAT one. A bundle with the
 * mainnet key compiled into it — which micro-org#361 suggests and this repository forbids
 * (`test/no-build-time-config.test.ts`) — fails these scenarios rather than passing them.
 *
 * NOTHING HERE IS A REAL TOKEN OR A REAL SECRET. The strings are the scenarios' own inventions and
 * the secret never leaves the mainnet host at all.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Reply, type Routes, type Screen } from './dom.ts'
import { __resetAuth } from '../src/lib/api.ts'
import { readChallenge } from '../src/lib/identity.ts'
import { RegisterPage } from '../src/pages/account.tsx'
import { TURNSTILE_SCRIPT_URL, forgetTurnstile, loadTurnstile } from '../src/lib/turnstile.ts'

const ORIGIN = 'https://hub.cloudsforge.online'

/**
 * The two identity routes this page calls, as LITERALS.
 *
 * Transcribed from `identity/src/server.ts` (`define('GET', '/auth/challenge', …)` and
 * `define('POST', '/auth/register', …)`) rather than imported from the code under test, so that
 * this file and the implementation have one string to disagree about instead of zero. `test/dom.ts`
 * throws on an unrouted request, so a bundle that asked a third address fails outright.
 */
const ROUTES = { challenge: '/auth/challenge', register: '/auth/register' } as const

const page = (): ReactElement =>
  h(MemoryRouter, { initialEntries: ['/account/register'] }, h(RegisterPage))

/** Module state that outlives a mount: `lib/api.ts`'s session, and the memoised script load. */
function fresh(): void {
  __resetAuth()
  forgetTurnstile()
}

/* ── the fake widget ────────────────────────────────────────────────────────────────────────── */

interface Widget {
  readonly id: string
  readonly element: unknown
  readonly options: Record<string, unknown>
}

interface FakeTurnstile {
  /** Cloudflare's global, as this app uses it. */
  readonly api: Record<string, unknown>
  /** Every `render` call, in order. */
  readonly widgets: Widget[]
  /** Widget ids passed to `reset`, in order. */
  readonly resets: string[]
  /** Widget ids passed to `remove`, in order. */
  readonly removes: string[]
  /** Hand the newest widget a fresh, never-before-used token, and return it. */
  solve(): string
  /** Tell the newest widget its token has expired. */
  expire(): void
}

/**
 * A widget that has to be told what to do.
 *
 * `render` returns an id and then WAITS. Nothing is solved until a scenario says so, which is what
 * makes "the form submits without a token" and "the form submits with a token" different runs
 * rather than the same run twice. `broken: true` makes `render` return `undefined`, which is what
 * Cloudflare's own script does when it declines to render — the page has a branch for it.
 */
function fakeTurnstile(options: { broken?: boolean } = {}): FakeTurnstile {
  const widgets: Widget[] = []
  const resets: string[] = []
  const removes: string[] = []
  let minted = 0

  const newest = (): Widget => {
    const widget = widgets[widgets.length - 1]
    assert.ok(widget, 'no widget has been rendered, so there is nothing to solve')
    return widget
  }

  const fake: FakeTurnstile = {
    api: {
      render(element: unknown, opts: Record<string, unknown>): string | undefined {
        if (options.broken === true) return undefined
        const id = `widget-${widgets.length + 1}`
        widgets.push({ id, element, options: opts })
        return id
      },
      reset(id?: string): void {
        resets.push(String(id))
      },
      remove(id?: string): void {
        removes.push(String(id))
      },
    },
    widgets,
    resets,
    removes,
    solve(): string {
      minted += 1
      // A DIFFERENT string every time. Two solves that produced the same token would hide the whole
      // point of the reset: a second submit carrying the first, already-redeemed token.
      const token = `solved-token-${minted}`
      const callback = newest().options['callback'] as ((t: string) => void) | undefined
      assert.ok(callback, 'the page rendered a widget with no callback, so it can never get a token')
      callback(token)
      return token
    },
    expire(): void {
      const expired = newest().options['expired-callback'] as (() => void) | undefined
      assert.ok(expired, 'the page rendered a widget with no expiry handler')
      expired()
    },
  }
  return fake
}

/** Run `fn` inside React's `act`, the way a real event would. */
async function inAct(s: Screen, fn: () => void): Promise<void> {
  const React = await import('react')
  const { act } = React as unknown as { act: (body: () => Promise<void> | void) => Promise<void> }
  await act(async () => {
    fn()
  })
  await s.settle()
}

/* ── stubs ──────────────────────────────────────────────────────────────────────────────────── */

/** What identity answers `GET /auth/challenge` with when the deployment has a challenge. */
const challengeOn = (siteKey: string): Reply => ({
  status: 200,
  body: { required: true, provider: 'turnstile', siteKey, action: 'signup' },
})

/** …and when it has none, which is every developer machine. `identity/src/env.ts`. */
const challengeOff: Reply = {
  status: 200,
  body: { required: false, provider: 'turnstile', siteKey: null, action: 'signup' },
}

/** The 202 identity answers a fresh registration with. */
const accepted = (email: string): Reply => ({
  status: 202,
  body: { verificationRequired: true, email },
})

/** identity's refusal when the challenge was not attempted or did not hold. `server.ts`. */
const refused = (code: string, message: string, status: number): Reply => ({
  status,
  body: { error: { code, message } },
})

const TYPED = {
  email: 'newcomer@example.com',
  handle: 'newcomer',
  password: 'a-long-passphrase',
} as const

/** Fill the three real fields and the confirmation, then press. */
async function register(s: Screen): Promise<void> {
  await s.type(s.byRole('textbox', 'Email'), TYPED.email)
  await s.type(s.byRole('textbox', 'Handle'), TYPED.handle)
  await s.type(labelled(s, 'Password'), TYPED.password)
  await s.type(labelled(s, 'Confirm password'), TYPED.password)
  await s.click(s.byRole('button', 'Create account'))
}

function labelled(s: Screen, label: string): Element {
  const found = [...s.document.querySelectorAll('label')].filter((l) =>
    (l.textContent ?? '').trim().toLowerCase().startsWith(label.toLowerCase()),
  )
  assert.equal(found.length, 1, `expected exactly one <label> starting "${label}", found ${found.length}`)
  const id = found[0]?.getAttribute('for')
  const control = id ? s.document.getElementById(id) : null
  assert.ok(control, `the label "${label}" points at no control`)
  return control
}

const valueOf = (s: Screen, id: string): string => {
  const el = s.document.getElementById(id)
  assert.ok(el, `no control with id ${id}`)
  return (el as unknown as { value: string }).value
}

/** The widget container, addressed the way a person reading the DOM would find it. */
const container = (s: Screen): Element | null => s.document.querySelector('[data-sitekey]')

/**
 * "There is no widget", as a BOOLEAN.
 *
 * `assert.equal(container(s), null)` says the same thing and is unusable when it fails: node:test
 * builds a diff of the actual value, a happy-dom `Element` whose graph reaches its parents, its
 * document and its window, and rendering that took 74 seconds and printed no message at all when a
 * mutant was tried against it. A predicate has nothing to serialise, so the failure is the sentence.
 */
const noWidget = (s: Screen): boolean => container(s) === null

/** Every Turnstile script tag this mount appended. */
const scripts = (s: Screen): Element[] =>
  [...s.document.querySelectorAll('script')].filter((el) =>
    (el.getAttribute('src') ?? '').includes('challenges.cloudflare.com'),
  )

const bodyOf = (s: Screen, n = 0): Record<string, unknown> =>
  (s.api.matching(`POST ${ROUTES.register}`)[n]?.json ?? {}) as Record<string, unknown>

/* ══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('the registration challenge — the widget, the token and the reset', () => {
  it('a deployment with no challenge draws no widget, loads no script, and registers exactly as before', async () => {
    fresh()
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        routes: {
          [`GET ${ROUTES.challenge}`]: challengeOff,
          [`POST ${ROUTES.register}`]: accepted(TYPED.email),
        } satisfies Routes,
      },
      async (s) => {
        await register(s)

        assert.ok(noWidget(s), 'a widget was drawn for a deployment that has no challenge')
        assert.deepEqual(scripts(s).map((el) => el.getAttribute('src')), [],
          'Cloudflare’s script was fetched by a deployment that has no challenge')

        // THE FIELD IS ABSENT, not empty. identity separates "no challenge was attempted" from "a
        // challenge did not hold" (`readChallengeToken`), and an empty string blurs the two.
        const sent = s.api.matching(`POST ${ROUTES.register}`)
        assert.equal(sent.length, 1, 'the registration was not posted exactly once')
        assert.deepEqual(sent[0]?.json, { ...TYPED },
          'the body is not the three fields identity takes — this deployment has no challenge, so ' +
            'there is no `cf-turnstile-response` to send')

        assert.ok(s.text().includes(TYPED.email), 'the "check your email" screen did not appear')
      },
    )
  })

  it('a deployment with a challenge draws the widget with the site key the SERVER sent, and the action identity asserts', async () => {
    fresh()
    // The scenario's own key. Not the mainnet one, and not read off the code under test: a bundle
    // with any key compiled into it fails here.
    const siteKey = '0xTESTKEYaaaaaaaaaaaaaa'
    const fake = fakeTurnstile()

    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        windowExtras: { turnstile: fake.api },
        routes: {
          [`GET ${ROUTES.challenge}`]: challengeOn(siteKey),
          [`POST ${ROUTES.register}`]: accepted(TYPED.email),
        } satisfies Routes,
      },
      async (s) => {
        const asked = s.api.matching(`GET ${ROUTES.challenge}`)
        assert.equal(asked.length >= 1, true, 'the page never asked identity whether it is challenged')
        assert.equal(asked[0]?.headers['authorization'], undefined,
          'the challenge was asked for with a credential; it is asked by somebody with no account')

        const el = container(s)
        assert.ok(el, 'no widget container was rendered for a deployment that requires a challenge')
        assert.equal(el.getAttribute('data-sitekey'), siteKey,
          'the container carries a site key that did not come from this run’s GET /auth/challenge')
        assert.equal(el.getAttribute('data-action'), 'signup',
          'the widget is not marked with the action identity asserts, so a token minted on any ' +
            'other Turnstile widget under this key would be accepted here')

        // And the same two values reached `turnstile.render`, which is what actually configures it.
        assert.equal(fake.widgets.length, 1, 'the widget was not rendered exactly once')
        assert.equal(fake.widgets[0]?.options['sitekey'], siteKey)
        assert.equal(fake.widgets[0]?.options['action'], 'signup')
        assert.equal(fake.widgets[0]?.element, el, 'the widget was rendered into some other element')
      },
    )
  })

  it('the token the widget produced is what is posted, under Cloudflare’s own field name', async () => {
    fresh()
    const fake = fakeTurnstile()
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        windowExtras: { turnstile: fake.api },
        routes: {
          [`GET ${ROUTES.challenge}`]: challengeOn('0xTESTKEYbbbbbbbbbbbbbb'),
          [`POST ${ROUTES.register}`]: accepted(TYPED.email),
        } satisfies Routes,
      },
      async (s) => {
        const token = await (async () => {
          let minted = ''
          await inAct(s, () => void (minted = fake.solve()))
          return minted
        })()
        await register(s)

        assert.deepEqual(bodyOf(s), { ...TYPED, 'cf-turnstile-response': token },
          'the registration did not carry the token this widget produced, under the field name ' +
            'identity reads (`cf-turnstile-response`)')
      },
    )
  })

  it('a form submitted before the widget is solved carries no token, and identity’s refusal is what the reader sees', async () => {
    fresh()
    const fake = fakeTurnstile()
    // identity's own sentence, from `runRegistrationChallenge`. The page must not invent one.
    const sentence = 'that registration did not carry a completed challenge'

    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        windowExtras: { turnstile: fake.api },
        routes: {
          [`GET ${ROUTES.challenge}`]: challengeOn('0xTESTKEYcccccccccccccc'),
          [`POST ${ROUTES.register}`]: refused('challenge_required', sentence, 403),
        } satisfies Routes,
      },
      async (s) => {
        await register(s)

        // THE PAGE DOES NOT HOLD THE RULE. It sends the registration and renders what identity
        // says. A bundle that refused locally would be a second copy of a server rule — and would
        // make a deployment with no challenge unregisterable the day this GET went slow.
        assert.equal(s.api.matching(`POST ${ROUTES.register}`).length, 1,
          'the page decided for itself not to post an unsolved registration')
        assert.equal(bodyOf(s)['cf-turnstile-response'], undefined,
          'a token was sent by a form whose widget was never solved')
        assert.ok(s.text().includes(sentence), `identity’s refusal is not on screen: ${s.text().slice(0, 200)}`)

        // Nothing the reader typed is thrown away, and they are not on the "check your email" page.
        assert.equal(valueOf(s, 'email'), TYPED.email, 'the email was cleared by a refusal')
        assert.equal(valueOf(s, 'handle'), TYPED.handle, 'the handle was cleared by a refusal')
        assert.equal(valueOf(s, 'new-password'), TYPED.password, 'the password was cleared by a refusal')
      },
    )
  })

  it('a refused registration resets the widget, so the RETRY carries a new token and never the spent one', async () => {
    fresh()
    const fake = fakeTurnstile()
    const taken = 'That handle is already in use.'

    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        windowExtras: { turnstile: fake.api },
        routes: {
          [`GET ${ROUTES.challenge}`]: challengeOn('0xTESTKEYdddddddddddddd'),
          // The first press is refused for a reason that has NOTHING to do with the challenge —
          // which is the case that matters, because identity redeemed the token on the way to
          // finding the handle taken, and it is spent whatever the reader now does.
          [`POST ${ROUTES.register}`]: (_wire, n) =>
            n === 1 ? refused('conflict', taken, 409) : accepted(TYPED.email),
        } satisfies Routes,
      },
      async (s) => {
        let first = ''
        await inAct(s, () => void (first = fake.solve()))
        await register(s)

        assert.equal(bodyOf(s, 0)['cf-turnstile-response'], first)
        assert.ok(s.text().includes(taken), 'identity’s refusal is not on screen')

        // THE ASSERTION THE WHOLE RESET EXISTS FOR: the widget was told, by id, to start again.
        assert.deepEqual(fake.resets, [fake.widgets[0]?.id],
          'the widget was not reset after a failed registration. The token in hand is spent, so ' +
            'every retry from here posts a dead string and earns `timeout-or-duplicate` — a form ' +
            'that tells a real person they are a bot, for ever, after one taken handle')

        // Solve again, correct nothing else, press again.
        let second = ''
        await inAct(s, () => void (second = fake.solve()))
        assert.notEqual(first, second, 'the fake minted the same token twice; this asserts nothing')

        await s.click(s.byRole('button', 'Create account'))
        assert.equal(s.api.matching(`POST ${ROUTES.register}`).length, 2, 'the retry was not posted')
        assert.equal(bodyOf(s, 1)['cf-turnstile-response'], second,
          'the retry re-sent the spent token instead of the one the reset produced')
        assert.ok(s.text().includes(TYPED.email), 'the retry did not reach the "check your email" screen')
      },
    )
  })

  it('an expired token is dropped rather than posted', async () => {
    fresh()
    const fake = fakeTurnstile()
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        windowExtras: { turnstile: fake.api },
        routes: {
          [`GET ${ROUTES.challenge}`]: challengeOn('0xTESTKEYeeeeeeeeeeeeee'),
          [`POST ${ROUTES.register}`]: accepted(TYPED.email),
        } satisfies Routes,
      },
      async (s) => {
        await inAct(s, () => void fake.solve())
        // Turnstile expires a token roughly five minutes after it is solved. Posting it then earns
        // `timeout-or-duplicate`, which identity cannot tell from a replay — so the reader is told
        // they are a bot for having read the form slowly.
        await inAct(s, () => fake.expire())
        await register(s)

        assert.equal(bodyOf(s)['cf-turnstile-response'], undefined,
          'an expired token was posted; the expiry callback is not clearing it')
      },
    )
  })

  it('a Turnstile outage answers 503 and the page says so without inventing a sentence', async () => {
    fresh()
    const fake = fakeTurnstile()
    // identity FAILS CLOSED — `identity/src/turnstile.ts` records the decision and its date.
    const sentence = 'the registration challenge could not be checked; please try again'

    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        windowExtras: { turnstile: fake.api },
        routes: {
          [`GET ${ROUTES.challenge}`]: challengeOn('0xTESTKEYffffffffffffff'),
          [`POST ${ROUTES.register}`]: refused('challenge_unavailable', sentence, 503),
        } satisfies Routes,
      },
      async (s) => {
        await inAct(s, () => void fake.solve())
        await register(s)

        assert.ok(s.text().includes(sentence), 'the 503 sentence is not on screen')
        assert.ok(!s.text().includes('Check your email'),
          'a registration identity refused reached the "check your email" screen')
        assert.deepEqual(fake.resets, [fake.widgets[0]?.id],
          'the widget was not reset after an outage, so the retry re-sends a token Cloudflare may ' +
            'well have redeemed before it went down')
      },
    )
  })

  it('the script is Cloudflare’s, async, deferred, explicit — and appended ONCE even under StrictMode', async () => {
    fresh()
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        // No `windowExtras.turnstile`: the real loader runs, and `test/dom.ts` does not fetch it.
        strict: true,
        routes: {
          [`GET ${ROUTES.challenge}`]: challengeOn('0xTESTKEYgggggggggggggg'),
          [`POST ${ROUTES.register}`]: accepted(TYPED.email),
        } satisfies Routes,
      },
      async (s) => {
        const tags = scripts(s)
        assert.equal(tags.length, 1,
          `Cloudflare’s script was appended ${tags.length} times. StrictMode mounts this page ` +
            'twice and the router mounts it again on every return, so a loader without the ' +
            'single-flight guard adds a script tag per visit')

        const tag = tags[0] as Element
        assert.equal(tag.getAttribute('src'), TURNSTILE_SCRIPT_URL)
        assert.ok((tag.getAttribute('src') ?? '').startsWith('https://challenges.cloudflare.com/turnstile/v0/api.js'),
          'the script is not Cloudflare’s documented widget URL')
        assert.ok((tag.getAttribute('src') ?? '').includes('render=explicit'),
          'implicit rendering scans the document once, at script load — a form the router mounts ' +
            'afterwards is not there yet, so the widget silently never appears')
        assert.notEqual(tag.getAttribute('async'), null, 'the script is not async')
        assert.notEqual(tag.getAttribute('defer'), null, 'the script is not deferred')
      },
    )
  })

  it('a script a content blocker ate is said out loud, and does not stop the form being submitted', async () => {
    fresh()
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        routes: {
          [`GET ${ROUTES.challenge}`]: challengeOn('0xTESTKEYhhhhhhhhhhhhhh'),
          [`POST ${ROUTES.register}`]: refused('challenge_required', 'that registration did not carry a completed challenge', 403),
        } satisfies Routes,
      },
      async (s) => {
        // `test/dom.ts` loads no external script, so the element errors — the same event a blocked
        // request produces in a real browser.
        await s.settle()
        assert.ok(s.text().toLowerCase().includes('bot check could not load'),
          `a page whose challenge script never arrived says nothing about it: ${s.text().slice(0, 300)}`)

        // The button is NOT disabled. A page that disabled it would be deciding, on its own
        // authority and with a third-party script as the evidence, that this person may not
        // register — on a deployment identity may not even be challenging.
        const button = s.byRole('button', 'Create account')
        assert.equal(button.hasAttribute('disabled'), false,
          'a blocked third-party script disabled registration')

        await register(s)
        assert.equal(s.api.matching(`POST ${ROUTES.register}`).length, 1,
          'the page refused to post at all when the widget script was blocked')
        assert.ok(s.text().includes('that registration did not carry a completed challenge'),
          'identity’s refusal is not on screen')
      },
    )
  })

  it('a widget that declines to render is reported, and nothing pretends there is a token', async () => {
    fresh()
    const fake = fakeTurnstile({ broken: true })
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        windowExtras: { turnstile: fake.api },
        routes: {
          [`GET ${ROUTES.challenge}`]: challengeOn('0xTESTKEYiiiiiiiiiiiiii'),
          [`POST ${ROUTES.register}`]: refused('challenge_required', 'that registration did not carry a completed challenge', 403),
        } satisfies Routes,
      },
      async (s) => {
        assert.equal(fake.widgets.length, 0, 'the fake was asked to render and did; it was meant to decline')
        assert.ok(s.text().toLowerCase().includes('bot check could not load'),
          'a widget that returned no id is not reported to the reader')
        await register(s)
        assert.equal(bodyOf(s)['cf-turnstile-response'], undefined,
          'a token was posted by a page that never rendered a widget')
      },
    )
  })

  it('an identity that has never heard of the challenge route registers exactly as before', async () => {
    fresh()
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        routes: {
          // A deployment older than micro-org#361: the route does not exist.
          [`GET ${ROUTES.challenge}`]: { status: 404, body: { error: { code: 'not_found', message: 'no' } } },
          [`POST ${ROUTES.register}`]: accepted(TYPED.email),
        } satisfies Routes,
      },
      async (s) => {
        await register(s)
        assert.ok(noWidget(s), 'a widget was drawn from a 404')
        assert.deepEqual(bodyOf(s), { ...TYPED },
          'a 404 on the challenge route changed what a registration posts')
        assert.ok(s.text().includes(TYPED.email), 'the registration did not go through')
      },
    )
  })

  it('the widget is torn down when the page is left, so a return does not stack a second one', async () => {
    fresh()
    const fake = fakeTurnstile()
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        windowExtras: { turnstile: fake.api },
        routes: {
          [`GET ${ROUTES.challenge}`]: challengeOn('0xTESTKEYjjjjjjjjjjjjjj'),
          [`POST ${ROUTES.register}`]: accepted(TYPED.email),
        } satisfies Routes,
      },
      async (s) => {
        assert.equal(fake.widgets.length, 1)
        const id = fake.widgets[0]?.id
        // Registering navigates the page to "check your email", which unmounts the form.
        await inAct(s, () => void fake.solve())
        await register(s)
        assert.deepEqual(fake.removes, [id],
          'the widget was not removed when its container left the DOM; Cloudflare keeps its own ' +
            'state per widget id and a page that never removes them leaks one per visit')
      },
    )
  })

  it('a site key published alongside `required: false` draws nothing — the BOOLEAN is the decision', async () => {
    fresh()
    const fake = fakeTurnstile()
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        windowExtras: { turnstile: fake.api },
        routes: {
          // A site key AND `required: false` in the same answer. identity refuses to boot
          // half-configured (`parseTurnstile`), so this is not a shape mainnet sends today — which
          // is exactly why it is worth pinning here rather than leaving to luck. `siteKey` names a
          // KEY; `required` names the DECISION. A client that infers the decision from "a key was
          // populated" is one server-side default away from drawing a widget nobody verifies, and a
          // token solved against a deployment that holds no secret can never be redeemed by anyone
          // — the reader would be solving a puzzle for nothing.
          [`GET ${ROUTES.challenge}`]: {
            status: 200,
            body: {
              required: false,
              provider: 'turnstile',
              siteKey: '0xTESTKEYmmmmmmmmmmmmmm',
              action: 'signup',
            },
          },
          [`POST ${ROUTES.register}`]: accepted(TYPED.email),
        } satisfies Routes,
      },
      async (s) => {
        assert.ok(noWidget(s), 'a widget was drawn for a deployment that said it needs none')
        assert.deepEqual(fake.widgets, [],
          'turnstile.render was called for a deployment whose answer was `required: false`')

        await register(s)
        assert.deepEqual(bodyOf(s), { ...TYPED },
          'a deployment that requires no challenge was sent a challenge field anyway')
      },
    )
  })

  it('two overlapping loads append ONE script tag', async () => {
    fresh()
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        routes: {
          [`GET ${ROUTES.challenge}`]: challengeOff,
          [`POST ${ROUTES.register}`]: accepted(TYPED.email),
        } satisfies Routes,
      },
      async (s) => {
        // Driven at the module rather than through the page, and that is deliberate. Under
        // StrictMode the page's two mounts both happen before the challenge answer arrives, so its
        // second load never overlaps its first and `RegisterPage` cannot exercise the guard at all
        // — while a reader who leaves /account/register and comes straight back, on a connection
        // slow enough that the script is still in flight, overlaps them every time. Proving a
        // property of the module at the module is the only way this one gets proven.
        const first = loadTurnstile()
        const second = loadTurnstile()

        // Counted BEFORE anything is awaited: `loadTurnstile` appends synchronously and the claim is
        // about what the document holds at that instant. The two promises are then quietened — this
        // harness never fetches a script (`test/dom.ts` disables file loading), so how they settle is
        // scenario 9's subject and not this one's.
        const appended = scripts(s).length
        first.catch(() => undefined)
        second.catch(() => undefined)
        await s.settle()

        assert.equal(appended, 1,
          `${appended} Turnstile script tags were appended by two overlapping loads. Cloudflare's ` +
            'guidance is one per document; a second copy re-installs `window.turnstile` underneath ' +
            'the widget ids the first one handed out')
      },
    )
  })

  it('the two passwords are still checked before anything is posted, and the challenge did not weaken it', async () => {
    fresh()
    const fake = fakeTurnstile()
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        strict: true,
        windowExtras: { turnstile: fake.api },
        routes: {
          [`GET ${ROUTES.challenge}`]: challengeOn('0xTESTKEYkkkkkkkkkkkkkk'),
          // A route that WOULD succeed. The scenario is that it is never called.
          [`POST ${ROUTES.register}`]: accepted(TYPED.email),
        } satisfies Routes,
      },
      async (s) => {
        await inAct(s, () => void fake.solve())
        await s.type(s.byRole('textbox', 'Email'), TYPED.email)
        await s.type(s.byRole('textbox', 'Handle'), TYPED.handle)
        await s.type(labelled(s, 'Password'), TYPED.password)
        await s.type(labelled(s, 'Confirm password'), 'a-long-pASsphrase')
        await s.click(s.byRole('button', 'Create account'))

        assert.equal(s.api.matching(`POST ${ROUTES.register}`).length, 0,
          'a registration with two different passwords was posted')
        // AND THE TOKEN WAS NOT SPENT ON IT. A mismatch that reset the widget would make the
        // commonest slip on this form cost the reader a second puzzle.
        assert.deepEqual(fake.resets, [],
          'a password mismatch reset the challenge, spending a solve on a request never sent')
      },
    )
  })

  it('two same-tick presses send ONE registration, and one token', async () => {
    fresh()
    const fake = fakeTurnstile()
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/account/register`,
        // StrictMode, because the latch lives in a ref and a ref is created twice under it — a
        // latch proven only outside StrictMode has never run the way `src/main.tsx` runs it.
        strict: true,
        windowExtras: { turnstile: fake.api },
        routes: {
          [`GET ${ROUTES.challenge}`]: challengeOn('0xTESTKEYllllllllllllll'),
          [`POST ${ROUTES.register}`]: { ...accepted(TYPED.email), delayMs: 20 },
        } satisfies Routes,
      },
      async (s) => {
        let token = ''
        await inAct(s, () => void (token = fake.solve()))
        await s.type(s.byRole('textbox', 'Email'), TYPED.email)
        await s.type(s.byRole('textbox', 'Handle'), TYPED.handle)
        await s.type(labelled(s, 'Password'), TYPED.password)
        await s.type(labelled(s, 'Confirm password'), TYPED.password)

        const button = s.byRole('button', 'Create account')
        s.clickNoFlush(button)
        s.clickNoFlush(button)
        await s.settle(60)

        const sent = s.api.matching(`POST ${ROUTES.register}`)
        assert.equal(sent.length, 1,
          `two same-tick presses sent ${sent.length} registrations. POST /auth/register carries no ` +
            'idempotency key, so the second creates nothing and refuses on the handle the first ' +
            'just took — and the token is single use, so it would fail anyway')
        assert.equal((sent[0]?.json as Record<string, unknown>)['cf-turnstile-response'], token)
      },
    )
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * `readChallenge` on its own, because one of its rules cannot be seen from the page.
 *
 * Everything above drives `RegisterPage`. That is the right level for "what did the reader see" and
 * "what did the client send" — but `RegisterPage` renders no widget for a null site key however the
 * answer was read, so the normalisation below is invisible from up there. Asserted where it lives.
 */
describe('reading identity’s challenge answer', () => {
  it('`required: true` with no site key is read as NO challenge, not as an impossible one', () => {
    /*
     * A widget cannot be rendered without a key. Read as "required", the form draws nothing, says
     * nothing, and can never be completed — a page that is broken and silent about it. Read as "no
     * challenge", the form is submitted and identity gets to say what it wants, which is the honest
     * outcome: see `NO_CHALLENGE` on why falling back to "no challenge" is not a bypass — identity
     * refuses a tokenless registration whether or not this bundle ever drew a widget.
     *
     * Not hypothetical. An identity that learned `required` before it learned to publish a key, a
     * proxy that strips fields it does not know, and a half-applied deploy all answer exactly this.
     */
    assert.equal(
      readChallenge({ required: true, provider: 'turnstile', siteKey: null, action: 'signup' }),
      null,
      'a challenge was declared required with no key to render it with',
    )
    assert.equal(
      readChallenge({ required: true, provider: 'turnstile', siteKey: '', action: 'signup' }),
      null,
      'an empty string was accepted as a site key',
    )
    assert.equal(
      readChallenge({ required: true, provider: 'turnstile', action: 'signup' }),
      null,
      'an answer with no `siteKey` field at all was accepted as a required challenge',
    )
  })

  it('an answer that is not one is refused rather than half-read', () => {
    for (const body of [null, undefined, 'no', 42, [], {}, { required: 'yes', siteKey: '0xKEY' }]) {
      assert.equal(readChallenge(body), null, `${JSON.stringify(body)} was read as a challenge answer`)
    }
  })

  it('a complete answer keeps the server’s site key and action verbatim', () => {
    // `action` is echoed rather than hard-coded, so the day identity changes it the widget follows
    // without a matching bundle: identity asserts the action it received the token under.
    assert.deepEqual(
      readChallenge({ required: true, provider: 'turnstile', siteKey: '0xKEY', action: 'register-v2' }),
      { required: true, siteKey: '0xKEY', action: 'register-v2' },
    )
    // …and an answer with no action falls back to the one both halves ship with today.
    assert.deepEqual(readChallenge({ required: false, siteKey: null }), {
      required: false,
      siteKey: null,
      action: 'signup',
    })
  })
})
