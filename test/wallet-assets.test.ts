/**
 * `CHAIN_ASSETS`, recomputed from the service that decides it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS TEST OPENS SIBLING REPOSITORIES. IT DOES NOT SKIP WHEN THEY ARE ABSENT.
 *
 * A browser bundle cannot import a private service's source, so `src/lib/money.ts` carries the
 * list of assets `micro-wallet` will move. A carried list is a list that drifts, and the drift is
 * invisible from inside this repository: every harness here stubs the response, so a Send menu
 * offering an asset the service refuses looks exactly like one that works.
 *
 * `micro-site` hit the same problem and solved it this way — `site/test/estate-claims.test.ts`
 * resolves its published numbers against `micro-contracts` in a sibling checkout and FAILS, rather
 * than skipping, when the checkout is missing. A check that quietly turns itself off when its
 * inputs are absent is worse than no check, because the green tick is the same either way.
 *
 * ── WHY WALLET AND NOT `ON_CHAIN_ASSETS` ──────────────────────────────────────────────────────
 *
 * Because they are different questions and Litecoin is currently the difference. `ON_CHAIN_ASSETS`
 * says the estate custodies an asset; `CHAIN_FOR_ASSET` says wallet will move it for a user.
 * Deriving Send's menu from the first would offer LTC and have `POST /v1/withdrawals` refuse it —
 * a dead end presented to a user as a choice. So the equality below is against wallet, and
 * `ON_CHAIN_ASSETS` is only asserted as an upper bound, which it genuinely is: wallet cannot move
 * an asset the estate does not hold.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { CHAIN_ASSETS, settlesOnChain } from '../src/lib/money.ts'

/** The working tree the sibling repositories sit in: `hub-web/..`. */
const ESTATE = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Listed rather than globbed, and each with the file that proves the checkout is the right one.
 *
 * A glob would make "the repository is missing" and "the repository is named something else" the
 * same silent outcome, and the second is what actually happens: CI checks
 * `cloudsforge-online/micro-wallet` out INTO a directory called `wallet`.
 */
const SIBLINGS = [
  { dir: 'wallet', repo: 'micro-wallet', reads: 'src/addresses.ts' },
  { dir: 'contracts', repo: 'micro-contracts', reads: 'packages/chain/src/index.ts' },
] as const

function read(sibling: (typeof SIBLINGS)[number]): string {
  const path = `${ESTATE}${sibling.dir}/${sibling.reads}`
  if (!existsSync(path)) {
    throw new Error(
      `${path} is missing. Check ${sibling.repo} out as '${sibling.dir}' beside this repository — ` +
        'this test does not skip, because a Send menu that offers an asset the service refuses ' +
        'is invisible to every other test here.',
    )
  }
  return readFileSync(path, 'utf8')
}

/**
 * The KEYS of wallet's `CHAIN_FOR_ASSET`, which is the map both of its asset gates call through
 * (`chainForAsset`, used by `requestWithdrawal` and `assignDepositAddress`).
 *
 * Parsed from the source rather than imported: `micro-wallet` is a service, this is a browser
 * bundle, and adding the dependency would put a server package in the shipped app.
 */
function walletMovableAssets(source: string): readonly string[] {
  const block = /const CHAIN_FOR_ASSET[^=]*=\s*Object\.freeze\(\{([^}]*)\}/.exec(source)
  if (!block?.[1]) {
    throw new Error(
      'wallet no longer declares CHAIN_FOR_ASSET as a frozen object literal. Read addresses.ts ' +
        'and re-point this parser — do not delete the check.',
    )
  }
  const codes = [...block[1].matchAll(/^\s*([A-Z][A-Z0-9]*)\s*:/gm)].map((m) => m[1] as string)
  if (codes.length === 0) throw new Error('CHAIN_FOR_ASSET parsed to nothing')
  return codes
}

