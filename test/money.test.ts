/**
 * The money layer: what leaves the browser when somebody moves value.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Every test here is of the form "the client sends what it claims to send". None of them asserts
 * a business rule — not what a valid address looks like, not what a minimum withdrawal is, not
 * who may export a key. Those are the SERVICES' decisions, and doc 14 §11 records what it costs
 * to hold a copy of one in a client: a game client withheld four SKUs from its UI while the
 * payment routes stayed live and chargeable, and a client-side test of the hidden catalogue would
 * have passed against that defect.
 *
 * Each route is driven against a stand-in that serves ONLY the routes the real service serves and
 * 404s everything else — the shape `auth.test.ts` in `@cloudsforge/ui` had to be rewritten into
 * after `/auth/exchange` shipped behind a green test that could not fail. A wrong path here is a
 * 404 and a red test, not a string that matches a copy of itself.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { __resetAuth, setTokens } from '../src/lib/api.ts'
import { __resetObs } from '../src/lib/obs.ts'
import { scaleOf, toBaseUnits } from '../src/lib/format.ts'
import { mintIdempotencyKey, SAFE_IDEMPOTENCY_KEY } from '../src/lib/idempotency.ts'
import {
  assignDepositAddress,
  cancelKeyExport,
  challengeKeyExport,
  CHAIN_ASSETS,
  loadKeyExports,
  redeemKeyExport,
  requestKeyExport,
  requestWithdrawal,
  settlesOnChain,
  type SendIntent,
} from '../src/lib/money.ts'
import {
  installFetch,
  installStorage,
  installWindow,
  json,
  removeStorage,
  removeWindow,
  type FetchCall,
  type FetchStub,
} from './browser-stubs.ts'

let stub: FetchStub | null = null

beforeEach(() => {
  // The window is what `cloudsforgeHosts()` reads to resolve the `pay.` and `vault.` hosts.
  // Nothing below inspects it afterwards, so the handle is not kept.
  installWindow('https://hub.cloudsforge.online/wallet')
  installStorage()
  __resetAuth()
  setTokens({ accessToken: 'at', refreshToken: 'rt' })
})

afterEach(() => {
  stub?.restore()
  stub = null
  __resetObs()
  removeStorage()
  removeWindow()
})

/**
 * The routes `micro-wallet` and `micro-custody` serve that this bundle calls, each with the line
 * it was read from. Anything else answers 404, exactly as the services do with a path they do not
 * route — so a client pointed at a route that does not exist fails its own test.
 */
const SERVED: Record<string, (call: FetchCall) => Response> = {
  // wallet/src/server.ts. Refuses without an Idempotency-Key (idempotency.ts).
  'POST https://pay.cloudsforge.online/v1/withdrawals': (call) => {
    if (!call.headers['idempotency-key']) {
      return json(400, {
        error: { code: 'idempotency_key_required', message: 'an Idempotency-Key header is required' },
      })
    }
    const body = JSON.parse(call.body ?? '{}') as SendIntent
    // The service echoes the destination it will actually pay. A client that submitted something
    // other than what it displayed would be caught by comparing the two.
    return json(201, {
      withdrawal: {
        id: 'w1',
        chain: 'ember',
        network: 'testnet',
        assetCode: body.assetCode,
        destination: body.destination,
        amount: body.amount,
        amountFormatted: '1.5',
        fee: '1000',
        net: '1499999999999999000',
        netFormatted: '1.499999',
        state: 'requested',
        txHash: null,
        failureReason: null,
        requestedAt: '2026-08-03T00:00:00.000Z',
      },
      replayed: false,
    })
  },
  // wallet/src/server.ts.
  'POST https://pay.cloudsforge.online/v1/deposits': (call) => {
    const body = JSON.parse(call.body ?? '{}') as { assetCode: string; rotate?: boolean }
    return json(201, {
      assignment: {
        id: body.rotate === true ? 'a2' : 'a1',
        assetCode: body.assetCode,
        chain: 'ember',
        network: 'testnet',
        walletId: 'wal1',
        address: '0xdeposit',
        status: 'active',
        assignedAt: '2026-08-03T00:00:00.000Z',
        watchedAt: null,
      },
    })
  },
  // custody/src/server.ts — the export routes below, all four of them.
  'GET https://vault.cloudsforge.online/v1/exports': () => json(200, { exports: [] }),
  'POST https://vault.cloudsforge.online/v1/exports': (call) => {
    const body = JSON.parse(call.body ?? '{}') as { address: string; format: string }
    return json(201, { export: { id: 'e1', address: body.address, format: body.format, status: 'cooling_off' } })
  },
  'POST https://vault.cloudsforge.online/v1/exports/e1/cancel': () =>
    json(200, { export: { id: 'e1', status: 'cancelled' } }),
  'POST https://vault.cloudsforge.online/v1/exports/e1/challenge': () =>
    json(200, { export: { id: 'e1', status: 'challenged' }, revealToken: 'reveal-1' }),
  'POST https://vault.cloudsforge.online/v1/exports/e1/redeem': (call) => {
    const body = JSON.parse(call.body ?? '{}') as { revealToken?: string; passphrase?: string }
    if (body.revealToken !== 'reveal-1') {
      return json(403, { error: { code: 'bad_token', message: 'the reveal token is not the one issued' } })
    }
    return json(200, { export: { address: '0xabc', format: 'keystore', material: 'MATERIAL', ...body } })
  },
}

