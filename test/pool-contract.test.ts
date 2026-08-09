/**
 * The Stratum client, driven against micro-pool's OWN server code.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS TEST OPENS A SIBLING REPOSITORY. IT DOES NOT SKIP WHEN THE CHECKOUT IS ABSENT.
 *
 * The same position `test/wallet-assets.test.ts` takes, for a stronger version of the same reason.
 * A carried copy of somebody else's protocol drifts, and a byte-order or parameter-order defect in
 * a Stratum client is INVISIBLE from inside this repository: every other harness here answers its
 * own requests, so a client that assembles the header wrong produces thirty-two uniformly
 * distributed bytes that fail the target comparison exactly as an honest losing nonce does. The
 * page would report a healthy hashrate, submit nothing all afternoon, and pass a suite written
 * against its own assumptions.
 *
 * So the assertions below are not "the client builds what the client expects". They are:
 *
 *   - `pool/src/work.ts` produces the `mining.notify` parameters, and `lib/stratum.ts` parses them.
 *   - `pool/src/session.ts` — the real `Session` class, not a re-description of it — produces the
 *     `mining.subscribe` reply and consumes the `mining.submit` this client builds.
 *   - `pool/src/validate.ts`, reached through that Session, reconstructs the header from its own
 *     record of the job and agrees that the digest this client found is a share.
 *
 * If any of the four byte orders is wrong, or the submit parameters are in the wrong positions, or
 * the merkle branch is folded in display order, the share is rejected and this test is red. That is
 * the only mechanism available: there is no runtime signal on the browser side, ever.
 *
 * ── HOW THE SERVER'S MODULES ARE LOADED, AND WHY IT LOOKS LIKE THIS ───────────────────────────
 *
 * By dynamic `import()` of a computed path, rather than a static import. Two reasons, both forced:
 *
 *   1. `tsc --noEmit` in this repository would typecheck a statically imported sibling, and
 *      `pool/src/chains.ts` imports `@cloudsforge/contracts-chain` — a package this browser bundle
 *      neither has nor should have. A computed specifier is not followed by the type checker.
 *   2. The checkout in CI has no `node_modules`, so anything that pulled a runtime dependency in
 *      would fail there and pass here. The modules reached below import nothing but `node:crypto`
 *      and each other: everything external in that graph is `import type`, which esbuild elides.
 *      That is a property of the pool's source, so it is asserted rather than assumed.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { scryptPow } from '../src/lib/scrypt.ts'
import {
  bytesToHex,
  buildSubmitParams,
  extranonce2,
  hashesPerDifficulty,
  headerFor,
  meetsTarget,
  parseNotify,
  parseSubscribe,
  targetForDifficulty,
  toStratumScalar,
  writeNonce,
  type StratumJob,
} from '../src/lib/stratum.ts'

/** The working tree the sibling repositories sit in: `hub-web/..`. */
const ESTATE = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Named with the file that proves the checkout is the right one, for the reason `wallet-assets`
 * gives: a glob makes "absent" and "named something else" the same silent outcome, and CI checks
 * `cloudsforge-online/micro-pool` out INTO a directory called `pool`.
 */
const POOL_PROOF = 'pool/src/session.ts'

/**
 * Another repository's module, as this side is allowed to see it.
 *
 * Deliberately untyped. These are internals reached across a boundary the type system cannot cross,
 * and writing local interfaces for them would be a fourth hand-maintained copy of the protocol —
 * the exact thing this file exists to make unnecessary.
 */
type PoolModule = Record<string, any>

/**
 * One of micro-pool's modules, loaded from the sibling checkout.
 *
 * The return type is deliberately loose. These are another repository's internals reached across a
 * boundary the type system cannot see, and writing local interfaces for them would be a fourth copy
 * of the protocol — the exact thing this file exists to stop.
 */
async function poolModule(name: string): Promise<PoolModule> {
  const proof = `${ESTATE}${POOL_PROOF}`
  if (!existsSync(proof)) {
    throw new Error(
      `${proof} is missing. Check micro-pool out as 'pool' beside this repository — this test ` +
        'does not skip, because a Stratum client with a reversed field submits nothing and looks ' +
        'exactly like a slow computer to every other test here.',
    )
  }
  const path = `${ESTATE}pool/src/${name}`
  return (await import(pathToFileURL(path).href)) as PoolModule
}

