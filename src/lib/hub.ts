/**
 * hub-api, as this bundle actually calls it.
 *
 * ── Every route below was read off hub-api's own route table ───────────────────────────────────
 *
 * Not off a shared client, not off a specification, and not off an expectation. The estate has
 * already paid for the alternative once: `wallet/src/pricingclient.ts` calls `GET /v1/quotes`,
 * which pricing has never served — the rate board is `GET /rates` — and it is item 7 on
 * hub-api's own gap list. A client written against an imagined surface fails at runtime, in
 * production, on the one screen that reads it.
 *
 * So each function carries the `hub-api/src/server.ts` line its path and its response shape were
 * verified against. If one of them moves, the citation is how the next person finds out.
 *
 *   GET /v1/dashboard      server.ts   → Dashboard          (dashboard.ts)
 *   GET /v1/portfolio      server.ts   → { portfolio: Tile<PortfolioView> }  (line 338)
 *   GET /v1/activity       server.ts   → a FLAT page, not a Tile  (lines 377-387)
 *   GET /v1/search         server.ts   → SearchResponse     (search.ts)
 *   GET /v1/next-actions   server.ts   → NextActions        (nextactions.ts)
 *
 * There are five. **hub-api serves no wallet route, no security route, no settings route and no
 * entitlements route** — those four pages are drawn from tiles of `/v1/dashboard`, plus, for the
 * things identity alone owns, direct calls to identity listed at the bottom of this file. Nothing
 * in this app may invent a sixth hub-api path.
 *
 * ── Types are mirrors, and they are `readonly` ─────────────────────────────────────────────────
 *
 * Every interface here mirrors one in hub-api and names the file it mirrors. They are deliberately
 * structural copies rather than an imported package: hub-api publishes nothing, and a hand-rolled
 * `@cloudsforge/hub-contracts` that nobody generates is a third description of the same shape.
 */
import { api, nimbus, type RequestOptions } from './api.ts'
import type { Tile } from './tile.ts'

/* ─────────────────────────────── portfolio ─────────────────────────────── */

/**
 * One asset the account holds. Mirrors `Holding` in hub-api/src/portfolio.ts.
 *
 * `usd` is `null` for a holding with no usable quote, and `priceReason` says why. It is NEVER
 * zero: hub-api drops such a holding from the total and sets `pricingComplete: false` rather than
 * counting it at nothing, because "a holding counted at zero is a portfolio that quietly shrinks
 * when the oracle blinks, and the user reads that as a loss" (portfolio.ts).
 */
export interface Holding {
  readonly assetCode: string
  /** Smallest units, decimal string. */
  readonly amount: string
  /** Human form. Null for a `TOKEN:` asset, whose decimals nothing in the fan-out knows. */
  readonly amountFormatted: string | null
  readonly available: string
  readonly reserved: string
  readonly usdScaled: string | null
  readonly usd: string | null
  readonly allocationBps: number | null
  /** When the quote behind `usd` was observed. Null for an unpriced holding and for fixed rates. */
  readonly quotedAt: string | null
  /** Present exactly when `usd` is null. */
  readonly priceReason: string | null
  /**
   * How the price behind `usd` was arrived at: `'market'` or `'administered'`, pricing's own word.
   *
   * Null where no quote produced the figure — SHARD and USD are fixed by contract and a `TOKEN:`
   * asset has no oracle — so null means "nothing to qualify", never "unknown".
   *
   * **This is the field the unlisted-asset note is derived from, and it is deliberately not an
   * asset code.** `pricing/src/rates.ts` owns the list of administered assets; a second copy of it
   * in this bundle would be a second place to forget when the list changes.
   */
  readonly priceSource: string | null
}

/** One bar of the allocation chart. Mirrors `AllocationRow`, portfolio.ts. */
export interface AllocationRow {
  readonly label: string
  readonly usdScaled: string
  readonly usd: string
  readonly bps: number
}

