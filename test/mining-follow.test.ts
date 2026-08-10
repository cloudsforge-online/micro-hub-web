/**
 * HOW THE BROWSER MINER LEARNS THE TIP MOVED — AND WHAT IT DOES WHEN IT CANNOT.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS, AND WHY IT IS THE HALF THAT WAS MISSING.
 *
 * micro-org#236. `src/mining/miner.js` is vendored from `network-site`, and this copy had the
 * `EventSource` DELETED — because the estate's gateway published `/mining/template` and
 * `/mining/submit` and not `/events`, so on a real deployment the stream was answered 405 by the
 * JSON-RPC router and a non-200 is fatal to an `EventSource`: `readyState` goes to CLOSED and the
 * browser does not retry. One failed request, then permanent silence.
 *
 * DELETING A FEATURE IS A LEGITIMATE ANSWER TO A BROKEN DEPENDENCY. WHAT WAS MISSING IS THIS FILE.
 * Nothing in either repository would have gone red when the dependency came back, so the two
 * copies of the same miner drifted with no signal — one polling silently, one streaming — and the
 * only symptom on either was a stale rate nobody could attribute.
 *
 * The gateway now routes `/events` (`cf-api-mining-events`) and this copy opens it again. What is
 * asserted here is not the route, though: it is the CLIENT'S OWN HONESTY. A client that cannot
 * tell a live stream from a dead one produces the same silence the next time anything upstream
 * refuses — a saturated node (`SSE_MAX_CLIENTS`, 503), the gateway's per-IP stream cap
 * (`cf-sse-inflight`, 429), a buffering corporate proxy, a phone changing networks. It must know
 * which of the two it is in, poll harder when it is blind, and say so on screen.
 *
 * ── NO DOM HERE, UNLIKE test/mine.test.ts ─────────────────────────────────────────────────────
 *
 * `/mine`'s rendering is asserted through the real screen harness next door. This file is about a
 * state machine whose only inputs are a browser's callbacks, and the only way to assert one of
 * those is to fire them by hand: `_follow()` touches three globals — `EventSource`, `setInterval`
 * and `document` — and all three are stubbed below. The stub `EventSource` connects to nothing; it
 * exposes `readyState` and lets the test drive `onopen`/`onerror`, which is exactly the pair of
 * transitions the deleted code had no answer for.
 *
 * ── WHAT IS NOT ASSERTED HERE, AND WHERE IT LIVES ─────────────────────────────────────────────
 *
 * That the node serves the stream, caps it and heartbeats it: `hearth/node/test/sse.js`. That the
 * gateway routes it: micro-deploy's `cf-api-mining-events` router. That `network-site`'s copy does
 * the same: its own `test/mining-follow.test.ts`. Three repositories, three halves; this one owns
 * only "what does this bundle's browser do about it".
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

/** The two transitions the shipped code had no answer for, driveable by hand. */
class StubEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  static opened: string[] = []
  static last: StubEventSource | null = null

  readyState = StubEventSource.CONNECTING
  onopen: (() => void) | null = null
  onmessage: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(readonly url: string) {
    StubEventSource.opened.push(url)
    StubEventSource.last = this
  }

  /** What a browser does on a 200 with `content-type: text/event-stream`. */
  connect() {
    this.readyState = StubEventSource.OPEN
    this.onopen?.()
  }

  /** What a browser does on ANY non-200 — 405, 429, 503 alike. It does not retry. */
  refuse() {
    this.readyState = StubEventSource.CLOSED
    this.onerror?.()
  }

  /** And what it does on a transport blip: it reconnects by itself, so this is not a failure. */
  blip() {
    this.readyState = StubEventSource.CONNECTING
    this.onerror?.()
  }

  close() {
    this.closed = true
    this.readyState = StubEventSource.CLOSED
  }
}

interface Timer {
  ms: number
  fn: () => void
  cleared: boolean
}

const timers = new Map<number, Timer>()
let nextTimer = 1

/** Live (uncleared) intervals. The count is an assertion in its own right: two timers doing the
 *  same job is the shape of a leak, and `_pollEvery` swapping periods is where one would appear. */
function liveTimers(): Timer[] {
  return [...timers.values()].filter((t) => !t.cleared)
}

const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval
const realEventSource = (globalThis as Record<string, unknown>).EventSource
const realDocument = (globalThis as Record<string, unknown>).document

