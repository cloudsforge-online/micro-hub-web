/**
 * The rule this template exists to keep: NOTHING IN THE BUNDLE KNOWS WHICH ENVIRONMENT IT IS IN.
 *
 * A `VITE_` variable is read at build time and frozen into the artefact. An artefact with an
 * environment frozen into it has to be rebuilt to be promoted, which means the thing that reaches
 * production is not the thing that passed CI — and the estate has already lost an afternoon to a
 * staging bundle serving production traffic against a staging API.
 *
 * Every host is resolved at runtime from `window.location.hostname` instead. This test is a grep,
 * because the failure mode is somebody adding one line in a hurry, and a grep is the only check
 * that catches that on the pull request rather than in an incident.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const root = fileURLToPath(new URL('..', import.meta.url))

/** Assembled rather than written out, so this file does not match its own search. */
const ENV_PREFIX = `VITE${'_'}`
const ENV_OBJECT = `import.meta${'.'}env`

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.html'])

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

describe('no build-time configuration', () => {
  const files = [...sourceFiles(join(root, 'src')), join(root, 'index.html')]

  it('finds source files to check', () => {
    // A grep over an empty list passes for the wrong reason, which is the one way this test could
    // silently stop protecting anything.
    assert.ok(files.length >= 10, `expected the source tree, found ${files.length} files`)
  })

  for (const file of files) {
    const name = relative(root, file)
    it(`${name} reads no build-time environment`, () => {
      const text = readFileSync(file, 'utf8')
      assert.equal(text.includes(ENV_PREFIX), false, `${name} references a ${ENV_PREFIX} variable`)
      assert.equal(text.includes(ENV_OBJECT), false, `${name} reads ${ENV_OBJECT}`)
    })
  }

  it('the Vite config defines no constants and reads no env prefix', () => {
    // The other half of the same hole: `define` and `envPrefix` bake values into the bundle
    // without any source file mentioning an environment variable at all.
    const config = readFileSync(join(root, 'vite.config.ts'), 'utf8')
    assert.equal(/^\s*define\s*:/m.test(config), false, 'vite.config.ts declares define')
    assert.equal(/^\s*envPrefix\s*:/m.test(config), false, 'vite.config.ts declares envPrefix')
  })

  it('there is no .env file to read one from', () => {
    const entries = readdirSync(root)
    const envFiles = entries.filter((e) => e === '.env' || e.startsWith('.env.'))
    assert.deepEqual(envFiles, [], `unexpected env files: ${envFiles.join(', ')}`)
  })
})
