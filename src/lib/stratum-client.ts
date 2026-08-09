/**
 * The Stratum socket: one connection, its lifecycle, and the credential that opens it.
 *
 * `lib/stratum.ts` is the protocol as pure functions over bytes. This is the part that has a clock,
 * a socket and a secret — deliberately separated, because the protocol can then be tested against
 * micro-pool's real server without a network, and this can be tested against a fake socket without
 * a hash.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE HANDSHAKE, IN THE ORDER IT MUST HAPPEN ────────────────────────────────────────────────
 *
 *   1. open the WebSocket to the endpoint the pool PUBLISHED — never one derived from the page.
 *   2. `mining.subscribe`, and wait for the reply. This carries `extranonce1` and the size of the
 *      `extranonce2` this connection owns, without which no coinbase can be assembled.
 *   3. `POST /v1/pool/ticket` with the user's bearer.
 *   4. `mining.authorize` with the ticket as `params[1]` — the PASSWORD position. On this transport
 *      the username is ignored and the password is the identity, which is the reverse of raw TCP
 *      and the reverse of every Stratum tutorial.
 *   5. the pool answers `mining.set_difficulty` and then `mining.notify`, in that order and
 *      unprompted, and the miner is running.
 *
 * **Step 2 is mandatory and the written wire contract does not mention it.** `pool/src/session.ts`
 * refuses a submit with error 25 from an unsubscribed connection, and — the part that would take a
 * day to diagnose — `pushJob` returns without sending anything at all in the same condition. A
 * client that authorised and waited would hold a perfectly healthy socket that never receives work
 * and is never told why. `test/pool-contract.test.ts` asserts both halves of that against the
 * server's own code, so this is a fact rather than a precaution.
 *
 * ── WHY THE TICKET IS MINTED AFTER THE SOCKET IS OPEN, NOT BEFORE ─────────────────────────────
 *
 * A ticket lives sixty seconds. Opening a WebSocket involves a DNS lookup, a TLS handshake and an
 * HTTP upgrade through a tunnel and a reverse proxy, and on a bad network that is not instant; on a
 * connection that fails and is retried it is not bounded at all. Minting first spends the ticket's
 * whole life on transport, and the failure it produces — an authorise refused for a ticket that was
 * valid when it was requested — looks exactly like a rejected credential.
 *
 * Minting after `open` costs nothing and makes the ticket as fresh as it can be at the only moment
 * it is used. The ORDER THAT MATTERS is unchanged and is the one the contract specifies: the ticket
 * is obtained over HTTP with the user's bearer, and then presented inside the protocol.
 *
 * ── AND THE RULES ABOUT THE CREDENTIAL, WHICH THIS FILE IS THE ONLY PLACE TO BREAK ────────────
 *
 * The ticket is a bearer credential for somebody's mining account. In this file it is received,
 * placed in one JSON-RPC message, and dropped. It is:
 *
 *   * never assigned to a field of this class — there is no `#ticket`, on purpose, so there is
 *     nothing for a future `toJSON`, a debugger snapshot or an error serialiser to find;
 *   * never logged, at any level, and never included in an error message. A refusal says the ticket
 *     was refused; it does not repeat it. `pool/src/tickets.ts` takes the same position from the
 *     other side and gives the reason: distinguishing "unknown" from "expired" from "already spent"
 *     would let anybody holding a candidate value learn whether it was ever real;
 *   * never put in the URL. The endpoint is used exactly as published, with nothing appended;
 *   * never put in `Sec-WebSocket-Protocol` — the one string a browser WebSocket constructor will
 *     accept besides the URL, and therefore the tempting place to put it. It is a plaintext
 *     negotiation field the server echoes back, and the wire contract settles on no subprotocol at
 *     all. `pool/src/wsstratum.ts` refuses to echo one for the same reason;
 *   * never reused. A ticket is spent on redemption, so every reconnect mints a fresh one. There is
 *     no cache to go stale and no copy to outlive its usefulness.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import { mintTicket, ticketRefusal, type MiningTicket } from './pool.ts'
import { buildSubmitParams, parseNotify, parseSubscribe, type StratumJob, type Subscription } from './stratum.ts'

/**
 * The part of `WebSocket` this uses, so a test can supply a socket that is not a socket.
 *
 * Written as the handler properties rather than `addEventListener`, because the set of events is
 * fixed and four assignments are a smaller thing for a fake to implement correctly than an event
 * target is.
 */
