/**
 * The sign-in surface says which of three things went wrong — micro-org#480.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS FILE EXISTS TO KEEP FIXED.
 *
 * Every failure to hand a session to another surface printed one sentence: *"CloudsForge will not
 * hand a session to that origin… ask an operator to add it to the hand-off allowlist."* Measured on
 * 2026-08-17, `POST /auth/handoff` answered 201 for the apex and identity's audit log held zero
 * `handoff_refused` lines for it across 72 hours. **Nobody was ever off the allowlist.** What people
 * were hitting is a fifteen-minute access token gone stale overnight: `hasSession()` tests that
 * `cf.accessToken` is PRESENT, never that it is live, so a browser reopened in the morning sent a
 * dead bearer to identity, got a 401, and told the one person who could fix it (sign in again) to
 * go and bother somebody who could not.
 *
 * Two halves fix it and both are exercised below:
 *
 *   1. the stored session is PROVED LIVE before it is spent — `refreshSession()` on mount, so a
 *      dead one produces "your session expired" and never reaches `/auth/handoff` at all;
 *   2. a refusal that does happen is READ rather than collapsed — `mintHandoff` in
 *      `@cloudsforge/ui` reports 403 `handoff_origin_refused` apart from 401 apart from everything
 *      else, and only the first of those may mention the allowlist.
 *
 * ── WHAT IS ASSERTED, AND WHY IT IS NOT A PAGE COMPARED WITH ITS OWN CONSTANT ─────────────────
 *
 * Doc 22 bans asserting that a page equals the string it rendered from. Nothing here does: the
 * subject is the CHOICE between four mutually exclusive sentences, and every scenario asserts
 * which one appeared AND that the other three did not. `BRANCHES` below holds one short
 * discriminating fragment per sentence — the words that only that branch can produce — so a
 * mutation that prints the allowlist sentence for a 401 fails on the second half of every
 * assertion. A test that only checked "some words are on the page" would have passed against the
 * defect for the whole time it shipped.
 *
 * The other assertions are the two doc-22 kinds that are always allowed: what the client SENT (the
 * bearer on the mint, the token in the refresh body, the requests that did NOT go out) and where
 * the browser ENDED UP.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes, type Screen } from './dom.ts'
import * as fx from './fixtures.ts'
import { __resetAuth } from '../src/lib/api.ts'
import { SignInPage } from '../src/pages/account.tsx'

/**
 * The two identity routes this file arranges, as LITERALS.
 *
 * Transcribed from `src/lib/api.ts` (`performRefresh`) and `src/lib/identity.ts`, which carries the
 * `identity/src/server.ts` line each path was verified against. Literals rather than an import so
 * that this file and the implementation have one string to disagree about instead of zero — the
 * SSO callback once posted for the life of the service to a route identity had never served, and
 * the test guarding it read the address off the code under test.
 */
const REFRESH = 'POST /auth/refresh'
const HANDOFF = 'POST /auth/handoff'

const ORIGIN = 'https://hub.cloudsforge.online'

/** Another surface, so the return address needs a hand-off code rather than an in-app navigation. */
const ELSEWHERE = 'https://worlds.cloudsforge.online/player'

/**
 * A browser that has been open before: two `cf.*` keys, and the access token is the STALE one.
 *
 * Its name is the whole scenario. `hasSession()` cannot tell this from a live session — that is
 * micro-org#480 — so every assertion below about "the stale bearer never left the browser" is
 * about this exact string.
 */
const SIGNED_IN = {
  'cf.accessToken': 'stale-access-token-from-last-night',
  'cf.refreshToken': 'refresh-token-still-good',
}

/** What the stubbed refresh mints. A DIFFERENT string, so the two can be told apart on the wire. */
const REFRESHED = 'access-token-minted-by-the-refresh'

/** A refresh that works, so the scenario is about the hand-off and not about the refresh. */
const REFRESH_WORKS: Routes = {
  [REFRESH]: { body: fx.session({ accessToken: REFRESHED, refreshToken: SIGNED_IN['cf.refreshToken'] }) },
}