const work = await poolModule('work.ts')
const pow = await poolModule('pow.ts')
const validate = await poolModule('validate.ts')
const session = await poolModule('session.ts')
const vardiff = await poolModule('vardiff.ts')

/* ══════════════════════════════ a job, built by the pool ══════════════════════════════ */

/**
 * Regtest's `powLimit`. Roughly every second hash clears it, which is what makes the block path
 * reachable at all — the same constant and the same reason as `pool/src/faketemplate.ts`.
 */
const REGTEST_BITS = '207fffff'

/** A P2PKH scriptPubKey, the shape `validateaddress` returns. Never encoded here; it is a fixture. */
const PAYOUT_SCRIPT = `76a914${'11'.repeat(20)}88ac`

const CURRENT_TIME = 1_760_000_000

/**
 * A `BlockTemplate` as `parseTemplate` would have produced one.
 *
 * Built as a literal rather than through `pool/src/faketemplate.ts`, which is otherwise exactly the
 * right fixture: that file imports `@cloudsforge/http` for its fake node, and a CI checkout has no
 * `node_modules`. The transaction ids are real double-SHA-256 hashes of real bytes, which is the
 * property that matters — a merkle branch over strings that merely have 64 characters is a branch
 * over a tree that does not exist.
 */
function fakeTemplate(transactionCount: number): PoolModule {
  const transactions = Array.from({ length: transactionCount }, (_unused, index) => {
    const data = `0100000001${index.toString(16).padStart(8, '0')}${'00'.repeat(40)}`
    const bytes = Buffer.from(data, 'hex')
    const txid = createHash('sha256').update(createHash('sha256').update(bytes).digest()).digest()
    return { data, txid, isHogEx: false }
  })
  return {
    height: 800_000,
    version: 0x20000000,
    previousBlockHashHex: createHash('sha256').update('tip').digest().toString('hex'),
    curTime: CURRENT_TIME,
    minTime: CURRENT_TIME - 3600,
    bitsHex: REGTEST_BITS,
    blockTarget: pow['targetFromCompactBits'](Number.parseInt(REGTEST_BITS, 16)),
    coinbaseValue: 312_500_000n,
    transactions,
    witnessCommitmentHex: `6a24aa21a9ed${'22'.repeat(32)}`,
    mwebHex: null,
    longPollId: null,
    fetchedAt: new Date(CURRENT_TIME * 1000),
  }
}

const TICKET = 'a'.repeat(43)
const ACCOUNT = 'cf-1a2b3c4d5e6f7a8b'
const WORKER = 'web-3f9c1a'

interface Sent {
  readonly id: number | string | null
  readonly result?: unknown
  readonly error?: readonly [number, string, unknown] | null
  readonly method?: string
  readonly params?: readonly unknown[]
}

interface Harness {
  readonly session: PoolModule
  readonly sent: Sent[]
  readonly accepted: PoolModule[]
  /** The connection's extranonce1, as the pool assigned it. */
  readonly extranonce1Hex: string
}

/**
 * A real `Session` on a real `JobRegistry`, with a ticket it will redeem exactly once.
 *
 * `redeemTicket` single-use is not a detail of the fixture: `pool/src/tickets.ts` spends the ticket
 * on redemption, and the browser client's reconnect path depends on that being true. The closure
 * below reproduces it rather than approximating it, so `test/stratum-client.test.ts` and this file
 * agree about what a spent ticket does.
 */
