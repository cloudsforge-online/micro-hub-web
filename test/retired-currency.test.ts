/**
 * NO RETIRED CURRENCY GETS A HEADLINE TILE ON THE TWO SCREENS THAT SHOW WHAT YOU HOLD.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * The owner reported it by LOOKING AT THE PRODUCT, twice. The Overview page's portfolio row read
 *
 *     TOTAL HELD   $0.10        SHARDS   0        EMBER   1,073.18217159        ASSETS   1
 *
 * and the second report said what was actually wrong with it: *"again we have in overview of the
 * account shards, we should have the real coins there."* Five hundred and thirty-nine tests ran
 * green over that screen on the same day.
 *
 * They missed it for the reason `mint-web/test/retired-currency.test.ts` sets out at length: every
 * assertion in this suite was written FORWARDS. `test/portfolio.test.ts` fed the fixture a
 * `shards` field and asserted the tile rendered it. The tile was green BECAUSE the word was there.
 * A suite made only of forward assertions cannot notice retired vocabulary — it pins it in place.
 *
 * ── WHAT WAS AND WAS NOT WRONG WITH THE OLD TILE ──────────────────────────────────────────────
 *
 * The number was TRUE. `hub-api/src/portfolio.ts` summed the ledger's own SHARD balances and the
 * label said "Shards" over them. This is NOT the mislabel micro-org#227 swept for, where copy said
 * "Shards" over data that was USD cents or a season reward, and the long comment that used to
 * stand on this tile defending it was right about that much.
 *
 * What it was wrong about is that a HEADLINE TILE IS A PROMOTION. SHARD is retired —
 * `RETIRED_ASSETS`, `contracts/packages/chain/src/index.ts` — so nothing new may ever be
 * denominated in it and no reader of this page can be paid in one again. Giving it two of the four
 * slots at the top of the estate's most-read screen, in the place where somebody's Bitcoin
 * belongs, is a claim about what matters here rather than a report of what the ledger holds.
 *
 * ── SO THIS FILE DRAWS THE LINE AT PROMOTION, NOT AT THE WORD ─────────────────────────────────
 *
 * A retired holding is still a real ledger row and still appears in "Every holding" with its
 * amount, its value and its share. Measured on mainnet 2026-08-11: thirteen user liability
 * accounts hold 1,000 SHARD each against one custody account of 13,000; testnet holds none. Hiding
 * those rows would be the worse defect — a balance that exists and is not shown — and the last
 * assertion below asserts they are NOT hidden, so this file can never be "satisfied" by deleting
 * the holdings table.
 *
 * ── WHY IT READS RENDERED TEXT AND NEVER SOURCE ───────────────────────────────────────────────
 *
 * A grep over `src/` would match this file's own header and the comments on both pages that
 * explain the decision. It would be green because of its own justification, and it would STAY
 * green if every tile it protects were deleted. So this mounts the real pages with the real
 * fixtures and reads `screen.text()`. `site/test/estate-claims.test.ts` counts five shipped
 * instances of the failure this avoids — "an nginx header quoting the directive it forbids".
 *
 * ── WHY THE WORD LIST COMES FROM `micro-contracts` ────────────────────────────────────────────
 *
 * Hardcoding /shards?/ here would make a second list to keep current, and the next asset wound
 * down would be caught by `contracts` and missed by this file. It is PARSED from a sibling
 * checkout rather than imported, because this is a browser bundle and `micro-contracts` is not a
 * dependency of it — the same technique, for the same reason, as `test/wallet-assets.test.ts`, and
 * it does not skip when the checkout is absent for the same reason either.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes, type Screen } from './dom.ts'
import * as fx from './fixtures.ts'
import { PortfolioPage } from '../src/pages/portfolio.tsx'
import { OverviewPage } from '../src/pages/overview.tsx'

const ORIGIN = 'https://hub.cloudsforge.online'
const SIGNED_IN = { 'cf.accessToken': 'held-access-token', 'cf.refreshToken': 'held-refresh-token' }

const page = (element: ReactElement, path: string): ReactElement =>
  h(MemoryRouter, { initialEntries: [path] }, element)

/** `contracts/packages/chain/src/index.ts`, in the sibling checkout CI lays out as `contracts`. */
const CONTRACTS = fileURLToPath(new URL('../../contracts/packages/chain/src/index.ts', import.meta.url))

/**
 * The asset codes `micro-contracts` calls retired.
 *
 * Throws rather than returning nothing on a shape change, because a regex that had degraded to an
 * empty capture would make every assertion below vacuously true — in the repository that did not
 * move. That is the exact failure `test/wallet-assets.test.ts` was red for within minutes of a
 * micro-wallet merge, and the reason it says "re-point this parser — do not delete the check".
 */