export interface SocketLike {
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((event?: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code?: number; reason?: string }) => void) | null
  onerror: ((event?: unknown) => void) | null
}

export type StratumStatus =
  /** Not started. */
  | 'idle'
  /** The socket is opening, or the handshake is in flight. */
  | 'connecting'
  /** Authorised, work received, hashing. */
  | 'mining'
  /** The socket dropped and a fresh attempt is scheduled. Carries the delay. */
  | 'reconnecting'
  /** Stopped by the caller. Terminal until `start()` is called again. */
  | 'stopped'
  /** Stopped by something that retrying will not fix. Carries a reason for the reader. */
  | 'failed'

export interface ShareOutcome {
  readonly accepted: boolean
  /** The Stratum error code, when the pool refused. 21 is stale, 23 is below target. */
  readonly code?: number | undefined
  readonly message?: string | undefined
}

export interface StratumHandlers {
  onStatus?: (status: StratumStatus, detail: string) => void
  /** A new job, and the difficulty in force when it arrived. Both are needed to mine it. */
  onJob?: (job: StratumJob, difficulty: number, subscription: Subscription) => void
  onDifficulty?: (difficulty: number) => void
  onShare?: (outcome: ShareOutcome) => void
  /** The opaque pool account and worker label, as soon as a ticket names them. */
  onIdentity?: (account: string, worker: string) => void
}

export interface StratumClientOptions extends StratumHandlers {
  /** The COMPLETE URL from `GET /v1/pool`. Never assembled here. */
  readonly endpoint: string
  /** Seams. Defaulted to the real thing; replaced wholesale in tests. */
  readonly openSocket?: (url: string) => SocketLike
  readonly mint?: () => Promise<MiningTicket>
  readonly setTimer?: (fn: () => void, ms: number) => number
  readonly clearTimer?: (handle: number) => void
  /** Deterministic in tests; `Math.random` in a browser. Only ever used for backoff jitter. */
  readonly random?: () => number
}

/**
 * Reconnection delays, in milliseconds, and then the last one forever.
 *
 * Written as a list rather than as `2^n` arithmetic because the shape is the point: the first
 * retry is almost immediate, since by far the most common cause of a drop is a proxy recycling a
 * connection and the next attempt simply works. The ceiling is thirty seconds, because a pool that
 * is genuinely down is not helped by a browser asking every second and a reader who left the tab
 * open overnight should not have generated three thousand requests.
 */
const BACKOFF_MS: readonly number[] = [500, 1_000, 2_000, 5_000, 10_000, 30_000]

/** JSON-RPC ids this client assigns. Small integers; the pool echoes them. */
const ID_SUBSCRIBE = 1
const ID_AUTHORIZE = 2
/** Submits start here, so a reply id can never be mistaken for a handshake reply. */
const ID_SUBMIT_BASE = 100

export class StratumClient {
  readonly #options: StratumClientOptions
  #socket: SocketLike | null = null
  #status: StratumStatus = 'idle'
  #subscription: Subscription | null = null
  #difficulty = 1
  #attempt = 0
  #retryTimer: number | null = null
  #submitId = ID_SUBMIT_BASE
  /**
   * True between `start()` and `stop()`. Every asynchronous continuation checks it.
   *
   * A ticket request in flight when the reader presses Stop would otherwise arrive afterwards and
   * authorise a connection nobody asked for — and because the socket would then start receiving
   * work, the page would show a stopped miner that is mining.
   */
  #running = false
  /** Which connection an async continuation belongs to. Bumped on every close. */
  #generation = 0

  constructor(options: StratumClientOptions) {
    this.#options = options
  }

  get status(): StratumStatus {
    return this.#status
  }

  get difficulty(): number {
    return this.#difficulty
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    this.#attempt = 0
    this.#connect()
  }

