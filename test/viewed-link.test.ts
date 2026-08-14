/**
 * THE NETWORK SURVIVES A PRODUCT SWITCH — the carrier half, on the reading side.
 *
 * *"if you select testnet and switch product you are back to mainnet"*
 *
 * `@cloudsforge/ui` composes the outgoing link with `?net=`, because every surface is its own
 * origin and neither storage nor the hostname can carry the reader's choice across one: the
 * combined view retired the testnet frontends, so `hub-testnet.<apex>` 302s straight back to
 * `hub.<apex>`. This file asserts the other end of that — that arriving here with the parameter
 * actually re-points what the bundle READS, and that nothing else about it changed.
 *
 * ── WHY EVERY CASE RE-IMPORTS THE MODULE ──────────────────────────────────────────────────────
 *
 * The seed is read ONCE, at module load, which is the property that makes it a carrier rather
 * than a store — so a test that imports `viewed.ts` at the top of the file could only ever
 * observe the first window it happened to see. Each case installs its window first and then
 * imports a FRESH copy (the `?case=` suffix defeats the module cache), which is exactly what a
 * browser does on a cross-origin navigation.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { installWindow, removeWindow } from './browser-stubs.ts'

let seq = 0

/** A fresh `viewed.ts`, loaded as a browser would load it at `url`. */
async function loadAt(url: string): Promise<typeof import('../src/lib/viewed.ts')> {
  installWindow(url)
  seq += 1
  return (await import(`../src/lib/viewed.ts?case=${seq}`)) as typeof import('../src/lib/viewed.ts')
}

afterEach(() => {
  removeWindow()
})

describe('the network a link arrived carrying', () => {
  it('is what the reader is viewing, on a mainnet hostname', async () => {
    const m = await loadAt('https://hub.cloudsforge.online/wallet?net=testnet')
    assert.equal(m.viewedNetwork(), 'testnet')
    // The whole point: the reads move with it. Not just the label in the bar.
    assert.equal(m.viewedApiOrigin(), 'https://hub-testnet.cloudsforge.online')
    assert.equal(m.viewedSurfaceUrl('wallet'), 'https://hub-testnet.cloudsforge.online/wallet')
  })

  it('works in the other direction too', async () => {
    const m = await loadAt('https://hub-testnet.cloudsforge.online/wallet?net=mainnet')
    assert.equal(m.viewedNetwork(), 'mainnet')
    assert.equal(m.viewedApiOrigin(), 'https://hub.cloudsforge.online')
  })

  it('is ignored when it agrees with the hostname, so reads stay relative', async () => {
    // `?net=mainnet` on a mainnet page is agreement, not an override. Recording it as an override
    // would send this bundle's own calls out to an absolute origin — a needless preflight on
    // every request, and a cross-origin one at that.
    const m = await loadAt('https://hub.cloudsforge.online/wallet?net=mainnet')
    assert.equal(m.viewedNetwork(), 'mainnet')
    assert.equal(m.viewedApiOrigin(), '')
  })

  it('is ignored when it is absent or nonsense', async () => {
    // A malformed link must not change what a signed-in page shows.
    for (const search of ['', '?asset=ltc', '?net=', '?net=maiinet', '?net=MAINNET']) {
      const m = await loadAt(`https://hub.cloudsforge.online/wallet${search}`)
      assert.equal(m.viewedNetwork(), 'mainnet', search)
      assert.equal(m.viewedApiOrigin(), '', search)
    }
  })

  it('does nothing off-registry, where there is no sibling estate', async () => {
    const m = await loadAt('http://localhost:3010/wallet?net=testnet')
    assert.equal(m.viewedNetwork(), 'mainnet')
    assert.equal(m.viewedApiOrigin(), '')
    // `viewedSurfaceUrl` refuses to invent a sibling on a host it does not understand.
    assert.equal(m.viewedSurfaceUrl('wallet'), 'http://localhost:3010/wallet')
  })

  it('is a starting point, not a lock — the switcher still wins', async () => {
    const m = await loadAt('https://hub.cloudsforge.online/wallet?net=testnet')
    m.setViewedNetwork('mainnet')
    assert.equal(m.viewedNetwork(), 'mainnet')
    assert.equal(m.viewedApiOrigin(), '')
  })

  it('is read, never written back', async () => {
    // Nothing persists: the parameter is a statement the LINK made for one navigation, which is
    // what keeps the estate's no-stored-network invariant intact. If this ever starts calling
    // history.replaceState, that decision needs its own argument.
    const browser = installWindow('https://hub.cloudsforge.online/wallet?net=testnet')
    seq += 1
    await import(`../src/lib/viewed.ts?case=${seq}`)
    assert.deepEqual(browser.replaced, [])
    assert.deepEqual(browser.assigned, [])
  })
})

/**
 * AND THE CHOICE SURVIVES A RELOAD, BECAUSE THE ADDRESS BAR CARRIES IT.
 *
 *     "if we have testnet selected and we refresh the page it goes to mainnet"   — 2026-08-14
 *
 * Every case above passed while that was true and none of them could have caught it: they all read
 * the module memory that a reload throws away. The mechanism is `keepNetworkInTheAddressBar` in
 * `@cloudsforge/ui/network-view`, tested there against a full history stub; what these two cases
 * pin is THIS module's wiring to it — that the switch writes, and that a fresh load at what was
 * written is viewing what the reader had on screen.
 */
describe('the viewed network survives a reload', () => {
  it('is written into the address bar when the reader switches', async () => {
    const browser = installWindow('https://hub.cloudsforge.online/wallet')
    seq += 1
    const m = (await import(`../src/lib/viewed.ts?case=${seq}`)) as typeof import('../src/lib/viewed.ts')
    m.setViewedNetwork('testnet')
    // In place: a switch is not a place in the reader's history.
    assert.deepEqual(browser.replaced, ['/wallet?net=testnet'])
  })

  it('and a fresh load at that address is viewing testnet — the reload, end to end', async () => {
    const m = await loadAt('https://hub.cloudsforge.online/wallet?net=testnet')
    assert.equal(m.viewedNetwork(), 'testnet')
    assert.equal(m.viewedApiOrigin(), 'https://hub-testnet.cloudsforge.online')
  })

  it('and switching back leaves the URL as it was found', async () => {
    const browser = installWindow('https://hub.cloudsforge.online/wallet')
    seq += 1
    const m = (await import(`../src/lib/viewed.ts?case=${seq}`)) as typeof import('../src/lib/viewed.ts')
    m.setViewedNetwork('testnet')
    m.setViewedNetwork('mainnet')
    // The parameter means "not what the hostname says", so on a mainnet page its absence IS
    // mainnet — and the reader who switches back has the address they arrived with.
    assert.deepEqual(browser.replaced, ['/wallet?net=testnet', '/wallet'])
  })
})