function installServices(): FetchStub {
  return installFetch((call) => {
    const key = `${call.method} ${new URL(call.url).origin}${new URL(call.url).pathname}`
    const handler = SERVED[key]
    return handler
      ? handler(call)
      : json(404, { error: { code: 'not_found', message: `nothing serves ${key}` } })
  })
}

/* ══════════════════════════════ amounts ══════════════════════════════ */

describe('toBaseUnits', () => {
  it('converts exactly, with no float anywhere in the path', () => {
    // 0.1 * 1e18 in IEEE 754 is 100000000000000000.00000001. This is the value that has to be
    // exact, because it is what is submitted as the amount.
    assert.equal(toBaseUnits('0.1', 18), 100000000000000000n)
    assert.equal(toBaseUnits('1.5', 18), 1500000000000000000n)
    assert.equal(toBaseUnits('0.00000001', 8), 1n)
    assert.equal(toBaseUnits('123', 0), 123n)
  })

  it('refuses a fraction longer than the asset holds rather than cutting it', () => {
    // Cutting would submit a different number from the one typed, silently.
    assert.equal(toBaseUnits('0.123456789', 8), null)
    assert.equal(toBaseUnits('1.5', 0), null)
  })

  it('refuses anything that is not a plain non-negative decimal', () => {
    for (const bad of ['', '-1', '1e18', 'abc', '1.2.3', '0x10', ' ']) {
      assert.equal(toBaseUnits(bad, 18), null, `${JSON.stringify(bad)} must not convert`)
    }
  })
})

describe('scaleOf', () => {
  it('recovers the scale from a balance the server already sent', () => {
    // The pair is `amount` (smallest units) and `amountFormatted` (human) from one holding.
    assert.equal(scaleOf('1500000000000000000', '1.5'), 18)
    assert.equal(scaleOf('50000000', '0.5'), 8)
    assert.equal(scaleOf('1000000', '1'), 6)
    assert.equal(scaleOf('7', '7'), 0)
  })

  it('is exact: only one scale can reproduce a given pair', () => {
    // `parse(text, d)` is strictly increasing in d, so a match is unique. This is what makes the
    // derivation safe to use for money rather than a heuristic.
    const matches = []
    for (let d = 0; d <= 30; d += 1) if (toBaseUnits('1.5', d) === 1500000000000000000n) matches.push(d)
    assert.deepEqual(matches, [18])
  })

  it('says nothing rather than guessing where the pair cannot establish it', () => {
    // Zero is reproduced by every scale; a TOKEN: asset has no formatted form at all
    // (hub-api/src/portfolio.ts). Both fall back to smallest units in the form.
    assert.equal(scaleOf('0', '0'), null)
    assert.equal(scaleOf('1000', null), null)
    assert.equal(scaleOf(null, '1'), null)
    assert.equal(scaleOf('not-a-number', '1'), null)
  })
})

/* ══════════════════════════════ idempotency ══════════════════════════════ */

