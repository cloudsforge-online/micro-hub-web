/**
 * micro-pool's HTTP API, as this page uses it.
 *
 * Four routes and no state. The socket is `lib/stratum-client.ts`'s business and the page's own
 * state is the page's; this file only knows how to ask.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE TICKET IS A CREDENTIAL, AND EVERY RULE ABOUT IT IS HERE ───────────────────────────────
 *
 * `POST /v1/pool/ticket` returns a value that authorises mining as somebody's account. It is worth
 * one authorisation on one connection and it lives for a minute, which makes it a short-lived
 * bearer token and nothing softer. The handling rules, stated once:
 *
 *   * **never logged** — not at info, not at debug, not in an error message, not in a breadcrumb.
 *     `RESULT` below is deliberately shaped so that the ticket is destructured out at the single
 *     point of use and the rest of the response, which is safe, is what travels.
 *   * **never in a URL** — not a query parameter, not a fragment. A URL is written to history, to
 *     the referrer of the next navigation, and to every proxy log on the path.
 *   * **never in `Sec-WebSocket-Protocol`** — the one place a browser WebSocket will let you put a
 *     string, which is exactly why it is tempting. That header is a plaintext negotiation field the
 *     server echoes back; the wire contract settles on NO subprotocol for this reason.
 *   * **never cached and never reused** — a spent ticket is refused by the pool, and holding one
 *     against a future reconnect only creates a copy that outlives its usefulness.
 *
 * The `account` in the reply is NOT any of that. It is an opaque label micro-pool minted
 * (`cf-` and sixteen hex characters), it is not the estate user id, and the public share and worker
 * routes below take it as a query parameter — so it is safe to display and safe to put in a URL,
 * which is precisely the distinction that makes the ticket unsafe in both.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import { ApiError, request, type RequestOptions } from './api.ts'
import { hosts } from './hosts.ts'
import type { PowAlgorithm } from './stratum.ts'

/** Everything here goes to `pool.<apex>`, which the surface registry resolves at runtime. */
const pool = <T,>(path: string, opts?: RequestOptions): Promise<T> => request<T>(hosts().pool, path, opts)

/* ══════════════════════════════ GET /v1/pool ══════════════════════════════ */

export interface PoolChain {
  readonly chain: string
  readonly name: string
  readonly asset: string
  readonly decimals: number
  readonly algorithm: PowAlgorithm
  /** The port the Stratum listener BINDS. Honest about itself, useless as half of an address. */
  readonly stratumPort: number
  /** A published `stratum+tcp://…`, or null. For firmware, not for this page. */
  readonly stratumEndpoint: string | null
  /**
   * THE COMPLETE `wss://…` URL, OR NULL. THE ONE FIELD THIS PAGE MUST NOT SECOND-GUESS.
   *
   * micro-org#285 is the defect this field exists to prevent, and it is worth stating in full
   * because the temptation to re-create it is strong and the failure is silent. micro-pool-web
   * derived a Stratum address from `window.location.hostname` and published
   * `stratum+tcp://pool.<apex>:3334` on a public page. That endpoint cannot connect — the console's
   * hostname is served through a tunnel and a reverse proxy, neither of which forwards a raw
   * stream, and the listener is bound to loopback anyway. A plausible address that does not connect
   * is worse than no address, because the person holding it debugs their own machine instead of
   * asking a question.
   *
   * **So this is used verbatim or not at all.** Not the page's hostname with a path bolted on, not
   * the API base with the scheme swapped, not `stratumPort` on the current host. When it is null
   * the chain is still LISTED — the pool really does mine it, and hiding it would be its own kind
   * of lie — but it cannot be started, and the page says browser mining has not been published on
   * this deployment.
   *
   * Optional in the type as well as nullable, because a deployment running an older micro-pool
   * omits the key entirely, and a client that distinguished "absent" from "null" would be drawing a
   * distinction the operator did not make.
   */
  readonly websocketEndpoint?: string | null
  readonly connections: number
  readonly height: number | null
  readonly networkDifficulty: number | null
  readonly templateAgeSeconds: number | null
  /** Whether the pool currently holds a template it could hand out. */
  readonly ready: boolean
  readonly windowSeconds: number
  readonly sharesInWindow: number
  readonly workersInWindow: number
  /** Hashes per second across the whole pool for this chain, over `windowSeconds`. */
  readonly hashrateEstimate: number
}

export interface PoolSummary {
  readonly network: string
  readonly feeBasisPoints: number
  readonly pplnsWindowMultiplier: number
  /**
   * FALSE, AND THE PAGE SAYS SO IN WORDS.
   *
   * micro-pool puts this in the response body rather than only in its README precisely so that a
   * client cannot show a share count that implies a payment. The number of shares is real, the
   * credit against the account is real, and nothing spendable accrues from either yet.
   */
  readonly payoutsImplemented: boolean
  readonly chains: readonly PoolChain[]
}

