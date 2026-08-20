/**
 * THE COMBINED VIEW'S SECOND HALF: which ESTATE each request actually goes to.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE DEFECT THIS FILE EXISTS FOR ───────────────────────────────────────────────────────────
 *
 * *"When you switch to testnet and then click on Wallet: that did not load, cannot reach the
 * server."*
 *
 * Two defects were stacked, and the visible one was standing in front of the dangerous one.
 *
 * The visible one is not in this repository: the testnet gateway's CORS allowlist named the
 * `*-testnet` frontend origins, which the combined view retired, so the browser threw away every
 * credentialed answer and `lib/api.ts` rendered its offline sentence. That is fixed in
 * micro-deploy, and it is the half a reader can see.
 *
 * The one underneath is here. `viewedApiOrigin()` moved ONE base — hub-api. Everything else this
 * bundle calls resolved through `cloudsforgeHosts()`, which reads `window.location.hostname`, and
 * under the combined view that hostname is the MAINNET estate whatever the switcher says. So with
 * the CORS fix alone, a Wallet page marked testnet would have shown mainnet balances, minted
 * mainnet deposit addresses, and offered a Send form that spends real coins — an amber band over
 * real money. Fixing CORS without this would have traded a visible failure for a silent one.
 *
 * ── WHY EVERY TEST BELOW ASSERTS ON A FETCHED URL ─────────────────────────────────────────────
 *
 * `viewedSurfaceUrl` returning the right string proves nothing; that is the shape of defect this
 * estate keeps meeting (`test/deposit-addresses.test.ts`, micro-foresight's `/stake-assets`) — a
 * function that is exported and correct, and that nothing calls. So each case drives the REAL
 * client function and reads the URL off the fetch stub. A helper nobody wired up fails here.
 *
 * ── AND THE ONES THAT MUST NOT MOVE ARE ASSERTED TOO ──────────────────────────────────────────
 *
 * Identity and the error ingest stay on the estate serving the bundle, deliberately, and a
 * negative that is never asserted is a decision that gets "tidied up" by the next person to read
 * `viewed.ts`. See the header there for why each one stays.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { __resetAuth, setTokens } from '../src/lib/api.ts'
import { __resetObs } from '../src/lib/obs.ts'
import { emberMiningBase, hosts } from '../src/lib/hosts.ts'
import { rpcCall } from '../src/lib/embersweep.ts'
import { assignDepositAddress, loadDepositAddresses, loadKeyExports } from '../src/lib/money.ts'
import { loadPool } from '../src/lib/pool.ts'
import { setViewedNetwork, viewedSurfaceUrl } from '../src/lib/viewed.ts'
import {
  installFetch,
  installStorage,
  installWindow,
  json,
  removeStorage,
  removeWindow,
  type FetchStub,
} from './browser-stubs.ts'

const MAINNET_PAGE = 'https://hub.cloudsforge.online/wallet'
const TESTNET_PAGE = 'https://hub-testnet.cloudsforge.online/wallet'

let stub: FetchStub | null = null

/** Serve anything, with a body shaped enough for the client to parse. Only the URL is under test. */
function serving(body: unknown = {}): FetchStub {
  stub = installFetch(() => json(200, body))
  return stub
}

/** The single URL the code under test asked for. Exactly one, so a stray call cannot hide. */
function askedOnce(): string {
  assert.equal(stub?.calls.length, 1, 'expected exactly one request')
  return stub?.calls[0]?.url ?? ''
}

beforeEach(() => {
  installWindow(MAINNET_PAGE)
  installStorage()
  __resetAuth()
  setTokens({ accessToken: 'at', refreshToken: 'rt' })
})

afterEach(() => {
  stub?.restore()
  stub = null
  // The viewed network is module state and this file is the only one that writes it. Clearing it
  // needs a window, because "is this the deployment's own network" is a question about a hostname
  // — so the reset happens BEFORE the window is torn down, in this order, every time.
  installWindow(MAINNET_PAGE)
  setViewedNetwork('mainnet')
  removeStorage()
  removeWindow()
  __resetObs()
})

/* ═══════════════ the reader has switched to testnet, on a mainnet hostname ═══════════════ */