function harness(transactionCount = 3): Harness {
  const registry = new work['JobRegistry']({
    chain: 'ltc',
    tag: Buffer.from('cf', 'utf8'),
    extranonce1Size: 4,
    extranonce2Size: 4,
  })
  registry.setPayoutScript(PAYOUT_SCRIPT)
  registry.push(fakeTemplate(transactionCount))

  const sent: Sent[] = []
  const accepted: PoolModule[] = []
  let spent = false
  const hashesPer = hashesPerDifficulty('scrypt')

  const live = new session['Session']({
    chain: 'ltc',
    algorithm: 'scrypt',
    registry,
    extranonce1: Buffer.from('deadbeef', 'hex'),
    extranonce2Size: 4,
    initialDifficulty: vardiff['browserInitialDifficulty'](hashesPer),
    minDifficulty: vardiff['BROWSER_MIN_HASHES_PER_SHARE'] / hashesPer,
    maxDifficulty: 65_536,
    vardiff: vardiff['browserVardiff'](vardiff['DEFAULT_VARDIFF'], hashesPer),
    now: () => CURRENT_TIME * 1000,
    send: (message: Sent) => sent.push(message),
    onAcceptedShare: (share: PoolModule) => accepted.push(share),
    onBlock: () => {},
    redeemTicket: (secret: string) => {
      if (secret !== TICKET || spent) return null
      spent = true
      return { account: ACCOUNT, worker: WORKER }
    },
  })

  return { session: live, sent, accepted, extranonce1Hex: 'deadbeef' }
}

/** Subscribe and authorise, and hand back what the client parsed out of each reply. */
function connect(h: Harness): { subscription: ReturnType<typeof parseSubscribe>; job: StratumJob; difficulty: number } {
  h.session.handle({ id: 1, method: 'mining.subscribe', params: ['cloudsforge-hub-web/1'] })
  const subscribeReply = h.sent.find((m) => m.id === 1)
  assert.ok(subscribeReply, 'the pool answered mining.subscribe')
  const subscription = parseSubscribe(subscribeReply.result)

  h.session.handle({ id: 2, method: 'mining.authorize', params: ['x', TICKET] })
  const authorizeReply = h.sent.find((m) => m.id === 2)
  assert.equal(authorizeReply?.result, true, 'the ticket was redeemed')

  const difficultyMessage = h.sent.find((m) => m.method === 'mining.set_difficulty')
  assert.ok(difficultyMessage, 'the pool set a difficulty before sending work')
  const difficulty = (difficultyMessage.params as readonly number[])[0] as number

  const notify = h.sent.find((m) => m.method === 'mining.notify')
  assert.ok(notify, 'the pool sent a job')
  return { subscription, job: parseNotify(notify.params), difficulty }
}

/**
 * Grind until a share clears the target, exactly as the Worker does.
 *
 * The nonce ceiling is a bound on a test, not on the miner: at the browser difficulty the pool sets
 * for scrypt, roughly one hash in a thousand clears, so a run that reached the ceiling would mean
 * the header is being assembled wrong rather than that the machine was unlucky.
 */
function mine(job: StratumJob, subscription: ReturnType<typeof parseSubscribe>, difficulty: number) {
  const target = targetForDifficulty('scrypt', difficulty)
  const counter = extranonce2(1, subscription.extranonce2Size)
  const header = headerFor({ job, extranonce1: subscription.extranonce1, extranonce2: counter })
  for (let nonce = 0; nonce < 200_000; nonce += 1) {
    writeNonce(header, nonce)
    if (meetsTarget(scryptPow(header), target)) {
      return { extranonce2Hex: bytesToHex(counter), nonceHex: toStratumScalar(nonce), header }
    }
  }
  throw new Error(`no share in 200000 nonces at difficulty ${difficulty} — the header is wrong, not unlucky`)
}

/* ══════════════════════════════ the tests ══════════════════════════════ */

