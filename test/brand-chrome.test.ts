/**
 * A frontend ships its own browser chrome, or it ships none at all.
 *
 * THREE FRONTENDS SHIPPED WITH NO FAVICON. `foresight-web` and `foresight-admin-web` were built
 * before their product's brand assets existed, and `emberkin-web` copied 180 game images into
 * `public/` without the four that a browser and a link preview actually use. Every one of them
 * passed its own suite, typechecked, built, and went green in CI — because nothing anywhere
 * asserted that a page has an icon. The result is the browser's blank-page glyph in the tab and a
 * bare URL wherever the app is shared.
 *
 * It is a template test because the defect is an omission, and the template is where an omission
 * gets inherited. A frontend cut from here now fails until it has its own chrome — which is the
 * point at which somebody notices the brand assets exist and copies them.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))
const HTML = readFileSync(at('index.html'), 'utf8')

/** The sizes a browser and an install prompt actually ask for. */
const REQUIRED_ICONS = ['favicon-32x32.png', 'favicon-192x192.png']

test('the icons a browser asks for are present in public/', () => {
  const missing = REQUIRED_ICONS.filter((f) => !existsSync(at(`public/${f}`)))
  assert.deepEqual(
    missing,
    [],
    `public/ is missing ${missing.join(', ')} — copy them from micro-brand's set for this surface`,
  )
})

test('index.html links every icon it ships, and ships every icon it links', () => {
  // Both directions. A link to a file that is not there is a 404 in every tab; a file nobody links
  // is dead weight that looks like it is working.
  for (const f of REQUIRED_ICONS) {
    assert.ok(HTML.includes(f), `index.html does not link /${f}`)
  }
  for (const m of HTML.matchAll(/href="\/(favicon[^"]*)"/g)) {
    assert.ok(existsSync(at(`public/${m[1]}`)), `index.html links /${m[1]}, which is not in public/`)
  }
})

test('a shared link renders as a card, not a bare URL', () => {
  assert.match(HTML, /property="og:title"/, 'no og:title — a shared link shows the URL')
  assert.match(HTML, /property="og:image"/, 'no og:image — a shared link shows no picture')
  const img = /property="og:image" content="([^"]+)"/.exec(HTML)?.[1]
  assert.ok(img, 'og:image has no content')
  if (img.startsWith('/')) {
    assert.ok(existsSync(at(`public${img}`)), `og:image points at ${img}, which is not in public/`)
  }
})

test('the og:image path is relative, so one bundle serves every host', () => {
  // An absolute URL here bakes a hostname into the artefact, which is the same defect as
  // build-time configuration: the bundle stops being the one thing promoted between environments.
  const img = /property="og:image" content="([^"]+)"/.exec(HTML)?.[1] ?? ''
  assert.doesNotMatch(img, /^https?:\/\//, 'og:image must not name a host')
})