/** What this pool is and what it is currently doing. Public: no bearer token is sent. */
export function loadPool(signal?: AbortSignal): Promise<PoolSummary> {
  return pool<PoolSummary>('/v1/pool', signal ? { auth: false, signal } : { auth: false })
}

/**
 * Why a browser cannot be pointed at this chain, or null if it can. The one place it is decided.
 *
 * TWO REASONS, AND THEY ARE NOT THE SAME SENTENCE TO A READER.
 *
 *   * `unpublished` — the operator has published no browser address. Nothing the reader does will
 *     change it, today or in an hour.
 *   * `not-ready` — the pool holds no template for this chain, so it has no work to hand out. In
 *     practice this is a node still downloading its chain: measured 2026-08-09, micro-pool's
 *     bitcoind was 885,650 blocks into 961,712 and still in initial block download, which is why
 *     BTC is listed and LTC is the only chain a browser can actually mine today. It fixes itself.
 *
 * Both are refused BEFORE a socket is opened, because the alternative is a Start button whose only
 * effect is a `503` on the upgrade — `pool/src/wsstratum.ts` refuses a chain that is not serving —
 * and a button that fails identically for a permanent cause and a temporary one teaches a reader
 * nothing about which they are looking at.
 */
export type MiningBlocker = 'unpublished' | 'not-ready'

export function miningBlocker(chain: PoolChain): MiningBlocker | null {
  if (typeof chain.websocketEndpoint !== 'string' || chain.websocketEndpoint === '') return 'unpublished'
  if (!chain.ready) return 'not-ready'
  return null
}

/** Can a browser be pointed at this chain right now? */
export function isMineable(chain: PoolChain): boolean {
  return miningBlocker(chain) === null
}

/* ══════════════════════════════ POST /v1/pool/ticket ══════════════════════════════ */

export interface MiningTicket {
  /** THE CREDENTIAL. See the header. Destructure it at the point of use and let it go. */
  readonly ticket: string
  /** Opaque, the pool's own, not the estate user id. Safe to show and safe to put in a query. */
  readonly account: string
  /** A label like `web-3f9c1a`, minted per ticket by the server. */
  readonly worker: string
  /** How long the ticket has left, in milliseconds. See below on why it is not a timestamp. */
  readonly expiresInMs: number
}

/**
 * The ticket route's response as it may arrive, across the versions of micro-pool this page may meet.
 *
 * `expiresInMs` is what the service sends today, and its reasoning is right: the only clock a
 * browser and a server reliably share is the elapsed one, so an absolute `expiresAt` compared
 * against a laptop that is forty seconds fast produces a ticket that looks expired on arrival.
 *
 * The written wire contract specifies `expiresAt` and `ttlSeconds` instead. That is a divergence
 * between the document and the service, the service is the one that is right, and both spellings
 * are accepted here rather than picking a side — a client that refused the older shape would break
 * against a deployment that had not caught up, and a client that refused the newer one would break
 * against the estate as it stands today.
 */
interface TicketReply {
  readonly ticket?: unknown
  readonly account?: unknown
  readonly worker?: unknown
  readonly expiresInMs?: unknown
  readonly ttlSeconds?: unknown
  readonly expiresAt?: unknown
}

/** The default the pool documents, used only when a reply carries no expiry at all. */
const TICKET_TTL_MS = 60_000

/**
 * Mint one ticket for the signed-in user.
 *
 * Sent with the bearer token and no body: everything this route needs is in the `Authorization`
 * header, and the chain is not named because it is already in the WebSocket path — naming it twice
 * would create a pair that can disagree.
 *
 * The three refusals are distinct and the page renders them differently, because the reader's next
 * move differs: 401 means sign in again, 403 means this credential is not a person's, and 503 means
 * the operator has not configured browser mining at all.
 */
export async function mintTicket(signal?: AbortSignal): Promise<MiningTicket> {
  const reply = await pool<TicketReply>(
    '/v1/pool/ticket',
    signal ? { method: 'POST', signal } : { method: 'POST' },
  )
  if (typeof reply.ticket !== 'string' || reply.ticket === '') {
    // Says what is missing and does not echo the body, which is the one thing in this whole file
    // that must not appear in a message.
    throw new Error('the pool minted a ticket with no secret in it')
  }
  if (typeof reply.account !== 'string' || typeof reply.worker !== 'string') {
    throw new Error('the pool minted a ticket with no account to credit')
  }
  return {
    ticket: reply.ticket,
    account: reply.account,
    worker: reply.worker,
    expiresInMs: expiryOf(reply),
  }
}

