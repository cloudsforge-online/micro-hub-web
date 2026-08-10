/**
 * `micro-wallet` and `micro-custody`, as this bundle actually calls them.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── WHY THIS BUNDLE TALKS TO THEM DIRECTLY, AND NOT THROUGH hub-api ───────────────────────────
 *
 * hub-api serves five routes and every one of them is a read: `/v1/dashboard`, `/v1/portfolio`,
 * `/v1/activity`, `/v1/search`, `/v1/next-actions` (`hub-api/src/server.ts`). **It
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
 * `custody/src/env.ts` and `ui/packages/ui/src/surfaces.test.ts` fails if the two
 * disagree. `custody/.env.example` says `PORT=4005`, which is the value in the registry.
 *
 * `hosts().pay` → the wallet service. NOT pinned, and the honest statement of why: `micro-wallet`
 * binds the service-template default `PORT=4000` (`wallet/.env.example`) and is separated from
 * its neighbours by compose, so the registry's 4003 is an allocation rather than a fact and there
 * is nothing to pin it against. `pay` is the estate's row for the payments API family —
 * `emberkin-web/src/lib/hosts.ts` already resolves billing through it — and the gateway
 * routes wallet's resources by path prefix (`deploy/gateway/dynamic/public-api.yml`), so
 * one host serving both by prefix is consistent with how the public surface is already laid out.
 *
 * **TWO THINGS IN `micro-deploy` HAVE TO BE TRUE BEFORE THIS WORKS IN A BROWSER, AND ARE NOT.**
 * There is no gateway router for `pay.<apex>` or `vault.<apex>` in the working tree, and the
 * routers that do exist for wallet are on the API host, which deliberately carries the security
 * headers WITHOUT the app CORS allowlist ("The API host is not a browser origin for a first-party
 * app", public-api.yml). A first-party browser therefore needs those two hostnames routed
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
 * holdings (`hub-api/src/portfolio.ts`). It simply was not the question. The question is
 * whether an asset settles on a chain, and only one component in the estate answers it.
 *
 * ── ESTABLISHED AGAINST THE RUNNING SERVICE, NOT AGAINST A STUB ───────────────────────────────
 *
 * `wallet/src/withdrawals.ts` calls `chainForAsset` and throws `not_withdrawable` for
 * `null`; `wallet/src/deposits.ts` does the same with `not_depositable`. The map behind
 * both is `CHAIN_FOR_ASSET` (`wallet/src/addresses.ts`), and its file says why SHARD is
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
 * ── THE STALENESS THIS ACCEPTS, AND THE CHECK THAT NOW BOUNDS IT ──────────────────────────────
 *
 * `micro-wallet` serves no route that enumerates its withdrawable assets, so this bundle cannot
 * ask at runtime and must carry the answer. The cost is that adding a sixth chain to wallet
 * leaves it missing from Send until this list ships too. That is the safe direction to be wrong
 * in: an asset absent from a menu is a visible gap somebody reports, whereas an asset present in
 * the menu and refused on submit is a dead end presented to a user as a choice.
 *
 * What it no longer accepts is that the gap goes UNNOTICED. `test/wallet-assets.test.ts` reads
 * `wallet/src/addresses.ts` in the sibling checkout, parses `CHAIN_FOR_ASSET`, and asserts this
 * array equals its keys. So the list is still typed — a browser bundle cannot import a private
 * service's source — but it can no longer drift in silence, in either direction. The test does
 * not skip when the sibling is absent; it fails and says what to check out.
 *
 * ── AND `ON_CHAIN_ASSETS` IS THE WRONG PLACE TO DERIVE IT FROM. THIS WAS TRIED ────────────────
 *
 * The obvious fix was to derive this from `contracts-chain`'s `ON_CHAIN_ASSETS` and stop
 * maintaining it. That would be a defect, and Litecoin was the live proof of it: LTC joined
 * `ON_CHAIN_ASSETS` on 2026-08-05 (`contracts/packages/chain/src/index.ts`) while
 * `micro-wallet` still had no `'ltc'` in `ChainId` and no `LTC` in `CHAIN_FOR_ASSET`, so
 * `chainForAsset('LTC')` was null and both gates refused: `not_withdrawable` at 422
 * (`wallet/src/withdrawals.ts`) and `not_depositable` at 400 (`wallet/src/deposits.ts`).
 * Deriving from `ON_CHAIN_ASSETS` would have put Litecoin in the Send menu and had the service
 * refuse it on submit — the exact dead end this list exists to rule out, shipped in the name of
 * removing a hardcoded list.
 *
 * **LTC IS ON THE LIST NOW, AND HOW IT GOT THERE IS THE POINT.** `micro-wallet` added `ltc` to
 * `ChainId` and `LTC: 'ltc'` to `CHAIN_FOR_ASSET` (`wallet/src/addresses.ts`, commit
 * 87f2251 "a Litecoin address is a Litecoin address, not a Bitcoin one wearing its name"). This
 * array did not move with it, and for a while wallet would move an asset Send did not offer — a
 * capability the user has and cannot reach. **Nobody noticed and nothing broke; the failing check
 * is what found it**, in the direction its own comment predicted would open again on the next
 * chain. The lag is the accepted cost written above; the check is what bounds it.
 *
 * The two arrays still answer different questions — "does the estate custody this asset" and
 * "will wallet move it for this user" — and the second is the only one Send may ask. They are
 * converging and they are not the same. The test asserts this array is a SUBSET of
 * `ON_CHAIN_ASSETS` — a real invariant, because wallet cannot move an asset the estate does not
 * hold — and stops there.
 *
 * ── DOGE AND ETC, AND THE ARGUMENT FOR NOT MARKING THEM UNAVAILABLE ───────────────────────────
 *
 * "The next chain" arrived on 2026-08-08 and it arrived as two. `feat/assets-doge-etc` merged
 * across the estate — `contracts` put `ETC` and `DOGE` in `ON_CHAIN_ASSETS`, `micro-wallet` added
 * `doge` and `etc` to `ChainId` and both codes to `CHAIN_FOR_ASSET` (`wallet/src/addresses.ts`),
 * and `micro-indexer` and `micro-ledger` took their halves. This array did not move, and
 * `test/wallet-assets.test.ts` went red in exactly the direction it was written to watch: wallet
 * moves two assets Send does not offer. That is the whole of the defect, and adding the two codes
 * below is the whole of the fix. Nothing else in this bundle is keyed by asset — decimals are
 * DERIVED per holding (`scaleOf` in `lib/format.ts`), there is deliberately no client-side address
 * validation, no per-asset minimum and no icon set — so there is no second table to follow.
 *
 * **THE HARDER QUESTION WAS WHETHER TO OFFER THEM AS WORKING OPTIONS AT ALL, AND THE ANSWER IS
 * YES — ON EVIDENCE, NOT ON THE DEFAULT.** Both chains are demonstrably unsettleable today:
 *
 *   DOGE  `settlement/src/registry.ts` refuses it by construction rather than implementing it —
 *         `unimplementedChain('doge', 'phase 8 …')`, because that adapter is P2WPKH end to end and
 *         Dogecoin has no segwit at all: every input is committed as a `witnessUtxo` a base58
 *         input cannot be signed as, and `vsize` is priced with the witness discount, which would
 *         under-quote a Dogecoin fee by more than half. Custody derives P2WPKH only, so the
 *         signing half does not exist either.
 *   ETC   The adapter IS written (`evmChain('etc')` — ETC never adopted London, so settlement's
 *         existing legacy `type: 0` builder is already the right shape). What is missing is a
 *         node: `SETTLEMENT_RPC_URLS` carries no `etc` key in any manifest, so every call ends at
 *         `NoEndpointError`. And `micro-ledger`'s `dogecoin_and_classic_chain_assets` migration
 *         says the rest in its own words — "THE ESTATE HAS NO DOGECOIN NODE AND NO ETHEREUM
 *         CLASSIC NODE … no DOGE or ETC deposit has ever been credited at any depth".
 *
 * So why offer them? Because **that is not a fact about DOGE and ETC, it is a fact about this
 * deployment, and it is already true of five of the six codes this array carried before them.**
 * Read on 2026-08-09 rather than assumed: `deploy/compose/docker-compose.estate.yml` sets
 * `WALLET_FEE_QUOTES` to `{"EMBER":…,"LTC":…}` — so a BTC, ETH, SOL or XRP withdrawal is refused
 * 503 `fee_unavailable` before it reaches settlement — and `SETTLEMENT_RPC_URLS` to `ember` plus an
 * optional `ltc`, so every other chain is endpointless. XRP is `unimplementedChain('xrp', 'phase
 * 7 …')` in the same table that refuses DOGE, and XRP has been on this list since it was written.
 * The same ledger migration puts it plainly: "BTC, ETH, SOL and XRP have sat in this table unswept
 * since migration 11 and LTC since 14. DOGE and ETC join them on exactly that footing."
 *
 * Marking two of eight unavailable while the other six carry the identical limitation would be a
 * false distinction shown to a user as a real one. Marking all eight would mean typing settlement's
 * registry and a deployment's environment into a browser bundle that can read neither — a fourth
 * unversioned copy of a fact this file's own header says not to make, and one that would be wrong
 * the day an operator adds an endpoint, silently, with nothing to fail.
 *
 * What actually protects the user is structural rather than editorial, and it is worth stating so
 * nobody adds the banner later believing it was an oversight:
 *
 *   1. **Send is holdings-gated.** `SendPanel` offers `holdings.filter(available !== '0' &&
 *      settlesOnChain(...))`, so a code can only appear once a balance exists. No DOGE or ETC
 *      deposit has ever been credited and the indexer follows neither, so neither can reach the
 *      menu until the estate can observe the chain — which is the same precondition settling it
 *      has.
 *   2. **Receive already ASKS.** It reads `GET /v1/deposits/assets`, which reports `depositable`
 *      with a reason per asset, so DOGE and ETC come back `not_followed` and are never offered.
 *      That is the runtime answer this list cannot give, and it exists on the deposit side only.
 *      BTC is the case worth watching: its node reached tip on 2026-08-10, so it will stop being
 *      `not_followed` the moment an operator adds it to `INDEXER_CHAINS`. It does not become
 *      offerable then — `wallet/src/observability.ts` answers `not_retrievable` until the estate
 *      can also pay BTC out. Nothing here needs changing for that; the point is that this menu
 *      keeps asking rather than knowing.
 *   3. **Every refusal downstream is named and reaches the user.** `fee_unavailable` renders as a
 *      503 with its request id, and `settlement/src/withdrawals.ts` classifies a
 *      `NotImplementedError` as `chain_unsupported` with `refund: 'now'` and the sentence "DOGE
 *      withdrawals are not available yet, so this has been returned to your balance". A missing
 *      endpoint refunds at the deadline. The reservation is what makes that safe: the money sits in
 *      the user's `reserved` account throughout and is returned, never spent.
 *
 * If wallet ever gains a route that states which chains can be SETTLED — it serves none today —
 * this list becomes a runtime question and the argument above expires with it.
 *
 * ── SPARKS ARE NOT ON THIS LIST, AND MUST NEVER BE ────────────────────────────────────────────
 *
 * One Spark is 10⁻⁶ EMBER. A Spark is a DISPLAY DENOMINATION of EMBER — the same relationship a
 * penny has to a pound — and deliberately never a second asset code; `contracts/packages/chain`
 * states that where it defines them, and `EMBER` below already covers everything a Spark
 * denominates. Adding `SPARK` here would re-create the exact defect this list closes.
 *
 * ── THIS PARAGRAPH USED TO CALL SPARKS SHARD'S REPLACEMENT. NOTHING HAS REPLACED SHARD ────────
 *
 * It read: "Shards are being withdrawn estate-wide in favour of EMBER denominated in Sparks …
 * the currency that replaced the one that caused it." The retirement half is true — `SHARD` is in
 * `RETIRED_ASSETS` (`contracts/packages/chain/src/index.ts`). The replacement half is a guess at
 * an open question, and it guesses against the record:
 *
 *   - The two migrations that have actually retired a SHARD price both went to **USD cents** and
 *     both refuse EMBER by name — `mint/src/migrations.ts` (`retire_shard_pricing`) and
 *     `billing/src/migrations.ts` (`retire_shard_prices`).
 *   - Their stated reason is that EMBER's rate is administered rather than discovered
 *     (`pricing/src/rates.ts`, `ADMINISTERED_ASSETS = ['EMBER']`), so a durable figure stored in
 *     EMBER silently restates itself every time an operator edits that one number.
 *   - What is still denominated in Shards — the engagement programme — is micro-org#226, open and
 *     an owner's decision.
 *
 * A sentence naming the destination unit, sitting in the file that decides which assets this app
 * will offer, is the kind of thing a later reader denominates something in. The rule above needs
 * no such claim: `SPARK` is excluded because it is not an asset code, which stays true whatever
 * #226 decides.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export const CHAIN_ASSETS: readonly string[] = Object.freeze([
  'EMBER',
  'BTC',
  'ETH',
  'SOL',
  'XRP',
  'LTC',
  'DOGE',
  'ETC',
])

/**
 * Whether `micro-wallet` will move this asset on a chain — the only assets Send and Receive may
 * offer.
 *
 * Case-sensitive on purpose. `wallet/src/withdrawals.ts` upper-cases before it looks the code
 * up, so `ember` would in fact be accepted; but every code hub-api serves is already upper-case,
 * and quietly accepting a second spelling here would hide a real disagreement between the two
 * services rather than surface it.
 */
