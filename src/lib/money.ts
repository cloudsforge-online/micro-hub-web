/**
 * `micro-wallet` and `micro-custody`, as this bundle actually calls them.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── WHY THIS BUNDLE TALKS TO THEM DIRECTLY, AND NOT THROUGH hub-api ───────────────────────────
 *
 * hub-api serves five routes and every one of them is a read: `/v1/dashboard`, `/v1/portfolio`,
 * `/v1/activity`, `/v1/search`, `/v1/next-actions` (`hub-api/src/server.ts:285-421`). **It
 * composes no mutation of any kind.** So a Send button routed through the BFF would need a sixth
 * hub-api route that does not exist, and inventing a client for a route nobody serves is exactly
 * how `wallet/src/pricingclient.ts` came to call a `/v1/quotes` that has never existed.
 *
 * The estate already has the pattern for this: `lib/api.ts`'s `nimbus()` calls identity
 * cross-origin for the two things only identity owns, and `pages/security.tsx` revokes sessions
 * against identity directly *"on purpose"* — a proxy in the middle would make every sign-out in
 * the estate look like it came from hub-api. The same reasoning holds here twice over: a
 * withdrawal is authorised against the user's own token, and custody's export ceremony reads
 * `amr` and `auth_time` off that token (`custody/src/exports.ts`, gates 4 and 6). A service
 * credential in front of it could not carry either.
 *
 * ── THE TWO HOSTS, AND WHERE THEY COME FROM ───────────────────────────────────────────────────
 *
 * `hosts().keyvault` → custody. VERIFIED: the registry pins that row's dev port to
 * `custody/src/env.ts:188` and `ui/packages/ui/src/surfaces.test.ts:196` fails if the two
 * disagree. `custody/.env.example:60` says `PORT=4005`, which is the value in the registry.
 *
 * `hosts().pay` → the wallet service. NOT pinned, and the honest statement of why: `micro-wallet`
 * binds the service-template default `PORT=4000` (`wallet/.env.example:50`) and is separated from
 * its neighbours by compose, so the registry's 4003 is an allocation rather than a fact and there
 * is nothing to pin it against. `pay` is the estate's row for the payments API family —
 * `emberkin-web/src/lib/hosts.ts:108-114` already resolves billing through it — and the gateway
 * routes wallet's resources by path prefix (`deploy/gateway/dynamic/public-api.yml:118-124`), so
 * one host serving both by prefix is consistent with how the public surface is already laid out.
 *
 * **TWO THINGS IN `micro-deploy` HAVE TO BE TRUE BEFORE THIS WORKS IN A BROWSER, AND ARE NOT.**
 * There is no gateway router for `pay.<apex>` or `vault.<apex>` in the working tree, and the
 * routers that do exist for wallet are on the API host, which deliberately carries the security
 * headers WITHOUT the app CORS allowlist ("The API host is not a browser origin for a first-party
 * app", public-api.yml:66-69). A first-party browser therefore needs those two hostnames routed
 * with the `cf-cors` middleware. That is a deploy change, it is recorded in this repository's
 * README, and it is not something this bundle can paper over with a different URL.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import { hosts } from './hosts.ts'
import { IDEMPOTENCY_HEADER } from './idempotency.ts'
import { request, type RequestOptions } from './api.ts'

/** The wallet service. Cross-origin from Hub, always. */
const wallet = <T,>(path: string, opts?: RequestOptions): Promise<T> =>
  request<T>(hosts().pay, path, opts)

/** Custody — the key service. Also cross-origin, and it is the one that holds private keys. */
const custody = <T,>(path: string, opts?: RequestOptions): Promise<T> =>
  request<T>(hosts().keyvault, path, opts)

/* ══════════════════════════════ which assets move on a chain ══════════════════════════════ */