/**
 * What a refused ticket means, in the reader's terms rather than the server's.
 *
 * FOUR REFUSALS, AND THE POINT IS THAT THEY LEAD TO DIFFERENT NEXT MOVES. The temptation is to
 * collapse them — every one of them is "you cannot mine right now" — and the reason not to is
 * `identity_unavailable`. micro-pool returns it as a **503, deliberately not a 401**, when identity
 * itself could not be reached: the token was never judged, so telling the reader to sign in again
 * would send them to re-authenticate against the very service that is down, and they would come
 * back with a fresh token and the same failure, now believing their account is broken.
 *
 * The server's own message is used where it is already the right sentence, and replaced where the
 * useful sentence is about this app rather than about the pool. Nothing here echoes a response body
 * beyond that: a refusal message is not a place to print what was sent.
 */
export function ticketRefusal(err: unknown): string {
  if (!(err instanceof ApiError)) {
    // No status at all: the request did not complete. A network fault, or the pool origin is not
    // reachable from this browser — neither of which is anything about the reader's session.
    return 'The pool could not be reached to authorise mining.'
  }
  switch (err.code) {
    case 'browser_mining_unavailable':
      return 'This deployment has not switched browser mining on. Mining firmware can still reach the pool over its Stratum port; a browser cannot.'
    case 'identity_unavailable':
      return 'The identity service could not be reached, so the pool could not check your session. Your sign-in is fine — this is the estate, not your account. Try again shortly.'
    case 'forbidden':
      return 'That credential belongs to a service rather than to a person, and a mining ticket is credited to a person’s account.'
    case 'unauthenticated':
      return 'Your session was not accepted. Sign in again and start over.'
    default:
      return err.message
  }
}

function expiryOf(reply: TicketReply): number {
  if (typeof reply.expiresInMs === 'number' && Number.isFinite(reply.expiresInMs)) {
    return Math.max(0, reply.expiresInMs)
  }
  if (typeof reply.ttlSeconds === 'number' && Number.isFinite(reply.ttlSeconds)) {
    return Math.max(0, reply.ttlSeconds * 1000)
  }
  if (typeof reply.expiresAt === 'string') {
    const at = Date.parse(reply.expiresAt)
    // Clamped at zero rather than allowed negative: a browser clock ahead of the server's would
    // otherwise make every freshly minted ticket look already dead, which is the exact failure the
    // service switched to an elapsed duration to avoid.
    if (Number.isFinite(at)) return Math.max(0, at - Date.now())
  }
  return TICKET_TTL_MS
}

/* ══════════════════════════════ credited work ══════════════════════════════ */

export interface PoolShare {
  readonly id: string
  readonly worker: string
  readonly jobId: string
  readonly height: number
  /** What the share was credited at — the connection's difficulty when the job was issued. */
  readonly creditedDifficulty: number
  /** What the digest actually achieved. The two together are what makes a share checkable. */
  readonly achievedDifficulty: number
  readonly isBlock: boolean
  readonly createdAt: string
}

export interface SharesReply {
  readonly chain: string
  readonly account: string
  readonly shares: readonly PoolShare[]
}

export interface PoolWorker {
  readonly worker: string
  readonly lastSeenAt: string
  readonly difficulty: number | null
  readonly sharesInWindow: number
  readonly hashrateEstimate: number
}

export interface WorkersReply {
  readonly chain: string
  readonly account: string
  readonly windowSeconds: number
  readonly workers: readonly PoolWorker[]
}

/**
 * The shares credited to an account, share by share.
 *
 * Public, and taking the opaque account as a query parameter — which is why no bearer is attached.
 * `auth: false` is not laziness: sending this app's access token to another service's public route
 * is how a token ends up in a log that had no reason to hold one.
 *
 * It returns each share's credited AND achieved difficulty because that is what makes the page's
 * numbers checkable — a miner can reconcile them line for line against their own record, which a
 * total could never be checked against anything.
 */
export function loadShares(
  chain: string,
  account: string,
  signal?: AbortSignal,
): Promise<SharesReply> {
  return pool<SharesReply>('/v1/pool/shares', {
    auth: false,
    query: { chain, account },
    ...(signal ? { signal } : {}),
  })
}

/** The workers seen for an account in the pool's rolling window, with the pool's own rate estimate. */
export function loadWorkers(
  chain: string,
  account: string,
  signal?: AbortSignal,
): Promise<WorkersReply> {
  return pool<WorkersReply>('/v1/pool/workers', {
    auth: false,
    query: { chain, account },
    ...(signal ? { signal } : {}),
  })
}