export function settlesOnChain(assetCode: string): boolean {
  return CHAIN_ASSETS.includes(assetCode)
}

/* ══════════════════════════════ withdrawals ══════════════════════════════ */

/** Mirrors `WithdrawalRecord`, `wallet/src/withdrawals.ts`. */
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

/** `wallet/src/server.ts` — 201 fresh, 200 with `replayed: true` for a repeat of one key. */
export interface WithdrawalOutcome {
  readonly withdrawal: Withdrawal
  readonly replayed: boolean
}

/** What the user has said they want to do. Every field is submitted exactly as given. */
export interface SendIntent {
  readonly assetCode: string
  readonly destination: string
  /** SMALLEST UNITS, as a decimal string. `wallet/src/server.ts` accepts nothing else. */
  readonly amount: string
}

/**
 * `POST /v1/withdrawals` — `wallet/src/server.ts`.
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

/** Mirrors `AssignmentRecord`, `wallet/src/deposits.ts`. */
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

/** `GET /v1/deposits` — `wallet/src/server.ts`. Every assignment this account holds. */
export const loadDepositAddresses = (
  signal: AbortSignal,
): Promise<{ assignments: readonly DepositAssignment[] }> =>
  wallet<{ assignments: readonly DepositAssignment[] }>('/v1/deposits', { signal })

