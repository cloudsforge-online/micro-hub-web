/**
 * The sitemap and robots.txt nginx serves for this surface.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE BODIES ARE IN nginx.conf AT ALL
 *
 * A sitemap must carry ABSOLUTE URLs — the spec requires it and a crawler discards a relative
 * `<loc>` — and nothing built in this repository may name a hostname, because one image is served
 * from localhost, from a preview deployment and from the apex. `test/no-build-time-config.test.ts`
 * is the rule; this is the one document that cannot obey it and be useful at the same time.
 *
 * nginx is the component that can. It has `$host` on every request, so the addresses are composed
 * per request and the artefact stays environment-free.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * AND WHY THIS SURFACE DOES NOT USE `sitemapXml()` FROM THE DESIGN SYSTEM
 *
 * THE SHARED GENERATOR IS FOR THE APEX. It composes each sibling surface as `<subdomain>.$host`,
 * which is right on the marketing site, where `$host` IS the apex. Here `$host` is already
 * `hub.<apex>`, so the same call would emit `network.hub.<apex>` — the two-label shape
 * `@cloudsforge/ui/surfaces.ts` records at length as unreachable, because the edge's Universal SSL
 * is a one-label wildcard and every two-label name fails the handshake.
 *
 * So this surface publishes ITS OWN indexable routes, derived from the same `ROUTES` table the
 * navigation, the router and nginx's enumerated locations all come from — and `robots.txt`, which
 * has no such problem, IS generated from the design system and compared byte for byte.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * AND WHY EITHER NEEDS A TEST
 *
 * A body pasted into a config file is a copy, and this estate has been bitten by exactly one of
 * those: `site/index.html`'s title drifted from its application's, the suite stayed green, and
 * every search result carried a sentence the owner had asked to have removed until somebody opened
 * the served HTML rather than the page. The block is therefore treated as GENERATED OUTPUT that
 * happens to live in a config file.
 *
 * On THIS surface there is a second reason, and it is the sharper one: the addresses that must stay
 * out of the sitemap are the estate's sign-in, registration and password-reset forms. An entry
 * added here by accident is a credential form the platform published about itself.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { ENV_LABELS } from '@cloudsforge/ui'
import { robotsTxt } from '@cloudsforge/ui/sitemap'
import { INDEXABLE_PATHS, PUBLIC_ROUTES, ROUTES } from '../src/lib/routes.ts'

const nginx = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8')

/** The single-quoted body of a `return 200 '…';` inside an exact-match location. */
function servedBody(path: string): string {
  const block = new RegExp(`location = ${path.replace('.', '\\.')} \\{([\\s\\S]*?)\\n    \\}`).exec(
    nginx,
  )
  assert.ok(block, `nginx.conf has no exact-match location for ${path}`)
  // Anchored to a `return` at the start of its own line: `/robots.txt` also carries a CONDITIONAL
  // `if ($cf_env) { return 200 '…'; }` above it, and a regex that took the first match would read
  // the non-mainnet body and report the mainnet one as drifted.
  const body = /\n {8}return 200 '([\s\S]*?)';/.exec(block[1] ?? '')
  assert.ok(body, `the ${path} location does not return an unconditional literal body`)
  return body[1] ?? ''
}

