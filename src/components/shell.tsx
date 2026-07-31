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
import { CloudsForgeBar } from '@cloudsforge/ui'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { PRODUCT } from '../lib/hosts.ts'
import { MAX_SEARCH_LENGTH } from '../lib/hub.ts'
import { NAV } from '../lib/routes.ts'
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
      */}
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
      <main className="wt-main" id="main">
        <Outlet />
      </main>
    </>
  )
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
