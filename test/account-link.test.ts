/**
 * The `Account` entry in the company bar's menu, driven in a DOM.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS FILE EXISTS FOR — FOUND BY THE OWNER, USING THE PRODUCT
 *
 * `ui/packages/ui/src/index.tsx` rendered the entry as a `<button>` whose `onClick` was
 * `onSignIn` — the SAME callback as the `Sign in` button that appears when nobody is signed in. So
 * a signed-in reader who opened the account menu and pressed `Account` was sent to the sign-in
 * page, which then bounced them back to where they started. There was no way to reach the account
 * settings screen from the chrome at all, on any of the nineteen surfaces that render this bar.
 *
 * It survived because a destination expressed as an `onClick` is invisible to everything that
 * checks destinations. It has no `href`, so it cannot be middle-clicked, cannot be copied, cannot
 * be crawled, and cannot be asserted on by any test that reads links — including
 * `ui/packages/ui/src/footer.test.ts`, which counts and resolves every anchor in the footer and
 * would have caught this instantly had the entry been one.
 *
 * ── WHY THE TEST IS HERE AND NOT IN `micro-ui` ────────────────────────────────────────────────
 *
 * The menu is behind a dropdown: `AccountMenu` renders the `<ul>` only while `open` is true, and
 * `open` is `useState` driven by a click. `micro-ui`'s own suite is `renderToStaticMarkup`, which
 * runs no effects and dispatches no events, so it can only ever see the closed trigger. Making the
 * menu server-renderable would mean adding a test-only `defaultOpen` prop — a fiction the product
 * never uses — so the assertion is made where a real click is possible instead.
 *
 * `@cloudsforge/ui` is consumed here as `link:../ui/packages/ui`, so this drives the REAL component
 * from the design system's working tree, mounted inside the REAL app shell, with the REAL registry
 * resolving the host. Nothing about the account entry is stubbed.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { accountUrl, cloudsforgeHosts } from '@cloudsforge/ui'

import { MINING_CAPABLE, withScreen } from './dom.ts'
import { poolSummary } from './fixtures.ts'
import { __resetAuth } from '../src/lib/api.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import { AppShell } from '../src/components/shell.tsx'
import { SettingsPage } from '../src/pages/settings.tsx'

const ORIGIN = 'https://hub.cloudsforge.online'

/**
 * An access token whose payload says what this scenario needs it to say.
 *
 * Unsigned on purpose, and copied in the same shape as `journeys.test.ts`'s: `lib/claims.ts` reads
 * these fields for DISPLAY and verifies nothing, because every service verifies the token on the
 * request itself. No credential appears here — the payload is two public display fields and the
 * signature segment is the literal word `unsigned`.
 */
