/**
 * The 1.1 chrome on the surface that carries authentication.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS SURFACE GETS ITS OWN FILE FOR IT
 *
 * The other surfaces in this sweep adopted `SkipLink`, `CookieBanner`, `DocumentMeta` and
 * `data-cf-scheme` as chrome. Here two of the four are not chrome:
 *
 *   - **`robots`.** Forge Hub serves the estate's SIGN-IN, REGISTRATION and PASSWORD-RESET forms
 *     (`src/app.tsx`, the six `PUBLIC_ROUTES`). A missing `noindex` on any of them publishes a
 *     credential form to whoever searches, and two of the six are landing pages for a link mailed
 *     to one named person. The failure is silent, invisible in a browser, and discovered in a
 *     search result.
 *   - **The consent gate.** This document renders password fields. A third-party script in it is a
 *     supply-chain question before it is a privacy one, which is why the assertion below is that
 *     `index.html` contains NO tag `<script src>` at all rather than that the banner behaves.
 *
 * The rendered assertions are made against the REAL components from `@cloudsforge/ui` — the package
 * is `link:`ed, so nothing about the bar, the skip link or the banner is stubbed.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { createElement as h } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { MAIN_ID, accountUrl, cloudsforgeHosts } from '@cloudsforge/ui'
import { surfaceMeta } from '@cloudsforge/ui/seo'
import { CONSENT_STORAGE_KEY } from '@cloudsforge/ui/consent'

import { withScreen, type Screen } from './dom.ts'
import { __resetAuth } from '../src/lib/api.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import { AppShell, headFor } from '../src/components/shell.tsx'
import { PUBLIC_ROUTES, ROUTES } from '../src/lib/routes.ts'

const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const HTML = read('index.html')
const MAIN = read('src/main.tsx')

const ORIGIN = 'https://hub.cloudsforge.online'

/**
 * The measurement ID READ OUT OF `index.html`, not typed here.
 *
 * The harness document has an empty head, and `CookieBanner` renders nothing without this tag. A
 * literal here would be a second copy of the ID that could pass while the shell's was wrong or
 * absent — which is precisely the failure "the banner never appears" looks like from the outside.
 */
const ANALYTICS_ID = /<meta name="cf-analytics" content="([^"]*)"/.exec(HTML)?.[1] ?? ''

