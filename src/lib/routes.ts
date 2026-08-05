/**
 * The route table, as data, in one place.
 *
 * ── Why this is not just a list inside app.tsx ─────────────────────────────────────────────────
 *
 * Three files describe Forge Hub's addresses and all three have to agree:
 *
 *   1. `src/app.tsx` — which component renders at each path,
 *   2. `src/components/shell.tsx` — which of them the sub-navigation offers,
 *   3. `nginx.conf` — which of them are served the app shell at all.
 *
 * The third is the one that bites, and it bites late. nginx enumerates this app's real routes and
 * 404s everything else *on purpose*, so that a wrong address answers 404 rather than 200 — the
 * estate's current site returns 200 for every unknown path, which means its "page not found"
 * screen is served as a success, indexed by crawlers and called healthy by monitors. The price of
 * that honesty is this list, in triplicate.
 *
 * So the navigation is DERIVED from here rather than restated, and `test/routes.test.ts` reads
 * `nginx.conf` and `app.tsx` and fails the build when either has drifted. "Remember to update
 * nginx.conf" is not a mechanism; a test is.
 *
 * This module deliberately imports nothing — not React, not the router — so the test that reads it
 * does not have to boot a browser to find out what the routes are.
 */

export interface HubRoute {
  /** The top-level path segment, without a leading slash. `''` is the index route. */
  readonly path: string
  /** The sub-navigation label, or null for a route that is reachable but not offered. */
  readonly label: string | null
  /** True when the route owns everything beneath it (`/wallet/deposits/<id>`). */
  readonly wildcard: boolean
}

/**
 * The addresses that render WITHOUT a session, and the only ones allowed to.
 *
 * ── Why Forge Hub, of all surfaces, has public routes ──────────────────────────────────────────
 *
 * It did not, and could not: "Forge Hub has no public page: every route reads an authenticated
 * composition of somebody's money, sessions and entitlements." That is still true of every page
 * that shows anything. These three show nothing — they are the estate's SIGN-IN SURFACE, and a
 * sign-in page behind a session gate is a redirect loop.
 *
 * They live here because nothing else in the estate could serve them. `signInRedirect()` sent
 * every product's signed-out visitor to `${accountUrl()}/login`, which resolved
 * `account.<apex>` — a hostname no repository serves and identity explicitly refuses to render
 * HTML for (`identity/src/server.ts` §3, `identity/src/server.test.ts:890`). docs/ecosystem/22
 * §8.1 records it as the estate's largest blocker: 86 of 318 browser scenarios start by signing
 * in, and none of them could. `@cloudsforge/ui`'s `signin` registry row now resolves to
 * `<hub>/account`, and these are the pages at the other end of it.
 *
 * The gate test in `test/routes.test.ts` reads this list. A route added to `app.tsx` without a
 * `<ProtectedRoute>` and without an entry here fails the build — which is the point: this is a
 * list of exemptions, and an exemption nobody wrote down is the failure it exists to prevent.
 */
export interface PublicRoute {
  /** The full path, relative to the app root and without a leading slash. */
  readonly path: string
  /** Why this address may be seen by somebody with no session. */
  readonly because: string
}

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  {
    path: 'account/login',
    because: 'the sign-in form itself; a session gate in front of it is a redirect loop',
  },
  {
    path: 'account/register',
    because: 'registration, reached from the sign-in form and from `site`',
  },
  {
    path: 'account/verify',
    because:
      'the landing page for the link in a verification email; the reader has no session yet — ' +
      'proving the address is what creates one — so a gate here is the redirect loop that would ' +
      'make the link useless to the person it was sent to',
  },
  {
    path: 'account/logout',
    because:
      'it revokes the refresh token and returns; gating it would leave a signed-out visitor ' +
      'unable to complete a sign-out that had already partly happened elsewhere',
  },
]

export const ROUTES: readonly HubRoute[] = [
  { path: '', label: 'Overview', wildcard: false },
  { path: 'portfolio', label: 'Portfolio', wildcard: false },
  // Wildcard: hub-api's deposit and withdrawal cards deep-link to `/wallet/deposits/<id>` and
  // `/wallet/withdrawals/<id>` (hub-api/src/nextactions.ts:160, 180).
  { path: 'wallet', label: 'Wallet', wildcard: true },
  { path: 'activity', label: 'Activity', wildcard: false },
  { path: 'security', label: 'Security', wildcard: false },
  { path: 'entitlements', label: 'Access', wildcard: false },
  { path: 'settings', label: 'Settings', wildcard: false },
  // Reached from the bar's search field, not from the sub-navigation: a nav entry for a page that
  // is empty until you type into something else is a nav entry that wastes a slot.
  { path: 'search', label: null, wildcard: false },
  // `account` carries two unrelated things, and both are addresses somebody else emits.
  //
  //   1. hub-api's "needs you" cards link into `/account/security` and
  //      `/account/restrictions/<id>` (nextactions.ts:200, 214, 235). A card "carries a verb and a
  //      destination", and a destination that 404s is a worry with no outlet.
  //   2. `@cloudsforge/ui`'s `signin` surface resolves to `<hub>/account`, so every product in the
  //      estate sends its signed-out visitors to `/account/login` and `/account/logout`. Those are
  //      in PUBLIC_ROUTES above; everything else under this prefix stays behind the gate.
  { path: 'account', label: null, wildcard: true },
  { path: 'billing', label: null, wildcard: true },
]

/** What the sub-navigation renders, with the leading slash a `NavLink` wants. */
export const NAV: ReadonlyArray<{ to: string; label: string }> = ROUTES.filter(
  (route): route is HubRoute & { label: string } => route.label !== null,
).map((route) => ({ to: `/${route.path}`, label: route.label }))

/** Every path nginx has to serve the shell for, excluding the index. */
export const NON_INDEX_PATHS: readonly string[] = ROUTES.filter((r) => r.path !== '').map(
  (r) => r.path,
)