describe('the idempotency key', () => {
  it('matches the pattern micro-wallet accepts', () => {
    // wallet/src/idempotency.ts refuses anything outside 8..200 of [A-Za-z0-9_:.-].
    for (let i = 0; i < 20; i += 1) {
      const key = mintIdempotencyKey('withdraw')
      assert.match(key, SAFE_IDEMPOTENCY_KEY, `${key} would be refused by the service`)
    }
  })

  it('names the intent, so a key in a log says what it was for', () => {
    assert.ok(mintIdempotencyKey('withdraw').startsWith('withdraw:'))
  })

  it('is a different key every time it is minted', () => {
    const keys = new Set(Array.from({ length: 50 }, () => mintIdempotencyKey('withdraw')))
    assert.equal(keys.size, 50)
  })
})

/* ══════════════════════════════ withdrawals ══════════════════════════════ */

describe('requestWithdrawal', () => {
  it('posts to the route micro-wallet serves, on the payments host', async () => {
    stub = installServices()
    await requestWithdrawal({ assetCode: 'EMBER', destination: '0xabc', amount: '1' }, 'withdraw:k1')
    assert.equal(stub.calls[0]?.url, 'https://pay.cloudsforge.online/v1/withdrawals')
    assert.equal(stub.calls[0]?.method, 'POST')
  })

  /**
   * THE ASSERTION THIS WHOLE FILE EXISTS FOR.
   *
   * The destination that goes over the wire is byte-for-byte the destination in the intent the
   * confirmation step was handed. Not lower-cased, not trimmed a second time, not "normalised".
   * A form that displays one address and submits another is the most expensive defect a frontend
   * can have here, and the case below is the one a normaliser would break: a mixed-case checksummed
   * address, which is a DIFFERENT address once it has been case-folded.
   */
  it('submits the destination exactly as it was confirmed', async () => {
    stub = installServices()
    const confirmed: SendIntent = {
      assetCode: 'EMBER',
      destination: '0xAbC0000000000000000000000000000000dEf1',
      amount: '1500000000000000000',
    }
    const outcome = await requestWithdrawal(confirmed, 'withdraw:k1')

    const sent = JSON.parse(stub.calls[0]?.body ?? '{}') as SendIntent
    assert.deepEqual(sent, confirmed, 'the submitted body differs from the confirmed intent')
    assert.equal(sent.destination, confirmed.destination)
    // And the service's own record echoes it back, which is what the receipt renders.
    assert.equal(outcome.withdrawal.destination, confirmed.destination)
  })

  it('carries the Idempotency-Key the service requires', async () => {
    // Without it the stand-in answers 400, exactly as `wallet/src/idempotency.ts` does:
    // "without one a retry moves money twice".
    stub = installServices()
    await requestWithdrawal({ assetCode: 'EMBER', destination: '0xabc', amount: '1' }, 'withdraw:k1')
    assert.equal(stub.calls[0]?.headers['idempotency-key'], 'withdraw:k1')
  })

  it('presents the user’s own session, never a service credential', async () => {
    stub = installServices()
    await requestWithdrawal({ assetCode: 'EMBER', destination: '0xabc', amount: '1' }, 'withdraw:k1')
    assert.equal(stub.calls[0]?.headers['authorization'], 'Bearer at')
  })

  it('reads back a replay as a replay, not as a failure', async () => {
    // The service answers 200 with `replayed: true` for a second press of one key. Translating
    // that into an error would invite the user to send a second payment.
    stub = installFetch(() =>
      json(200, { withdrawal: { id: 'w1', destination: '0xabc', state: 'requested' }, replayed: true }),
    )
    const outcome = await requestWithdrawal(
      { assetCode: 'EMBER', destination: '0xabc', amount: '1' },
      'withdraw:k1',
    )
    assert.equal(outcome.replayed, true)
  })
})

/* ══════════════════════════════ deposits ══════════════════════════════ */

describe('assignDepositAddress', () => {
  it('asks for the existing address by default, and never sends `rotate`', async () => {
    // wallet: "Defaulting to it would mint a new address on every page load and leave a trail of
    // addresses nobody was told about." Sending `rotate: false` would be harmless; sending the
    // key at all is what this asserts is not done, because the default must be the safe one.
    stub = installServices()
    await assignDepositAddress('EMBER')
    assert.deepEqual(JSON.parse(stub.calls[0]?.body ?? '{}'), { assetCode: 'EMBER' })
  })

  it('sends `rotate` only when a rotation was actually asked for', async () => {
    stub = installServices()
    await assignDepositAddress('EMBER', true)
    assert.deepEqual(JSON.parse(stub.calls[0]?.body ?? '{}'), { assetCode: 'EMBER', rotate: true })
  })
})