/**
 * `POST /v1/deposits` — `wallet/src/server.ts`.
 *
 * `rotate` is an explicit ask and defaults to false, mirroring the service: *"Defaulting to it
 * would mint a new address on every page load and leave a trail of addresses nobody was told
 * about."* Asking without it returns the existing active assignment, which is why this is safe to
 * call from a button the user presses to reveal an address.
 */
/** One asset's deposit availability, as `wallet/src/deposits.ts:depositableAssets` reports it. */
export interface DepositableAsset {
  readonly assetCode: string
  readonly chain: string
  readonly depositable: boolean
  /**
   * `null` when depositable. Otherwise one of THREE, and they are three different facts about the
   * deployment rather than three wordings of "no":
   *
   *   * `not_followed`   — the indexer follows no source for this chain. An owner's decision.
   *   * `unknown`        — wallet could not ask the indexer and has no cached answer to fall back
   *                        on. Transient, and the only one of the three that may fix itself.
   *   * `not_retrievable` — the estate can WATCH the chain and has stated no way to pay its native
   *                        asset back out, so it will not take a deposit it could not return.
   *                        Added by micro-org#373 §6.1; read from `WALLET_FEE_QUOTES`.
   *
   * This type says `string` and not a union on purpose: a new reason must not break the build of a
   * bundle already in somebody's browser. Anything unrecognised renders as plain unavailability.
   */
  readonly reason: string | null
}

