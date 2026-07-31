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
  // Not this app's own naming — these two are the prefixes hub-api's "needs you" cards link into:
  // `/account/security`, `/account/restrictions/<id>` and `/billing/subscriptions/<id>`
  // (nextactions.ts:200, 214, 235, 251). A card "carries a verb and a destination", and a
  // destination that 404s is a worry with no outlet.
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