/** `ON_CHAIN_ASSETS`, the same way `site/test/estate-claims.test.ts` reads it. */
function onChainAssets(source: string): readonly string[] {
  const list = /ON_CHAIN_ASSETS:[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/.exec(source)
  if (!list?.[1]) throw new Error('ON_CHAIN_ASSETS is no longer a frozen array literal')
  const codes = [...list[1].matchAll(/'([A-Z]+)'/g)].map((m) => m[1] as string)
  if (codes.length === 0) throw new Error('ON_CHAIN_ASSETS parsed to nothing')
  return codes
}

describe('CHAIN_ASSETS against the estate', () => {
  it('parses both siblings to something, so neither assertion below can be vacuous', () => {
    // The parsers throw on a shape change, but a regex that matched a short capture would make
    // the set comparisons trivially true. Asserted first and separately, so a parser that has
    // rotted reports itself rather than turning the real checks green.
    //
    // The bound is `CHAIN_ASSETS.length` and not a digit, deliberately. A digit here would be a
    // typed fact about how many assets the estate has TODAY, smuggled into a check whose whole
    // purpose is to stop typed facts about assets — and it would go stale on the next chain, in a
    // test file, where a stale number is hardest to see. Both upstream sets must be at least as
    // large as this list for the assertions below to mean anything, and that is a real invariant
    // rather than a count.
    assert.ok(walletMovableAssets(read(SIBLINGS[0])).length >= CHAIN_ASSETS.length)
    assert.ok(onChainAssets(read(SIBLINGS[1])).length >= CHAIN_ASSETS.length)
  })

  it('is exactly the set micro-wallet will move, in both directions', () => {
    // ── THE CHECK. Both directions matter and they fail differently:
    //
    //   MISSING  wallet moves an asset Send does not offer. A capability the user paid for and
    //            cannot reach. This is the direction that was open on 2026-08-05 with nothing
    //            watching it, and the direction that will open again on the next chain.
    //   EXTRA    Send offers an asset wallet refuses. A dead end presented as a choice, and the
    //            failure `settlesOnChain` was written to close in the first place.
    const wallet = [...walletMovableAssets(read(SIBLINGS[0]))].sort()
    assert.deepEqual(
      [...CHAIN_ASSETS].sort(),
      wallet,
      'CHAIN_ASSETS and wallet CHAIN_FOR_ASSET disagree. Wallet decides; edit src/lib/money.ts.',
    )
    // Stated as behaviour too, not only as data: the list is what `settlesOnChain` reads, and a
    // future refactor could satisfy the deepEqual above while changing what Send actually asks.
    for (const code of wallet) {
      assert.equal(settlesOnChain(code), true, `${code} moves in wallet but Send would not offer it`)
    }
  })

  it('never offers an asset the estate does not custody', () => {
    // The upper bound, and it is a real one rather than a restatement: wallet cannot move an
    // asset that is not in ON_CHAIN_ASSETS, because there is no ledger balance to move. A subset
    // and NOT an equality — Litecoin is in ON_CHAIN_ASSETS and wallet does not move it, and
    // offering it here because contracts lists it would be the defect this file exists to stop.
    const custodied = new Set(onChainAssets(read(SIBLINGS[1])))
    for (const code of CHAIN_ASSETS) {
      assert.ok(custodied.has(code), `${code} is offered by Send but is not an on-chain asset`)
    }
  })

  it('offers nothing the estate calls retired or off-chain', () => {
    // Belt and braces on the three codes that have actually reached this list's inputs and had to
    // be refused: SHARD is retired, USD is not a chain asset, and a TOKEN: urn is a holding
    // hub-api serves that no chain settles. Confirmed against the live estate through the real
    // gateway, per the note in money.ts — all three answer 422 not_withdrawable.
    for (const code of ['SHARD', 'USD', 'SPARK', 'TOKEN:cf:mint:token:1']) {
      assert.equal(settlesOnChain(code), false, `${code} must never be offered`)
    }
  })
})