  /**
   * Stop, and mean it.
   *
   * The generation is bumped BEFORE the socket is closed, so the `onclose` this triggers is
   * recognised as belonging to a connection that is no longer current and does not schedule a
   * retry. Without that, Stop and a reconnect race, and the reconnect usually wins.
   */
  stop(): void {
    this.#running = false
    this.#generation += 1
    this.#cancelRetry()
    const socket = this.#socket
    this.#socket = null
    this.#subscription = null
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      // 1000 is a normal closure. The pool records the disconnect either way; sending the honest
      // code is what keeps its logs distinguishable from a network failure.
      try {
        socket.close(1000, 'stopped')
      } catch {
        // A socket that is already closing throws on some implementations. Nothing to do about it
        // and nothing worth telling the reader.
      }
    }
    this.#set('stopped', '')
  }

  /**
   * Submit a solution.
   *
   * Returns false when there is no authorised socket to submit on, which is not an error: a worker
   * that found a share microseconds after the connection dropped has done nothing wrong, and the
   * share is simply lost. Throwing here would turn a routine race into a red banner.
   */
  submit(fields: {
    readonly jobId: string
    readonly extranonce2Hex: string
    readonly ntimeHex: string
    readonly nonceHex: string
  }): boolean {
    const socket = this.#socket
    if (socket === null || this.#status !== 'mining') return false
    this.#submitId += 1
    this.#send(socket, {
      id: this.#submitId,
      method: 'mining.submit',
      // `params[0]` is ignored by this pool and must still occupy its position — the server
      // destructures positionally, so an array without it shifts every other field one place left.
      // See `buildSubmitParams` and the test that drives the omission through the real server.
      params: buildSubmitParams({ worker: 'web', ...fields }),
    })
    return true
  }

  /* ── the connection ───────────────────────────────────────────────────────────────────────── */

  #connect(): void {
    const generation = this.#generation
    this.#set('connecting', '')

    let socket: SocketLike
    try {
      socket = (this.#options.openSocket ?? defaultSocket)(this.#options.endpoint)
    } catch (err) {
      // A malformed endpoint throws in the constructor, and retrying cannot fix a URL. This is the
      // one failure that is terminal rather than transient.
      this.#set('failed', `that mining endpoint could not be opened: ${messageOf(err)}`)
      this.#running = false
      return
    }
    this.#socket = socket

    socket.onopen = () => {
      if (generation !== this.#generation) return
      // Subscribe FIRST and unconditionally. Without it this connection is sent no work at all and
      // is told nothing — see the header.
      this.#send(socket, { id: ID_SUBSCRIBE, method: 'mining.subscribe', params: ['cloudsforge-hub-web'] })
    }

    socket.onmessage = (event) => {
      if (generation !== this.#generation) return
      this.#receive(socket, event.data)
    }

    socket.onerror = () => {
      // Deliberately silent. A browser's WebSocket error event carries nothing useful by design —
      // it is opaque so a page cannot probe the network — and `onclose` always follows it with a
      // code. Reporting both produces two messages for one event, one of which says nothing.
    }

    socket.onclose = (event) => {
      if (generation !== this.#generation) return
      this.#generation += 1
      this.#socket = null
      this.#subscription = null
      if (!this.#running) return
      this.#scheduleRetry(closeReason(event))
    }
  }

  /**
   * A dropped socket is retried with a FRESH ticket, because `#connect` mints one per connection
   * and there is nowhere for an old one to be kept.
   *
   * That is not a rule this method enforces; it is a property of the shape. `#authorize` is the only
   * caller of `mint`, it is called only from the subscribe reply, and the value it receives is
   * destructured into one message and never stored. A reconnect therefore cannot reuse a ticket
   * even by mistake — there is no variable holding one.
   */
  #scheduleRetry(reason: string): void {
    const delay = BACKOFF_MS[Math.min(this.#attempt, BACKOFF_MS.length - 1)] as number
    this.#attempt += 1
    // Jitter of up to a quarter of the delay. Not for this reader's benefit — for the pool's, when
    // a proxy drops every browser connection at once and they would otherwise all return together.
    const jittered = Math.round(delay * (1 + 0.25 * (this.#options.random ?? Math.random)()))
    this.#set(
      'reconnecting',
      `${reason} Reconnecting in ${(jittered / 1000).toFixed(1)} seconds, with a new mining ticket.`,
    )
    const setTimer = this.#options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number)
    this.#retryTimer = setTimer(() => {
      this.#retryTimer = null
      if (this.#running) this.#connect()
    }, jittered)
  }

  #cancelRetry(): void {
    if (this.#retryTimer === null) return
    const clearTimer = this.#options.clearTimer ?? ((handle: number) => clearTimeout(handle))
    clearTimer(this.#retryTimer)
    this.#retryTimer = null
  }

  /* ── the protocol ─────────────────────────────────────────────────────────────────────────── */

  #receive(socket: SocketLike, data: unknown): void {
    if (typeof data !== 'string') return
    // The contract is one newline-delimited JSON-RPC message per TEXT frame, and micro-pool sends
    // exactly that with the newline stripped — `pool/src/wsframe.ts` takes it off on the way out and
    // puts one back on anything a client sends that lacks it. So the delimiter is real on the wire
    // and absent from what a browser hands us, and both readings have to work. Splitting on it
    // costs one pass over a small string and makes the client indifferent to which side of that
    // decision a future deployment lands on, including a server that coalesces two messages.
    for (const line of data.split('\n')) {
      if (line.trim() === '') continue
      this.#dispatch(socket, line)
    }
  }

  #dispatch(socket: SocketLike, line: string): void {
    let message: Record<string, unknown>
    try {
      // A frame that is not JSON is dropped rather than fatal: it is not this client's place to
      // close a connection over a message it did not understand.
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }

    const method = message['method']
    if (typeof method === 'string') {
      this.#notification(method, message['params'])
      return
    }
    this.#reply(socket, message)
  }

  #notification(method: string, params: unknown): void {
    switch (method) {
      case 'mining.set_difficulty': {
        const next = Array.isArray(params) ? params[0] : undefined
        if (typeof next !== 'number' || !Number.isFinite(next) || next <= 0) return
        this.#difficulty = next
        this.#options.onDifficulty?.(next)
        return
      }
      case 'mining.notify': {
        let job: StratumJob
        try {
          job = parseNotify(params)
        } catch (err) {
          // A job this client cannot parse is a disagreement about the protocol, and mining a
          // header assembled from a guess is worse than mining nothing. Reported, not hidden.
          this.#set('failed', `the pool sent a job this page could not read: ${messageOf(err)}`)
          return
        }
        const subscription = this.#subscription
        if (subscription === null) return
        if (this.#status !== 'mining') this.#set('mining', '')
        this.#options.onJob?.(job, this.#difficulty, subscription)
        return
      }
      default:
        // `mining.set_extranonce` and anything else this pool does not send. Ignored rather than
        // refused: an unknown notification is the server's business, not a protocol violation.
        return
    }
  }

  #reply(socket: SocketLike, message: Record<string, unknown>): void {
    const id = message['id']
    const error = message['error']

    if (id === ID_SUBSCRIBE) {
      if (error != null) {
        this.#set('failed', `the pool refused to subscribe this connection: ${errorText(error)}`)
        return
      }
      try {
        this.#subscription = parseSubscribe(message['result'])
      } catch (err) {
        this.#set('failed', messageOf(err))
        return
      }
      void this.#authorize(socket)
      return
    }

    if (id === ID_AUTHORIZE) {
      if (message['result'] === true) {
        // The pool sends set_difficulty and then notify unprompted; `mining` is entered when the
        // first job arrives rather than here, so the status never claims work that has not come.
        return
      }
      // NOTHING ABOUT THE TICKET IS REPEATED. The pool's own refusal says what to do and echoes
      // nothing, and this passes that message through unchanged rather than decorating it with the
      // value that was refused.
      this.#set('failed', `the pool refused this mining ticket. ${errorText(error)}`)
      this.#running = false
      return
    }

    if (typeof id === 'number' && id > ID_SUBMIT_BASE) {
      if (message['result'] === true) {
        this.#options.onShare?.({ accepted: true })
        return
      }
      const code = Array.isArray(error) && typeof error[0] === 'number' ? error[0] : undefined
      this.#options.onShare?.({ accepted: false, code, message: errorText(error) })
    }
  }

  /**
   * Mint a ticket and present it, on this connection only.
   *
   * `async` and therefore resumable after the socket has gone, which is why the generation is
   * captured and rechecked. Without that, a ticket minted for a connection that dropped while the
   * request was in flight would be sent on whatever socket happened to be current — and being
   * single-use, it would then be spent on the wrong one.
   */
  async #authorize(socket: SocketLike): Promise<void> {
    const generation = this.#generation
    let ticket: MiningTicket
    try {
      ticket = await (this.#options.mint ?? mintTicket)()
    } catch (err) {
      if (generation !== this.#generation || !this.#running) return
      // A ticket request that fails is usually the session or the estate, not the pool's mining
      // machinery, and none of those causes is fixed by retrying a socket. `ticketRefusal` is what
      // decides which sentence the reader gets, and it is worth reading before changing anything
      // here: the four refusals lead to four different next moves, and one of them is specifically
      // NOT "sign in again".
      this.#set('failed', ticketRefusal(err))
      this.#running = false
      this.stop()
      return
    }
    if (generation !== this.#generation || !this.#running) {
      // The ticket is simply dropped. It expires on its own in under a minute and no reconnect will
      // look for it, because nothing keeps one.
      return
    }

    this.#options.onIdentity?.(ticket.account, ticket.worker)
    this.#send(socket, {
      id: ID_AUTHORIZE,
      method: 'mining.authorize',
      // params[0] is the username and IS IGNORED on this transport; params[1] is the ticket. The
      // reverse of raw TCP, and the reverse of every Stratum tutorial — `pool/src/session.ts`
      // explains why: a browser has just proved who it is to an estate service, so taking its word
      // for an account name would be strictly worse information than the ticket already carries.
      params: ['web', ticket.ticket],
    })
    // The local binding goes out of scope here and is never assigned anywhere. That is the whole
    // of the ticket's lifetime in this process.
  }

  #send(socket: SocketLike, message: Record<string, unknown>): void {
    try {
      socket.send(JSON.stringify(message))
    } catch {
      // A send on a closing socket throws. `onclose` is already on its way and will schedule the
      // retry; reporting this separately would produce a second message for one event.
    }
  }

  #set(status: StratumStatus, detail: string): void {
    this.#status = status
    this.#options.onStatus?.(status, detail)
  }
}