describe('the sitemap nginx serves', () => {
  it('names no hostname — every address is composed from $host', () => {
    /*
     * THE ASSERTION THAT KEEPS THE ARTEFACT ENVIRONMENT-FREE, and the reason a document with
     * absolute URLs in it is allowed here at all. A single literal apex would make the image wrong
     * on a preview deployment and on testnet, silently, in the one document a crawler treats as
     * authoritative.
     */
    const xml = servedBody('/sitemap.xml')
    assert.ok(!xml.includes('cloudsforge.online'), 'the sitemap names the production apex')
    assert.ok(!xml.includes('localhost'), 'the sitemap names localhost')
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1] ?? '')
    assert.ok(locs.length > 0, 'the sitemap lists nothing at all')
    for (const loc of locs) {
      // No subdomain is composed here, unlike the apex's sitemap: `$host` IS this surface.
      assert.match(loc, /^\$scheme:\/\/\$host(\/|$)/, `a <loc> is not composed: ${loc}`)
    }
  })

  it('lists every route this surface declares indexable', () => {
    const xml = servedBody('/sitemap.xml')
    for (const path of INDEXABLE_PATHS) {
      const address = path === '/' ? '$scheme://$host' : `$scheme://$host${path}`
      assert.ok(xml.includes(`<loc>${address}</loc>`), `${path} is missing from the sitemap`)
    }
  })

  it('lists nothing else — the other direction, which is the one that matters here', () => {
    const xml = servedBody('/sitemap.xml')
    const listed = [...xml.matchAll(/<loc>\$scheme:\/\/\$host([^<]*)<\/loc>/g)].map((m) =>
      m[1] === '' ? '/' : (m[1] ?? ''),
    )
    assert.deepEqual([...listed].sort(), [...INDEXABLE_PATHS].sort())
  })

  it('advertises not one address of the sign-in surface', () => {
    /*
     * Named individually as well as covered by the set comparison above, because this is the
     * assertion whose failure would matter: `/account/login`, `/account/register` and the four
     * beside them are the estate's credential forms, and two of them are landing pages for a link
     * mailed to one named person. An entry for any of them is a page the platform published about
     * itself.
     */
    const xml = servedBody('/sitemap.xml')
    for (const route of PUBLIC_ROUTES) {
      assert.ok(!xml.includes(route.path), `the sitemap advertises /${route.path}`)
    }
  })

  it('advertises no gated page, which would answer a crawler with a redirect to sign in', () => {
    const xml = servedBody('/sitemap.xml')
    for (const route of ROUTES) {
      if (route.indexable) continue
      assert.ok(
        !xml.includes(`$host/${route.path}`),
        `the sitemap advertises /${route.path}, which is behind <ProtectedRoute>`,
      )
    }
  })

  it('is a well-formed urlset in the only schema crawlers implement', () => {
    const xml = servedBody('/sitemap.xml')
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n/)
    assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/)
    assert.match(xml, /<\/urlset>$/)
  })

  it('is served as XML, because a sitemap sent as text/html is a sitemap nobody reads', () => {
    // `types { }` as well as `default_type`: without emptying the table for this location, nginx
    // maps the `.xml` in the URI to `text/xml` from its own mime types and `default_type` never
    // applies.
    assert.match(
      nginx,
      /location = \/sitemap\.xml \{[\s\S]*?types \{ \}[\s\S]*?default_type application\/xml;/,
    )
  })

  it('is derived from the route table rather than typed a fifth time', () => {
    // `src/lib/routes.ts` already decides the router, the navigation and nginx's enumerated
    // locations. This asserts the derivation above is real, and pins the decision: exactly one
    // address on Forge Hub is offered to a crawler, and a second one is a decision somebody has to
    // make here rather than a line that slipped into a config file.
    assert.deepEqual(INDEXABLE_PATHS, ['/'])
    assert.equal(
      ROUTES.filter((r) => r.indexable).length,
      1,
      'a route was made indexable. Every page but the front door is either behind a session gate ' +
        'or a credential form; if that has genuinely changed, change this assertion deliberately',
    )
  })
})