/** Mirrors `PortfolioView`, portfolio.ts. */
export interface PortfolioView {
  readonly totalUsdScaled: string
  readonly totalUsd: string
  /** The OLDEST contributing observation, never the newest and never now. portfolio.ts. */
  readonly pricedAt: string | null
  /** False when a holding was dropped from the total for want of a price. */
  readonly pricingComplete: boolean
  readonly holdings: readonly Holding[]
  readonly allocation: readonly AllocationRow[]
  readonly shards: string
  readonly ember: string
}

/* ─────────────────────────────── wallet ────────────────────────────────── */

/** Mirrors `WalletRecord`, hub-api/src/upstreams.ts (wallet's `GET /v1/wallets`). */
export interface WalletRecord {
  readonly id: string
  readonly userId: string
  readonly origin: 'managed' | 'external' | 'watch'
  readonly chain: string
  readonly network: string
  readonly address: string
  readonly label: string | null
  readonly isPrimary: boolean
  readonly status: 'provisioning' | 'active' | 'frozen' | 'exported' | 'retiring' | 'retired'
  readonly custodyKeyUrn: string | null
  readonly createdAt: string
  readonly verifiedAt: string | null
  readonly exportedAt: string | null
  readonly retiredAt: string | null
}

/** Mirrors `DepositCredit`, upstreams.ts. */
export interface DepositCredit {
  readonly id: string
  readonly assetCode: string
  readonly amount: string
  readonly amountFormatted: string
  readonly chain: string
  readonly network: string
  readonly txHash: string
  readonly txUrn: string
  readonly explorerUrl: string | null
  readonly confirmations: number
  readonly credited: boolean
}

/** Mirrors `WithdrawalRecord`, upstreams.ts. */
export interface WithdrawalRecord {
  readonly id: string
  readonly userId: string
  readonly chain: string
  readonly network: string
  readonly assetCode: string
  readonly destination: string
  readonly amount: string
  readonly amountFormatted: string
  readonly fee: string
  readonly net: string
  readonly netFormatted: string
  readonly state:
    | 'requested'
    | 'reserved'
    | 'queued'
    | 'settling'
    | 'settled'
    | 'stuck'
    | 'failed'
    | 'refunded'
    | 'cancelled'
  readonly txHash: string | null
  readonly failureReason: string | null
  readonly requestedAt: string
  readonly updatedAt: string
}

/* ───────────────────────── security and access ─────────────────────────── */

/** Mirrors `SecurityView`, hub-api/src/dashboard.ts. */
export interface SecurityView {
  readonly email: string
  readonly handle: string
  readonly emailVerified: boolean
  readonly roles: readonly string[]
  readonly sessionId: string
  /** How the CURRENT session authenticated — `pwd`, `otp`. */
  readonly amr: readonly string[]
  readonly mfaEnabled: boolean
  readonly factors: readonly {
    readonly id: string
    readonly kind: string
    readonly label: string
    readonly status: string
    readonly lastUsedAt: string | null
  }[]
  readonly recoveryCodesRemaining: number
  readonly organisations: readonly { readonly id: string; readonly name: string }[]
}

/** Mirrors `SecurityAlert`, dashboard.ts. */
export interface SecurityAlert {
  readonly kind: 'mfa_disabled' | 'email_unverified' | 'account_frozen'
  readonly severity: 'warning' | 'critical'
  readonly message: string
  readonly source: string
}

/** Mirrors `PolicyFreeze`, upstreams.ts. */
export interface PolicyFreeze {
  readonly id: string
  readonly subject: string
  readonly scope: string
  readonly reason: string
  readonly createdAt: string
  readonly clearedAt: string | null
  readonly clearancesRequired: number
}

/** Mirrors `BillingEntitlement`, upstreams.ts. */
export interface BillingEntitlement {
  readonly id: string
  readonly sku: string
  readonly scope: string
  readonly source: string
  readonly grantedAt: string
  readonly expiresAt: string | null
  readonly active: boolean
}

/** Mirrors `BillingSubscription`, upstreams.ts. */
export interface BillingSubscription {
  readonly id: string
  readonly productId: string
  readonly status: string
  readonly currentPeriodEnd: string | null
  readonly cancelAt: string | null
  readonly scope: string
  readonly confersAccess: boolean
}

