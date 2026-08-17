/**
 * The Wallet page's coin cards, after micro-org#485 — *"useless text also"* — and micro-org#481.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE THREE CLAIMS THE REDESIGN MAKES, AND WHY EACH NEEDS A TEST RATHER THAN A SCREENSHOT
 *
 *   1. **§2, every asset row carries balance, network and address.** Three facts from three
 *      different reads joined on one card. A card that quietly dropped one would still look like a
 *      card, and the one it drops is invisible until somebody goes looking for it — which is
 *      exactly how "in overview no bitcoin address exist again (i already discuss this with you
 *      twice)" got reported a third time.
 *   2. **§2, "an asset showing nothing must say why in one line a person can act on".** There are
 *      three different nothings — the ledger did not answer, you hold none and have an address,
 *      you hold none and have no address — and they take three different sentences with three
 *      different next moves. Collapsing them tells somebody their Bitcoin is gone because a read
 *      timed out. Each scenario below asserts the ABSENCE of the other two sentences, because a
 *      screen printing all three would pass any one of them taken alone.
 *   3. **micro-org#481, a refused coin is drawn and not dropped.** *"I don't see any dogecoin
 *      reference in the wallet."* DOGE has been in `GET /v1/deposits/assets` the whole time and
 *      every surface filtered it out on `depositable: false`. The honest answer is a visible DOGE
 *      card that says why it cannot be used yet, so the assertion is that the ticker is ON the
 *      page — an assertion that fails the moment somebody re-adds a filter.
 *
 * ── WHAT IS ARRANGED HERE AND WHAT IS TRANSCRIBED ─────────────────────────────────────────────
 *
 * Every sentence asserted on screen is either put into the fixture by this file (wallet's `detail`
 * prose, the balances, the addresses) or is prose this bundle authors and the scenario names in
 * full. Nothing imports a display constant from `src/` and checks the page equals it: that shape
 * of test is green for every possible value, including the wrong one.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Reply, type Routes, type Screen } from './dom.ts'
import * as fx from './fixtures.ts'
import { __resetAuth } from '../src/lib/api.ts'
import { AddressBook } from '../src/components/addressbook.tsx'
import { WalletPage } from '../src/pages/wallet.tsx'
import type { Holding } from '../src/lib/hub.ts'
import type { Absence } from '../src/lib/tile.ts'
import type { DepositAssignment } from '../src/lib/money.ts'

const MAINNET = 'https://hub.cloudsforge.online'
const TESTNET = 'https://hub-testnet.cloudsforge.online'
const fresh = (): void => __resetAuth()

const SIGNED_IN = { 'cf.accessToken': 'held-access-token', 'cf.refreshToken': 'held-refresh-token' }

/**
 * A real bech32 Bitcoin address rather than `0xdeadbeef`.
 *
 * The card prints the destination verbatim and these scenarios search the rendered text for it, so
 * a fixture that could not be a Bitcoin address would prove the card renders SOMETHING rather than
 * that it renders the address.
 */
const BTC_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'

const assignment = (over: Partial<DepositAssignment> = {}): DepositAssignment => ({
  id: 'dep-btc-1',
  assetCode: 'BTC',
  chain: 'btc',
  network: 'mainnet',
  walletId: 'wal-1',
  address: BTC_ADDRESS,
  status: 'active',
  assignedAt: '2026-08-01T10:00:00.000Z',
  watchedAt: '2026-08-01T10:00:04.000Z',
  ...over,
})

/**
 * The deposit catalogue, shaped as `wallet/src/deposits.ts:depositableAssets` answers it after
 * micro-wallet#26 — `detail` beside `reason`, and `network` beside the list.
 *
 * The DOGE sentence is the service's own prose, put here by this scenario. It is the string the
 * card must print: hard-coding a DIFFERENT one in the component is the failure mode #481 is about,
 * because then the screen and the 503 a person gets when they ask for an address disagree.
 */
const DOGE_DETAIL = 'we do not follow the doge chain, so a deposit could not be observed or credited'

