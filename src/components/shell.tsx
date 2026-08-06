/**
 * The app shell: the company bar, Hub's own sub-navigation, and the page.
 *
 * The bar is `CloudsForgeBar` from @cloudsforge/ui and is never reimplemented — it is the thing
 * that makes moving between seven surfaces feel like one application. Everything this app adds
 * goes BELOW it, except the search field, which the design system provides a `rightSlot` for
 * precisely so that §6's "⌘K search" sits in the bar rather than in a second bar underneath it.
 *
 * Hub is `current="hub"` in the switcher, which the switcher renders as *no* current entry: Hub is
 * not a destination in the list, it is the container the reader is already inside.
 */
import { useEffect, useRef, useState } from 'react'
import {
  CloudsForgeBar,
  CloudsForgeFooter,
  CookieBanner,
  MainRegion,
  SkipLink,
} from '@cloudsforge/ui'
import { applyHead, surfaceMeta, type SurfaceMeta } from '@cloudsforge/ui/seo'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { PRODUCT } from '../lib/hosts.ts'
import { MAX_SEARCH_LENGTH } from '../lib/hub.ts'
import { NAV, PUBLIC_ROUTES, ROUTES, isIndexable } from '../lib/routes.ts'
import { useSession } from '../lib/auth.tsx'

/*
 * The sub-navigation is DERIVED from `lib/routes.ts` rather than restated here. A second list
 * would be a second opinion about which addresses exist, and nginx.conf already makes that two —
 * see the header of that file for why the count matters.
 */