/* ══════════════════════════════ which assets may be offered ══════════════════════════════ */

describe('settlesOnChain', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * WHAT THIS TEST IS, AND — MORE IMPORTANTLY — WHAT IT IS NOT.
   *
   * It is NOT the evidence that `micro-wallet` refuses SHARD. It cannot be: every test in this
   * file answers its own requests from a stand-in, and a stand-in will happily accept an asset
   * the real service rejects. That was exactly the defect — Send offered SHARD, the whole
   * frontend suite was green, and the refusal only ever existed at the service.
   *
   * The evidence is `micro-wallet`'s source and the running estate, in that order:
   *
   *   wallet/src/addresses.ts     CHAIN_FOR_ASSET — EMBER, ETH, BTC, SOL, XRP, and its own
   *                                     comment on why SHARD is absent
   *   wallet/src/withdrawals.ts `chainForAsset(...) === null` → `not_withdrawable`
   *   wallet/src/deposits.ts    the same, → `not_depositable`
   *
   * and then confirmed by driving `POST /v1/withdrawals` through the real gateway against the
   * live estate, once per code — SHARD, USD and TOKEN:… came back 422 `not_withdrawable`, while
   * the five below got past the asset gate and were refused on the address instead.
   *
   * What THIS test does is narrower and still worth having: it pins the list so that a later
   * edit cannot quietly widen it, and it states the SHARD case by name so the regression has a
   * red test with the defect's own name on it.
   *
   * ── AND THE LINE ABOVE NAMES ITS OWN LIMIT, WHICH IS NOW CLOSED ELSEWHERE ─────────────────
   *
   * "the evidence is micro-wallet's source" was true, and reading it once is not a check. A list
   * pinned against a second list typed beside it cannot notice an asset that is in NEITHER — the
   * missing direction, where wallet gains a chain and Send silently goes on not offering it.
   * `test/wallet-assets.test.ts` closes that: it parses `CHAIN_FOR_ASSET` out of the sibling
   * checkout and asserts set equality, so wallet decides and this repository follows.
   *
   * **So do not fix a failure of the assertion below by editing the literal.** Read
   * `wallet/src/addresses.ts` first; if wallet really did gain the asset, `CHAIN_ASSETS` is what
   * changes and this literal follows it.
   * ══════════════════════════════════════════════════════════════════════════════════════════
   */
  it('accepts exactly the assets micro-wallet maps to a chain', () => {
    // LTC joined on 2026-08-05, and it joined the way the block above says it must: `wallet-
    // assets.test.ts` went red first, naming `wallet/src/addresses.ts` as the source, and
    // `CHAIN_ASSETS` and this literal moved together in that change. Nobody edited this line to
    // make a red test green.
    //
    // DOGE and ETC joined on 2026-08-08 by the same route and for the same reason — the estate's
    // `feat/assets-doge-etc` put both in `CHAIN_FOR_ASSET`, the derived check went red naming
    // wallet, and the two literals moved together. The title no longer counts them: "six" was a
    // typed fact about how many chains the estate had, in a test whose neighbours exist to stop
    // typed facts about chains, and it went stale on the first one that arrived after it.
    assert.deepEqual(
      [...CHAIN_ASSETS].sort(),
      ['BTC', 'DOGE', 'EMBER', 'ETC', 'ETH', 'LTC', 'SOL', 'XRP'],
    )
    for (const code of CHAIN_ASSETS) assert.equal(settlesOnChain(code), true, `${code} was excluded`)
  })

  it('offers DOGE and ETC, which wallet moves and this deployment cannot yet settle', () => {
    // ══════════════════════════════════════════════════════════════════════════════════════
    // ASSERTED SEPARATELY BECAUSE THE DECISION BEHIND THEM IS THE INTERESTING PART, AND THE
    // LITERAL ABOVE RECORDS ONLY THE OUTCOME.
    //
    // Both chains are unsettleable on the estate today: `settlement/src/registry.ts` refuses DOGE
    // outright (`unimplementedChain`, phase 8 — the adapter is P2WPKH and Dogecoin has no segwit),
    // and no manifest gives ETC a `SETTLEMENT_RPC_URLS` entry, so every ETC call ends at
    // `NoEndpointError`. Offering an asset the estate cannot settle looks like the defect this
    // whole file exists to stop, and it is not: read on 2026-08-09,
    // `deploy/compose/docker-compose.estate.yml` quotes fees for EMBER and LTC alone and points
    // settlement at `ember` alone, XRP is `unimplementedChain` in the very same table, and all
    // five of those codes have been offered here since before either of these two existed.
    //
    // So the limitation is the deployment's and not the asset's, and the guard against it is
    // structural: Send only lists assets with a non-zero balance, no DOGE or ETC deposit has ever
    // been credited, and Receive asks `GET /v1/deposits/assets` rather than reading this list. See
    // `lib/money.ts` for the argument in full and for what would expire it.
    // ══════════════════════════════════════════════════════════════════════════════════════
    assert.equal(settlesOnChain('DOGE'), true)
    assert.equal(settlesOnChain('ETC'), true)
  })

  it('offers Litecoin, because micro-wallet moves it now — and the old assertion is gone', () => {
    // ══════════════════════════════════════════════════════════════════════════════════════
    // THIS ROW USED TO ASSERT THE OPPOSITE, AND THE INVERSION IS THE RECORD OF A REAL GAP.
    //
    // It read "does not offer Litecoin, because micro-wallet does not move it", and it said of
    // itself: "This is a TEMPORARY truth and it is asserted anyway, because the thing that must
    // not happen quietly is it changing. When wallet adds Litecoin, `wallet-assets.test.ts` goes
    // red first with the reason, and this line is deleted as part of the same change."
    //
    // That is exactly what happened. `micro-wallet` added `ltc` to `ChainId` and `LTC: 'ltc'` to
    // `CHAIN_FOR_ASSET` (`wallet/src/addresses.ts,99`, commit 87f2251) and this repository did
    // not follow, so for a while wallet would move an asset Send did not offer — a capability the
    // user has and cannot reach. Nothing broke and nobody noticed; the derived check found it.
    //
    // It is kept as an assertion rather than deleted because the pair is what has value: the
    // literal above pins the set, and this pins the ONE asset whose two answers were out of step,
    // so a revert in either repository is red here with the history attached.
    // ══════════════════════════════════════════════════════════════════════════════════════
    assert.equal(settlesOnChain('LTC'), true)
  })

  it('refuses SHARD, which is the defect this exists for', () => {
    // The old test was `/^[A-Z]+$/`, which matches SHARD — so Send offered a withdrawal the
    // service answers with "SHARD does not settle on a chain and cannot be withdrawn".
    assert.equal(settlesOnChain('SHARD'), false)
  })

  it('refuses the other things hub-api serves as holdings but wallet will not move', () => {
    // `USD` is why this is an allowlist and not `assetCode !== 'SHARD'`: it is also plain
    // uppercase and also refused. `TOKEN:<urn>` was the only thing the old regex did exclude.
    assert.equal(settlesOnChain('USD'), false)
    assert.equal(settlesOnChain('TOKEN:cf:mint:token:1'), false)
  })

  it('does not accept SPARK, which is a denomination of EMBER and not an asset', () => {
    // One Spark is 10⁻⁶ EMBER — the relationship a penny has to a pound — so a `SPARK` entry here
    // would re-create the defect above in a name that is not an asset code at all.
    //
    // The reason is that and only that. This comment used to add "Shards are being withdrawn
    // estate-wide in favour of EMBER denominated in Sparks", which states a decision that has not
    // been taken: SHARD is retired, but the two migrations that retired a SHARD price went to USD
    // cents and refused EMBER by name, and what remains in Shards is micro-org#226, still open.
    // `lib/money.ts` carries the citations. The assertion below does not depend on the answer.
    assert.equal(settlesOnChain('SPARK'), false)
  })
})

