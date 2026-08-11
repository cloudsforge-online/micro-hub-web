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

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE JSON SHAPE OF `/v1/pool`, WHICH TYPESCRIPT CANNOT CHECK AND WHICH WAS WRONG FOR WEEKS.
 *
 * `loadPool()` casts an `unknown` body to `PoolSummary`. Nothing verifies the cast at runtime and
 * nothing can verify it at compile time across a repository boundary, so a field this app declares
 * with the wrong TYPE typechecks perfectly, passes a suite full of this app's own fixtures, and is
 * wrong only against the live service — where the symptom is a blank, not an error.
 *
 * That is not hypothetical. `stratumEndpoint` was declared `string | null` here while micro-pool
 * has always sent `{ host, port } | null`, and `src/pages/mine.tsx` gated the hardware address on
 * `typeof … === 'string'`. The page would therefore have kept telling the reader with real mining
 * hardware that no Stratum address exists on the day an operator published one — and `mine.test.ts`
 * asserted the branch with a string fixture the service cannot produce, so the suite was green
 * about a rendering that could never occur.
 *
 * So the shapes are read out of micro-pool's own source as text. Coarse, and the honest check
 * available across the boundary: it cannot prove a type, but it catches the rename and the
 * scalar-versus-object mistake, which are the two that actually happen.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
describe('the /v1/pool response shape this app casts to', () => {
  /** This app's own declarations, for comparison against micro-pool's. */
  const client = readFileSync(new URL('../src/lib/pool.ts', import.meta.url), 'utf8')

  /** The `readonly name: type` pairs of one exported interface, in declaration order. */
  function interfaceFields(source: string, name: string): [string, string][] {
    const body = new RegExp(`(?:export )?interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1]
    assert.ok(body, `${name} is no longer an interface in the source this test reads`)
    return [...body.matchAll(/^\s*(?:readonly )?(\w+)\??:\s*([^\n]+?);?\s*$/gm)]
      .filter((match) => !(match[2] as string).startsWith('//'))
      .map((match) => [match[1] as string, (match[2] as string).replace(/;$/, '').trim()])
  }

  /**
   * THE ONE THAT WAS WRONG. `stratumEndpoint` is an object of two fields, not a URL string.
   *
   * Asserted against `pool/src/env.ts`'s declaration rather than against a copy of it here, so the
   * day micro-pool changes the pair this goes red in the repository that has to react to it.
   */
  it('declares stratumEndpoint with the two fields micro-pool publishes, not a string', () => {
    const service = interfaceFields(poolSource('env.ts'), 'StratumEndpoint')
    assert.deepEqual(
      service,
      [
        ['host', 'string'],
        ['port', 'number'],
      ],
      'micro-pool changed StratumEndpoint — re-point src/lib/pool.ts at whatever it sends now',
    )
    assert.deepEqual(
      interfaceFields(client, 'StratumEndpoint'),
      service,
      'this app’s StratumEndpoint no longer matches micro-pool’s, so composed addresses are wrong',
    )
    // And the field on the chain is that object, not a scalar. This is the exact assertion whose
    // absence let a `string | null` declaration survive against a service that never sends one.
    assert.match(
      client,
      /readonly stratumEndpoint: StratumEndpoint \| null/,
      'stratumEndpoint is declared as something other than the object micro-pool sends',
    )
  })

  /**
   * The merged chain, which is the one field on this response with no observable consequence.
   *
   * Every other field on a chain changes a number on screen if it is misread. `merged` changes
   * nothing: a pool merge-mining Dogecoin reports the same hashrate, shares and difficulty as one
   * that is not, so a client that dropped the field entirely — which this one did — looks identical
   * in every test written against its own fixtures. The only defence is reading the server.
   */
  it('reads every field of the merged chain micro-pool publishes', () => {
    const server = poolSource('server.ts')
    // `merged: status.merged ? { … } : null` — the ternary's consequent, which is the only place
    // the wire field names are written down.
    const block = /merged: status\.merged\s*\?\s*\{([\s\S]*?)\n\s*\}\s*\n?\s*:/.exec(server)?.[1]
    assert.ok(
      block,
      'the `merged` object literal is no longer in pool/src/server.ts where this test reads it — ' +
        'RE-POINT THIS CHECK. A parser that cannot find its subject asserts nothing while ' +
        'reporting a pass, which is worse than a red one.',
    )
    const published = [...block.matchAll(/^\s*(\w+):/gm)].map((match) => match[1] as string).sort()
    const declared = interfaceFields(client, 'MergedChain')
      .map(([name]) => name)
      .sort()
    assert.deepEqual(
      declared,
      published,
      'micro-pool publishes a merged-chain field this app does not read, or the reverse',
    )
  })
})