/**
 * A real browser WebSocket, with NO SUBPROTOCOL and NOTHING APPENDED TO THE URL.
 *
 * Both omissions are the point, and both are the kind of thing a later change adds back without
 * meaning to. The constructor's second argument is where a subprotocol would go; the wire contract
 * settles on none, `pool/src/wsstratum.ts` refuses to echo one, and it is the only place a browser
 * would let a credential be smuggled into a handshake. The URL is used exactly as the pool
 * published it.
 */
function defaultSocket(url: string): SocketLike {
  return new WebSocket(url) as unknown as SocketLike
}

/**
 * Why a socket closed, in a sentence a reader can act on.
 *
 * 1006 deserves its own wording because it is by far the most common and the most misleading: it is
 * what a browser reports when the connection failed WITHOUT a close frame, which covers a refused
 * TCP connection, a TLS failure, a proxy timeout and a pulled network cable equally. The browser
 * genuinely does not know which, and the security model is why — a page that could tell them apart
 * could scan a network. So the copy says the connection dropped and does not speculate.
 */
function closeReason(event: { code?: number; reason?: string }): string {
  const code = event.code ?? 0
  if (event.reason) return `The pool closed the connection: ${event.reason}.`
  if (code === 1006) return 'The connection to the pool dropped.'
  if (code === 1001) return 'The pool went away.'
  return `The connection to the pool closed (code ${code}).`
}

function errorText(error: unknown): string {
  if (Array.isArray(error) && typeof error[1] === 'string') return error[1]
  if (typeof error === 'string') return error
  return 'The pool gave no reason.'
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
