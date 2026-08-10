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
  SubNav,
  type MiningControlProps,
} from '@cloudsforge/ui'
import { applyHead, surfaceMeta, type SurfaceMeta } from '@cloudsforge/ui/seo'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { PRODUCT } from '../lib/hosts.ts'
import { MAX_SEARCH_LENGTH } from '../lib/hub.ts'
import { NAV, PUBLIC_ROUTES, ROUTES, isIndexable } from '../lib/routes.ts'
import { useSession } from '../lib/auth.tsx'
import { EMBER_MINE_HREF, barMining } from '../mining/bar.ts'
import { MiningProvider, useMining } from '../mining/session.tsx'

/*
 * The sub-navigation is DERIVED from `lib/routes.ts` rather than restated here. A second list
 * would be a second opinion about which addresses exist, and nginx.conf already makes that two —
 * see the header of that file for why the count matters.
 */

/**
 * The shell, wrapped in the one thing that has to outlive the page.
 *
 * `MiningProvider` is here rather than in `app.tsx` for a reason that is a property of the router:
 * this component is the LAYOUT route's element, so react-router keeps it mounted across every
 * navigation between the routes nested inside it, and the miner it holds is not restarted by
 * walking from the wallet to the activity feed. Putting it around `<Routes>` would work equally
 * well and would leave three test files mounting `AppShell` without it — the provider throws
 * rather than returning a not-mining default, on purpose.
 *
 * `Chrome` is a separate component because a component cannot consume a context it provides in the
 * same render pass, and the bar needs the session.
 */
export function AppShell() {
  return (
    <MiningProvider>
      <Chrome />
    </MiningProvider>
  )
}

/**
 * The bar's mining control, in whichever of its states is true right now.
 *
 * All of the judgement is in `mining/bar.ts`, which is a pure function of the session so that
 * every state can be walked without a browser. This is the wiring: what a press DOES.
 *
 * The `idle` press starts the session AND goes to `/mine`. Both halves matter. Starting is the
 * owner's request taken literally — one press, from anywhere, no page to find first. Landing on
 * the mining page is what keeps that honest: `pages/mine.tsx` carries the duty-cycle and battery
 * controls, the measured numbers, the deposit address a found block is being swept to and the
 * confirmation depth it has to reach, and a machine that starts hashing with none of that on
 * screen is a machine somebody did not agree to. The address is `HUB_MINE_PATH` from the design
 * system — the same constant the other thirteen surfaces link to, so this app's route and their
 * link cannot drift apart, and `?chain=ember` selects what was just started rather than leaving
 * the picker on whatever it defaults to.
 *
 * `session.start()` is called with NO ARGUMENT, which since micro-org#362 means EMBER and means it
 * only when EMBER is startable. The bar does not offer this press in any other state, and the
 * session refuses it in any other state, so the two agree twice.
 *
 * The `mining` press only stops. It deliberately does NOT navigate: the reader is in the middle of
 * something else, which is the whole reason the control is in the bar.
 *
 * `elsewhere` has no press at all — it is an anchor, and react-router is deliberately not involved:
 * `MiningControl` renders a real `<a href>` so the destination can be middle-clicked, opened in a
 * new tab and read by every check that reads links.
 */
function useBarMining(): MiningControlProps | undefined {
  const { account, signIn } = useSession()
  const session = useMining()
  const navigate = useNavigate()

  return barMining({
    signedIn: account.signedIn,
    // The subject travels with the session rather than being assumed, so a reader who started a
    // pool chain from the mining page's picker keeps the pool's Stop, the pool's shares and the
    // pool's clause while it runs.
    live: session.running
      ? session.target === 'ember'
        ? {
            subject: 'ember',
            readout: {
              hashrate: session.emberSnapshot.hashrate,
              accepted: session.emberSnapshot.accepted.length,
            },
          }
        : { subject: 'pool', readout: session.snapshot }
      : null,
    refusal: session.refusal,
    ember: session.ember,
    payoutsImplemented: session.payoutsImplemented,
    onSignIn: () => signIn(),
    onStart: () => {
      session.start()
      navigate(EMBER_MINE_HREF)
    },
    onStop: session.stop,
  })
}

function Chrome() {
  const { account, signIn, signOut } = useSession()
  const mining = useBarMining()

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
      {/*
        `mining` is the design system's own control and sits between the search field and the
        account menu — the bar decides that, not this file. Forge Hub is the ONE surface that passes
        a live session rather than `miningOnHub()`: the miner runs on this origin, so this is the
        only bundle that can observe or stop it. See `mining/session.tsx`.
      */}
      <CloudsForgeBar
        current={PRODUCT}
        account={account}
        onSignIn={() => signIn()}
        onSignOut={signOut}
        rightSlot={account.signedIn ? <SearchField /> : undefined}
        mining={mining}
      />
      {/*
        `SubNav` from @cloudsforge/ui, rather than the `.wt-subnav` this file used to write itself.

        The strip was sticky at `var(--cf-bar-h)`, scrolled rather than squeezed on a phone, and
        marked the current section in three channels — all of which was RIGHT, and all of which
        was private. Measured 2026-08-10: ten frontends declared this same row under six different
        class prefixes, and this repository's copy was the only one of the ten that survived a
        narrow viewport. The other nine squeezed their labels and broke them mid-word. Sharing the
        copy that got it right is what fixes them; keeping a private copy here is what let the
        other nine drift in the first place.

        What this app still owns is the LINKS — `NAV` is derived from `lib/routes.ts`, and the
        active state is react-router's, which is why the shared component takes children rather
        than a list of addresses.

        It is absent for a signed-out reader. Every entry in it goes to a page that reads somebody's
        money or sessions, so for a visitor on the sign-in page it is eight links that all end in a
        redirect back to the form they are already looking at. Hiding it is not a security
        boundary and is not pretending to be one — every service verifies the token on the request
        — it is the same reasoning as the switcher's `adminOnly`: a menu entry nobody can open.
      */}
      {account.signedIn && (
        <SubNav label="Sections">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              // `end` only on the index: without it, `/` matches every path and the Overview tab
              // stays highlighted on all seven pages.
              end={item.to === '/'}
              className={({ isActive }) =>
                `cf-subnav__link${isActive ? ' cf-subnav__link--current' : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </SubNav>
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
 * `maxLength` mirrors hub-api's own cap (server.ts, 403), so an over-long query is refused
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
        // hub-api answers 400 for an empty `q` (server.ts). Not sending it is better than
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