function unsignedToken(payload: Record<string, unknown>): string {
  const b64url = (value: string): string =>
    Buffer.from(value, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify(payload))}.unsigned`
}

describe('BJ-SIGNIN — the account menu leads somewhere', () => {
  it('BJ-SIGNIN-09 ★ T1: Account is a link, and it does not lead back to sign-in', async () => {
    __resetAuth()
    const handle = 'savvanis'

    await withScreen(
      h(MemoryRouter, { initialEntries: ['/'] }, h(AuthProvider, null, h(AppShell))),
      {
        url: `${ORIGIN}/`,
        storage: {
          'cf.accessToken': unsignedToken({ handle, roles: ['player'] }),
          'cf.refreshToken': 'held-refresh-token',
        },
        routes: {
          'GET /auth/me': { body: { user: { id: 'u1', handle, roles: ['player'] } } },
          // The bar asks the pool what it is now, on every address — `src/mining/session.tsx` sits
          // inside `AppShell` so the Mine control can start and stop one session from anywhere.
          // Routed here so this scenario's bar is the ordinary one and not a bar in the state that
          // follows an unreachable pool.
          'GET /v1/pool': { body: poolSummary() },
        },
        windowExtras: MINING_CAPABLE,
      },
      async (s) => {
        // Open the menu the way a reader does. The trigger is named by the handle it displays.
        await s.click(s.byRole('button', handle))

        // ── IT IS A LINK ──────────────────────────────────────────────────────────────────────
        // `byRole('link', …)` in `test/dom.ts` only matches `a[href]`. A `<button>` carrying an
        // `onClick` does not match it, which is exactly why this assertion is the one that fails
        // against the defect: before the fix there is no anchor here at all.
        const account = s.queryByRole('link', 'Account')
        assert.ok(
          account !== null,
          'the Account entry in the account menu is not a link. A destination expressed as an ' +
            'onClick cannot be middle-clicked, copied or asserted on — which is how it went four ' +
            'months pointing at the sign-in page',
        )
        const href = account.getAttribute('href') ?? ''

        // ── AND IT DOES NOT LEAD BACK TO SIGN-IN ──────────────────────────────────────────────
        // The defect's destination, named from the registry rather than written out: `accountUrl()`
        // resolves the `signin` surface, and `signInRedirect()` appends `/login`. Either shape
        // means a signed-in reader pressing Account is offered the sign-in form again.
        assert.notEqual(
          href,
          accountUrl(),
          `Account points at the sign-in surface (${href}) — this IS the defect, not a fix of it`,
        )
        assert.ok(
          !href.includes('/login'),
          `Account points at a login route (${href}), so a signed-in reader is sent to sign in again`,
        )

        // ── AND IT POINTS AT THE PAGE THAT IS ACTUALLY SERVED ─────────────────────────────────
        // `src/app.tsx` routes `settings` under the root of this bundle, and this bundle
        // is what `hub.<apex>` serves. Resolved through the registry, so a change of apex or of
        // environment moves it and a hard-coded hostname cannot creep back in.
        assert.equal(
          href,
          `${cloudsforgeHosts().hub}/settings`,
          'Account does not point at the settings page this app serves',
        )

        s.clean('the account menu')
      },
    )
  })

  /**
   * The same defect, one page further in.
   *
   * `account.<apex>` is one of exactly TWO subdomains out of twenty-seven with no DNS record on
   * either network — the other is `worlds-api` — so a link to it does not 404, it fails to resolve
   * and the browser shows its own error page. Settings linked to it twice: once as "Open account
   * settings", and once as the value of the row labelled "Account (sign-in)" on the panel whose
   * whole purpose is to tell a reader which environment they are on.
   *
   * The rule is asserted over EVERY anchor and every rendered address on the page rather than over
   * the two that were known to be wrong, because the next one will be somewhere else.
   */
  it('BJ-SIGNIN-10 T1: Settings names no hostname the estate has no DNS record for', async () => {
    __resetAuth()
    const handle = 'savvanis'

    await withScreen(
      h(MemoryRouter, { initialEntries: ['/settings'] }, h(AuthProvider, null, h(SettingsPage))),
      {
        url: `${ORIGIN}/settings`,
        storage: {
          'cf.accessToken': unsignedToken({ handle, roles: ['player'] }),
          'cf.refreshToken': 'held-refresh-token',
        },
        routes: { 'GET /auth/me': { body: { user: { id: 'u1', handle, roles: ['player'] } } } },
      },
      async (s) => {
        // Named from the registry, not written out, so it stays true on testnet and in dev.
        const dead = cloudsforgeHosts().account
        assert.ok(dead.length > 0, 'the registry produced no `account` host; this asserts nothing')

        for (const a of s.allByRole('link')) {
          const href = a.getAttribute('href') ?? ''
          assert.ok(
            !href.startsWith(dead),
            `Settings links to ${href}. The estate has no DNS record for that hostname, on ` +
              `either network, so the reader gets the browser's own error page`,
          )
        }

        // And it is not merely unlinked — it is not PRINTED either. The "Resolved hosts" panel is
        // read as the answer to "which environment am I on", so a dead address shown there is
        // believed even though nothing is clickable.
        assert.ok(
          !s.text().includes(dead),
          `Settings prints ${dead} on the page, and nothing serves it`,
        )

        // The sign-in row still has to name the address that IS served, or this test would pass
        // just as well against a page that dropped the row instead of correcting it.
        assert.ok(
          s.text().includes(cloudsforgeHosts().signin),
          'Settings no longer names the sign-in address at all',
        )

        s.clean('the settings page')
      },
    )
  })
})