/** Mirrors `Entitlements`, dashboard.ts. */
export interface EntitlementsView {
  readonly entitlements: readonly BillingEntitlement[]
  readonly subscriptions: readonly BillingSubscription[]
}

/**
 * Mirrors `NotificationRecord`, upstreams.ts (notify's `GET /notifications`).
 *
 * `title` IS THE SENTENCE, already written and already substituted, and nothing in this bundle may
 * compose one from `templateId` and `params`. notify's `templates.ts` is the single place a
 * user-visible sentence is written in this estate; a second rendering here would be a copy free to
 * drift, and it would drift in the one direction nobody notices — the old wording still reads
 * fine.
 *
 * `href` is RELATIVE and may be null. Null means there is nowhere honest to point: the row's link
 * is a single-use credential which notify has already redacted, so a link would go to `/[redacted]`
 * and look like a working one. Render the row without a link rather than dropping it.
 */
export interface NotificationRecord {
  readonly id: string
  readonly userId: string
  readonly category: string
  readonly priority: string
  readonly templateId: string
  readonly title: string
  readonly href: string | null
  readonly params: Record<string, unknown>
  readonly locale: string
  readonly subjectUrn: string | null
  readonly createdAt: string
  readonly readAt: string | null
}

/** Mirrors `Notifications`, dashboard.ts. */
export interface NotificationsView {
  /** Unread across the whole inbox, not within `items`. A badge, not a length. */
  readonly unread: number
  readonly items: readonly NotificationRecord[]
}

/* ───────────────────────── activity and prices ─────────────────────────── */

/** Mirrors `ActivityRecord`, upstreams.ts (activity's `GET /feed`). */
export interface ActivityRecord {
  readonly id: string
  readonly userId: string | null
  readonly occurredAt: string
  readonly category: string
  readonly type: string
  readonly subjectUrn: string
  readonly summary: string
  readonly amount: string | null
  readonly assetCode: string | null
  readonly product: string
  readonly visibility: string
}

/** Mirrors `PricingRate`, upstreams.ts (pricing's `GET /rates` — NOT `/v1/quotes`). */
export interface PricingRate {
  readonly asset: string
  readonly source: string
  readonly usable: boolean
  readonly reason?: string
  readonly quotedAt: string | null
  readonly ageSeconds: number | null
  readonly usdScaled: string | null
  readonly usd: string | null
}

/* ───────────────────────────── next actions ────────────────────────────── */

/** Mirrors `ActionProgress`, hub-api/src/nextactions.ts. */
export interface ActionProgress {
  readonly done: number
  readonly total: number
  readonly etaMinutes: number | null
}

/** Mirrors `NextAction`, nextactions.ts. */
export interface NextAction {
  readonly id: string
  readonly kind:
    | 'deposit_confirming'
    | 'mfa_disabled'
    | 'recovery_codes_low'
    | 'account_frozen'
    | 'subscription_past_due'
    | 'withdrawal_stuck'
  readonly severity: 'info' | 'warning' | 'critical'
  readonly source: string
  readonly title: string
  readonly detail: string
  /** The imperative on the button — "Enable", "Review", "Track". */
  readonly verb: string
  /** A relative deep link. hub-api never emits an origin: "the SPA owns its own origin." */
  readonly href: string
  readonly progress: ActionProgress | null
}

/** Mirrors `NextActions`, nextactions.ts. */
export interface NextActions {
  readonly actions: readonly NextAction[]
  /** Sources that could not be consulted. For operators; a user simply sees one fewer card. */
  readonly missing: readonly { readonly source: string; readonly reason: string }[]
}

/* ────────────────────────────── the dashboard ──────────────────────────── */