/**
 * The asset codes `micro-wallet` will actually deposit and withdraw.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── WHY THIS LIST IS HERE AT ALL, AND WHAT IT REPLACED ────────────────────────────────────────
 *
 * Send and Receive both used to select their assets with `/^[A-Z]+$/.test(assetCode)`, under a
 * comment claiming that a SHARD row "would be offered and then refused by the service". The
 * comment described the right behaviour and the regex did not implement it: `SHARD` is nothing
 * but uppercase letters, so it matched, and Send offered a Shard withdrawal that `micro-wallet`
 * refuses. The code disagreed with its own documentation, and the documentation was right.
 *
 * The regex was not pointless — it excluded the `TOKEN:<urn>` codes that hub-api also serves as
 * holdings (`hub-api/src/portfolio.ts:43`). It simply was not the question. The question is
 * whether an asset settles on a chain, and only one component in the estate answers it.
 *
 * ── ESTABLISHED AGAINST THE RUNNING SERVICE, NOT AGAINST A STUB ───────────────────────────────
 *
 * `wallet/src/withdrawals.ts:283-290` calls `chainForAsset` and throws `not_withdrawable` for
 * `null`; `wallet/src/deposits.ts:163-172` does the same with `not_depositable`. The map behind
 * both is `CHAIN_FOR_ASSET` (`wallet/src/addresses.ts:66-73`), and its file says why SHARD is
 * absent: "Shards are a platform unit with no chain, so asking for their deposit address must
 * fail rather than fall through to a default."
 *
 * That reading of the source was then CONFIRMED against the live estate, through the real
 * gateway, because a frontend harness that stubs every response cannot see a service refuse an
 * asset. `POST /v1/withdrawals` for each code in turn:
 *
 *   EMBER, BTC, ETH, SOL, XRP  → 422 `invalid_address`   (past the asset gate; the probe address
 *                                                         was deliberately wrong for the chain)
 *   SHARD, USD, TOKEN:…        → 422 `not_withdrawable`  ("… does not settle on a chain")
 *
 * `USD` is the reason this is an allowlist rather than `assetCode !== 'SHARD'`: it is also plain
 * uppercase, it is also refused, and a denylist would have to grow a new entry every time the
 * estate invents another off-chain unit — which is the defect above, recurring on a timer.
 *
 * ── THE STALENESS THIS ACCEPTS, DELIBERATELY ──────────────────────────────────────────────────
 *
 * `micro-wallet` serves no route that enumerates its withdrawable assets, so this bundle cannot
 * ask and must carry the answer. The cost is that adding a sixth chain to wallet leaves it
 * missing from Send until this list ships too. That is the safe direction to be wrong in: an
 * asset absent from a menu is a visible gap somebody reports, whereas an asset present in the
 * menu and refused on submit is a dead end presented to a user as a choice.
 *
 * ── SPARKS ARE NOT ON THIS LIST, AND MUST NEVER BE ────────────────────────────────────────────
 *
 * Shards are being withdrawn estate-wide in favour of EMBER denominated in Sparks, where one
 * Spark is 10⁻⁶ EMBER. A Spark is a DISPLAY DENOMINATION of EMBER — the same relationship a penny
 * has to a pound — and deliberately never a second asset code. `EMBER` below already covers it.
 * Adding `SPARK` here would re-create the exact defect this list closes, in the currency that
 * replaced the one that caused it.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export const CHAIN_ASSETS: readonly string[] = Object.freeze(['EMBER', 'BTC', 'ETH', 'SOL', 'XRP'])

/**
 * Whether `micro-wallet` will move this asset on a chain — the only assets Send and Receive may
 * offer.
 *
 * Case-sensitive on purpose. `wallet/src/withdrawals.ts:283` upper-cases before it looks the code
 * up, so `ember` would in fact be accepted; but every code hub-api serves is already upper-case,
 * and quietly accepting a second spelling here would hide a real disagreement between the two
 * services rather than surface it.
 */
export function settlesOnChain(assetCode: string): boolean {
  return CHAIN_ASSETS.includes(assetCode)
}

/* ══════════════════════════════ withdrawals ══════════════════════════════ */

/** Mirrors `WithdrawalRecord`, `wallet/src/withdrawals.ts:114-133`. */
export interface Withdrawal {
  readonly id: string
  readonly chain: string
  readonly network: string
  readonly assetCode: string
  /** The address the payment is going to. Compare it with what the user confirmed. */
  readonly destination: string
  readonly amount: string
  readonly amountFormatted: string
  readonly fee: string
  readonly net: string
  readonly netFormatted: string
  readonly state: string
  readonly txHash: string | null
  readonly failureReason: string | null
  readonly requestedAt: string
}

