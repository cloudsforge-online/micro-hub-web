/**
 * The response bodies the journey scenarios render, shaped like the ones the services send.
 *
 * ── Every shape here was read off the interface this bundle declares for it ────────────────────
 *
 * Not off a document, and not invented. `src/lib/hub.ts` mirrors `hub-api/src/dashboard.ts` field
 * for field and cites the line each block came from; `src/lib/money.ts` does the same for
 * `micro-wallet` and `micro-custody`. A fixture that drifted from those would make every scenario
 * below assert against a payload no service sends — which is the defect doc 22 §1 records this
 * estate producing repeatedly, and it is why `test/hub.test.ts` and `test/api.test.ts` exist.
 *
 * The one rule these fixtures follow: **a fixture never carries a value the scenario asserts as a
 * literal.** Every scenario reads the figure it expects OUT of the fixture it supplied, so a
 * fixture and an assertion cannot agree with each other while both being wrong about the page.
 * The self-referential assertion — a page compared against the same constant it rendered from —
 * is a failure this estate has already shipped once.
 */
import type {
  Dashboard,
  DashboardTiles,
  DepositCredit,
  Holding,
  PortfolioView,
  WalletRecord,
  WithdrawalRecord,
} from '../src/lib/hub.ts'
import type { KeyExport, RevealedKey, TokenSighting, Withdrawal } from '../src/lib/money.ts'
import type { PoolChain, PoolSummary } from '../src/lib/pool.ts'
import type { Tile } from '../src/lib/tile.ts'

/* ══════════════════════════════ tiles ══════════════════════════════ */

/** A healthy tile. `ok`, uncached, with the data the scenario supplied. */
export const ok = <T,>(data: T, upstream = 'wallet'): Tile<T> => ({
  status: 'ok',
  upstream,
  reason: null,
  cached: false,
  ageMs: null,
  data,
})

/**
 * A tile that did not answer.
 *
 * `data` still holds the tile's EMPTY value, which is the whole point of hub-api's design and the
 * trap it exists to spring: `src/lib/tile.ts` — "an `unavailable` wallets tile carries `[]`,
 * and `[]` drawn without its status reads as 'you have no wallets' — a confident, wrong statement
 * about somebody's money". A fixture that omitted `data` would make that untestable.
 */
export const unavailable = <T,>(empty: T, upstream: string, reason: string): Tile<T> => ({
  status: 'unavailable',
  upstream,
  reason,
  cached: false,
  ageMs: null,
  data: empty,
})

/** A tile with data that is not current. It HAS an answer; it lacks confidence. */
export const degraded = <T,>(data: T, upstream: string, reason: string): Tile<T> => ({
  status: 'degraded',
  upstream,
  reason,
  cached: false,
  ageMs: null,
  data,
})

/* ══════════════════════════════ the pieces ══════════════════════════════ */

export const OWN_ADDRESS = '0xa11ce0000000000000000000000000000000beef'
export const OTHER_ADDRESS = '0xb0b0000000000000000000000000000000cafe11'
/**
 * The same address as `OTHER_ADDRESS` with one case flipped.
 *
 * It exists for exactly one scenario: BJ-WAL-08's guard was proven by inserting a `.toLowerCase()`
 * between the confirmation step and the wire, and a fixture whose address has no upper-case
 * character could not tell the two apart.
 */
export const MIXED_CASE_ADDRESS = '0xB0b0000000000000000000000000000000CaFe11'

/**
 * One holding, EMBER, eighteen decimals.
 *
 * `amount` and `amountFormatted` are a matched pair on purpose: `src/lib/format.ts`
 * RECOVERS the asset's scale by finding the unique `d` for which `parse(amountFormatted, d)`
 * reproduces `amount`. A fixture whose two halves disagreed would make `scaleOf` answer null and
 * silently put every Send scenario onto the smallest-units path — which is a different screen.
 */
export const holding = (over: Partial<Holding> = {}): Holding => ({
  assetCode: 'EMBER',
  amount: '2500000000000000000',
  amountFormatted: '2.5',
  available: '2500000000000000000',
  reserved: '0',
  usdScaled: '500000',
  usd: '5.00',
  allocationBps: 10000,
  quotedAt: '2026-08-03T09:00:00.000Z',
  priceReason: null,
  /*
    `administered`, because this fixture's asset is EMBER and EMBER has no exchange listing —
    pricing answers `source: "administered"` for it and hub-api passes that through
    (`hub-api/src/portfolio.ts`). A fixture that said `market` here would be a fixture of a response
    the estate cannot produce, and every scenario built on it would be showing a screen no reader
    ever sees. Scenarios that want a market-priced holding pass `assetCode` and `priceSource`
    together.
  */
  priceSource: 'administered',
  ...over,
})