describe('the pool and this client agree about the wire', () => {
  it('parses the subscribe reply the pool actually sends', () => {
    const h = harness()
    h.session.handle({ id: 1, method: 'mining.subscribe', params: [] })
    const reply = h.sent.find((m) => m.id === 1)
    const subscription = parseSubscribe(reply?.result)
    assert.equal(bytesToHex(subscription.extranonce1), h.extranonce1Hex)
    assert.equal(subscription.extranonce2Size, 4)
  })

  it('parses the nine parameters of mining.notify in the order work.ts emits them', () => {
    const h = harness()
    const { job } = connect(h)
    assert.equal(job.versionHex, '20000000')
    assert.equal(job.bitsHex, REGTEST_BITS)
    assert.equal(job.ntimeHex, toStratumScalar(CURRENT_TIME))
    assert.equal(job.merkleSteps.length, 2, 'three transactions give a two-step branch')
    assert.equal(job.cleanJobs, true, 'the first job on a new tip is clean')
  })

  /**
   * THE ONE THAT MATTERS. Everything else in this file is a shape check; this is the round trip.
   *
   * The client folds the branch, assembles the coinbase, builds the eighty bytes and finds a nonce.
   * The SERVER then reconstructs all of that from its own record of the job — it trusts nothing in
   * the submission but the four small strings — hashes it with its own scrypt, and says whether the
   * digest is a share. Agreement here is agreement about all four byte orders at once.
   */
  it('builds a mining.submit the pool accepts, and the pool credits the share', () => {
    const h = harness()
    const { subscription, job, difficulty } = connect(h)
    const solution = mine(job, subscription, difficulty)

    const params = buildSubmitParams({
      worker: `${ACCOUNT}.${WORKER}`,
      jobId: job.jobId,
      extranonce2Hex: solution.extranonce2Hex,
      ntimeHex: job.ntimeHex,
      nonceHex: solution.nonceHex,
    })
    h.session.handle({ id: 3, method: 'mining.submit', params })

    const reply = h.sent.find((m) => m.id === 3)
    assert.equal(
      reply?.error ?? null,
      null,
      `the pool rejected the share: ${JSON.stringify(reply?.error)}`,
    )
    assert.equal(reply?.result, true)
    assert.equal(h.accepted.length, 1, 'the share was credited')
    assert.equal(h.accepted[0]?.['account'], ACCOUNT)
    assert.equal(h.accepted[0]?.['worker'], WORKER)
  })

  /**
   * The empty branch, which is a different code path and the one a quiet chain spends all day in.
   *
   * A template with only its coinbase has the coinbase txid AS the merkle root, so the fold runs
   * zero times. A client that mishandled that — by folding the txid against itself, say — would
   * pass the test above and fail here, and Litecoin blocks with no other transaction are ordinary.
   */
  it('accepts a share against a template that carries no transactions but the coinbase', () => {
    const h = harness(0)
    const { subscription, job, difficulty } = connect(h)
    assert.equal(job.merkleSteps.length, 0)
    const solution = mine(job, subscription, difficulty)
    h.session.handle({
      id: 3,
      method: 'mining.submit',
      params: buildSubmitParams({
        worker: WORKER,
        jobId: job.jobId,
        extranonce2Hex: solution.extranonce2Hex,
        ntimeHex: job.ntimeHex,
        nonceHex: solution.nonceHex,
      }),
    })
    assert.equal(h.sent.find((m) => m.id === 3)?.result, true)
  })

  /**
   * `params[0]` is ignored by the server and MUST still occupy its position.
   *
   * `pool/src/session.ts` destructures by position and skips the first element. An array that
   * omitted the worker puts the job id where the worker belongs and shifts every subsequent field
   * one place left, so the pool reads the extranonce2 as a job id and finds no nonce at the end.
   *
   * The share is refused, which is the point — but notice WHAT it is refused for: the pool answers
   * 20, "mining.submit takes worker, job id, extranonce2, ntime and nonce", because the fifth field
   * ran off the end. That message names the missing parameter, so this particular mistake is at
   * least diagnosable from the miner's side. It is diagnosable ONLY because this client does not
   * negotiate version rolling: a six-element submit shifted by one has a string in every checked
   * position, passes the type guards intact, and comes back as a job that does not exist — a stale
   * share, which is the one rejection an operator is trained to ignore.
   *
   * So the reason `buildSubmitParams` always emits the worker is recorded here as an executable
   * fact rather than as a comment, and the assertion is on the rejection rather than on the code:
   * the code is a property of how far the shift happens to run off the end.
   */
  it('would be misread by the server if the ignored worker parameter were omitted', () => {
    const h = harness()
    const { subscription, job, difficulty } = connect(h)
    const solution = mine(job, subscription, difficulty)

    const correct = buildSubmitParams({
      worker: WORKER,
      jobId: job.jobId,
      extranonce2Hex: solution.extranonce2Hex,
      ntimeHex: job.ntimeHex,
      nonceHex: solution.nonceHex,
    })
    assert.equal(correct.length, 5)
    assert.equal(correct[0], WORKER)
    assert.equal(correct[1], job.jobId)

    // The same fields with the worker dropped — what a client that read "params[0] is ignored" as
    // "params[0] is optional" would send.
    h.session.handle({ id: 4, method: 'mining.submit', params: correct.slice(1) })
    const reply = h.sent.find((m) => m.id === 4)
    assert.equal(reply?.result, false, 'the shifted array is not a share')
    assert.equal(
      reply?.error?.[0],
      validate['STRATUM_ERROR'].OTHER,
      'the shift runs the nonce off the end, which the server names in its refusal',
    )

    // And the same submission, sent correctly, IS a share — so the difference above is the worker
    // parameter and nothing else about the solution.
    h.session.handle({ id: 5, method: 'mining.submit', params: correct })
    assert.equal(h.sent.find((m) => m.id === 5)?.result, true)
  })

  /**
   * `mining.subscribe` IS MANDATORY, AND THE WRITTEN CONTRACT DOES NOT SAY SO.
   *
   * The contract describes `mining.authorize` and the ticket and stops there. The server refuses a
   * submit with error 25 unless the connection subscribed first, and — worse, because it is silent
   * — `pushJob` returns without sending anything at all in the same condition, so a client that
   * authorised and waited would hold a healthy socket that never receives a job and never says why.
   *
   * This test is what makes that finding hold: it is the executable form of the under-specification
   * report, and it goes red if the pool ever relaxes the requirement, at which point the client's
   * mandatory subscribe becomes merely harmless rather than load-bearing.
   */
  it('refuses a submit from a connection that authorised without subscribing', () => {
    const h = harness()
    h.session.handle({ id: 2, method: 'mining.authorize', params: ['x', TICKET] })
    assert.equal(
      h.sent.some((m) => m.method === 'mining.notify'),
      false,
      'an unsubscribed connection is sent no work at all, and is told nothing',
    )
    h.session.handle({
      id: 3,
      method: 'mining.submit',
      params: [WORKER, '1', '00000000', toStratumScalar(CURRENT_TIME), '00000000'],
    })
    assert.equal(h.sent.find((m) => m.id === 3)?.error?.[0], validate['STRATUM_ERROR'].NOT_SUBSCRIBED)
  })

  /**
   * The ticket goes in `params[1]`, and the username is not read.
   *
   * On this transport the two are the reverse of raw TCP, which `pool/src/session.ts` explains at
   * length. A client that sent the ticket as the username — the arrangement every Stratum tutorial
   * describes — would be refused, and this pins which of the two the client chose.
   */
  it('redeems the ticket from the password position and ignores the username', () => {
    const h = harness()
    h.session.handle({ id: 1, method: 'mining.subscribe', params: [] })
    h.session.handle({ id: 2, method: 'mining.authorize', params: [TICKET, 'x'] })
    assert.equal(h.sent.find((m) => m.id === 2)?.result, false, 'a ticket in the username is not a ticket')

    const fresh = harness()
    fresh.session.handle({ id: 1, method: 'mining.subscribe', params: [] })
    fresh.session.handle({ id: 2, method: 'mining.authorize', params: ['anything at all', TICKET] })
    assert.equal(fresh.sent.find((m) => m.id === 2)?.result, true)
    assert.equal(fresh.session.account, ACCOUNT, 'the account comes from the ticket, not the username')
  })

  /**
   * A ticket is single use, which is what forces the reconnect path to mint a new one.
   *
   * Asserted here against the redemption rule itself rather than in the client's own suite alone,
   * so that "the ticket cannot be replayed" is checked where the rule lives.
   */
  it('refuses a second authorize with the same ticket', () => {
    const h = harness()
    h.session.handle({ id: 1, method: 'mining.subscribe', params: [] })
    h.session.handle({ id: 2, method: 'mining.authorize', params: ['x', TICKET] })
    assert.equal(h.sent.find((m) => m.id === 2)?.result, true)

    const second = harness()
    second.session.handle({ id: 1, method: 'mining.subscribe', params: [] })
    second.session.handle({ id: 2, method: 'mining.authorize', params: ['x', 'b'.repeat(43)] })
    assert.equal(second.sent.find((m) => m.id === 2)?.result, false)
  })
})