/** Mirrors `DashboardTiles`, dashboard.ts. Eleven tiles, and every one is a `Tile<T>`. */
export interface DashboardTiles {
  readonly portfolio: Tile<PortfolioView>
  readonly prices: Tile<readonly PricingRate[]>
  readonly wallets: Tile<readonly WalletRecord[]>
  readonly deposits: Tile<readonly DepositCredit[]>
  readonly withdrawals: Tile<readonly WithdrawalRecord[]>
  readonly activity: Tile<readonly ActivityRecord[]>
  readonly security: Tile<SecurityView | null>
  readonly restrictions: Tile<readonly PolicyFreeze[]>
  readonly entitlements: Tile<EntitlementsView>
  readonly alerts: Tile<readonly SecurityAlert[]>
  readonly notifications: Tile<NotificationsView>
}

/** Mirrors `Dashboard`, dashboard.ts. */
export interface Dashboard {
  readonly userId: string
  /** When the response was assembled. Distinct from `tiles.portfolio.data.pricedAt`, which is older. */
  readonly generatedAt: string
  readonly budgetMs: number
  readonly elapsedMs: number
  readonly tiles: DashboardTiles
  readonly nextActions: NextActions
  /** Tile names whose status is not `ok`. The page banner is built from this. */
  readonly degraded: readonly string[]
}

/**
 * The whole page in one call.
 *
 * It answers 200 or it answers an auth failure — never a 500 for an upstream fault. hub-api's
 * `composeDashboard` "resolves. It does not reject, and a caller that wraps it in a try/catch to
 * produce a 503 has misunderstood the design" (dashboard.ts). So a rejection from this
 * function means the SESSION or the BFF itself is the problem, and only then does the page render
 * a failure state instead of tiles.
 */
export const loadDashboard = (signal: AbortSignal): Promise<Dashboard> =>
  api<Dashboard>('/v1/dashboard', { signal })

/**
 * The portfolio on its own, for the page that is only the portfolio.
 *
 * The response is `{ portfolio: <tile> }` — a single key, not the tile at the top level. Verified
 * at hub-api/src/server.ts.
 */
export const loadPortfolio = (signal: AbortSignal): Promise<{ portfolio: Tile<PortfolioView> }> =>
  api<{ portfolio: Tile<PortfolioView> }>('/v1/portfolio', { signal })

/**
 * One page of the unified feed.
 *
 * **The response is NOT a `Tile<T>`.** hub-api flattens this one: `records` and `nextCursor` sit
 * beside `status`, `reason`, `cached` and `ageMs` at the top level (server.ts). Typing it
 * as a tile and reading `body.data.records` is exactly the shape mistake this file's header is
 * about, so it has its own interface.
 *
 * The cursor is OPAQUE and is passed back byte-for-byte. hub-api does not parse it either — "it
 * is activity's keyset position… re-encoding it would create a second cursor format that has to
 * be kept in step with the first for ever" (server.ts).
 */
export interface ActivityPageResponse {
  readonly records: readonly ActivityRecord[]
  readonly nextCursor: string | null
  readonly status: Tile<unknown>['status']
  readonly reason: string | null
  readonly cached: boolean
  readonly ageMs: number | null
}

/** `limit` must be a whole number between 1 and 100, or hub-api answers 400 (server.ts). */
export const ACTIVITY_PAGE_SIZE = 25

export function loadActivity(
  signal: AbortSignal,
  cursor: string | null,
  limit: number = ACTIVITY_PAGE_SIZE,
): Promise<ActivityPageResponse> {
  const options: RequestOptions = {
    signal,
    // A null cursor is OMITTED rather than sent as the string "null": hub-api caches only the
    // first page, and it decides which that is by `searchParams.get('cursor') === null`
    // (server.ts, 369). Sending an empty value would defeat the cache on every first load.
    query: cursor === null ? { limit } : { limit, cursor },
  }
  return api<ActivityPageResponse>('/v1/activity', options)
}

/** The "needs you" cards on their own, for a poll that is cheaper than a whole dashboard. */
export const loadNextActions = (signal: AbortSignal): Promise<NextActions> =>
  api<NextActions>('/v1/next-actions', { signal })

/** Mirrors `SearchResponse`, hub-api/src/search.ts. */
export interface SearchResponse {
  readonly query: string
  readonly groups: {
    readonly wallets: Tile<SearchGroup>
    readonly transactions: Tile<SearchGroup>
    readonly tokens: Tile<SearchGroup>
    readonly activity: Tile<SearchGroup>
  }
  readonly total: number
  readonly degraded: readonly string[]
}

