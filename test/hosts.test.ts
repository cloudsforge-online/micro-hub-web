/**
 * Host resolution: the mechanism that lets ONE image serve every environment.
 *
 * If these assertions ever have to be relaxed, a build-time constant has crept back in.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import type { CloudsForgeHosts } from '@cloudsforge/ui'
import { APP_NAME, PRODUCT, apiBase, hosts, pageOrigin, resolveApiBase } from '../src/lib/hosts.ts'
import { installWindow, removeWindow } from './browser-stubs.ts'

afterEach(removeWindow)

describe('hosts()', () => {
  it('resolves to the local dev ports when served from localhost', () => {
    installWindow('http://localhost:5180/')
    const resolved = hosts()
    assert.equal(resolved.trade, 'http://localhost:4006')
    assert.equal(resolved.nimbus, 'http://localhost:4001')
    assert.equal(resolved.lantern, 'http://localhost:4010')
  })

  it('derives the apex from a product subdomain', () => {
    installWindow('https://trade.cloudsforge.online/settings')
    const resolved = hosts()
    assert.equal(resolved.trade, 'https://trade.cloudsforge.online')
    assert.equal(resolved.nimbus, 'https://nimbus.cloudsforge.online')
    assert.equal(resolved.account, 'https://account.cloudsforge.online')
    // The marketing site is the apex itself, with no subdomain.
    assert.equal(resolved.site, 'https://cloudsforge.online')
  })

  it('treats an unrecognised prefix as its own apex', () => {
    // A preview deployment is not a CloudsForge subdomain. Stripping `pr-42` would send the
    // sign-in redirect to a host that does not exist, and the user would never come back.
    installWindow('https://pr-42.example.dev/')
    assert.equal(hosts().nimbus, 'https://nimbus.pr-42.example.dev')
  })

  it('resolves a surface that is a path on another surface', () => {
    installWindow('https://hub.cloudsforge.online/')
    assert.equal(hosts().wallet, 'https://hub.cloudsforge.online/wallet')
  })
})

describe('resolveApiBase()', () => {
  // Only the two keys under test: the function reads one entry and never enumerates the record.
  const local = {
    trade: 'http://localhost:4006',
    hub: 'https://hub.x.dev/wallet',
  } as unknown as CloudsForgeHosts

  it('is relative when the page and the API share an origin', () => {
    assert.equal(resolveApiBase('http://localhost:4006', local, 'trade'), '')
  })

  it('is absolute when they do not — the dev server on another port', () => {
    assert.equal(resolveApiBase('http://localhost:5180', local, 'trade'), 'http://localhost:4006')
  })

  it('compares origins, not whole URLs, so a surface with a base path is still same-origin', () => {
    assert.equal(resolveApiBase('https://hub.x.dev', local, 'hub'), '')
  })

  it('is absolute when there is no page origin to be relative to', () => {
    assert.equal(resolveApiBase('', local, 'trade'), 'http://localhost:4006')
  })
})

/* ------------------------------------------------------------------ */

/**
 * Hub-specific resolution. The block above is the template's, and it is unchanged on purpose —
 * these are the assertions that would fail if this repository were instantiated as the wrong
 * surface, which is a mistake that produces a working app pointed at somebody else's API.
 */
describe('this surface', () => {
  it('is `hub`, which is a container rather than a product', () => {
    // `hub` resolves to --cf-ember rather than to a product accent, and it is deliberately not a
    // switcher entry. `index.html` sets data-cf-product="hub" statically to match.
    assert.equal(PRODUCT, 'hub')
    assert.equal(APP_NAME, 'hub')
  })

  it('addresses hub-api on the registry’s dev port when served from Vite’s', () => {
    // Under `pnpm dev` the page is on 5180 and hub-api is on 3010, so the base is ABSOLUTE and
    // the request goes cross-origin. Getting this wrong means every call 404s against Vite.
    installWindow('http://localhost:5180/portfolio')
    assert.equal(apiBase(), 'http://localhost:3010')
  })

  it('is RELATIVE in production, where nginx and hub-api share an origin', () => {
    // The property that lets one image serve every environment: no absolute API host is ever
    // baked in, and the same bundle stays relative behind any hostname.
    installWindow('https://hub.cloudsforge.online/portfolio')
    assert.equal(apiBase(), '')
    installWindow('https://hub.pr-42.example.dev/')
    assert.equal(apiBase(), '')
  })

  it('resolves Nimbus cross-origin from Hub, always', () => {
    // Tokens are issued by identity on its own hostname, never by hub-api, so this must not
    // collapse to a relative base the way this app's own API does.
    installWindow('https://hub.cloudsforge.online/')
    assert.equal(hosts().nimbus, 'https://nimbus.cloudsforge.online')
    assert.notEqual(hosts().nimbus, '')
  })

  it('places the wallet surface INSIDE this app, at /wallet', () => {
    // The registry says the wallet is a path on Hub's host rather than a host of its own, and
    // `src/lib/routes.ts` routes `/wallet` accordingly. If these two ever disagree, a deep link
    // from another product lands on a 404.
    installWindow('https://hub.cloudsforge.online/')
    assert.equal(hosts().wallet, 'https://hub.cloudsforge.online/wallet')
  })

  it('has a page origin even with no window, so a URL can still be resolved', () => {
    removeWindow()
    assert.equal(pageOrigin(), 'http://localhost')
    assert.equal(apiBase(), 'http://localhost:3010', 'no origin means the absolute form')
  })
})