export const portfolio = (over: Partial<PortfolioView> = {}): PortfolioView => ({
  totalUsdScaled: '500000',
  totalUsd: '5.00',
  pricedAt: '2026-08-03T09:00:00.000Z',
  pricingComplete: true,
  holdings: [holding()],
  allocation: [],
  // EMBER always leads, then whatever else is held — hub-api's order, mirrored here so a fixture
  // cannot assert a row the service would never send.
  coins: [{ assetCode: 'EMBER', amount: '2500000000000000000', amountFormatted: '2.5' }],
  ...over,
})

export const wallet = (over: Partial<WalletRecord> = {}): WalletRecord => ({
  id: 'wal-0000-0000-0000-000000000001',
  userId: USER_ID,
  origin: 'managed',
  chain: 'hearth',
  network: 'mainnet',
  address: OWN_ADDRESS,
  label: 'Main wallet',
  isPrimary: true,
  status: 'active',
  custodyKeyUrn: 'urn:cf:key:hearth:1',
  createdAt: '2026-01-01T00:00:00.000Z',
  verifiedAt: null,
  exportedAt: null,
  retiredAt: null,
  ...over,
})

export const deposit = (over: Partial<DepositCredit> = {}): DepositCredit => ({
  id: 'dep-0000-0000-0000-000000000001',
  assetCode: 'EMBER',
  amount: '1000000000000000000',
  amountFormatted: '1',
  chain: 'hearth',
  network: 'mainnet',
  txHash: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  txUrn: 'urn:cf:tx:hearth:mainnet:0xdead',
  explorerUrl: null,
  confirmations: 3,
  credited: false,
  ...over,
})

export const withdrawalRecord = (over: Partial<WithdrawalRecord> = {}): WithdrawalRecord => ({
  id: 'wd-0000-0000-0000-000000000001',
  userId: USER_ID,
  chain: 'hearth',
  network: 'mainnet',
  assetCode: 'EMBER',
  destination: OTHER_ADDRESS,
  amount: '1000000000000000000',
  amountFormatted: '1',
  fee: '10000000000000000',
  net: '990000000000000000',
  netFormatted: '0.99',
  state: 'queued',
  txHash: null,
  failureReason: null,
  requestedAt: '2026-08-03T09:30:00.000Z',
  updatedAt: '2026-08-03T09:30:00.000Z',
  ...over,
})

/** What `POST /v1/withdrawals` answers. `wallet/src/withdrawals.ts`. */
export const withdrawal = (over: Partial<Withdrawal> = {}): Withdrawal => ({
  id: 'wd-0000-0000-0000-000000000009',
  chain: 'hearth',
  network: 'mainnet',
  assetCode: 'EMBER',
  destination: OTHER_ADDRESS,
  amount: '1000000000000000000',
  amountFormatted: '1',
  fee: '10000000000000000',
  net: '990000000000000000',
  netFormatted: '0.99',
  state: 'requested',
  txHash: null,
  failureReason: null,
  requestedAt: '2026-08-03T09:30:00.000Z',
  ...over,
})

export const keyExport = (over: Partial<KeyExport> = {}): KeyExport => ({
  id: 'exp-0000-0000-0000-000000000001',
  address: OWN_ADDRESS,
  status: 'cooling_off',
  format: 'keystore',
  requestedAt: '2026-08-03T08:00:00.000Z',
  availableAt: '2026-08-04T08:00:00.000Z',
  expiresAt: '2026-08-10T08:00:00.000Z',
  challengedAt: null,
  tokenExpiresAt: null,
  redeemedAt: null,
  cancelledAt: null,
  policyDecision: 'allow',
  policyReasons: [],
  ...over,
})

