/**
 * Put the reader at the top of the page they just asked for.
 *
 * A browser resets scroll when it loads a document. A client-side router never loads one, so
 * without this the window keeps whatever offset it had and the next page opens part-way down.
 * React Router does not do this for you.
 *
 * Every frontend in the estate was missing it. On the marketing site it was severe enough to be
 * reported as a routing bug rather than a scrolling one: every page there ends with the same grid
 * of all the products, so pressing a product tile two thousand pixels down the home page landed
 * the reader on that product's page looking at the grid of every OTHER product. The report was
 * "the links take you to the ecosystem page", and every link named was one low on the page while
 * the navigation bar at the top was fine. Written up in micro-org#240.
 *
 * ── Why this is a per-app file and not a @cloudsforge/ui export ────────────────────────────────
 *
 * It was one, briefly. The hooks below read a context the APPLICATION owns, and the design system
 * is consumed as `link:../ui/packages/ui`, whose working tree has its own `node_modules` — so a
 * router imported from inside that package resolves to a SECOND copy and reads an empty context.
 * That is the same trap `@cloudsforge/ui/test-loader` exists to work around for React, and making
 * it work would have meant adding the router to `resolve.dedupe` in every consumer's vite config
 * and to the test loader's specifier list. Twelve lines duplicated is the cheaper, duller answer
 * than a new class of peer dependency in the shared package.
 *
 * ── Mounted inside the Router, not in the shell ────────────────────────────────────────────────
 *
 * `useLocation` throws outside a `<Router>`, and several shells are rendered standalone by their
 * own tests. Rendering here keeps those tests testing the shell rather than the router.
 *
 * ── The three behaviours, in precedence order ──────────────────────────────────────────────────
 *
 * POP is left alone. That is back and forward, where the reader expects the place they were
 * reading; the browser restores it and this must not fight it.
 *
 * A `#hash` scrolls to its target instead, so adding an in-page anchor anywhere does not silently
 * stop working.
 *
 * Otherwise the top, instantly. Animating a page CHANGE makes every click feel slow and fights a
 * reader who starts scrolling before it finishes.
 */
import { useEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

export function ScrollToTop() {
  const { pathname, hash } = useLocation()
  const navigationType = useNavigationType()

  useEffect(() => {
    if (navigationType === 'POP') return
    if (hash) {
      const target = document.getElementById(hash.slice(1))
      if (target) {
        target.scrollIntoView()
        return
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname, hash, navigationType])

  return null
}