const catalogue = (over: Record<string, unknown> = {}) => ({
  body: {
    network: 'mainnet',
    assets: [
      { assetCode: 'EMBER', chain: 'hearth', depositable: true, reason: null, detail: null },
      { assetCode: 'BTC', chain: 'btc', depositable: true, reason: null, detail: null },
      {
        assetCode: 'DOGE',
        chain: 'doge',
        depositable: false,
        reason: 'not_followed',
        detail: DOGE_DETAIL,
      },
    ],
    ...over,
  },
})

const holding = (over: Partial<Holding> = {}): Holding => fx.holding(over)

/** The panel, mounted the way the Wallet page mounts it: with balances, under a router. */
const book = (
  balances: readonly Holding[] | undefined,
  balanceAbsent: Absence | null = null,
) =>
  h(
    MemoryRouter,
    { initialEntries: ['/wallet'] },
    h(AddressBook, balances === undefined ? {} : { balances, balanceAbsent }),
  )

/**
 * `assets` is a `Reply`, not `ReturnType<typeof catalogue>`.
 *
 * Two scenarios below hand it a catalogue a DIFFERENT wallet answers with — one that predates the
 * `detail` field and so omits it entirely — and inferring the parameter from the default value
 * would make "the field is missing" a compile error instead of the case under test. The whole
 * point of those scenarios is that this bundle meets a body it did not write.
 */
const bookAt = (
  assignments: readonly DepositAssignment[],
  assets: Reply = catalogue(),
  origin: string = MAINNET,
) => ({
  url: `${origin}/wallet`,
  storage: SIGNED_IN,
  routes: {
    'GET /v1/deposits/assets': assets,
    'GET /v1/deposits': { body: { assignments } },
  } as Routes,
})