/** `wallet/src/server.ts:676` — 201 fresh, 200 with `replayed: true` for a repeat of one key. */
export interface WithdrawalOutcome {
  readonly withdrawal: Withdrawal
  readonly replayed: boolean
}

/** What the user has said they want to do. Every field is submitted exactly as given. */
export interface SendIntent {
  readonly assetCode: string
  readonly destination: string
  /** SMALLEST UNITS, as a decimal string. `wallet/src/server.ts:1014-1020` accepts nothing else. */
  readonly amount: string
}

/**
 * `POST /v1/withdrawals` — `wallet/src/server.ts:645`.
 *
 * ── THE DESTINATION SUBMITTED IS THE DESTINATION THAT WAS CONFIRMED ───────────────────────────
 *
 * `intent` is the object the confirmation step RENDERED. It is passed through untouched — not
 * re-read from a form field, not re-normalised, not trimmed, not case-folded. A form that shows
 * one address and submits another is the single most expensive defect a frontend can have here,
 * and the only way to make that impossible is for the rendered value and the submitted value to
 * be the same object. `test/money.test.ts` asserts the body byte-for-byte against the object the
 * confirmation was given.
 *
 * There is deliberately no client-side address validation. Which addresses are well formed for a
 * chain is a rule, the rule lives in `wallet/src/withdrawals.ts` and the chain packages, and a
 * copy here would be a second opinion that refuses payments the service would have accepted.
 */
export const requestWithdrawal = (
  intent: SendIntent,
  idempotencyKey: string,
): Promise<WithdrawalOutcome> =>
  wallet<WithdrawalOutcome>('/v1/withdrawals', {
    method: 'POST',
    body: intent,
    headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
  })

/* ══════════════════════════════ deposits ══════════════════════════════ */

/** Mirrors `AssignmentRecord`, `wallet/src/deposits.ts:76-91`. */
export interface DepositAssignment {
  readonly id: string
  readonly assetCode: string
  readonly chain: string
  readonly network: string
  readonly walletId: string
  readonly address: string
  readonly status: 'active' | 'rotated' | 'retired'
  readonly assignedAt: string
  /**
   * Null until the indexer has been told to watch this address. wallet's own comment: "An
   * unwatched address produces no events" — so a deposit sent to it would arrive on chain and
   * never be credited. The receive screen says so rather than showing the address as ready.
   */
  readonly watchedAt: string | null
}

/** `GET /v1/deposits` — `wallet/src/server.ts:624`. Every assignment this account holds. */
export const loadDepositAddresses = (
  signal: AbortSignal,
): Promise<{ assignments: readonly DepositAssignment[] }> =>
  wallet<{ assignments: readonly DepositAssignment[] }>('/v1/deposits', { signal })

/**
 * `POST /v1/deposits` — `wallet/src/server.ts:604`.
 *
 * `rotate` is an explicit ask and defaults to false, mirroring the service: *"Defaulting to it
 * would mint a new address on every page load and leave a trail of addresses nobody was told
 * about."* Asking without it returns the existing active assignment, which is why this is safe to
 * call from a button the user presses to reveal an address.
 */
export const assignDepositAddress = (
  assetCode: string,
  rotate = false,
): Promise<{ assignment: DepositAssignment }> =>
  wallet<{ assignment: DepositAssignment }>('/v1/deposits', {
    method: 'POST',
    body: rotate ? { assetCode, rotate: true } : { assetCode },
  })

/* ══════════════════════════════ the export ceremony ══════════════════════════════ */

/**
 * Mirrors `ExportRecord`, `custody/src/exports.ts:90-104`.
 *
 * `status` is the stage: `requested` → `cooling_off` → `challenged` → `redeemed`, or `cancelled`
 * or `denied`. It is a string rather than a union on purpose — a status this build has not heard
 * of must render as itself rather than crash a page about somebody's private key.
 */