describe('the numbers this client computes are the pool’s numbers', () => {
  it('agrees with pool/src/pow.ts about difficulty-1 and hashes per difficulty', () => {
    assert.equal(hashesPerDifficulty('scrypt'), pow['hashesPerDifficulty']('scrypt'))
    assert.equal(hashesPerDifficulty('sha256d'), pow['hashesPerDifficulty']('sha256d'))
    for (const difficulty of [0.00390625, 0.015625, 1, 1024, 65_536]) {
      assert.equal(
        targetForDifficulty('scrypt', difficulty),
        pow['targetForDifficulty']('scrypt', difficulty),
        `the scrypt target at difficulty ${difficulty}`,
      )
      assert.equal(
        targetForDifficulty('sha256d', difficulty),
        pow['targetForDifficulty']('sha256d', difficulty),
      )
    }
  })

  /**
   * The proof-of-work functions themselves, on the same bytes.
   *
   * `pool/src/pow.ts` calls OpenSSL through `node:crypto`; `src/lib/scrypt.ts` is this repository's
   * own. `test/scrypt.test.ts` checks the primitive in isolation; this checks that the two ARE the
   * same function at the point where a disagreement would cost a share.
   */
  it('computes the same scrypt digest as the pool for the same header', () => {
    const h = harness()
    const { subscription, job } = connect(h)
    const header = headerFor({
      job,
      extranonce1: subscription.extranonce1,
      extranonce2: extranonce2(7, subscription.extranonce2Size),
      nonceHex: '0000002a',
    })
    assert.equal(
      bytesToHex(scryptPow(header)),
      (pow['powHash']('scrypt', Buffer.from(header)) as Buffer).toString('hex'),
    )
  })
})