describe('viewing testnet from the merged frontend', () => {
  beforeEach(() => setViewedNetwork('testnet'))

  it('reads balances and deposits from testnet, not from the estate serving the page', async () => {
    serving({ assignments: [] })
    await loadDepositAddresses(new AbortController().signal)
    assert.equal(askedOnce(), 'https://pay-testnet.cloudsforge.online/v1/deposits')
  })

  it('mints a deposit address on testnet — the write, which is the one that could lose money', async () => {
    // A deposit address minted on the wrong network is worse than a wrong balance: the reader
    // copies it, sends coins to it, and the network that would have credited them never saw it.
    serving({ assignment: {} })
    await assignDepositAddress('BTC')
    assert.equal(askedOnce(), 'https://pay-testnet.cloudsforge.online/v1/deposits')
    assert.equal(stub?.calls[0]?.method, 'POST')
  })

  it('asks testnet custody about keys — the service that holds them', async () => {
    serving({ exports: [] })
    await loadKeyExports(new AbortController().signal)
    assert.equal(askedOnce(), 'https://vault-testnet.cloudsforge.online/v1/exports')
  })

  it('reads the testnet pool, which is where the stratum endpoint on screen comes from', async () => {
    // micro-org#285 took this string away from `window.location` once already. The reason holds
    // in the other direction now: a ticket minted by one pool is worthless on the other's socket.
    serving({ chain: 'ember', stratum: {} })
    await loadPool()
    assert.equal(askedOnce(), 'https://testnet.cloudsforge.online/pool/v1/pool')
  })

  it('sweeps mined EMBER through the testnet node', async () => {
    stub = installFetch(() => json(200, { jsonrpc: '2.0', id: 1, result: '0x1' }))
    await rpcCall('eth_chainId', [])
    assert.equal(askedOnce(), 'https://rpc-testnet.cloudsforge.online')
  })

  it('mines against the testnet node, on the REST port and not the JSON-RPC one', () => {
    // 8545 is JSON-RPC and 8645 is `/mining/*`. In production the gateway serves both under
    // `rpc<suffix>`, so the swap is a no-op there — but the HOSTNAME still has to be testnet's.
    assert.equal(emberMiningBase(viewedSurfaceUrl('rpc')), 'https://rpc-testnet.cloudsforge.online')
  })

  it('names the hostnames with a HYPHEN, which is the only form the estate can serve', () => {
    // `hub.testnet.<apex>` is not a style question. Cloudflare's Universal SSL is
    // `*.cloudsforge.online`, a wildcard matches ONE label, and the nested form therefore fails
    // the TLS handshake at the edge before a request is made. It has been in a config once.
    // `pool` LEFT THIS LIST IN WAVE 3d, and it is the one whose absence is worth a sentence: it
    // has no subdomain any more, so there is no first label for a hyphen to join and the testnet
    // console is `testnet.<apex>/pool`. Asserting `-testnet.` on it would be demanding a hostname
    // shape from a surface that no longer has a hostname — and the nested-form check below covers
    // it either way, which is the half of this test that is about the TLS wildcard.
    for (const key of ['pay', 'keyvault', 'rpc'] as const) {
      const url = viewedSurfaceUrl(key)
      assert.ok(!url.includes('.testnet.'), `${key} composed the nested form: ${url}`)
      assert.ok(url.includes('-testnet.cloudsforge.online'), `${key} did not reach testnet: ${url}`)
    }
    // And the consolidated form, asserted rather than skipped: same estate, reached as a path.
    const pool = viewedSurfaceUrl('pool')
    assert.ok(!pool.includes('.testnet.'), `pool composed the nested form: ${pool}`)
    assert.equal(pool, 'https://testnet.cloudsforge.online/pool')
  })

  it('keeps the money services on ONE network, which is what makes a withdrawal a transaction', () => {
    // Custody signs and the wallet holds the balance being signed for. A signature from one
    // estate against a balance on the other is not a degraded read, it is a broken transaction.
    // Asserted as a RELATIONSHIP rather than two literals, so it cannot pass by coincidence.
    const label = (url: string) => new URL(url).hostname.split('.')[0]?.split('-').slice(1).join('-')
    assert.equal(label(viewedSurfaceUrl('pay')), label(viewedSurfaceUrl('keyvault')))
    assert.equal(label(viewedSurfaceUrl('pay')), label(viewedSurfaceUrl('rpc')))
    assert.equal(label(viewedSurfaceUrl('pay')), 'testnet')
  })

  it('leaves identity and the error ingest on the estate that served this bundle', () => {
    // Not an oversight in either case, and asserted so it survives a tidy-up. The token was minted
    // by the serving estate and is refreshed there; the errors belong to the deployment that
    // produced them, and filing a mainnet bundle's under testnet makes both estates' rates fiction.
    //
    // The assertion is on the SOURCE because both resolvers are private — `nimbusUrl()` in
    // `api.ts`, `ingestUrl()` in `obs.ts` — and the thing worth pinning is which helper they reach
    // for. `test/no-build-time-config.test.ts` is the same shape and exists for the same reason:
    // some invariants are about what the code says, and the only honest test of one is a read.
    for (const file of ['src/lib/api.ts', 'src/lib/obs.ts']) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      assert.ok(
        !source.includes('viewedSurfaceUrl'),
        `${file} resolves a host through viewedSurfaceUrl. Identity and the error ingest belong ` +
          'to the estate serving this bundle, not to the network the reader is looking at — see ' +
          'the header of src/lib/viewed.ts.',
      )
    }
    // And the bases those two resolvers return are unmoved by the switch, which is the behaviour
    // the assertion above is protecting.
    assert.equal(hosts().nimbus, 'https://nimbus.cloudsforge.online')
    assert.equal(hosts().lantern, 'https://lantern.cloudsforge.online')
  })
})