describe('an environment that is not mainnet', () => {
  /**
   * The `map` that decides it, and the alternation of labels inside it.
   *
   * A testnet estate carries test EMBER and a faucet. Indexed beside the real one, its pages are a
   * control centre and a sign-in form that look exactly like the real ones — which on this surface
   * is a phishing shape the platform would have published about itself.
   */
  function alternation(): string[] {
    const map = /map \$host \$cf_env \{[\s\S]*?~\^[^\n]*?\(\?:([^)]*)\)\\\./.exec(nginx)
    assert.ok(map, 'the $cf_env map is missing from nginx.conf')
    return (map[1] ?? '').split('|')
  }

  it('recognises exactly the labels the registry reserves', () => {
    /*
     * ENV_LABELS is the estate's single list — `deploy/scripts/check-apex-prefix.py` reads the same
     * export. An alternation here that had drifted from it would either miss an environment (and
     * index it) or refuse a surface (and de-index a real one), and both fail silently.
     */
    assert.deepEqual(alternation().sort(), [...ENV_LABELS].sort())
  })

  it('refuses every crawler and serves no sitemap', () => {
    // Both halves matter and neither is sufficient: robots.txt stops the fetch, and a sitemap that
    // still answered would be an invitation contradicting the instruction beside it.
    assert.match(nginx, /if \(\$cf_env\) \{ return 200 'User-agent: \*\\nDisallow: \/\\n'; \}/)
    assert.match(nginx, /location = \/sitemap\.xml \{[\s\S]*?if \(\$cf_env\) \{ return 404; \}/)
  })

  it('matches a suffixed subdomain as well as a bare environment apex', () => {
    // The environment is a SUFFIX on the first label now (`hub-testnet.`) and was an apex prefix
    // (`testnet.`) before. Both shapes still resolve — surfaces.ts keeps the old one deliberately —
    // so the pattern has to catch both or half the estate stays indexable.
    const map = /map \$host \$cf_env \{[\s\S]*?\n\}/.exec(nginx)
    assert.ok(map, 'the $cf_env map is missing')
    assert.match(map[0], /\(\?:\[\^\.\]\+-\)\?/, 'the map does not allow a suffixed subdomain')
  })
})

describe('robots.txt', () => {
  it('is exactly what the design system generates', () => {
    // Compared with its trailing newline intact: robots.txt is a line-oriented format and a parser
    // that reads the last line only when it is terminated is a parser that silently loses the
    // Sitemap directive.
    assert.equal(
      servedBody('/robots.txt'),
      robotsTxt({ indexable: true, sitemapUrl: '$scheme://$host/sitemap.xml' }),
    )
  })

  it('points at the sitemap with an absolute address, composed rather than typed', () => {
    // A relative `Sitemap:` line is invalid per the standard and is ignored; a literal one bakes in
    // a hostname. `$scheme://$host` is the only form that is both valid and environment-free.
    assert.match(servedBody('/robots.txt'), /^Sitemap: \$scheme:\/\/\$host\/sitemap\.xml$/m)
  })

  it('is not a static file, which an exact-match location would have shadowed', () => {
    /*
     * `location = /robots.txt` wins over the `location /` prefix that serves the static tree, so a
     * file in `public/` would be deployed, unreachable, and edited by the next reader to no effect
     * — the worst of the three states, worse than either serving it or not having it.
     */
    for (const name of ['robots.txt', 'sitemap.xml']) {
      let present = true
      try {
        readFileSync(new URL(`../public/${name}`, import.meta.url))
      } catch {
        present = false
      }
      assert.equal(present, false, `public/${name} exists, and nginx will never serve it`)
    }
  })
})

describe('the security headers on the documents this file adds', () => {
  it('are repeated in both new locations, because add_header does not accumulate', () => {
    // A location that declares ANY add_header inherits NONE from the server level. Both blocks set
    // Cache-Control, so both have to restate the three security headers or ship without them.
    for (const path of ['/sitemap.xml', '/robots.txt']) {
      const block = new RegExp(
        `location = ${path.replace('.', '\\.')} \\{([\\s\\S]*?)\\n    \\}`,
      ).exec(nginx)
      assert.ok(block, `no location for ${path}`)
      const body = block[1] ?? ''
      assert.match(body, /X-Content-Type-Options "nosniff"/)
      assert.match(body, /X-Frame-Options "SAMEORIGIN"/)
      assert.match(body, /Referrer-Policy "strict-origin-when-cross-origin"/)
    }
  })

  it('are repeated in /assets/ too, which is the location that serves the code', () => {
    const block = /location \/assets\/ \{([\s\S]*?)\n    \}/.exec(nginx)
    assert.ok(block, 'no /assets/ location')
    assert.match(block[1] ?? '', /X-Content-Type-Options "nosniff"/)
  })
})
