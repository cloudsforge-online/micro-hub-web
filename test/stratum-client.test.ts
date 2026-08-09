/**
 * The Stratum socket, and the credential it carries for one message.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `test/pool-contract.test.ts` drives micro-pool's real `Session`, so what a correct handshake
 * looks like is settled THERE, against the server's own code, and is not re-described here. What
 * that test cannot see is everything outside a single successful connection: what happens when the
 * socket drops, what happens when Stop is pressed while a ticket request is in flight, and what the
 * client does with the credential between receiving it and forgetting it.
 *
 * Those are this file's subject, and they are the ones that go wrong quietly. A client that reuses
 * a ticket after a reconnect does not fail on the first drop — it fails on the second, minutes
 * later, with a refusal that reads exactly like an expired session; and a client that keeps a spent
 * ticket in a field has a credential in every heap dump and error report for the life of the tab.
 *
 * ── THE FOUR RULES, EACH AS AN EXECUTABLE ASSERTION ───────────────────────────────────────────
 *
 *   never reused ......... `a dropped socket mints a new ticket, and never re-sends the old one`
 *   never in a URL ....... `the socket is opened at the published endpoint, byte for byte`
 *   never a subprotocol .. same scenario — the factory is handed one argument and there is nowhere
 *                          for a second to go, which is asserted by arity rather than by reading
 *   never spoken ......... `a refused ticket is not repeated back to the reader`
 *
 * The ticket values below are fixtures with no power anywhere; they are written to look like
 * credentials so that a grep for one across the client's output is a meaningful search.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ApiError } from '../src/lib/api.ts'
import { StratumClient, type SocketLike } from '../src/lib/stratum-client.ts'
import type { MiningTicket } from '../src/lib/pool.ts'

/* ══════════════════════════════ a socket that is not a socket ══════════════════════════════ */

class FakeSocket implements SocketLike {
  readonly url: string
  readonly sent: string[] = []
  closed: { code?: number | undefined; reason?: string | undefined } | null = null
  onopen: ((event?: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null
  onerror: ((event?: unknown) => void) | null = null

  constructor(url: string) {
    this.url = url
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason }
  }

  /** Everything this socket was sent, decoded. The client sends one JSON object per frame. */
  messages(): Record<string, unknown>[] {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>)
  }

  methods(): string[] {
    return this.messages().map((message) => String(message['method']))
  }

  find(method: string): Record<string, unknown> | undefined {
    return this.messages().find((message) => message['method'] === method)
  }

  open(): void {
    this.onopen?.()
  }

  reply(id: number, result: unknown, error: unknown = null): void {
    this.onmessage?.({ data: JSON.stringify({ id, result, error }) })
  }

  notify(method: string, params: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ id: null, method, params }) })
  }

  drop(code = 1006): void {
    this.onclose?.({ code })
  }
}

/** A `mining.subscribe` reply in the shape `pool/src/session.ts` sends. */
const SUBSCRIBE_RESULT = [
  [
    ['mining.set_difficulty', 'aabbccdd1'],
    ['mining.notify', 'aabbccdd2'],
  ],
  'aabbccdd',
  4,
]

const ENDPOINT = 'wss://pool.cloudsforge.online/v1/pool/stratum/ltc'

interface Harness {
  readonly client: StratumClient
  readonly sockets: FakeSocket[]
  /** Every ticket this harness handed out, in order. */
  readonly issued: MiningTicket[]
  /** The URLs the factory was asked for, so "nothing appended" is checkable. */
  readonly urls: string[]
  /** How many arguments the factory was handed each time. A second one is a subprotocol. */
  readonly openArgs: number[]
  readonly statuses: { status: string; detail: string }[]
  /** Pending backoff timers, fired by hand so the test has no real clock in it. */
  readonly timers: (() => void)[]
  runTimers(): void
}