/**
 * The four sentences, one discriminating fragment each.
 *
 *   `allowlist`   — `HandoffNotice` `why: 'origin'`. THE ONLY BRANCH THAT MAY SAY THIS WORD, and
 *                   it is reachable only when identity said `handoff_origin_refused` in as many
 *                   words (micro-identity#22).
 *   `handedDead`  — `HandoffNotice` `why: 'session'`. The mint was refused because the bearer was
 *                   not accepted. Nothing is misconfigured.
 *   `blamesNoOne` — `HandoffNotice` `why: 'unknown'`. The refusal was not explained, or never
 *                   arrived. No claim is made about whose fault it is.
 *   `expired`     — the mount-time refresh established that this browser has no live session.
 *
 * They are disjoint on purpose: "session expired" appears in two of them, so neither is matched on
 * those two words.
 */
const BRANCHES = {
  allowlist: /allowlist/i,
  handedDead: /expired before we could hand it/i,
  blamesNoOne: /nothing has happened to your account/i,
  expired: /your session expired\. sign in again\./i,
} as const

/** Which of the four the reader is looking at. Every scenario asserts the whole list. */
const said = (s: Screen): string[] => {
  const text = s.text()
  return Object.entries(BRANCHES)
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name)
}

/** The sign-in page, arrived at from another surface. */
const arrivingFrom = (returnTo: string, extra = ''): ReturnType<typeof h> =>
  h(
    MemoryRouter,
    { initialEntries: [`/account/login?${extra}return=${encodeURIComponent(returnTo)}`] },
    h(SignInPage),
  )

/**
 * Module state that outlives a mount.
 *
 * `lib/api.ts` holds the in-flight refresh promise and the memory storage fallback at module
 * scope; a scenario that inherited either would be reading the previous one's session.
 */