function retiredAssets(): readonly string[] {
  if (!existsSync(CONTRACTS)) {
    throw new Error(
      `${CONTRACTS} is missing. Check micro-contracts out as 'contracts' beside this repository — ` +
        'this test does not skip, because a retired asset promoted back to a headline tile is ' +
        'invisible to every other test here.',
    )
  }
  const source = readFileSync(CONTRACTS, 'utf8')
  const list = /RETIRED_ASSETS:[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/.exec(source)
  if (!list?.[1]) {
    throw new Error(
      'contracts no longer declares RETIRED_ASSETS as a frozen array literal. Read ' +
        'packages/chain/src/index.ts and re-point this parser — do not delete the check.',
    )
  }
  const codes = [...list[1].matchAll(/'([A-Z][A-Z0-9]*)'/g)].map((m) => m[1] as string)
  if (codes.length === 0) throw new Error('RETIRED_ASSETS parsed to nothing')
  return codes
}

/**
 * A portfolio holding a retired asset AND two real coins, which is the case that has to work.
 *
 * A fixture holding only real coins would pass against a page that still rendered a Shards tile
 * from a field that happened to be absent, so the retired holding is present and non-zero on
 * purpose: the tile row must exclude it while the table below includes it.
 */
const RETIRED_HOLDING = fx.holding({
  assetCode: 'SHARD',
  amount: '1000',
  amountFormatted: '1000',
  available: '1000',
  usd: '10.00',
  usdScaled: '10000000',
  priceSource: null,
})

const BITCOIN = fx.holding({
  assetCode: 'BTC',
  amount: '100000000',
  amountFormatted: '1',
  available: '100000000',
  usd: '60000.00',
  usdScaled: '60000000000',
  priceSource: 'market',
})

const EMBER = fx.holding({
  assetCode: 'EMBER',
  amount: '1073182171590000000000',
  amountFormatted: '1073.18217159',
  available: '1073182171590000000000',
  usd: '1073.18',
  usdScaled: '1073180000',
  priceSource: 'administered',
})

/**
 * The view hub-api would actually send for that account.
 *
 * `coins` carries EMBER and BTC and NOT the retired holding, because hub-api decides the tile row
 * — `headlineCoins`, which asks `isRetiredAsset` rather than naming SHARD. Written out here rather
 * than derived, so that a change to hub-api's ordering shows up as a red test in this repository
 * instead of silently agreeing with itself.
 */
const VIEW = fx.portfolio({
  holdings: [BITCOIN, EMBER, RETIRED_HOLDING],
  totalUsd: '61083.18',
  totalUsdScaled: '61083180000',
  coins: [
    { assetCode: 'EMBER', amount: '1073182171590000000000', amountFormatted: '1073.18217159' },
    { assetCode: 'BTC', amount: '100000000', amountFormatted: '1' },
  ],
})

const overview = {
  element: page(h(OverviewPage), '/'),
  options: {
    url: `${ORIGIN}/`,
    storage: SIGNED_IN,
    routes: {
      'GET /v1/dashboard': { body: fx.dashboard({ portfolio: fx.ok(VIEW, 'ledger+pricing') }) },
    } as Routes,
  },
}

const portfolio = {
  element: page(h(PortfolioPage), '/portfolio'),
  options: {
    url: `${ORIGIN}/portfolio`,
    storage: SIGNED_IN,
    routes: {
      'GET /v1/portfolio': { body: { portfolio: fx.ok(VIEW, 'ledger+pricing') } },
    } as Routes,
  },
}

/**
 * The tile row's own text, isolated from the holdings table below it.
 *
 * `StatTile` renders its label, so the row is addressed by the labels that must be in it and the
 * one that must not. Reading the whole page instead would conflate "SHARD has a tile" with "SHARD
 * has a table row", and this file's whole point is that the second is allowed.
 */
function tileLabels(screen: Screen): string[] {
  return [...screen.document.querySelectorAll('.wt-tiles .cf-tile__label')].map((node) =>
    (node.textContent ?? '').trim(),
  )
}

describe('no retired asset is promoted to a headline tile', () => {
  it('parses micro-contracts to something, so nothing below can be vacuous', () => {
    const retired = retiredAssets()
    assert.ok(retired.length > 0)
    // The fixture must actually exercise the rule. If SHARD is one day removed from `AssetCode`
    // entirely, this line goes red and whoever does that re-points the fixture at whatever is
    // retired then — rather than leaving a file that asserts nothing about nothing.
    assert.ok(
      retired.includes(RETIRED_HOLDING.assetCode),
      `${RETIRED_HOLDING.assetCode} is no longer retired; re-point this fixture at one that is`,
    )
  })

  for (const [name, screenSpec] of [
    ['the Overview', overview],
    ['the Portfolio page', portfolio],
  ] as const) {
    it(`${name} gives its tiles to real coins and not to a retired one`, async () => {
      await withScreen(screenSpec.element, screenSpec.options, async (s) => {
        const labels = tileLabels(s)

        // ── The check, in the direction that fails today.
        for (const code of retiredAssets()) {
          assert.ok(
            !labels.some((label) => label.toUpperCase().startsWith(code)),
            `${code} still has a headline tile on ${name}: ${JSON.stringify(labels)}`,
          )
        }

        // ── And the pair, so this cannot be satisfied by rendering no tiles at all. A page with
        // an empty tile row would pass the loop above and would be a worse screen than the one
        // being fixed.
        assert.ok(labels.includes('EMBER'), `${name} lost its EMBER tile: ${JSON.stringify(labels)}`)
        assert.ok(labels.includes('BTC'), `${name} did not show the Bitcoin actually held`)
        assert.ok(
          s.text().includes('1,073.18217159'),
          'the EMBER figure the API sent is not on the page',
        )
      })
    })
  }

  it('still shows the retired balance in the holdings table, where it is a fact and not a promotion', async () => {
    // The line this file will not let anyone cross. Somebody holds these; a screen that silently
    // drops a real ledger row is the defect the Shards tile was defended against in the first
    // place, and it would be the easy way to make every assertion above green.
    await withScreen(portfolio.element, portfolio.options, async (s) => {
      const rows = [...s.document.querySelectorAll('.wt-table tbody tr th')].map((node) =>
        (node.textContent ?? '').trim(),
      )
      assert.ok(
        rows.includes(RETIRED_HOLDING.assetCode),
        `the ${RETIRED_HOLDING.assetCode} holding vanished from the table: ${JSON.stringify(rows)}`,
      )
      assert.ok(s.text().includes('$10.00'), 'its value went with it')
    })
  })
})