describe('the pool source this client was written against', () => {
  /**
   * The submit parameter order, read out of the server rather than restated.
   *
   * `pool/src/session.ts` destructures `mining.submit`'s parameters into named bindings, and the
   * ORDER of those bindings is the contract. This lifts the destructuring pattern out of the source
   * and compares it to what `buildSubmitParams` emits, so a reordering upstream fails here with a
   * message that names both — rather than as a mysterious rejected share.
   */
  it('destructures submit into the positions buildSubmitParams fills', () => {
    const source = readFileSync(`${ESTATE}${POOL_PROOF}`, 'utf8')
    const pattern = /const \[([^\]]*)\] = params/.exec(source)
    assert.ok(pattern?.[1], 'pool/src/session.ts no longer destructures mining.submit positionally')
    const positions = pattern[1].split(',').map((name) => name.trim())
    assert.deepEqual(
      positions,
      ['', 'jobIdRaw', 'extranonce2Raw', 'ntimeRaw', 'nonceRaw', 'versionRaw'],
      'the server reads mining.submit in a different order than buildSubmitParams writes it',
    )
  })

  /**
   * The graph this test imports must stay free of runtime dependencies, because CI checks micro-pool
   * out without installing it.
   *
   * A `import type` line is elided by the transpiler and costs nothing; a value import of
   * `@cloudsforge/contracts-chain` would make this whole file fail in CI and pass on a developer's
   * machine, which is the worst available outcome. Checked rather than trusted.
   */
  it('reaches no runtime dependency outside node:', () => {
    for (const file of ['session.ts', 'validate.ts', 'work.ts', 'coinbase.ts', 'merkle.ts', 'pow.ts', 'bytes.ts', 'mweb.ts', 'vardiff.ts', 'pplns.ts']) {
      const source = readFileSync(`${ESTATE}pool/src/${file}`, 'utf8')
      for (const line of source.split('\n')) {
        const importing = /^import\s+(?!type\s)(.*)from\s+'([^']+)'/.exec(line)
        if (!importing) continue
        const specifier = importing[2] as string
        assert.ok(
          specifier.startsWith('./') || specifier.startsWith('node:'),
          `pool/src/${file} now has a runtime import of ${specifier}, which a CI checkout cannot resolve`,
        )
      }
    }
  })
})