const fresh = (): void => __resetAuth()

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   The refusal, once one has genuinely happened.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('a hand-off that did not happen says which of three things went wrong', () => {
  it('403 handoff_origin_refused is the only thing that may name the allowlist', async () => {
    fresh()
    await withScreen(
      arrivingFrom(ELSEWHERE),
      {
        url: `${ORIGIN}/account/login`,
        storage: SIGNED_IN,
        routes: {
          ...REFRESH_WORKS,
          [HANDOFF]: {
            status: 403,
            body: fx.errorBody('handoff_origin_refused', 'That origin may not be handed a session.'),
          },
        },
      },
      async (s) => {
        await s.settle()

        assert.deepEqual(
          said(s),
          ['allowlist'],
          'the one refusal that IS an allowlist problem did not say so, or said something else too',
        )
        // Named, so the reader can tell an operator WHICH origin — and so can they.
        assert.ok(
          s.text().includes(new URL(ELSEWHERE).origin),
          'the refusal does not name the surface that was refused',
        )
        // The hand-off did not happen, and the reader is not bounced to a dashboard pretending it
        // did. The form is back so there is something to do about it.
        assert.equal(s.navigations.length, 0, 'a refused hand-off navigated somewhere anyway')
        assert.ok(s.byRole('button', 'Sign in'), 'the form did not come back after a refusal')
        s.clean('origin refusal')
      },
    )
  })

  it('a 401 on the mint is a dead session, and blames no list the reader is already on', async () => {
    fresh()
    await withScreen(
      arrivingFrom(ELSEWHERE),
      {
        url: `${ORIGIN}/account/login`,
        storage: SIGNED_IN,
        routes: {
          ...REFRESH_WORKS,
          [HANDOFF]: { status: 401, body: fx.errorBody('unauthorized', 'That token is not one I will accept.') },
        },
      },
      async (s) => {
        await s.settle()

        // THE ASSERTION THIS FILE EXISTS FOR. For months this exact wire answer produced the
        // allowlist sentence; `said` returning `['allowlist']` here is the shipped defect, and it
        // fails this line.
        assert.deepEqual(said(s), ['handedDead'], 'a 401 was not reported as a dead session')
        assert.ok(s.text().includes(new URL(ELSEWHERE).origin), 'the sentence does not say where it was going')
        assert.equal(s.navigations.length, 0, 'a refused hand-off navigated somewhere anyway')
        s.clean('session refusal')
      },
    )
  })

  it('a refusal identity did not explain blames nobody at all', async () => {
    fresh()
    await withScreen(
      arrivingFrom(ELSEWHERE),
      {
        url: `${ORIGIN}/account/login`,
        storage: SIGNED_IN,
        routes: {
          ...REFRESH_WORKS,
          [HANDOFF]: { status: 500, body: fx.errorBody('internal_error', 'Something went wrong.') },
        },
      },
      async (s) => {
        await s.settle()

        assert.deepEqual(said(s), ['blamesNoOne'], 'an unexplained refusal named a cause it cannot know')
        s.clean('unexplained refusal')
      },
    )
  })

  it('a mint that never reached identity is not a refusal BY identity', async () => {
    fresh()
    await withScreen(
      arrivingFrom(ELSEWHERE),
      {
        url: `${ORIGIN}/account/login`,
        storage: SIGNED_IN,
        // A throw from `fetch`: nothing served there, DNS, offline, a CORS preflight refused. The
        // request got no answer, so nobody refused anything and no sentence may say they did.
        routes: { ...REFRESH_WORKS, [HANDOFF]: { networkError: 'Failed to fetch' } },
      },
      async (s) => {
        await s.settle()

        assert.deepEqual(said(s), ['blamesNoOne'], 'a dropped connection was reported as somebody’s decision')
        assert.equal(s.navigations.length, 0, 'a hand-off that never landed navigated anyway')
        s.clean('unreachable mint')
      },
    )
  })

  it('a hand-off that works says none of the four — the notices are not always on screen', async () => {
    fresh()
    const code = 'handoff-code-4c71'
    await withScreen(
      arrivingFrom(ELSEWHERE),
      {
        url: `${ORIGIN}/account/login`,
        storage: SIGNED_IN,
        routes: { ...REFRESH_WORKS, [HANDOFF]: { status: 201, body: { code, expiresInSeconds: 60 } } },
      },
      async (s) => {
        await s.settle()

        // Without this the four scenarios above prove nothing: a page that printed all four
        // sentences always would fail here, and a page that printed none of them would pass every
        // "the other three are absent" clause above.
        assert.deepEqual(said(s), [], 'a successful hand-off still complained about something')
        assert.equal(s.navigations.length, 1, 'a minted code did not hand the browser over exactly once')
        const went = new URL(s.navigations[0] as string)
        assert.equal(
          new URLSearchParams(went.hash.slice(1)).get('cf_code'),
          code,
          'the fragment does not carry the code identity minted in this run',
        )
        s.clean('successful hand-off')
      },
    )
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   The session is proved live before it is spent.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('a stored session is proved live before it is handed anywhere', () => {
  it('a session that will not refresh is never presented to identity as a bearer', async () => {
    fresh()
    let minted = 0
    await withScreen(
      arrivingFrom(ELSEWHERE),
      {
        url: `${ORIGIN}/account/login`,
        storage: SIGNED_IN,
        routes: {
          // 401: the refresh token is spent or expired. Routine, and `performRefresh` reports
          // nothing for it — only a non-401 is Nimbus failing.
          [REFRESH]: { status: 401, body: fx.errorBody('unauthorized', 'That refresh token is done.') },
          // ROUTED, and counted, rather than left out. An unrouted request throws, which would
          // also fail the scenario — but it would fail it as "the harness has no stub" instead of
          // as "a dead bearer went to identity", and the second is the sentence somebody needs to
          // read at 3am. The count below is the actual claim.
          [HANDOFF]: () => {
            minted += 1
            return { status: 401, body: fx.errorBody('unauthorized', 'no') }
          },
        },
      },
      async (s) => {
        await s.settle()

        assert.equal(
          minted,
          0,
          'a session that could not be refreshed was still spent on /auth/handoff — this is micro-org#480',
        )
        assert.deepEqual(said(s), ['expired'], 'a dead stored session was explained as something else')
        assert.ok(s.byRole('button', 'Sign in'), 'the reader was told their session expired and offered no form')
        assert.equal(s.navigations.length, 0, 'a dead session bounced the browser somewhere')

        // What the client SENT: the refresh token out of storage, and nothing else.
        const tried = s.api.matching(REFRESH)
        assert.equal(tried.length, 1, 'the stored session was not proved live exactly once')
        assert.deepEqual(
          tried[0]?.json,
          { refreshToken: SIGNED_IN['cf.refreshToken'] },
          'the refresh was not the token this browser holds',
        )
        s.clean('dead stored session')
      },
    )
  })

  it('the bearer that mints is the refreshed one, and the stale one never leaves the browser', async () => {
    fresh()
    await withScreen(
      arrivingFrom(ELSEWHERE),
      {
        url: `${ORIGIN}/account/login`,
        storage: SIGNED_IN,
        routes: { ...REFRESH_WORKS, [HANDOFF]: { status: 201, body: { code: 'handoff-code-77b2', expiresInSeconds: 60 } } },
      },
      async (s) => {
        await s.settle()

        const mint = s.api.matching(HANDOFF)[0]
        // Two independent inputs: one seeded into `localStorage` by this scenario, one returned by
        // this scenario's stubbed refresh. Neither is read off the code under test.
        assert.equal(
          mint?.headers['authorization'],
          `Bearer ${REFRESHED}`,
          'the hand-off spent the token in storage rather than proving it live first',
        )

        // Stronger than "the mint used the new one": the stale bearer is in NO request this page
        // made. A page that refreshed and then attached the old token somewhere else would pass
        // the assertion above and fail this one.
        const leaked = s.api.wire.filter((w) =>
          Object.values(w.headers).some((v) => v.includes(SIGNED_IN['cf.accessToken'])),
        )
        assert.deepEqual(
          leaked.map((w) => `${w.method} ${w.path}`),
          [],
          'the stale access token was attached to a request after the refresh replaced it',
        )
        s.clean('refreshed bearer')
      },
    )
  })

  it('no session at all is not an expired one, and asks identity nothing', async () => {
    fresh()
    await withScreen(
      // No `storage`: a browser that has never signed in here. Every route is unstubbed on
      // purpose — the harness throws on an unrouted request, so a page that asked identity
      // anything at all fails this scenario rather than passing it quietly.
      arrivingFrom(ELSEWHERE),
      { url: `${ORIGIN}/account/login`, routes: {} },
      async (s) => {
        await s.settle()

        assert.deepEqual(said(s), [], 'a first-time visitor was told their session expired')
        assert.equal(s.api.wire.length, 0, 'a page with no session still called a service')
        assert.ok(s.byRole('button', 'Sign in'), 'the sign-in form is not on the sign-in page')
        assert.equal(s.navigations.length, 0, 'a visitor with no session was sent somewhere')
        s.clean('no session')
      },
    )
  })

  it('a silent probe with a dead session is answered, not shown a form it never asked for', async () => {
    fresh()
    await withScreen(
      // `silent=1` is set by `attemptSilentSignIn` (@cloudsforge/ui), never by a person following a
      // link: another surface found the shared hint cookie, guessed there was a session here and
      // sent the browser to collect it. There is one in storage and it is dead, which is the same
      // answer as none — and the caller has to be told so it can clear its hint.
      arrivingFrom(ELSEWHERE, 'silent=1&'),
      {
        url: `${ORIGIN}/account/login`,
        storage: SIGNED_IN,
        routes: { [REFRESH]: { status: 401, body: fx.errorBody('unauthorized', 'That refresh token is done.') } },
      },
      async (s) => {
        await s.settle()

        assert.deepEqual(
          s.navigations,
          [`${ELSEWHERE}#cf_sso=none`],
          'a silent probe holding a dead session was not answered "nobody is signed in here"',
        )
        s.clean('silent probe, dead session')
      },
    )
  })
})