export const revealed = (over: Partial<RevealedKey> = {}): RevealedKey => ({
  address: OWN_ADDRESS,
  chain: 'hearth',
  network: 'mainnet',
  scheme: 'secp256k1',
  derivationPath: "m/44'/60'/0'/0/0",
  format: 'keystore',
  // Distinctive on purpose: the storage assertion greps for this exact string, and a value that
  // could occur by accident would make that assertion pass for the wrong reason.
  material: 'KEYMATERIAL-a7f3c19e-NEVER-STORED',
  ...over,
})

/* ══════════════════════════════ the dashboard ══════════════════════════════ */

export const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/** An empty tile set. Individual scenarios override the one tile they are about. */
function emptyTiles(): DashboardTiles {
  return {
    portfolio: ok(portfolio({ holdings: [] }), 'ledger+pricing'),
    prices: ok([], 'pricing'),
    wallets: ok([], 'wallet'),
    deposits: ok([], 'wallet'),
    withdrawals: ok([], 'wallet'),
    activity: ok([], 'activity'),
    security: ok(null, 'identity'),
    restrictions: ok([], 'policy'),
    entitlements: ok(
      { entitlements: [], subscriptions: [] } as unknown as DashboardTiles['entitlements']['data'],
      'billing',
    ),
    alerts: ok([], 'identity'),
    notifications: ok(
      { unread: 0, items: [] } as unknown as DashboardTiles['notifications']['data'],
      'notify',
    ),
  }
}

export function dashboard(over: Partial<DashboardTiles> = {}): Dashboard {
  const tiles = { ...emptyTiles(), ...over }
  return {
    userId: USER_ID,
    generatedAt: '2026-08-03T09:31:00.000Z',
    budgetMs: 800,
    elapsedMs: 42,
    tiles,
    /*
      `missing` is present and empty, and the `as unknown as` cast that used to stand here is gone.
      `NextActions` (src/lib/hub.ts) declares two fields and this fixture supplied one of them plus
      a `generatedAt` the interface does not have; the cast made that compile. `pages/overview.tsx`
      reads `nextActions.missing.length` unconditionally — it is how "we could not ask" is told
      apart from "nothing is waiting on you" — so any scenario mounting that page against this
      fixture threw on the first render, which is how the omission was found.
    */
    nextActions: { actions: [], missing: [] },
    // Derived from the tiles rather than passed in, so a scenario cannot arrange a dashboard whose
    // banner disagrees with its own tiles — which is a state hub-api cannot produce.
    degraded: Object.entries(tiles)
      .filter(([, tile]) => (tile as Tile<unknown>).status !== 'ok')
      .map(([name]) => name),
  }
}

/**
 * The dashboard a Send scenario needs: one spendable holding and one of this account's wallets.
 *
 * `holdings` and `wallets` are supplied together because the Send form reads both — the holding
 * for what can be sent and its scale, the wallet list for whether a destination is one of this
 * account's own (`components/send.tsx, 90`).
 */
export const sendableDashboard = (over: Partial<DashboardTiles> = {}): Dashboard =>
  dashboard({
    portfolio: ok(portfolio(), 'ledger+pricing'),
    wallets: ok([wallet()], 'wallet'),
    ...over,
  })

/* ══════════════════════════════ identity ══════════════════════════════ */

/** `identity/src/server.ts` — what a completed sign-in answers. */
export const session = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  accessToken: 'access-token-from-identity',
  refreshToken: 'refresh-token-from-identity',
  expiresIn: 900,
  user: { id: USER_ID, handle: 'alice', email: 'alice@example.com' },
  ...over,
})

/** `identity/src/server.ts` — a password accepted and nothing else established. */
export const mfaRequired = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  mfaRequired: true,
  challenge: 'challenge-abc123',
  factors: [{ id: 'f1', kind: 'totp', label: 'Authenticator' }],
  ...over,
})

/**
 * The estate's error envelope. `hub-api/src/server.ts`, `identity/src/server.ts`
 * and `service-template/src/server.ts` are the same three lines.
 */
export const errorBody = (
  code: string,
  message: string,
  fields: readonly { field: string; code: string; message: string }[] = [],
  requestId = 'cf-req-0042',
): Record<string, unknown> => ({
  error: { code, message, requestId, ...(fields.length > 0 ? { fields } : {}) },
})

/**
 * One token that landed on a deposit address and was not credited.
 * `GET /v1/deposits/token-sightings`, `wallet/src/deposits.ts`.
 *
 * `amount` is deliberately a figure no reader could confuse with a scaled one, and it is NOT a
 * round power of ten: a scenario that asserts the raw integer reaches the page has to be able to
 * fail when somebody divides it, and `1000000000000000000` renders as a plausible "1" either way.
 */