export interface KeyExport {
  readonly id: string
  readonly address: string
  readonly status: string
  readonly format: string
  readonly requestedAt: string
  /** When the 24-hour cooling-off ends. Null while the request is not holding. */
  readonly availableAt: string | null
  readonly expiresAt: string
  readonly challengedAt: string | null
  readonly tokenExpiresAt: string | null
  readonly redeemedAt: string | null
  readonly cancelledAt: string | null
  /** `allow`, `deny`, `challenge` or `review`, straight from micro-policy. */
  readonly policyDecision: string | null
  readonly policyReasons: readonly string[]
}

/** The formats custody will produce. `custody/src/exports.ts:62-64`. */
export const EXPORT_FORMATS = ['keystore', 'mnemonic', 'raw', 'wif', 'xrp_seed'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/** `GET /v1/exports` — `custody/src/server.ts:497`. */
export const loadKeyExports = (signal: AbortSignal): Promise<{ exports: readonly KeyExport[] }> =>
  custody<{ exports: readonly KeyExport[] }>('/v1/exports', { signal })

/**
 * `POST /v1/exports` — `custody/src/server.ts:474`. Stage 1, and it starts a 24-hour clock.
 *
 * custody refuses unless the token's `amr` carries BOTH `pwd` and `mfa`
 * (`custody/src/exports.ts`, the `reauthentication_required` and `mfa_required` refusals), and it
 * records a policy `deny`, `challenge` or `review` as a `denied` request rather than as a
 * half-open ceremony: *"a ceremony left open on either would be one an attacker can return to."*
 * So a 201 whose body says `status: 'denied'` is a real answer and not a success — the screen
 * reads the record, never the status code.
 */
export const requestKeyExport = (
  address: string,
  format: ExportFormat,
): Promise<{ export: KeyExport }> =>
  custody<{ export: KeyExport }>('/v1/exports', { method: 'POST', body: { address, format } })

/**
 * `POST /v1/exports/:id/cancel` — `custody/src/server.ts:518`.
 *
 * Needs no second factor and is available at every point in the window (05:296). That is the
 * whole point of the cooling-off: the person who did NOT start this has 24 hours to stop it, and
 * a cancel that itself demanded a factor would be useless to someone whose factor was stolen.
 */
export const cancelKeyExport = (id: string): Promise<{ export: KeyExport }> =>
  custody<{ export: KeyExport }>(`/v1/exports/${encodeURIComponent(id)}/cancel`, { method: 'POST' })

/**
 * `POST /v1/exports/:id/challenge` — `custody/src/server.ts:534`. Returns the reveal token ONCE.
 *
 * Gate 6: the second factor must have been answered *just now* — custody compares the token's
 * `auth_time` against its own token TTL and refuses a session that presented a factor a day ago.
 * A caller that has not signed in again in the last few minutes gets `stale_authentication`, and
 * the screen says so rather than showing a dead button.
 *
 * The token is held in memory by the caller and never written to storage: it is a bearer secret
 * that yields a private key, and `localStorage` survives the tab.
 */
export const challengeKeyExport = (
  id: string,
): Promise<{ export: KeyExport; revealToken: string }> =>
  custody<{ export: KeyExport; revealToken: string }>(
    `/v1/exports/${encodeURIComponent(id)}/challenge`,
    { method: 'POST' },
  )

/** What custody hands back on redemption. `custody/src/exports.ts`, the tail of `redeemExport`. */
export interface RevealedKey {
  readonly address: string
  readonly chain: string
  readonly network: string
  readonly scheme: string
  readonly derivationPath: string | null
  readonly format: string
  /** The key material. Delivered once, in a `no-store` response, and never logged. */
  readonly material: string
}

/**
 * `POST /v1/exports/:id/redeem` — `custody/src/server.ts:554`. **The one route that returns a key.**
 *
 * Single-use by construction: the redemption spends the token and moves the wallet to `exported`
 * in one transaction, so a replay updates no row and returns nothing. Nothing in this app may
 * retry it automatically, and nothing may store what it returns.
 */
export const redeemKeyExport = (
  id: string,
  revealToken: string,
  passphrase?: string,
): Promise<{ export: RevealedKey }> =>
  custody<{ export: RevealedKey }>(`/v1/exports/${encodeURIComponent(id)}/redeem`, {
    method: 'POST',
    body: passphrase === undefined ? { revealToken } : { revealToken, passphrase },
  })