function harness(over: { mint?: () => Promise<MiningTicket> } = {}): Harness {
  const sockets: FakeSocket[] = []
  const urls: string[] = []
  const openArgs: number[] = []
  const issued: MiningTicket[] = []
  const statuses: { status: string; detail: string }[] = []
  const timers: (() => void)[] = []
  let minted = 0

  const client = new StratumClient({
    endpoint: ENDPOINT,
    openSocket: (...args: [string]) => {
      const url = args[0]
      openArgs.push(args.length)
      urls.push(url)
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    mint:
      over.mint ??
      (async () => {
        minted += 1
        // Distinct per call, on purpose: reuse is only detectable if the values differ.
        const ticket: MiningTicket = {
          ticket: `pt_live_ticket_number_${minted}`,
          account: 'cf-0123456789abcdef',
          worker: `web-${minted}`,
          expiresInMs: 60_000,
        }
        issued.push(ticket)
        return ticket
      }),
    setTimer: (fn) => {
      timers.push(fn)
      return timers.length
    },
    clearTimer: () => undefined,
    // Deterministic jitter, so the delay stated to the reader is a fixed string in these tests.
    random: () => 0,
    onStatus: (status, detail) => statuses.push({ status, detail }),
  })

  return {
    client,
    sockets,
    issued,
    urls,
    openArgs,
    statuses,
    timers,
    runTimers: () => {
      const pending = timers.splice(0, timers.length)
      for (const fire of pending) fire()
    },
  }
}

/** Let the client's `await mint()` continuation run. Two turns: the promise, then the send. */
const settle = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

/** Drive one connection all the way to authorised. Returns the socket it used. */
async function authorised(h: Harness, index = 0): Promise<FakeSocket> {
  const socket = h.sockets[index]
  assert.ok(socket, `no socket was opened for connection ${index}`)
  socket.open()
  socket.reply(1, SUBSCRIBE_RESULT)
  await settle()
  return socket
}

/* ══════════════════════════════ the handshake ══════════════════════════════ */

describe('the handshake', () => {
  it('subscribes before it mints anything, and authorises only after the subscribe reply', async () => {
    const h = harness()
    h.client.start()
    const socket = h.sockets[0]
    assert.ok(socket)
    socket.open()

    // Nothing has been minted yet. `mining.subscribe` is mandatory — the pool refuses a submit from
    // an unsubscribed connection and, worse, sends it no job at all — so subscribing first is not a
    // preference. Minting first would also spend the ticket's sixty seconds on the handshake.
    assert.deepEqual(socket.methods(), ['mining.subscribe'])
    assert.equal(h.issued.length, 0, 'a ticket was minted before the connection was usable')

    socket.reply(1, SUBSCRIBE_RESULT)
    await settle()

    assert.deepEqual(socket.methods(), ['mining.subscribe', 'mining.authorize'])
    assert.equal(h.issued.length, 1)
  })

  it('puts the ticket in params[1] — the password position — and nowhere else', async () => {
    const h = harness()
    h.client.start()
    const socket = await authorised(h)

    const authorize = socket.find('mining.authorize')
    assert.ok(authorize, 'no mining.authorize was sent')
    const params = authorize['params'] as unknown[]
    const ticket = h.issued[0]?.ticket
    assert.ok(ticket)

    // On this transport the username is IGNORED and the password is the identity, which is the
    // reverse of raw TCP. `pool/src/session.ts` reads params[1] and nothing else.
    assert.equal(params[1], ticket, 'the ticket is not in the password position')
    assert.notEqual(params[0], ticket, 'the ticket was also sent as the username')
    assert.equal(params.length, 2, 'mining.authorize carries more than the two positional fields')
  })

  it('opens the socket at the published endpoint, byte for byte, with no second argument', async () => {
    const h = harness()
    h.client.start()
    await authorised(h)

    assert.deepEqual(
      h.urls,
      [ENDPOINT],
      'the client did not use the endpoint the pool published, verbatim. micro-org#285 is the ' +
        'defect where an address was derived rather than read, and it could not connect',
    )
    const ticket = h.issued[0]?.ticket
    assert.ok(ticket)
    for (const url of h.urls) {
      assert.equal(url.includes(ticket), false, 'the ticket was put in the URL')
      assert.equal(url.includes('?'), false, 'a query string was appended to the published endpoint')
    }
    // A subprotocol is the one other string a browser WebSocket constructor accepts, so it is the
    // tempting place to smuggle a credential. The factory is handed ONE argument, which is the
    // mechanical form of "no subprotocol" — `pool/src/wsstratum.ts` refuses to echo one anyway.
    assert.deepEqual(
      h.openArgs,
      [1],
      'the socket factory was called with more than a URL, which on a real WebSocket is the ' +
        'subprotocol argument',
    )
  })
})

/* ══════════════════════════════ the reconnect ══════════════════════════════ */

describe('a dropped socket', () => {
  it('mints a NEW ticket, and never re-sends the one it already spent', async () => {
    const h = harness()
    h.client.start()
    const first = await authorised(h, 0)
    const firstTicket = h.issued[0]?.ticket
    assert.ok(firstTicket)

    first.drop()
    assert.equal(h.client.status, 'reconnecting')
    h.runTimers()

    const second = await authorised(h, 1)
    assert.equal(h.sockets.length, 2, 'the client did not reconnect')
    assert.equal(h.issued.length, 2, 'the reconnect did not mint a fresh ticket')

    const secondTicket = h.issued[1]?.ticket
    assert.ok(secondTicket)
    assert.notEqual(secondTicket, firstTicket, 'the harness handed out the same ticket twice')

    const authorize = second.find('mining.authorize')
    assert.ok(authorize)
    assert.equal(
      (authorize['params'] as unknown[])[1],
      secondTicket,
      'the reconnect presented the ticket from the previous connection. A ticket is spent on ' +
        'redemption, so the pool refuses it — and the refusal is indistinguishable from an ' +
        'expired session',
    )

    // Stronger than checking the one field: the first ticket appears NOWHERE on the second socket.
    assert.equal(
      second.sent.some((frame) => frame.includes(firstTicket)),
      false,
      'the first connection’s ticket appears somewhere in the second connection’s traffic',
    )
  })

  it('backs off, and says so in seconds', async () => {
    const h = harness()
    h.client.start()
    const first = await authorised(h, 0)
    first.drop()

    const reconnecting = h.statuses.filter((entry) => entry.status === 'reconnecting')
    assert.equal(reconnecting.length, 1)
    // Jitter is pinned to zero in this harness, so the first delay is the first step of the ladder.
    assert.match(reconnecting[0]?.detail ?? '', /Reconnecting in 0\.5 seconds/)
    assert.match(reconnecting[0]?.detail ?? '', /new mining ticket/)
  })

  it('does not reconnect after Stop, and closes the socket it holds', async () => {
    const h = harness()
    h.client.start()
    const socket = await authorised(h, 0)

    h.client.stop()
    assert.equal(h.client.status, 'stopped')
    assert.deepEqual(socket.closed, { code: 1000, reason: 'stopped' })

    // The close handler this triggers must not schedule anything: the generation was bumped before
    // the socket was closed, precisely so Stop and a reconnect cannot race.
    socket.drop()
    h.runTimers()
    assert.equal(h.sockets.length, 1, 'Stop was followed by a reconnect')
  })
})

/* ══════════════════════════════ the credential's lifetime ══════════════════════════════ */

describe('the ticket', () => {
  it('is dropped, not sent, when Stop happens while the mint is in flight', async () => {
    let release: ((ticket: MiningTicket) => void) | null = null
    const h = harness({
      mint: () =>
        new Promise<MiningTicket>((resolve) => {
          release = resolve
        }),
    })
    h.client.start()
    const socket = h.sockets[0]
    assert.ok(socket)
    socket.open()
    socket.reply(1, SUBSCRIBE_RESULT)
    await settle()

    // The reader presses Stop before the ticket request comes back.
    h.client.stop()
    assert.ok(release)
    ;(release as (t: MiningTicket) => void)({
      ticket: 'pt_live_ticket_that_must_never_be_sent',
      account: 'cf-0123456789abcdef',
      worker: 'web-1',
      expiresInMs: 60_000,
    })
    await settle()

    assert.equal(
      socket.sent.some((frame) => frame.includes('pt_live_ticket_that_must_never_be_sent')),
      false,
      'a ticket that arrived after Stop was authorised anyway — the page would show a stopped ' +
        'miner that is mining',
    )
    assert.equal(socket.find('mining.authorize'), undefined)
  })

  it('is not repeated back to the reader when the pool refuses it', async () => {
    const h = harness()
    h.client.start()
    const socket = await authorised(h)
    const ticket = h.issued[0]?.ticket
    assert.ok(ticket)

    socket.reply(2, false, [24, 'Unauthorized worker', null])
    assert.equal(h.client.status, 'failed')

    for (const entry of h.statuses) {
      assert.equal(
        entry.detail.includes(ticket),
        false,
        'the refusal message quotes the ticket. Every sentence this client produces is rendered on ' +
          'a page and may be pasted into a support conversation',
      )
    }
    // The pool's own sentence is passed through, so the reader is told something actionable.
    const failed = h.statuses.find((entry) => entry.status === 'failed')
    assert.match(failed?.detail ?? '', /Unauthorized worker/)
  })

  /**
   * The refusal that must not become "sign in again".
   *
   * micro-pool answers `503 identity_unavailable` when it could not REACH identity to judge the
   * token, and it is deliberately not a 401 — the token was never judged at all. A client that
   * flattens every ticket failure into one sentence sends the reader to re-authenticate against the
   * service that is down; they come back with a fresh token, hit exactly the same failure, and now
   * believe their account is broken. The status carries the code, so the client can tell.
   */
  it('does not tell the reader to sign in when identity was merely unreachable', async () => {
    const h = harness({
      mint: () =>
        Promise.reject(
          new ApiError(
            503,
            'identity could not be reached; try again shortly',
            'identity_unavailable',
            'cf-req-1',
          ),
        ),
    })
    h.client.start()
    await authorised(h)

    const failed = h.statuses.find((entry) => entry.status === 'failed')
    assert.ok(failed, 'a ticket that could not be minted left the client without a failed status')
    assert.doesNotMatch(
      failed.detail,
      /sign in/i,
      'an unreachable identity service is reported as a session problem, which sends the reader to ' +
        'sign in again against the very service that is down',
    )
    assert.match(
      failed.detail,
      /identity/i,
      'the reader is not told which part of the estate is unavailable, so the only thing left to ' +
        'suspect is their own account',
    )
  })

  it('reports a deployment with browser mining switched off as a deployment setting', async () => {
    const h = harness({
      mint: () =>
        Promise.reject(
          new ApiError(503, 'this pool is not configured for browser mining', 'browser_mining_unavailable', 'cf-req-2'),
        ),
    })
    h.client.start()
    await authorised(h)

    const failed = h.statuses.find((entry) => entry.status === 'failed')
    assert.match(
      failed?.detail ?? '',
      /this deployment has not switched browser mining on/i,
      'the same 503 as an unreachable identity service produces the same sentence, though one is ' +
        'an operator decision and the other is an outage',
    )
  })

  it('is minted once per connection and never held in a field', async () => {
    const h = harness()
    h.client.start()
    const socket = await authorised(h)
    const ticket = h.issued[0]?.ticket
    assert.ok(ticket)

    // A structural check rather than a behavioural one, and deliberately so: the rule is that there
    // is nowhere for a credential to live, not that it happens not to be read. Anything reachable
    // from the instance is reachable from a debugger snapshot, an error serialiser and a `toJSON`.
    const visible = JSON.stringify(h.client, (_key, value: unknown) =>
      value instanceof Uint8Array ? Array.from(value) : value,
    )
    assert.equal(
      visible.includes(ticket),
      false,
      'the ticket is enumerable on the client instance',
    )
    assert.equal(
      Object.values(h.client as unknown as Record<string, unknown>).includes(ticket),
      false,
      'the ticket is an own property of the client',
    )
    assert.equal(socket.messages().length, 2)
  })
})

/* ══════════════════════════════ work ══════════════════════════════ */

describe('work and shares', () => {
  it('does not submit before the pool has sent a job', async () => {
    const h = harness()
    h.client.start()
    const socket = await authorised(h)
    socket.reply(2, true)

    const submitted = h.client.submit({
      jobId: 'job-1',
      extranonce2Hex: '00000000',
      ntimeHex: '5f5e1000',
      nonceHex: 'deadbeef',
    })
    assert.equal(submitted, false, 'a share was submitted before any job existed')
    assert.equal(socket.find('mining.submit'), undefined)
  })

  /**
   * The delimiter that is on the wire and not in the browser's hands.
   *
   * The contract is one newline-delimited JSON-RPC message per TEXT frame, and micro-pool takes the
   * newline off on the way out — `pool/src/wsframe.ts` strips a trailing one when it sends and adds
   * one back to anything a client sends without it. So the delimiter is real, a browser never sees
   * it, and a client that fed a whole frame to `JSON.parse` would be relying on that stripping
   * continuing to happen. Both readings are exercised here, including two objects in one frame.
   */
  it('reads a frame whether or not the newline the contract names is still on it', async () => {
    const h = harness()
    h.client.start()
    const socket = await authorised(h)
    socket.reply(2, true)

    socket.onmessage?.({ data: `${JSON.stringify({ id: null, method: 'mining.set_difficulty', params: [0.015625] })}\n` })
    assert.equal(h.client.difficulty, 0.015625, 'a frame with the contract’s newline still on it was dropped')

    const two = [
      JSON.stringify({ id: null, method: 'mining.set_difficulty', params: [0.00390625] }),
      JSON.stringify({ id: null, method: 'mining.set_difficulty', params: [0.0078125] }),
    ].join('\n')
    socket.onmessage?.({ data: two })
    assert.equal(
      h.client.difficulty,
      0.0078125,
      'two messages in one frame were read as one unparseable string, so the pool lowered the ' +
        'difficulty and this tab kept grinding for the old one',
    )
  })

  it('reports set_difficulty and then submits with the five positional fields', async () => {
    const h = harness()
    h.client.start()
    const socket = await authorised(h)
    socket.reply(2, true)
    socket.notify('mining.set_difficulty', [0.00390625])
    assert.equal(h.client.difficulty, 0.00390625)

    socket.notify('mining.notify', [
      'job-1',
      '00'.repeat(32),
      '01000000',
      '02000000',
      [],
      '20000000',
      '207fffff',
      '5f5e1000',
      true,
    ])
    assert.equal(h.client.status, 'mining')

    const fields = {
      jobId: 'job-1',
      extranonce2Hex: '00000001',
      ntimeHex: '5f5e1000',
      nonceHex: '0000002a',
    }
    assert.equal(h.client.submit(fields), true)

    const submit = socket.find('mining.submit')
    assert.ok(submit, 'no mining.submit was sent')
    // FIVE, in this order. `pool/src/session.ts` destructures positionally and ignores the first,
    // so a four-element array shifts every field one place left and is read as a different share.
    // `test/pool-contract.test.ts` proves that against the server itself; this only checks the
    // client puts the values it was handed into the positions that test settled.
    assert.deepEqual(submit['params'], [
      'web',
      fields.jobId,
      fields.extranonce2Hex,
      fields.ntimeHex,
      fields.nonceHex,
    ])
  })
})