export const tokenSighting = (over: Partial<TokenSighting> = {}): TokenSighting => ({
  id: 'ts-0000-0000-0000-000000000001',
  assetCode: 'TOKEN:ethereum:mainnet:0xdac17f958d2ee523a2206206994597c13d831ec7',
  tokenAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  amount: '250731000',
  chain: 'ethereum',
  network: 'mainnet',
  txHash: '0x5f2c1d4e8a9b0c3d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d',
  txUrn: 'cf:tx:ethereum:mainnet:0x5f2c1d4e',
  explorerUrl: 'https://etherscan.io/tx/0x5f2c1d4e',
  confirmations: 12,
  firstSeenAt: '2026-08-09T18:04:00.000Z',
  credited: false,
  ...over,
})

/* ══════════════════════════════ the pool ══════════════════════════════ */

/**
 * micro-pool describing itself, as `GET /v1/pool` answers. `src/lib/pool.ts` declares the shape.
 *
 * ── WHY A POOL FIXTURE LIVES IN THE SHARED FILE NOW ───────────────────────────────────────────
 *
 * Because the SHELL reads this route, on every address. `src/mining/session.tsx` owns the browser
 * mining session above the router so the control in the bar can start and stop one thing from
 * anywhere, and it asks the pool what it is as soon as it mounts. That makes `GET /v1/pool` part of
 * the scenery of every scenario that mounts `AppShell` — the account menu, the consent banner, the
 * held session — none of which are about mining. A scenario that leaves it unrouted is not neutral:
 * `test/dom.ts` throws, the provider's rejection handler swallows the throw, and the bar settles
 * into the "the pool could not be reached" state the scenario never arranged and does not know it
 * is asserting against.
 *
 * `test/mine.test.ts` deliberately keeps its own copy rather than importing this. Its scenarios vary
 * one chain field at a time and read every expected value back out of the object they supplied; a
 * shared default that each of them overrode would be a fixture in name only, and the mining page is
 * the one surface where the pool's shape IS the subject.
 *
 * The default describes ONE MINEABLE CHAIN, which is the estate as measured on 2026-08-11: LTC has
 * a published browser endpoint and a template, and it is the only chain a browser is offered. That
 * is also the state in which the bar's control has something to offer, so a scenario that wanted a
 * refusal has to say so rather than inheriting one.
 *
 * `browserMining` is deliberately ABSENT from this default rather than set to `{available: true}`.
 * A pool older than micro-org#360 omits the key, and the default fixture is the place that keeps
 * this app honest about tolerating one: with it absent, every scenario built on this fixture is
 * exercising the compatibility path, and `test/mine.test.ts` — which varies the field on purpose —
 * is where the field's own behaviour is pinned.
 */
export const poolChain = (over: Partial<PoolChain> = {}): PoolChain => ({
  chain: 'ltc',
  name: 'Litecoin',
  asset: 'LTC',
  decimals: 8,
  algorithm: 'scrypt',
  stratumPort: 3333,
  // Null, and not a plausible-looking `stratum+tcp://…`. micro-org#285 is the defect where a
  // derived address that could not connect was published on a public page; a fixture that carried
  // one would let a scenario pass while the page showed exactly that.
  stratumEndpoint: null,
  websocketEndpoint: 'wss://pool.example.test/v1/pool/stratum/ltc',
  connections: 2,
  height: 2_900_001,
  networkDifficulty: 41_000_000,
  templateAgeSeconds: 4,
  ready: true,
  windowSeconds: 600,
  sharesInWindow: 128,
  workersInWindow: 3,
  hashrateEstimate: 51_200,
  ...over,
})

/**
 * The pool's own summary.
 *
 * `payoutsImplemented` is false, which is not a convenience: `pool/src/payouts.ts` holds two
 * independent gates that refuse settlement, the service derives this flag from them, and a fixture
 * that said otherwise would let a surface claim a payment the estate cannot make.
 */
export const poolSummary = (over: Partial<PoolSummary> = {}): PoolSummary => ({
  network: 'mainnet',
  feeBasisPoints: 100,
  pplnsWindowMultiplier: 2,
  payoutsImplemented: false,
  chains: [poolChain()],
  ...over,
})