export function AppShell() {
  const { account, signIn, signOut } = useSession()

  return (
    <>
      {/*
        The skip link is the first focusable thing in the document, and it is the SHARED one — this
        app had none at all, so a keyboard or screen-reader reader reached the page by tabbing past
        the logo, the switcher, the search field and the account menu, on every navigation. WCAG 2.2
        SC 2.4.1 is the criterion and the shared bar is exactly the "block repeated on multiple
        pages" it is about.

        NOTE the account menu is DELIBERATELY NOT MOVED. Its `accountHref` is left unset so it keeps
        `@cloudsforge/ui`'s default, `accountSettingsUrl()` — `<hub>/settings`, this bundle's own
        settings page. It is NOT `accountUrl()`, which resolves the `signin` surface and is the
        defect `test/account-link.test.ts` exists for.
      */}
      <SkipLink>Skip to the page</SkipLink>
      <CloudsForgeBar
        current={PRODUCT}
        account={account}
        onSignIn={() => signIn()}
        onSignOut={signOut}
        rightSlot={account.signedIn ? <SearchField /> : undefined}
      />
      {/*
        The sub-nav is sticky at exactly `var(--cf-bar-h)` — the bar's own height token, not a
        number copied out of it. When the bar's height changes, this moves with it; a hard-coded
        46px would leave a seam that only appears on the surfaces nobody rechecked.

        It is absent for a signed-out reader. Every entry in it goes to a page that reads somebody's
        money or sessions, so for a visitor on the sign-in page it is eight links that all end in a
        redirect back to the form they are already looking at. Hiding it is not a security
        boundary and is not pretending to be one — every service verifies the token on the request
        — it is the same reasoning as the switcher's `adminOnly`: a menu entry nobody can open.
      */}
      {account.signedIn && (
        <nav className="wt-subnav" aria-label="Sections">
          <div className="wt-subnav__inner">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                // `end` only on the index: without it, `/` matches every path and the Overview tab
                // stays highlighted on all seven pages.
                end={item.to === '/'}
                className={({ isActive }) => `wt-subnav__link${isActive ? ' is-active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
      <DocumentMeta />
      {/*
        `MainRegion` rather than the hand-written `<main id="main">` this file used to carry. A
        `<main>` is not focusable, so a skip link pointing at one scrolls the page in Chrome and
        Safari and leaves focus on the link itself; `MainRegion` sets `id={MAIN_ID}` and
        `tabIndex={-1}` together, which is the pair `SkipLink` needs. The id is `cf-main` now rather
        than `main` — nothing in this app referenced the old one (checked: no `#main` anchor, no
        selector, no test), and the shared `SkipLink` composes its href from the same constant, so
        the two cannot disagree.
      */}
      <MainRegion className="wt-main">
        <Outlet />
      </MainRegion>

      {/*
        The company footer, from @cloudsforge/ui. Not written here, and deliberately not
        `<footer>` markup of this app's own: the estate had four hand-rolled footers and nine
        surfaces with none, and the registry's `developers` row has been claiming all along that
        the developer console is "reached from the footer" — a navigation path that existed
        nowhere. Every link in it is derived from SURFACES, so a new product appears here without
        this file changing.

        `account` is passed for one reason: it decides whether the operator surfaces are offered.
        Omitting it would hide them, which is safe, but this app already knows and a signed-in
        operator should be able to reach Admin from any page.
      */}
      <CloudsForgeFooter current={PRODUCT} account={account} />

      {/*
        Last in the document, and therefore last in the tab order. That is deliberate: the banner is
        a dialog and is explicitly NOT modal, so a reader who came here to sign in, to read a
        deposit address or to finish a password reset can do it and answer afterwards. A consent
        banner that traps focus is the coercion the regulation is about — and on this surface the
        thing it would trap somebody out of is a credential field.

        It renders nothing at all until it knows the reader has not already answered, and nothing on
        an origin where analytics would not report anyway — which is every local stack.
      */}
      <CookieBanner />
    </>
  )
}

/**
 * Keep `document.title`, the description, the Open Graph tags, the canonical link and — the field
 * that matters most on this surface — the robots directive in step with the address.
 *
 * A component in the shell rather than a hook called by each page, because the failure mode of the
 * second shape is the page that forgets to call it, and the page that forgets is the one added
 * last. Here that page would be an auth screen with no `noindex` on it.
 *
 * ── What this does NOT replace ────────────────────────────────────────────────────────────────
 *
 * The static tags in `index.html`. They are what a link-preview fetcher gets — the ones used by
 * chat and social clients generally do not execute JavaScript — so the shell keeps its own title,
 * description and card, and this is the layer a browser and the crawlers that do execute JavaScript
 * see. That trade is inherited rather than introduced; it is written down at the top of
 * `@cloudsforge/ui/seo`.
 */
function DocumentMeta() {
  const { pathname } = useLocation()

  useEffect(() => {
    applyHead(headFor(pathname), window.location.origin)
  }, [pathname])

  return null
}

/**
 * The head for one address, as a pure function of it.
 *
 * Exported so it can be asserted directly as well as through a rendered document: the robots
 * directive is the one field on this surface whose failure is silent, invisible in a browser, and
 * discovered by finding a sign-in form in a search result.
 *
 * ── Where the words come from ─────────────────────────────────────────────────────────────────
 *
 * The registry, through `surfaceMeta`. Which page you are on is read off `ROUTES` — the same
 * declaration the navigation, the router and nginx are derived from — rather than typed a fifth
 * time. The six ungated addresses take their name from the `signin` registry row, because that is
 * literally what they are: `signin` is a real surface with `basePath: '/account'` that rides on
 * this bundle, and "Sign in to CloudsForge" is its registered name rather than a string invented
 * here.
 *
 * ── And the robots directive, which is not derived from the registry ──────────────────────────
 *
 * `robotsDirective()` answers per SURFACE, and both `hub` and `signin` carry `servesUi: true` with
 * no `adminOnly`, so the registry's answer for both is `index, follow`. That is right for exactly
 * one address on this surface and wrong for every other one — see the note on `HubRoute.indexable`.
 * So it is forced here, per address, and `isIndexable()` is the single declaration of which is
 * which.
 */
export function headFor(pathname: string): SurfaceMeta {
  const trimmed = pathname.replace(/^\/+/, '')
  const isAuthPage = PUBLIC_ROUTES.some((route) => route.path === trimmed)
  const indexable = isIndexable(pathname)
  const robots = indexable ? undefined : 'noindex, nofollow'

  if (isAuthPage) {
    // The sign-in surface's own registry row, `basePath: '/account'`. Its name and blurb are the
    // right ones for these six screens, and `noindex, nofollow` is forced over the registry's
    // answer: a credential form in a search index is that form published to whoever searches, and
    // two of the six are landing pages for a link addressed to one person.
    return surfaceMeta('signin', { path: pathname, robots: 'noindex, nofollow' })
  }

  const segment = trimmed.split('/')[0] ?? ''
  // The index route takes the surface name ALONE, not "Overview — Forge Hub". It is the front door
  // and it is the one address on this surface a stranger reaches from a search result, so the title
  // there is the product's name — which is also what `index.html` carries statically, and
  // `test/head.test.ts` asserts the two are the same string rather than two opinions about it.
  // `surfaceMeta` makes the same choice for `site` and for the same reason.
  const label = segment === '' ? null : ROUTES.find((route) => route.path === segment)?.label
  return surfaceMeta(PRODUCT, {
    ...(label === null || label === undefined ? {} : { title: label }),
    path: pathname,
    ...(robots === undefined ? {} : { robots }),
  })
}

/**
 * The search field in the bar.
 *
 * Submits to `/search?q=`, a real address, rather than opening a modal that owns the results.
 * A result set a reader cannot link to, bookmark or reload is a result set they have to produce
 * again every time they want to look at it, and the back button — which is how people leave a
 * search — would take them out of the search instead of back into it.
 *
 * `maxLength` mirrors hub-api's own cap (server.ts:130, 403), so an over-long query is refused
 * where the reader can see it rather than by a 400 they cannot act on.
 */
function SearchField() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)

  // ⌘K / Ctrl-K focuses the field. Bound on the window rather than on the input, because the
  // point of the shortcut is that it works when the field does NOT have focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <form
      className="wt-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = query.trim()
        // hub-api answers 400 for an empty `q` (server.ts:400-402). Not sending it is better than
        // sending it and rendering the refusal.
        if (trimmed.length === 0) return
        navigate(`/search?q=${encodeURIComponent(trimmed)}`)
      }}
    >
      <input
        ref={input}
        className="wt-search__input"
        type="search"
        name="q"
        value={query}
        maxLength={MAX_SEARCH_LENGTH}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search wallets, transactions, activity"
        aria-label="Search CloudsForge"
      />
      <kbd className="wt-search__hint" aria-hidden="true">
        ⌘K
      </kbd>
    </form>
  )
}