/** As `test/account-link.test.ts`: unsigned, two public display fields, no credential. */
function unsignedToken(payload: Record<string, unknown>): string {
  const b64url = (value: string): string =>
    Buffer.from(value, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify(payload))}.unsigned`
}

/* ─────────────────────────────── the head, per address ─────────────────────────────── */

describe('the robots directive, per address', () => {
  it('invites a crawler to the front door and nowhere else', () => {
    assert.equal(headFor('/').robots, 'index, follow, max-image-preview:large')
  })

  it('refuses every gated page, which would answer a crawler with a redirect to sign in', () => {
    for (const route of ROUTES) {
      if (route.indexable) continue
      const meta = headFor(`/${route.path}`)
      assert.equal(
        meta.robots,
        'noindex, nofollow',
        `/${route.path} is offered to a crawler, and it is behind <ProtectedRoute>`,
      )
    }
  })

  it('refuses every screen of the sign-in surface, one by one', () => {
    /*
     * Named individually rather than covered by a prefix rule, because `account` carries two
     * unrelated things: these six ungated screens, and the GATED `/account/security` and
     * `/account/restrictions/<id>` that hub-api's next-action cards deep-link into. A rule written
     * over the prefix would pass while a rule written over the wrong thing was in place.
     */
    for (const route of PUBLIC_ROUTES) {
      const meta = headFor(`/${route.path}`)
      assert.equal(
        meta.robots,
        'noindex, nofollow',
        `/${route.path} is offered to a crawler. ${route.because}`,
      )
    }
  })

  it('refuses a deep address under a gated prefix, and an address that does not exist', () => {
    assert.equal(headFor('/wallet/deposits/7c3f').robots, 'noindex, nofollow')
    assert.equal(headFor('/account/restrictions/9').robots, 'noindex, nofollow')
    assert.equal(headFor('/nothing-here').robots, 'noindex, nofollow')
  })

  it('names the sign-in screens from the registry rather than from a string typed here', () => {
    // `signin` is a real registry row with `basePath: '/account'` that rides on this bundle, so its
    // NAME is what these six screens are called. A literal here would be a fifth copy of it.
    assert.equal(headFor('/account/login').title, surfaceMeta('signin').title)
    assert.equal(headFor('/account/reset').description, surfaceMeta('signin').description)
  })

  it('titles an inner page from its navigation label, and the front door from neither', () => {
    assert.equal(headFor('/wallet').title, 'Wallet — Forge Hub')
    assert.equal(headFor('/').title, 'Forge Hub')
  })

  it('carries the address it was asked about, so the canonical is per page', () => {
    assert.equal(headFor('/portfolio').path, '/portfolio')
    // Normalised: `/portfolio/` and `/portfolio` are one page and must not produce two canonicals.
    assert.equal(headFor('/portfolio/').path, '/portfolio')
  })
})

describe('the static head and the applied head are one string', () => {
  /*
   * THE DRIFT THIS ESTATE HAS ALREADY PAID FOR ONCE. `site/index.html`'s description disagreed with
   * its application's, the suite stayed green, and every search result carried a sentence the owner
   * had asked to have removed until somebody opened the served HTML rather than the page.
   *
   * Two copies are unavoidable: `index.html` is what a link-preview fetcher gets, because the ones
   * chat and social clients use do not execute JavaScript, and `applyHead()` is what everything
   * else gets. So the test is what makes them one string.
   */
  const front = surfaceMeta('hub', { path: '/' })

  const content = (attr: 'name' | 'property', key: string): string => {
    const found = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(HTML)
    assert.ok(found, `index.html has no <meta ${attr}="${key}">`)
    return found[1] ?? ''
  }

  it('agree on the title', () => {
    assert.equal(/<title>([^<]*)<\/title>/.exec(HTML)?.[1], front.title)
    assert.equal(content('property', 'og:title'), front.title)
  })

  it('agree on the description, in both places index.html states it', () => {
    assert.equal(content('name', 'description'), front.description)
    assert.equal(content('property', 'og:description'), front.description)
  })

  it('agree on the robots directive and on the card', () => {
    assert.equal(content('name', 'robots'), front.robots)
    assert.equal(content('property', 'og:image'), front.image)
  })
})

/* ─────────────────────────────── the shell's own declarations ─────────────────────────────── */

describe('index.html', () => {
  it('sets the scheme statically, as the third of the three attributes', () => {
    assert.match(HTML, /<html [^>]*data-cf-scheme="auto"/)
    // The other two are unchanged; an edit that dropped either would repaint the whole surface.
    assert.match(HTML, /<html [^>]*data-cf-product="hub"/)
    assert.match(HTML, /<html [^>]*data-cf-substrate="warm"/)
  })

  it('spells color-scheme the way the standard spells it, and declares both', () => {
    // `colour-scheme` is correct English and is not a meta name any browser knows, so the tag that
    // was supposed to decide how native controls are drawn has always done nothing.
    // The META TAG, not the word: the comment beside the correct tag names the old spelling in
    // order to explain it, and a grep over the whole file would fail on a correct document.
    assert.ok(
      !/<meta name="colour-scheme"/.test(HTML),
      'index.html still declares the inert British spelling',
    )
    assert.match(HTML, /<meta name="color-scheme" content="dark light" \/>/)
  })

  it('carries the measurement ID as a meta tag', () => {
    assert.match(HTML, /<meta name="cf-analytics" content="G-[A-Z0-9]{4,20}" \/>/)
  })

  it('CARRIES NO TAG, and names no tag host', () => {
    /*
     * The assertion this whole arrangement exists for. The stock analytics snippet fetches a
     * third-party script and sets `_ga` on load — before any banner has been drawn, let alone
     * answered — and under ePrivacy Art. 5(3) that is a violation a banner underneath it does not
     * cure. On the document that renders a password field it is also a supply-chain question.
     *
     * The host is assembled here rather than written out so that a grep for it over `index.html`
     * returns nothing and the absence is checkable rather than asserted.
     */
    const tagHost = ['googletagmanager', 'com'].join('.')
    assert.ok(!HTML.includes(tagHost), `index.html names ${tagHost}`)
    assert.ok(!HTML.includes('gtag'), 'index.html mentions gtag')
    for (const script of HTML.matchAll(/<script\b[^>]*\bsrc="([^"]*)"/g)) {
      assert.match(
        script[1] ?? '',
        /^\/src\/main\.tsx$/,
        `index.html loads a script from ${script[1]} — the only <script src> here is the bundle`,
      )
    }
  })
})

describe('the boot sequence', () => {
  it('primes consent before React mounts', () => {
    assert.match(MAIN, /import \{ initAnalytics \} from '@cloudsforge\/ui\/consent'/)
    assert.match(MAIN, /^initAnalytics\(\)$/m)
  })

  it('primes it AFTER initObs and STRICTLY BEFORE bootstrapSession, which is awaited', () => {
    /*
     * The order is the whole point and each neighbour is load-bearing:
     *
     *   - after `initObs()`, so an exception thrown by the consent module is reported rather than
     *     lost;
     *   - before `bootstrapSession()`, because the hand-off is a network round trip and a window in
     *     which a tag could arrive with storage permitted by default is what this closes — and
     *     because that call is AWAITED so the bar shows the handle on the first paint instead of
     *     flashing `Sign in` at somebody who is already signed in. Anything inserted into or after
     *     that await can reintroduce the flash.
     */
    const obs = MAIN.indexOf('\ninitObs()')
    const consent = MAIN.indexOf('\ninitAnalytics()')
    const boot = MAIN.indexOf('void bootstrapSession()')
    assert.ok(obs >= 0 && consent >= 0 && boot >= 0, 'the boot sequence has changed shape')
    assert.ok(obs < consent, 'initAnalytics() runs before initObs(), so a throw in it is lost')
    assert.ok(consent < boot, 'initAnalytics() runs after the session bootstrap, which is a race')
  })
})

/* ─────────────────────────────── the rendered shell ─────────────────────────────── */

/** The shell, mounted at `path`, signed in or not. */
async function shellAt(
  path: string,
  signedIn: boolean,
  body: (s: Screen) => Promise<void>,
): Promise<void> {
  __resetAuth()
  const handle = 'savvanis'
  await withScreen(
    h(MemoryRouter, { initialEntries: [path] }, h(AuthProvider, null, h(AppShell))),
    {
      url: `${ORIGIN}${path}`,
      // What `index.html` declares. Without it `analyticsId()` finds nothing and the banner
      // renders `null`, which would make every consent assertion below pass vacuously.
      meta: { 'cf-analytics': ANALYTICS_ID },
      ...(signedIn
        ? {
            storage: {
              'cf.accessToken': unsignedToken({ handle, roles: ['player'] }),
              'cf.refreshToken': 'held-refresh-token',
            },
            routes: {
              'GET /auth/me': { body: { user: { id: 'u1', handle, roles: ['player'] } } },
            },
          }
        : {}),
    },
    body,
  )
}

describe('the shell', () => {
  it('puts the skip link first, and following it moves focus INTO the main region', async () => {
    await shellAt('/', true, async (s) => {
      const first = await s.tab()
      assert.equal(first?.tagName.toLowerCase(), 'a', 'the first tab stop is not a link')
      assert.equal(
        s.textOf(first),
        'Skip to the page',
        'the first focusable element in the document is not the skip link',
      )
      assert.equal(first?.getAttribute('href'), `#${MAIN_ID}`)

      // The half this app was missing entirely: a `<main>` is not focusable, so a skip link
      // pointing at one scrolls the page and leaves focus on the link.
      const main = s.document.getElementById(MAIN_ID)
      assert.ok(main, `there is no #${MAIN_ID} for the skip link to target`)
      assert.equal(main.tagName.toLowerCase(), 'main')
      assert.equal(main.getAttribute('tabindex'), '-1')
      assert.equal(s.allByRole('main').length, 1, 'the document has more than one main landmark')

      s.clean('the shell')
    })
  })

  it('puts the consent banner LAST in the tab order, because it must not trap focus', async () => {
    await shellAt('/', true, async (s) => {
      const banner = s.document.querySelector('.cf-consent')
      assert.ok(banner, 'the consent banner did not render on an origin where analytics reports')
      assert.equal(banner.getAttribute('role'), 'dialog')
      assert.equal(banner.getAttribute('aria-modal'), 'false')

      const tabbables = s.tabbables()
      const last = tabbables[tabbables.length - 1]
      assert.ok(
        banner.contains(last ?? null),
        'the last tab stop is not inside the consent banner, so the banner is not last in the ' +
          'document — a consent dialog ahead of the page is the coercion the regulation is about',
      )
      // Reject and Accept share one class and there is no modifier making one louder.
      const choices = [...banner.querySelectorAll('.cf-consent__choice')].map((b) =>
        s.textOf(b),
      )
      assert.deepEqual(choices, ['Reject', 'Accept'])

      s.clean('the consent banner')
    })
  })

  it('sets no analytics cookie and records no decision before anybody has answered', async () => {
    await shellAt('/', true, async (s) => {
      assert.equal(s.window.document.cookie, '', 'a cookie exists before the banner was answered')
      assert.ok(
        !s.storageSnapshot().includes(CONSENT_STORAGE_KEY),
        'a consent decision was recorded before the reader made one',
      )
      s.clean('the consent banner')
    })
  })

  it('writes the address into the head on every navigation', async () => {
    await shellAt('/account/login', false, async (s) => {
      assert.equal(s.document.title, surfaceMeta('signin').title)
      assert.equal(
        s.document.head.querySelector('meta[name="robots"]')?.getAttribute('content'),
        'noindex, nofollow',
        'the sign-in form is offered to a crawler',
      )
      assert.equal(
        s.document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'),
        `${ORIGIN}/account/login`,
      )
      s.clean('the sign-in address')
    })
  })
})

describe('the account menu, which this change must not have moved', () => {
  it('still points at this bundle’s settings page and not at the sign-in surface', async () => {
    /*
     * `test/account-link.test.ts` is the file that owns this claim; it is restated here because the
     * shell is what passes (or fails to pass) `accountHref`, and this change edits the shell. The
     * prop is left UNSET on purpose, so the menu keeps `@cloudsforge/ui`'s default
     * `accountSettingsUrl()` — `<hub>/settings` — rather than `accountUrl()`, which resolves the
     * `signin` surface and is the defect.
     */
    await shellAt('/', true, async (s) => {
      await s.click(s.byRole('button', 'savvanis'))
      const account = s.queryByRole('link', 'Account')
      assert.ok(account, 'the Account entry is not a link')
      const href = account.getAttribute('href') ?? ''
      assert.equal(href, `${cloudsforgeHosts().hub}/settings`)
      assert.notEqual(href, accountUrl())
      assert.ok(!href.includes('/login'))
      s.clean('the account menu')
    })
  })
})