/* ═══════════════════════════════ the other direction, and none ═══════════════════════════════ */

describe('the network the hostname already names', () => {
  it('changes nothing when the reader has not switched', async () => {
    serving({ assignments: [] })
    await loadDepositAddresses(new AbortController().signal)
    assert.equal(askedOnce(), 'https://pay.cloudsforge.online/v1/deposits')
  })

  it('is not made absolute by choosing the network the page is already on', () => {
    // `setViewedNetwork` clears the override rather than storing it, and the composed form must
    // agree with `hosts()` exactly — two spellings of one address is how they drift apart.
    setViewedNetwork('mainnet')
    assert.equal(viewedSurfaceUrl('pay'), 'https://pay.cloudsforge.online')
    assert.equal(viewedSurfaceUrl('wallet'), 'https://hub.cloudsforge.online/wallet')
  })

  it('carries a basePath surface across with its path intact', () => {
    setViewedNetwork('testnet')
    assert.equal(viewedSurfaceUrl('wallet'), 'https://hub-testnet.cloudsforge.online/wallet')
  })

  it('goes the other way too: a testnet hostname viewing mainnet drops the label', () => {
    installWindow(TESTNET_PAGE)
    setViewedNetwork('mainnet')
    assert.equal(viewedSurfaceUrl('pay'), 'https://pay.cloudsforge.online')
    assert.equal(viewedSurfaceUrl('pool'), 'https://cloudsforge.online/pool')
  })

  it('does not switch on localhost, where there is no second estate to switch to', () => {
    // `NetworkSwitcher` hides itself when the network cannot be determined, so this state should
    // not arise — and if it does, a composed `https://pay-testnet.localhost` is an address that
    // resolves nowhere. The dev ports are the only honest answer.
    installWindow('http://localhost:5180/wallet')
    setViewedNetwork('testnet')
    assert.equal(viewedSurfaceUrl('pay'), 'http://localhost:4003')
    assert.equal(viewedSurfaceUrl('rpc'), 'http://localhost:8545')
  })

  it('does not switch on a preview host, for the same reason', () => {
    installWindow('https://pr-42.example.dev/wallet')
    setViewedNetwork('testnet')
    // `pr-42` is not a known subdomain, so the preview host IS its own apex — and a testnet
    // sibling of a preview deployment does not exist.
    assert.equal(viewedSurfaceUrl('pay'), 'https://pay.pr-42.example.dev')
  })
})
