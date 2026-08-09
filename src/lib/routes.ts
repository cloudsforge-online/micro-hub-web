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
  /**
   * Whether a crawler should be INVITED to this address — the sitemap, and `<meta name="robots">`.
   *
   * "Index" here means a SEARCH index. It has nothing to do with `NON_INDEX_PATHS` at the foot of
   * this file, which means "not the router's index route"; the two words collide and only one of
   * them is about crawlers.
   *
   * Being SERVED and being ADVERTISED are different questions, and this is the second one. Every
   * route below is served — a wrong address must answer 404 rather than 200, which is what
   * `nginx.conf` enumerates them for — and all but one of them is behind `<ProtectedRoute>`, so
   * what a crawler would actually get is a redirect to a sign-in form. A sitemap entry for that is
   * a dead link the site handed over about itself, and a crawler that is given dead links by an
   * index discounts the ones that work.
   *
   * SO EXACTLY ONE ADDRESS ON THIS SURFACE IS TRUE: `/`. It is the front door — the address the
   * estate's own sitemap already advertises (`hub` is in `SITEMAP_SURFACES`,
   * `ui/packages/ui/src/sitemap.ts`) and the one `robotsDirective()` derives `index, follow`
   * for from a registry row carrying `servesUi: true` and no `adminOnly`. What a crawler is served
   * there is the shell: the product's name and its one sentence, which is what a search for "Forge
   * Hub" ought to return. That the DATA behind it needs a session is not a reason to hide that the
   * door exists.
   *
   * The six `PUBLIC_ROUTES` below are ungated and are STILL not indexable — they are not in this
   * table at all, and `noindex, nofollow` is applied to them by path. They are the estate's sign-in,
   * registration and password-reset forms; indexing a credential form publishes it to anyone
   * searching, and the two that are landing pages for a mailed link are addressed to one person.
   */
  readonly indexable: boolean
}