/** Mirrors `SearchGroup`, search.ts. */
export interface SearchGroup {
  readonly results: readonly {
    readonly kind: 'wallet' | 'transaction' | 'token' | 'activity'
    readonly id: string
    readonly title: string
    readonly subtitle: string
    readonly href: string
    readonly source: string
  }[]
  /** True when the window searched was full, so an older match could exist and was not seen. */
  readonly truncated: boolean
}

/**
 * Search. `q` is required and non-empty, or hub-api answers 400 (server.ts), and it is
 * capped at 128 characters (server.ts, 403).
 */
export const MAX_SEARCH_LENGTH = 128

export const search = (signal: AbortSignal, q: string): Promise<SearchResponse> =>
  api<SearchResponse>('/v1/search', { signal, query: { q } })

/* ───────────────── identity, called directly, on purpose ───────────────── */

/**
 * Why these four are NOT hub-api calls.
 *
 * hub-api composes a READ of the security state and nothing more, and it can only do that much by
 * forwarding the caller's own bearer, because "`GET /auth/me` and `GET /mfa/factors` are guarded
 * by identity's `authenticateUser`, which explicitly refuses a service token"
 * (hub-api/src/upstreams.ts). The session LIST and the revoke are not composed at all —
 * hub-api has no route for them.
 *
 * Routing them through a BFF would gain nothing and cost the audit trail: identity records the
 * revoke against the presenting session, and a proxy in the middle makes every sign-out look like
 * it came from hub-api. So this app talks to identity directly, with the user's own token, for
 * the operations identity alone owns. `docs/ecosystem/03-repository-responsibilities.md`
 * moves the Nimbus `/account` page into this repository, which is the mandate for it.
 */

/** Mirrors `listSessions`, identity/src/sessions.ts. Active sessions only, newest first. */
export interface IdentitySession {
  readonly id: string
  readonly userId: string
  readonly deviceId: string | null
  readonly refreshFamilyId: string
  /** A PREFIX, not an address — identity stores no full client IP. */
  readonly ipPrefix: string | null
  readonly createdAt: string
  readonly lastActiveAt: string
  readonly revokedAt: string | null
  readonly revokeReason: string | null
  readonly userAgentFamily: string | null
  readonly osFamily: string | null
}

/** `GET /sessions` — identity/src/server.ts. */
export const loadSessions = (signal: AbortSignal): Promise<{ sessions: readonly IdentitySession[] }> =>
  nimbus<{ sessions: readonly IdentitySession[] }>('/sessions', { signal })

/**
 * `DELETE /sessions/:id` — identity/src/server.ts.
 *
 * Answers 204 whether or not there was a session, "signing out of something already signed out is
 * not an error, and a 404 here would say which session ids exist". So a successful call proves
 * nothing about what existed, and the caller reloads rather than removing a row optimistically.
 */
export const revokeSession = (id: string): Promise<void> =>
  nimbus<void>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })

/**
 * `DELETE /sessions` — identity/src/server.ts. Signs out EVERYWHERE, including here.
 *
 * "A 'sign out everywhere' that spares the button that was pressed is not the operation the user
 * asked for — they pressed it because they believe a session is compromised, and the one they are
 * looking at may be it." The caller must therefore drop its own tokens afterwards.
 */
export const revokeAllSessions = (): Promise<{ revoked: number }> =>
  nimbus<{ revoked: number }>('/sessions', { method: 'DELETE' })

/** Mirrors identity's `GET /mfa/factors` body — identity/src/server.ts. */
export interface IdentityFactors {
  readonly factors: readonly {
    readonly id: string
    readonly kind: string
    readonly label: string
    readonly status: string
    readonly lastUsedAt: string | null
    readonly createdAt: string
  }[]
  readonly recoveryCodesRemaining: number
}

export const loadFactors = (signal: AbortSignal): Promise<IdentityFactors> =>
  nimbus<IdentityFactors>('/mfa/factors', { signal })