/* ══════════════════════════════ the export ceremony ══════════════════════════════ */

describe('the key export ceremony', () => {
  it('uses the four routes micro-custody serves, on the vault host', async () => {
    stub = installServices()
    const controller = new AbortController()
    await loadKeyExports(controller.signal)
    await requestKeyExport('0xabc', 'keystore')
    await challengeKeyExport('e1')
    await redeemKeyExport('e1', 'reveal-1', 'a-long-enough-passphrase')
    await cancelKeyExport('e1')

    // Every one of these would 404 against the stand-in if the path were wrong, and each call
    // above would have rejected — so reaching this line is itself the assertion. The list is here
    // so a reader can see WHICH routes, in order.
    assert.deepEqual(
      stub.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
      [
        'GET /v1/exports',
        'POST /v1/exports',
        'POST /v1/exports/e1/challenge',
        'POST /v1/exports/e1/redeem',
        'POST /v1/exports/e1/cancel',
      ],
    )
    for (const call of stub.calls) {
      assert.equal(new URL(call.url).origin, 'https://vault.cloudsforge.online')
    }
  })

  it('sends the reveal token custody issued, and the passphrase only when there is one', async () => {
    stub = installServices()
    await redeemKeyExport('e1', 'reveal-1')
    assert.deepEqual(JSON.parse(stub.calls[0]?.body ?? '{}'), { revealToken: 'reveal-1' })

    stub.restore()
    stub = installServices()
    await redeemKeyExport('e1', 'reveal-1', 'a-long-enough-passphrase')
    assert.deepEqual(JSON.parse(stub.calls[0]?.body ?? '{}'), {
      revealToken: 'reveal-1',
      passphrase: 'a-long-enough-passphrase',
    })
  })

  it('does not ask for a key with a token custody did not issue', async () => {
    stub = installServices()
    await assert.rejects(() => redeemKeyExport('e1', 'guessed'), /reveal token/)
  })

  it('encodes the id, so an id is a path segment rather than a path', async () => {
    stub = installFetch(() => json(200, { export: {} }))
    await cancelKeyExport('e1/../../admin/keys')
    assert.equal(
      new URL(stub.calls[0]?.url ?? '').pathname,
      '/v1/exports/e1%2F..%2F..%2Fadmin%2Fkeys/cancel',
    )
  })
})

