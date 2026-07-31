/**
 * The three descriptions of this app's addresses, checked against each other.
 *
 *   1. `src/lib/routes.ts` — the declaration, from which the sub-navigation is derived.
 *   2. `src/app.tsx`       — which component renders at each path.
 *   3. `nginx.conf`        — which addresses are served the app shell at all.
 *
 * The third is what makes this test worth having. nginx enumerates the real routes and 404s
 * everything else on purpose, so that a wrong address answers 404 rather than 200 — the estate's
 * current site returns 200 for every unknown path, which means its "page not found" screen is
 * served as a success, indexed by crawlers and called healthy by monitors.
 *
 * The price of that honesty is that a route added to the router and not to nginx works perfectly
 * under `pnpm dev` and 404s on the first hard refresh in production. That failure survives review
 * because nothing about the diff looks wrong. This test is the mechanism instead.
 *
 * It reads `app.tsx` as TEXT rather than importing it: importing would pull in React, the router
 * and every page, and this suite deliberately has no DOM.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { NAV, NON_INDEX_PATHS, ROUTES } from '../src/lib/routes.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

const appSource = read('src/app.tsx')
const nginx = read('nginx.conf')

/**
 * nginx.conf with its comments removed.
 *
 * The file's own header quotes the directive it forbids — "the usual SPA fallback is
 * `try_files $uri /index.html`, which serves the bundle with a 200 for every address in
 * existence" — so a grep over the raw text matches the warning and fails on a correct file. The
 * web template's `ci.yml` has exactly that bug in its "The SPA fallback keeps its 404" step, and
 * that step therefore fails on the pristine template. The rule is about DIRECTIVES; strip the
 * prose before checking it.
 */
const directives = nginx
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')

/** The alternation inside nginx's enumerated `location ~ ^/(…)` block. */
function nginxPaths(): string[] {
  const match = /location\s+~\s+\^\/\(([^)]+)\)/.exec(directives)
  assert.ok(match, 'nginx.conf has no enumerated route block')
  return (match[1] ?? '').split('|').map((p) => p.trim())
}

describe('the route declaration', () => {
  it('is not empty, so this whole file cannot pass for the wrong reason', () => {
    assert.ok(ROUTES.length >= 8, `expected the route table, found ${ROUTES.length} entries`)
    assert.ok(root.length > 0)
  })

  it('has exactly one index route', () => {
    assert.equal(ROUTES.filter((r) => r.path === '').length, 1)
  })

  it('declares no duplicate path', () => {
    const paths = ROUTES.map((r) => r.path)
    assert.equal(new Set(paths).size, paths.length)
  })

  it('declares no path with a slash: these are TOP-LEVEL segments', () => {
    // nginx matches on the first segment and everything under it. A declaration of `wallet/deposits`
    // would produce a location block that does not mean what it says.
    for (const route of ROUTES) {
      assert.ok(!route.path.includes('/'), `${route.path} is not a top-level segment`)
    }
  })
})

describe('the sub-navigation', () => {
  it('is derived from the declaration rather than restated', () => {
    const labelled = ROUTES.filter((r) => r.label !== null)
    assert.equal(NAV.length, labelled.length)
    assert.deepEqual(
      NAV.map((n) => n.to),
      labelled.map((r) => `/${r.path}`),
    )
  })

  it('points the first entry at the index, with the leading slash a NavLink needs', () => {
    assert.equal(NAV[0]?.to, '/')
  })

  it('does not offer the routes that exist only because another service links into them', () => {
    // `/account/...` and `/billing/...` are hub-api's next-action destinations, and `/search` is
    // reached from the bar. A nav entry for a page that is empty until you type into something
    // else wastes a slot in a list whose whole job is separation.
    const offered = NAV.map((n) => n.to)
    for (const hidden of ['/search', '/account', '/billing']) {
      assert.ok(!offered.includes(hidden), `${hidden} must not be a nav entry`)
    }
  })
})

describe('the router', () => {
  it('has a <Route> for every declared path', () => {
    for (const route of ROUTES) {
      if (route.path === '') {
        assert.match(appSource, /<Route\s+index/, 'no index route in app.tsx')
        continue
      }
      const expected = route.wildcard ? `path="${route.path}/*"` : `path="${route.path}"`
      assert.ok(appSource.includes(expected), `app.tsx has no ${expected}`)
    }
  })

  it('declares no <Route path=…> that the declaration does not know about', () => {
    const declared = new Set(NON_INDEX_PATHS)
    for (const match of appSource.matchAll(/path="([^"]+)"/g)) {
      const path = (match[1] ?? '').replace(/\/\*$/, '')
      if (path === '*') continue // the catch-all
      assert.ok(declared.has(path), `app.tsx routes ${path}, which lib/routes.ts does not declare`)
    }
  })

  it('keeps the catch-all, which is what renders the honest 404 page', () => {
    assert.ok(appSource.includes('path="*"'))
    assert.ok(appSource.includes('NotFoundPage'))
  })

  it('puts every route behind the session gate', () => {
    // Forge Hub has no public page: every route reads an authenticated composition of somebody's
    // money, sessions and entitlements. Counting rather than eyeballing, because an unwrapped
    // route looks exactly like a wrapped one in a diff.
    const routes = [...appSource.matchAll(/<Route\s/g)].length
    const gates = [...appSource.matchAll(/<ProtectedRoute>/g)].length
    // Every <Route> except the shell's layout route and the catch-all carries a gate.
    assert.equal(gates, routes - 2, 'a route was added without ProtectedRoute')
  })
})

describe('nginx', () => {
  it('enumerates every declared path', () => {
    const served = new Set(nginxPaths())
    for (const path of NON_INDEX_PATHS) {
      assert.ok(served.has(path), `nginx.conf does not serve /${path}; it will 404 on a hard refresh`)
    }
  })

  it('enumerates nothing the app does not route', () => {
    // The other direction: a stale entry serves the shell with a 200 for an address that renders
    // the not-found page, which is the exact dishonesty the enumeration exists to prevent.
    const declared = new Set(NON_INDEX_PATHS)
    for (const path of nginxPaths()) {
      assert.ok(declared.has(path), `nginx.conf serves /${path}, which this app does not route`)
    }
  })

  it('serves the index explicitly', () => {
    assert.match(nginx, /location\s+=\s+\/\s*\{/)
  })

  it('never falls back to index.html with a 200 for an unknown path', () => {
    // `try_files $uri /index.html` in the catch-all is how an app starts answering 200 for every
    // address in existence. The shell reaches an unknown address through `error_page 404`, which
    // KEEPS the status.
    assert.equal(
      /try_files\s+\$uri\s+(\$uri\/\s+)?\/index\.html/.test(directives),
      false,
      'the catch-all falls back to the shell with a 200',
    )
    assert.ok(directives.includes('error_page 404 /index.html'))
    // …and the comment that explains the rule is still there, since it is the only reason anybody
    // reading this file later will understand why the routes are enumerated by hand.
    assert.match(nginx, /404, not 200/)
  })

  it('does not let a missing asset fall through to the shell', () => {
    // A JavaScript request answered with HTML fails with a syntax error that names the wrong file.
    assert.match(directives, /location\s+\/assets\/\s*\{[\s\S]*?try_files\s+\$uri\s+=404;/)
  })
})