/**
 * What this deployment can take a deposit in, asked of the service rather than guessed.
 *
 * Receive used to build its menu from the caller's HOLDINGS, and the comment above that line said
 * why it must not: "a receive screen that only offers what you already have cannot be used for the
 * first deposit". The code did it anyway, so a person holding only EMBER was offered only EMBER
 * for ever, and Litecoin was unreachable through the interface however completely the estate
 * supported it.
 *
 * A static list in the bundle was the other option and is worse: it drifts, and it offers assets
 * the service then refuses. This asks whatever `assignDepositAddress` itself would decide.
 */
export const depositableAssets = (): Promise<{
  assets: readonly DepositableAsset[]
  network: string
}> => wallet<{ assets: readonly DepositableAsset[]; network: string }>('/v1/deposits/assets')

export const assignDepositAddress = (
  assetCode: string,
  rotate = false,
): Promise<{ assignment: DepositAssignment }> =>
  wallet<{ assignment: DepositAssignment }>('/v1/deposits', {
    method: 'POST',
    body: rotate ? { assetCode, rotate: true } : { assetCode },
  })

/**
 * A token that arrived at one of this account's deposit addresses and was NOT credited.
 *
 * Mirrors `TokenSightingView`, `wallet/src/deposits.ts`. micro-org#200: somebody sends USDT to
 * their ETH deposit address, the transfer confirms, and until this existed nothing in the estate
 * said so — the money is real, held by a key custody controls, and against no ledger liability.
 *
 * `amount` is UNSCALED and there is deliberately no formatted twin, in the service and therefore
 * here. Nothing in this estate carries the token's decimals — that missing fact is the reason the
 * deposit is not credited in the first place — so dividing by 10^18 to render "0.25" would be this
 * bundle asserting a number the service refused to assert. It is shown as the integer it is,
 * labelled as the integer it is, beside the explorer link that shows the real figure.
 */