before(() => {
  ;(globalThis as Record<string, unknown>).EventSource = StubEventSource
  ;(globalThis as Record<string, unknown>).document = {
    hidden: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  ;(globalThis as unknown as { setInterval: unknown }).setInterval = (fn: () => void, ms: number) => {
    const id = nextTimer++
    timers.set(id, { ms, fn, cleared: false })
    return id
  }
  ;(globalThis as unknown as { clearInterval: unknown }).clearInterval = (id: number) => {
    const t = timers.get(id)
    if (t) t.cleared = true
  }
})

after(() => {
  ;(globalThis as unknown as { setInterval: unknown }).setInterval = realSetInterval
  ;(globalThis as unknown as { clearInterval: unknown }).clearInterval = realClearInterval
  ;(globalThis as Record<string, unknown>).EventSource = realEventSource
  ;(globalThis as Record<string, unknown>).document = realDocument
})

type MinerUnderTest = import('../src/mining/miner.js').Miner

async function newMiner(rpc = 'https://rpc.example.test'): Promise<MinerUnderTest> {
  const { Miner } = await import('../src/mining/miner.js')
  return new Miner({
    rpc,
    // A valid-shaped key so the constructor's own guard passes. It signs nothing here: no block is
    // mined in this file, and `_follow()` never touches it.
    key: { priv: new Uint8Array(32).fill(7), pubHex: '0x' + '11'.repeat(65) },
    workers: 1,
  })
}

/** The stream the miner opened, which is always the one the stub constructed last. */
function stream(): StubEventSource {
  const es = StubEventSource.last
  assert.ok(es, 'the miner opened no stream at all')
  return es
}

/** Collect `follow` events in order, as the page's own listener sees them. */
function watchFollow(m: MinerUnderTest): boolean[] {
  const seen: boolean[] = []
  m.addEventListener('follow', (e) => seen.push(Boolean((e as CustomEvent).detail.following)))
  return seen
}

describe('the miner follows the chain, and knows when it is not', () => {
  it('polls hard from the moment it dials, before the stream has answered', async () => {
    // THE ORDERING THAT MATTERS. `new EventSource(...)` returns instantly and connects later, so
    // between the dial and the first byte the miner is blind. Waiting for `onerror` to start the
    // fallback would leave that window unpolled — and against an endpoint that answers 405, the
    // window is the whole session.
    timers.clear()
    StubEventSource.opened = []
    const m = await newMiner()
    m._follow()

    assert.deepEqual(StubEventSource.opened, ['https://rpc.example.test/events'])
    assert.equal(m.following, false, 'not following until the stream actually opens')
    assert.equal(m._refreshEveryMs, 10_000)
    assert.equal(liveTimers().length, 1, 'exactly one interval, not one per state change')
  })

  it('backs the timer off once the stream is genuinely open', async () => {
    timers.clear()
    const m = await newMiner()
    const seen = watchFollow(m)
    m._follow()
    stream().connect()

    assert.equal(m.following, true)
    assert.deepEqual(seen, [true])
    // 45 s is inside the node's 120 s template TTL, so a missed frame still cannot leave this tab
    // grinding on an expired template.
    assert.equal(m._refreshEveryMs, 45_000)
    assert.deepEqual(
      liveTimers().map((t) => t.ms),
      [45_000],
      'the 10 s timer was replaced, not joined',
    )
  })

  it('a refusal is noticed, said out loud, and polled around', async () => {
    // The regression. 405 (no route), 429 (`cf-sse-inflight`) and 503 (`SSE_MAX_CLIENTS`) are the
    // same event to an `EventSource`: readyState CLOSED, no retry, no further callbacks ever.
    timers.clear()
    const m = await newMiner()
    const seen = watchFollow(m)
    m._follow()
    stream().connect()
    stream().refuse()

    assert.equal(m.following, false)
    assert.deepEqual(seen, [true, false], 'the page is told, so it can put a line on the screen')
    assert.equal(m._refreshEveryMs, 10_000, 'and polls at block cadence while it is blind')
    assert.equal(liveTimers().length, 1)
  })

  it('does not re-dial a refused stream', async () => {
    // A browser that re-opens a refused stream forever is indistinguishable from the outage it is
    // in, and both caps on this route (503 at the node, 429 at the gateway) refuse rather than
    // queue precisely so a client can back off. One dial, then the timer.
    timers.clear()
    StubEventSource.opened = []
    const m = await newMiner()
    m._follow()
    stream().refuse()
    stream().refuse()

    assert.equal(StubEventSource.opened.length, 1)
  })

  it('leaves an ordinary blip alone, because the browser is already handling it', async () => {
    // `onerror` fires for a dropped connection too, and there the browser reconnects by itself.
    // Treating that as a failure would drop a healthy miner to the fast poll for the rest of the
    // session on one flaky moment. `readyState` is what separates the two.
    timers.clear()
    const m = await newMiner()
    const seen = watchFollow(m)
    m._follow()
    stream().connect()
    stream().blip()

    assert.equal(m.following, true, 'still following — CONNECTING means it is coming back')
    assert.deepEqual(seen, [true])
    assert.equal(m._refreshEveryMs, 45_000)
  })

  it('stopping takes the stream and the timer with it', async () => {
    // A worker pool left running is caught elsewhere; an interval left running is not, and it holds
    // a closure over a miner that is meant to be gone.
    timers.clear()
    const m = await newMiner()
    m._follow()
    stream().connect()
    const es = stream()
    m.stop()

    assert.equal(es.closed, true)
    assert.equal(m._sse, null)
    assert.equal(m._refreshTimer, null)
    assert.equal(m.following, false)
    assert.equal(liveTimers().length, 0)
  })
})