/**
 * The addresses that render WITHOUT a session, and the only ones allowed to.
 *
 * ── Why Forge Hub, of all surfaces, has public routes ──────────────────────────────────────────
 *
 * It did not, and could not: "Forge Hub has no public page: every route reads an authenticated
 * composition of somebody's money, sessions and entitlements." That is still true of every page
 * that shows anything. These six show nothing — they are the estate's SIGN-IN SURFACE, and a
 * sign-in page behind a session gate is a redirect loop. Three of them are the landing pages for
 * links CloudsForge puts in email, where "the reader has no session" is not a preference but the
 * definition of the situation: proving an address is what creates a session, and asking for a
 * password reset is what a reader does when they have none and cannot get one.
 *
 * They live here because nothing else in the estate could serve them. `signInRedirect()` sent
 * every product's signed-out visitor to `${accountUrl()}/login`, which resolved
 * `account.<apex>` — a hostname no repository serves and identity explicitly refuses to render
 * HTML for (`identity/src/server.ts` §3, `identity/src/server.test.ts`). docs/ecosystem/22
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
    path: 'account/forgot',
    because:
      'the form that asks identity for a password-reset link; the reader is signed out by ' +
      'definition — not being able to sign in is the reason they are here — so a session gate is ' +
      'a redirect loop that puts the only route to a reset behind the thing it exists to repair. ' +
      'It shows nothing: identity answers `POST /auth/password/forgot` with one fixed sentence ' +
      'for a known address, an unknown one and a malformed one alike, and that sentence is the ' +
      'whole of the screen',
  },
  {
    path: 'account/reset',
    because:
      'the landing page for the link in a password-reset email; the reader has no session — a ' +
      'reset revokes every session on the account, and they could not sign in before it either — ' +
      'so a gate here is the redirect loop that makes the mailed link useless to the person it ' +
      'was sent to. It also has to EXIST before the mail can be sent: notify refuses to send a ' +
      'message whose link cannot be built. It shows nothing until a token is typed into no field ' +
      'at all: the token arrives in the fragment, is held in a ref, and goes into one POST body',
  },
  {
    path: 'account/logout',
    because:
      'it revokes the refresh token and returns; gating it would leave a signed-out visitor ' +
      'unable to complete a sign-out that had already partly happened elsewhere',
  },
]

export const ROUTES: readonly HubRoute[] = [
  { path: '', label: 'Overview', wildcard: false, indexable: true },
  { path: 'portfolio', label: 'Portfolio', wildcard: false, indexable: false },
  // Wildcard: hub-api's deposit and withdrawal cards deep-link to `/wallet/deposits/<id>` and
  // `/wallet/withdrawals/<id>` (hub-api/src/nextactions.ts, 180).
  { path: 'wallet', label: 'Wallet', wildcard: true, indexable: false },
  { path: 'activity', label: 'Activity', wildcard: false, indexable: false },
  { path: 'security', label: 'Security', wildcard: false, indexable: false },
  { path: 'entitlements', label: 'Access', wildcard: false, indexable: false },
  { path: 'settings', label: 'Settings', wildcard: false, indexable: false },
  // Mining, in this tab. Offered in the navigation because it is a thing the reader DOES rather
  // than a record of something that already happened, and a capability nobody can find is a
  // capability nobody has — the page is the only place in the estate where a signed-in account can
  // point a browser at either the EMBER node or the pool.
  //
  // `indexable: false` for the reason every row below the front door carries it: the page is behind
  // the session gate, so what a crawler would be served is a redirect to a sign-in form.
  { path: 'mine', label: 'Mine', wildcard: false, indexable: false },
  // Reached from the bar's search field, not from the sub-navigation: a nav entry for a page that
  // is empty until you type into something else is a nav entry that wastes a slot.
  //
  // Never indexable, and for a reason of its own beyond the gate: `/search?q=…` is an unbounded
  // family of addresses whose content is one reader's own wallets and transactions.
  { path: 'search', label: null, wildcard: false, indexable: false },
  // `account` carries two unrelated things, and both are addresses somebody else emits.
  //
  //   1. hub-api's "needs you" cards link into `/account/security` and
  //      `/account/restrictions/<id>` (nextactions.ts, 214, 235). A card "carries a verb and a
  //      destination", and a destination that 404s is a worry with no outlet.
  //   2. `@cloudsforge/ui`'s `signin` surface resolves to `<hub>/account`, so every product in the
  //      estate sends its signed-out visitors to `/account/login` and `/account/logout`. Those are
  //      in PUBLIC_ROUTES above; everything else under this prefix stays behind the gate.
  { path: 'account', label: null, wildcard: true, indexable: false },
  { path: 'billing', label: null, wildcard: true, indexable: false },
]

/**
 * The addresses of THIS surface a crawler is invited to, with the leading slash a `<loc>` wants.
 *
 * Derived, not restated: `nginx.conf`'s sitemap block is checked against this list in both
 * directions by `test/sitemap.test.ts`, so an address cannot be advertised without being declared
 * true here and cannot be declared here without being advertised.
 */
export const INDEXABLE_PATHS: readonly string[] = ROUTES.filter((r) => r.indexable).map(
  (r) => `/${r.path}`,
)

/** Every path on this surface that must carry `noindex, nofollow`, as a predicate. */
export function isIndexable(pathname: string): boolean {
  // The first segment decides, because that is the granularity `ROUTES` declares and the
  // granularity nginx serves. `/wallet/deposits/<id>` is `wallet`.
  const segment = pathname.split('/')[1] ?? ''
  return ROUTES.find((route) => route.path === segment)?.indexable === true
}

/** What the sub-navigation renders, with the leading slash a `NavLink` wants. */
export const NAV: ReadonlyArray<{ to: string; label: string }> = ROUTES.filter(
  (route): route is HubRoute & { label: string } => route.label !== null,
).map((route) => ({ to: `/${route.path}`, label: route.label }))

/** Every path nginx has to serve the shell for, excluding the index. */
export const NON_INDEX_PATHS: readonly string[] = ROUTES.filter((r) => r.path !== '').map(
  (r) => r.path,
)