/* ══════════════════════════════ the confirmation step ══════════════════════════════ */

/**
 * The other half of "what you see is what is sent", checked in the source.
 *
 * There is no DOM in this suite — see `test/browser-stubs.ts` for why — so the render cannot be
 * driven. What CAN be checked, and is worth checking, is that the confirmation step and the
 * submission read the same frozen object with nothing between them. Put a `.toLowerCase()`, a
 * `.trim()` or a spread with an override on either side and this goes red.
 */
describe('the Send confirmation and the Send submission read one object', () => {
  const source = readFileSync(new URL('../src/components/send.tsx', import.meta.url), 'utf8')

  it('renders the destination straight off the frozen intent', () => {
    assert.match(
      source,
      /\{armed\.intent\.destination\}/,
      'the confirmation step does not render armed.intent.destination directly',
    )
  })

  it('submits the frozen intent itself, not a copy built from the form', () => {
    assert.match(
      source,
      /requestWithdrawal\(armed\.intent, armed\.key\)/,
      'the submit does not pass the frozen intent through untouched',
    )
  })

  it('has exactly one place that builds a SendIntent, and it is the review step', () => {
    // Two construction sites are two chances for them to differ. One, in `review`, is what makes
    // "the confirmation renders what will be sent" a property of the shape of the code.
    const built = [...source.matchAll(/const intent: SendIntent = \{/g)]
    assert.equal(built.length, 1, `SendIntent is built in ${built.length} places`)
  })

  it('never transforms the destination between the confirmation and the wire', () => {
    // The transformations that would silently change an address. `.trim()` on the raw input at
    // review time is allowed and is the only one; after the intent exists, nothing may touch it.
    const afterReview = source.slice(source.indexOf('const confirm ='))
    for (const forbidden of ['.toLowerCase()', '.toUpperCase()', '.trim()', '.replace(']) {
      assert.equal(
        afterReview.includes(`intent.destination${forbidden}`),
        false,
        `the destination is put through ${forbidden} after it was confirmed`,
      )
    }
  })
})