export interface TokenSighting {
  readonly id: string
  /** `TOKEN:<chain>:<network>:<contract>`, the estate's chain-token urn. Not a ticker. */
  readonly assetCode: string
  readonly tokenAddress: string
  /** Smallest units, unscaled. See above: no decimals exist to scale it by. */
  readonly amount: string
  readonly chain: string
  readonly network: string
  readonly txHash: string
  readonly txUrn: string
  readonly explorerUrl: string | null
  readonly confirmations: number
  readonly firstSeenAt: string
  /** Always false. Present so this cannot be mistaken for the credits list. */
  readonly credited: false
}

/** `GET /v1/deposits/token-sightings` — `wallet/src/server.ts`. */
export const loadTokenSightings = (
  signal: AbortSignal,
): Promise<{ sightings: readonly TokenSighting[]; nextCursor: string | null }> =>
  wallet<{ sightings: readonly TokenSighting[]; nextCursor: string | null }>(
    '/v1/deposits/token-sightings',
    { signal },
  )

/* ══════════════════════════════ the export ceremony ══════════════════════════════ */

/**
 * Mirrors `ExportRecord`, `custody/src/exports.ts`.
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

/** The formats custody will produce. `custody/src/exports.ts`. */
export const EXPORT_FORMATS = ['keystore', 'mnemonic', 'raw', 'wif', 'xrp_seed'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/** `GET /v1/exports` — `custody/src/server.ts`. */
export const loadKeyExports = (signal: AbortSignal): Promise<{ exports: readonly KeyExport[] }> =>
  custody<{ exports: readonly KeyExport[] }>('/v1/exports', { signal })

/**
 * `POST /v1/exports` — `custody/src/server.ts`. Stage 1, and it starts a 24-hour clock.
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
 * `POST /v1/exports/:id/cancel` — `custody/src/server.ts`.
 *
 * Needs no second factor and is available at every point in the window (05:296). That is the
 * whole point of the cooling-off: the person who did NOT start this has 24 hours to stop it, and
 * a cancel that itself demanded a factor would be useless to someone whose factor was stolen.
 */
export const cancelKeyExport = (id: string): Promise<{ export: KeyExport }> =>
  custody<{ export: KeyExport }>(`/v1/exports/${encodeURIComponent(id)}/cancel`, { method: 'POST' })

/**
 * `POST /v1/exports/:id/challenge` — `custody/src/server.ts`. Returns the reveal token ONCE.
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
 * `POST /v1/exports/:id/redeem` — `custody/src/server.ts`. **The one route that returns a key.**
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
