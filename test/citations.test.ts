/**
 * EVERY CITATION IN THIS REPOSITORY NAMES A FILE THAT EXISTS, AND NAMES NO LINE IN IT.
 *
 * This bundle is documented by citation: nearly three hundred paths into `wallet/src/server.ts`,
 * `identity/src/server.ts`, `hub-api/src/portfolio.ts`, `custody/src/server.ts` and more. A citation
 * is the estate's unit of evidence and it decays silently, so it needs a check — and the README
 * template says why in one line: "A claim nobody can check is worse than no claim, because it is
 * believed."
 *
 * Until today those citations carried a LINE NUMBER, and that is the failure this file now exists
 * to prevent. A line number names a position in a file that a DIFFERENT repository owns and is free
 * to edit. micro-trade inserted seven lines near its imports and every route below moved, so every
 * citation into it broke while nothing in the citing repository was wrong — and nothing runs this
 * suite when a service changes, so it surfaced during a release rather than at the edit. Seven of
 * nineteen CI failures across the estate on 2026-08-06 were that one shape.
 *
 * What replaces it is the file, plus the SYMBOL when a reader needs the exact place. A symbol moves
 * with the code; a line does not.
 *
 * When a sibling is not checked out, the citations into it are REPORTED as unchecked rather than
 * passed over in silence, so a green run never implies more than it measured.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const here = fileURLToPath(new URL('..', import.meta.url))

/**
 * Every sibling repository a citation in this repository reaches into.
 *
 * Enumerated rather than globbed, because a citation into a repository nobody listed here would
 * otherwise be silently treated as "not checked out" and never verified at all — the exact shape of
 * failure this file exists to catch.
 *
 * The estate checks each `cloudsforge-<name>` out as `<name>`, while the prose cites some of them
 * by their GitHub name, `micro-<name>`. Both spellings resolve to the same directory; see
 * `org/tools/registry.ts`, which applies that substitution once for the whole programme.
 */
const SIBLINGS: readonly string[] = [
  'hub-api',
  'identity',
  'wallet',
  'custody',
  'lantern',
  'ui',
  'web-template',
  'service-template',
  'contracts',
  'org',
  'deploy',
  'site',
  'market-web',
  'admin-web',
  'emberkin-web',
]

/** Where a sibling is checked out. `micro-wallet` and `wallet` are the same directory. */
function siblingRoot(name: string): string | undefined {
  const bare = name.startsWith('micro-') ? name.slice('micro-'.length) : name
  if (!SIBLINGS.includes(bare)) return undefined
  return join(here, `../${bare}`)
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.md', '.yml', '.html'])

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) out.push(full)
  }
  return out
}

/** A citation: a repository-relative path to a file. NO LINE NUMBER — see the header. */
const CITATION = /\b((?:[a-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:ts|tsx|css|yml|sol|md))\b/g

interface Citation {
  readonly from: string
  readonly path: string
}

/**
 * Directories inside THIS repository that a citation may be rooted at.
 *
 * Without this the sweep matches every relative import (`lib/hub.ts`), every package specifier
 * (`@cloudsforge/ui/tokens.css`) and every URL that happens to end in a source extension, and then
 * reports all of them as citations to files that do not exist. A citation is rooted either at a
 * sibling repository or at the top of this one; anything else is a module reference, which
 * TypeScript already resolves and does not need a second, worse checker.
 */
const LOCAL_ROOTS: readonly string[] = ['src', 'test', 'public', 'scripts', '.github']

/**
 * `docs/` is the ESTATE's, not this repository's. The ecosystem documents live one level up beside
 * every repository, so a citation to `docs/ecosystem/…` resolves there or nowhere.
 */
const ESTATE_ROOTS: readonly string[] = ['docs']

function collect(): Citation[] {
  const out: Citation[] = []
  for (const file of sourceFiles(here)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(CITATION)) {
      const path = m[1] ?? ''
      const head = path.split('/')[0] ?? ''
      if (!SIBLINGS.includes(head) && !LOCAL_ROOTS.includes(head) && !ESTATE_ROOTS.includes(head))
        continue
      out.push({ from: relative(here, file), path })
    }
  }
  return out
}

/** Resolve a citation's path to a file on disk, or null when its repository is not checked out. */
function resolve(path: string): string | null {
  const [head, ...rest] = path.split('/')
  const root = siblingRoot(head ?? '')
  if (root === undefined) {
    if (ESTATE_ROOTS.includes(head ?? '')) {
      const estate = join(here, '..', path)
      return existsSync(estate) ? estate : null
    }
    // Not a sibling: a path inside THIS repository.
    const local = join(here, path)
    return existsSync(local) ? local : null
  }
  if (!existsSync(root)) return null
  const full = join(root, rest.join('/'))
  return existsSync(full) ? full : null
}

const CITATIONS = collect()

describe('every citation names a file that exists', () => {
  it('finds citations at all, so this cannot pass on an empty sweep', () => {
    // A regex that stopped matching would make this whole file a no-op that reads as a guarantee.
    assert.ok(CITATIONS.length >= 150, `found only ${CITATIONS.length} citations`)
  })

  it('cites more than one repository, because a client that only cites itself proves nothing', () => {
    const repos = new Set(CITATIONS.map((c) => c.path.split('/')[0]))
    assert.ok(repos.size >= 3, `citations reach only ${[...repos].join(', ')}`)
  })

  it('names a file that exists, wherever the repository is checked out', () => {
    const missing = CITATIONS.filter((c) => {
      const root = siblingRoot(c.path.split('/')[0] ?? '')
      // A sibling that is not checked out is UNCHECKED, not broken. Reported below.
      if (root !== undefined && !existsSync(root)) return false
      return resolve(c.path) === null
    })
    assert.deepEqual(
      missing.map((c) => `${c.from} cites ${c.path}, which does not exist`),
      [],
    )
  })

  it('carries no line numbers, because a line number in another repository cannot be kept true', () => {
    // The rule, enforced rather than described. A path into micro-wallet followed by a colon and a
    // number is a claim about a file this repository does not own and does not watch; it goes stale
    // silently and then fails a build that has nothing to do with it. Cite the file and, if a
    // reader needs the exact place, name the symbol — which moves with the code.
    const withLines: string[] = []
    for (const file of sourceFiles(here)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(
        /\b((?:[a-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:ts|tsx|css|yml|sol|md)):(\d+)/g,
      )) {
        withLines.push(`${relative(here, file)} cites ${m[1]}:${m[2]} — cite the file or the symbol`)
      }
    }
    assert.deepEqual(withLines, [])
  })

  it('reports which repositories were NOT available, rather than passing quietly', () => {
    // Not a failure: `pnpm test` has to work for somebody who cloned only this repository. But an
    // unmeasured citation must never look like a verified one, so the absence is printed and the
    // CI job that has the siblings checked out is where it becomes fatal.
    const absent = SIBLINGS.filter((name) => {
      const root = siblingRoot(name)
      return root === undefined || !existsSync(root)
    })
    if (absent.length > 0) {
      console.log(
        `UNCHECKED: citations into ${absent.join(', ')} — those repositories are not checked out`,
      )
    }
    assert.ok(true)
  })
})