/** The one `<li>` whose text names this coin. Cards are list items; they are found by their words. */
function card(s: Screen, name: string): string {
  const found = s.allByRole('listitem').filter((li) => s.textOf(li).includes(name))
  assert.equal(
    found.length,
    1,
    `expected exactly one card naming "${name}", found ${found.length}. The page holds: ` +
      s.allByRole('listitem').map((li) => JSON.stringify(s.textOf(li).slice(0, 40))).join(', '),
  )
  return s.textOf(found[0])
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   §2. Balance, network, address — the three facts, on one card.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('one coin, three facts', () => {
  it('carries the balance, the network and the address together', async () => {
    fresh()
    await withScreen(
      book([holding({ assetCode: 'BTC', amountFormatted: '0.0125', reserved: '0' })]),
      bookAt([assignment()]),
      async (s) => {
        await s.settle()
        const btc = card(s, 'Bitcoin')

        // The figure, from this scenario's own holding.
        assert.match(btc, /0\.0125/, `the balance is not on the Bitcoin card: "${btc}"`)
        assert.ok(btc.includes('BTC'), 'the figure is printed without its unit')
        // The network, from this scenario's own assignment.
        assert.ok(btc.includes('mainnet'), `the network is not on the card: "${btc}"`)
        // The address, in full. A shortened deposit address is a destination somebody can copy and
        // lose money to, so the ellipsis check is on the whole page rather than the card.
        assert.ok(btc.includes(BTC_ADDRESS), 'the address this account holds was not printed')
        assert.ok(!s.text().includes('…'), 'an ellipsis appeared on a screen that prints addresses')

        // And the free/reserved split says which, because a figure that is partly spoken for and
        // says nothing is the one a person over-commits.
        assert.match(btc, /free to spend/i)
        s.clean('a funded coin card')
      },
    )
  })

  it('names the network on a coin with no address yet, which is where it used to be missing', async () => {
    // The network used to come off `assignment.network`, so a coin nobody had asked for an address
    // for showed none — and those are exactly the cards carrying the button that mints one. The
    // deployment's own answer stands in, off the same read that lists the asset.
    fresh()
    await withScreen(book([]), bookAt([]), async (s) => {
      await s.settle()
      const btc = card(s, 'Bitcoin')
      assert.ok(btc.includes('mainnet'), `a coin with no address names no network: "${btc}"`)
      assert.ok(
        s.queryByRole('button', /Get my Bitcoin address/i) !== null,
        'the card names Bitcoin and offers no way to get an address, which is the reported defect',
      )
      s.clean('an unassigned coin card')
    })
  })

  it('says testnet where the wallet answered testnet, and does not say mainnet', async () => {
    // The catalogue's own `network`, not the hostname and not a constant: a testnet deployment
    // answering `mainnet` here would be a bug in the service, and this card must repeat what it
    // was told rather than what it assumed.
    fresh()
    await withScreen(
      book([]),
      bookAt([], catalogue({ network: 'testnet' }), TESTNET),
      async (s) => {
        await s.settle()
        const btc = card(s, 'Bitcoin')
        assert.ok(btc.includes('testnet'), `the testnet card does not say testnet: "${btc}"`)
        assert.ok(
          !btc.replace(/testnet/g, '').includes('mainnet'),
          `a testnet card also says mainnet: "${btc}"`,
        )
        s.clean('a testnet coin card')
      },
    )
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   §2. The three nothings, which must not read alike.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('a coin showing nothing says which nothing it is', () => {
  it('holds none and has an address: the next move is to send to it', async () => {
    fresh()
    await withScreen(book([]), bookAt([assignment()]), async (s) => {
      await s.settle()
      const btc = card(s, 'Bitcoin')
      assert.match(btc, /None held/i, `an empty balance said nothing at all: "${btc}"`)
      assert.match(btc, /Send to the address below/i, 'the line offers no next move')
      assert.ok(
        !/could not read your balances/i.test(btc),
        'an answered ledger was drawn as an unread one',
      )
      s.clean('an empty balance with an address')
    })
  })

  it('holds none and has no address: the next move is to get one', async () => {
    fresh()
    await withScreen(book([]), bookAt([]), async (s) => {
      await s.settle()
      const btc = card(s, 'Bitcoin')
      assert.match(btc, /None held/i)
      assert.match(btc, /Get an address below/i, 'the line points at an address that is not there')
      assert.ok(
        !/Send to the address below/i.test(btc),
        'the card told somebody to send to an address it had not given them',
      )
      s.clean('an empty balance with no address')
    })
  })

  it('could not read the ledger: it says so, and names where it could not read', async () => {
    // `lib/tile.ts`'s rule on the screen that can least afford to break it. "None held" for a read
    // that timed out tells somebody with a funded address that their money is gone.
    fresh()
    const reason = 'the ledger did not answer within the budget'
    await withScreen(
      book([], { upstream: 'ledger', reason }),
      bookAt([assignment()]),
      async (s) => {
        await s.settle()
        const btc = card(s, 'Bitcoin')
        assert.ok(btc.includes(reason), `the card does not carry the upstream's own reason: "${btc}"`)
        assert.ok(
          !/None held/i.test(btc),
          'AN UNREAD BALANCE WAS DRAWN AS AN EMPTY ONE — the exact defect lib/tile.ts names',
        )
        // And it says what has NOT happened, which is the part that stops somebody acting on it.
        assert.match(btc, /Nothing has changed about what you hold/i)
        s.clean('an unread balance')
      },
    )
  })

  it('refuses to print a figure it cannot scale, and does not call it nothing', async () => {
    // `amountFormatted` is null for a `TOKEN:` asset, whose decimals no service in the fan-out can
    // supply. Drawing that as "None held" reports a balance somebody HAS as one they do not.
    fresh()
    await withScreen(
      book([holding({ assetCode: 'BTC', amount: '12345', amountFormatted: null })]),
      bookAt([assignment()]),
      async (s) => {
        await s.settle()
        const btc = card(s, 'Bitcoin')
        assert.ok(!/None held/i.test(btc), 'an unscalable holding was drawn as no holding')
        assert.match(btc, /decimal places/i, 'the card gives no reason for the missing figure')
        assert.ok(!btc.includes('12345'), 'the smallest-unit integer was printed as a balance')
        s.clean('an unscalable holding')
      },
    )
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   micro-org#481. The coin the estate cannot take is on the page anyway.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('a coin the estate cannot take yet', () => {
  it('is on the screen, by name, with the service’s own reason', async () => {
    fresh()
    await withScreen(book([]), bookAt([]), async (s) => {
      await s.settle()
      // THE REPORTED DEFECT, VERBATIM: "I don't see any dogecoin reference in the wallet." The row
      // was in the response the whole time and the panel filtered it out on `depositable: false`.
      assert.ok(
        s.text().includes('Dogecoin'),
        'the deposit catalogue names DOGE and the wallet page does not contain the word Dogecoin',
      )
      const doge = card(s, 'Dogecoin')
      // wallet's own sentence, put on the wire by this scenario — so the screen and the 503 a
      // person gets when they ask for a DOGE address cannot disagree.
      assert.ok(
        doge.toLowerCase().includes(DOGE_DETAIL.toLowerCase()),
        `the card does not carry the service's explanation: "${doge}"`,
      )
      // Not behind a disclosure triangle: a reader looking for Dogecoin does not open a summary
      // that does not say "Dogecoin".
      assert.equal(
        s.document.querySelectorAll('details').length,
        0,
        'the refused coins went back behind a <details>, which is the same defect with a triangle',
      )
      s.clean('a refused coin')
    })
  })

  it('offers no button that would fail, and keeps the ones that would not', async () => {
    fresh()
    await withScreen(book([]), bookAt([]), async (s) => {
      await s.settle()
      assert.equal(
        s.queryByRole('button', /Get my Dogecoin address/i),
        null,
        'a card that explains why it cannot be used still offered the control that cannot work',
      )
      assert.ok(s.queryByRole('button', /Get my Bitcoin address/i) !== null)
      s.clean('a refused coin’s controls')
    })
  })

  it('still shows a balance held in it, because the coin is not the thing that is shut', async () => {
    fresh()
    await withScreen(
      book([holding({ assetCode: 'DOGE', amountFormatted: '4200' })]),
      bookAt([]),
      async (s) => {
        await s.settle()
        const doge = card(s, 'Dogecoin')
        // `4,200` and not `4200`: `formatAmount` groups thousands, and pinning the grouped form is
        // the difference between asserting the figure and asserting that some digits are present.
        assert.match(doge, /4,200/, `a balance on a refused coin was hidden: "${doge}"`)
        assert.ok(doge.includes('DOGE'), 'the figure was printed without its unit')
        // And it says the money is unaffected, which is the question a person actually has.
        assert.match(doge, /Still yours/i)
        s.clean('a balance on a refused coin')
      },
    )
  })

  it('falls back to its own prose against a wallet older than micro-wallet#26', async () => {
    // A deployment running a wallet without `detail` answers without the field, and `undefined` is
    // not a sentence. The local prose is keyed on `reason`, which that wallet does send.
    fresh()
    const older = {
      body: {
        network: 'mainnet',
        assets: [
          { assetCode: 'EMBER', chain: 'hearth', depositable: true, reason: null },
          { assetCode: 'DOGE', chain: 'doge', depositable: false, reason: 'not_followed' },
        ],
      },
    }
    await withScreen(book([]), bookAt([], older), async (s) => {
      await s.settle()
      const doge = card(s, 'Dogecoin')
      assert.ok(!doge.includes('undefined'), 'the card printed `undefined` at somebody')
      assert.match(
        doge,
        /not watching this chain yet/i,
        `an unexplained refusal is not actionable: "${doge}"`,
      )
      s.clean('a refusal from an older wallet')
    })
  })

  it('does not treat a transient failure as a permanent one', async () => {
    // `unknown` means wallet could not ask the indexer and has no cached answer. Telling somebody
    // Bitcoin is unsupported on the strength of it is a lie that lasts until they reload.
    fresh()
    const flaky = {
      body: {
        network: 'mainnet',
        assets: [
          { assetCode: 'EMBER', chain: 'hearth', depositable: true, reason: null, detail: null },
          { assetCode: 'BTC', chain: 'btc', depositable: false, reason: 'unknown', detail: null },
        ],
      },
    }
    await withScreen(book([]), bookAt([], flaky), async (s) => {
      await s.settle()
      const btc = card(s, 'Bitcoin')
      assert.match(btc, /Reload/i, `a transient refusal offers no next move: "${btc}"`)
      assert.ok(
        !/not watching this chain/i.test(btc),
        'a chain we could not ask about was reported as one we do not follow',
      )
      s.clean('a transient refusal')
    })
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   §1 and §3, on the whole page: no paragraph in front of the balances, one address, one network.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('the Wallet page around the cards', () => {
  const walletPage = (origin: string = MAINNET) => ({
    element: h(MemoryRouter, { initialEntries: ['/wallet'] }, h(WalletPage)),
    options: {
      url: `${origin}/wallet`,
      storage: SIGNED_IN,
      routes: {
        'GET /v1/dashboard': {
          body: fx.dashboard({
            portfolio: fx.ok(fx.portfolio({ holdings: [holding({ assetCode: 'BTC' })] }), 'ledger+pricing'),
            deposits: fx.ok([], 'wallet'),
            withdrawals: fx.ok([], 'wallet'),
            wallets: fx.ok([], 'wallet'),
          }),
        },
        'GET /v1/exports': { body: { exports: [] } },
        'GET /v1/deposits/token-sightings': { body: { sightings: [], nextCursor: null } },
        'GET /v1/deposits/assets': catalogue(),
        'GET /v1/deposits': { body: { assignments: [assignment()] } },
      } as Routes,
    },
  })

  it('names the network the figures were read from, in the head', async () => {
    fresh()
    const { element, options } = walletPage(TESTNET)
    await withScreen(element, options, async (s) => {
      await s.settle()
      // §3: no amount on this page may be ambiguous between the two estates, and the head is where
      // that claim is made for the page as a whole. The reads all go out through
      // `viewedApiOrigin()`, so this is a statement about where the figures came from.
      // Anchored, because three headings on this page contain the word "wallet" — the page title,
      // the managed-wallet panel, and the note about connecting an external one.
      const head = s.textOf(s.byRole('heading', /^Wallet$/).parentElement)
      assert.ok(head.includes('testnet'), `the page head does not name the network: "${head}"`)
      s.clean('the wallet head')
    })
  })

  it('prints each deposit address exactly once', async () => {
    // `AddressBook` and `ReceivePanel` both draw held addresses. Stacked, they printed the same
    // eight destinations twice — the complaint, reproduced. `compact` narrows the second one to
    // the job nothing else does.
    fresh()
    const { element, options } = walletPage()
    await withScreen(element, options, async (s) => {
      await s.settle()
      const body = s.text()
      const occurrences = body.split(BTC_ADDRESS).length - 1
      assert.equal(occurrences, 1, `the deposit address appears ${occurrences} times on one page`)
      s.clean('the wallet page')
    })
  })

  it('opens with the coins rather than with a paragraph about them', async () => {
    // #485 §1: *"a wallet page shows balances, addresses and the two actions without a paragraph in
    // front of each"*. The two paragraphs that used to stand here were a custody claim naming three
    // coins and every chain's confirmation depth; the second now sits inside Arriving, beside the
    // counts it explains, and this scenario has nothing arriving — so it must not be on the page.
    fresh()
    const { element, options } = walletPage()
    await withScreen(element, options, async (s) => {
      await s.settle()
      assert.ok(
        !/thirty on\s+Dogecoin/i.test(s.text()),
        'the confirmation-depth paragraph is on a page with nothing confirming',
      )
      s.before(
        'Your coins',
        'Send',
        'the balances and addresses have to come before the send form — they are what the page is for',
      )
      s.clean('the wallet page opening')
    })
  })
})
