/**
 * What micro-pool's SOURCE has to say, read as text, importing nothing.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS FILE EXISTS BECAUSE ITS CHECKS USED TO LIVE IN `pool-contract.test.ts` AND COULD NOT FIRE.
 *
 * That file loads micro-pool's modules with top-level `await import(...)`. The check below —
 * "reaches no runtime dependency outside node:" — is the guard against those modules acquiring an
 * import a bare checkout cannot resolve. It sat downstream of the very thing it guards, so when
 * the condition it was written for actually occurred, the load crashed and the guard never ran.
 *
 * Measured, 2026-08-09, on the 2.5.9 release PR of this repository:
 *
 *     Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@cloudsforge/contracts-chain'
 *       imported from .../pool/src/chains.ts
 *     not ok 17 - test/pool-contract.test.ts
 *
 * micro-pool's `session.ts` had taken a value import of `./chains.ts` for one error string. The
 * assertion that names exactly that mistake was in the same file, forty lines further down, and
 * was never reached. The diagnosis had to come out of a stack trace instead of out of the message
 * written for it.
 *
 * So: these read files. They do not import them. `pool-contract.test.ts` keeps the behavioural
 * half, where importing the modules IS the point — and when it dies at load, this file still
 * reports why in one sentence.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

/** The working tree the sibling repositories sit in: `hub-web/..`. */
const ESTATE = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Named with the file that proves the checkout is the right one, for the reason `wallet-assets`
 * gives: a glob makes "absent" and "named something else" the same silent outcome, and CI checks
 * `cloudsforge-online/micro-pool` out INTO a directory called `pool`.
 */
const POOL_PROOF = 'pool/src/session.ts'

function poolSource(file: string): string {
  const proof = `${ESTATE}${POOL_PROOF}`
  if (!existsSync(proof)) {
    throw new Error(
      `${proof} is missing. Check micro-pool out as 'pool' beside this repository — this test ` +
        'does not skip, because a Stratum client with a reversed field submits nothing and looks ' +
        'exactly like a slow computer to every other test here.',
    )
  }
  return readFileSync(`${ESTATE}pool/src/${file}`, 'utf8')
}

describe('the pool source this client was written against', () => {
  /**
   * The submit parameter order, read out of the server rather than restated.
   *
   * `pool/src/session.ts` destructures `mining.submit`'s parameters into named bindings, and the
   * ORDER of those bindings is the contract. This lifts the destructuring pattern out of the source
   * and compares it to what `buildSubmitParams` emits, so a reordering upstream fails here with a
   * message that names both — rather than as a mysterious rejected share.
   */
  it('destructures submit into the positions buildSubmitParams fills', () => {
    const source = poolSource('session.ts')
    const pattern = /const \[([^\]]*)\] = params/.exec(source)
    assert.ok(pattern?.[1], 'pool/src/session.ts no longer destructures mining.submit positionally')
    const positions = pattern[1].split(',').map((name) => name.trim())
    assert.deepEqual(
      positions,
      ['', 'jobIdRaw', 'extranonce2Raw', 'ntimeRaw', 'nonceRaw', 'versionRaw'],
      'the server reads mining.submit in a different order than buildSubmitParams writes it',
    )
  })

  /**
   * The graph `pool-contract.test.ts` imports must stay free of runtime dependencies, because CI
   * checks micro-pool out without installing it.
   *
   * A `import type` line is elided by the transpiler and costs nothing; a value import of
   * `@cloudsforge/contracts-chain` makes that whole file fail in CI and pass on a developer's
   * machine, which is the worst available outcome. Checked rather than trusted — and checked from
   * HERE, so the check outlives the load it describes.
   *
   * ── IT IS A WALK, AND IT WAS A LIST ─────────────────────────────────────────────────────────
   *
   * The original checked a hand-written list of ten files for direct bare specifiers. That is not
   * the property. The property is about the whole reachable graph, and the two differ exactly
   * where it matters: on 2026-08-09 `session.ts` acquired `import { nameFor } from './chains.ts'`
   * — a RELATIVE specifier, which the list version waves through — and `chains.ts`, one hop
   * further out and not on the list, is what imports `@cloudsforge/contracts-chain`.
   *
   * So the check would have passed on the very commit that made this repository's suite unable to
   * load. It was never reached, because it lived downstream of the load; and had it been reached,
   * it would have been green. Both halves are fixed here: the file no longer imports anything, and
   * the check follows every relative edge to its end.
   *
   * micro-pool carries the same walk in `src/browserdriven.test.ts`, so the red lands in the
   * repository that caused it. This copy stays because it is the half that knows which modules
   * THIS repository loads: if the entry list grows here, the guard over there is a version behind
   * until somebody tells it.
   */
  it('reaches no runtime dependency outside node:', () => {
    // The five `poolModule(...)` calls in `pool-contract.test.ts`. Kept in step with that file by
    // the assertion below, not by memory.
    const entries = ['work.ts', 'pow.ts', 'validate.ts', 'session.ts', 'vardiff.ts']
    const seen = new Set<string>()
    const queue = [...entries]
    const offenders: string[] = []
    while (queue.length > 0) {
      const file = queue.shift() as string
      if (seen.has(file)) continue
      seen.add(file)
      for (const line of poolSource(file).split('\n')) {
        const importing = /^import\s+(?!type\s)(?:.*?from\s+)?'([^']+)'/.exec(line)
        const specifier = importing?.[1]
        if (!specifier || specifier.startsWith('node:')) continue
        if (specifier.startsWith('./')) queue.push(specifier.slice(2))
        else offenders.push(`pool/src/${file} → ${specifier}`)
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `a CI checkout of micro-pool has no node_modules, so these cannot resolve and this whole ` +
        `suite fails to load:\n  ${offenders.join('\n  ')}`,
    )
    // A walk that resolved nothing would satisfy the assertion above by visiting nothing.
    assert.ok(seen.size > entries.length, `walked only ${seen.size} modules; the graph is larger`)
  })

  /**
   * The entry list above is the one in `pool-contract.test.ts`, and drift between them is silent:
   * a module added there and not here is loaded by CI and walked by nobody.
   */
  it('walks exactly the modules pool-contract.test.ts loads', () => {
    const contract = readFileSync(new URL('./pool-contract.test.ts', import.meta.url), 'utf8')
    const loaded = [...contract.matchAll(/poolModule\('([^']+)'\)/g)].map((match) => match[1])
    assert.ok(loaded.length > 0, 'pool-contract.test.ts no longer calls poolModule() — re-point this test')
    assert.deepEqual([...loaded].sort(), ['pow.ts', 'session.ts', 'validate.ts', 'vardiff.ts', 'work.ts'])
  })
})
