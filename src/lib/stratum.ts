/**
 * Stratum v1, the half of it a miner performs: reading a job, assembling the eighty bytes, and
 * saying what was found.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THIS FILE IS THE MIRROR OF `pool/src/`, AND IT WAS WRITTEN BY READING IT ──────────────────
 *
 * Not from a blog post, and not from memory. Every conversion below has a named counterpart in the
 * pool's own source, and where the two must agree the pool's file is cited by name so the next
 * reader can put them side by side:
 *
 *   `notifyParams`          `pool/src/work.ts`       the nine positional parameters of mining.notify
 *   `assembleCoinbase`      `pool/src/coinbase.ts`   coinb1 ‖ extranonce1 ‖ extranonce2 ‖ coinb2
 *   `merkleRootFromBranch`  `pool/src/merkle.ts`     the left-to-right fold
 *   `buildHeader`           `pool/src/coinbase.ts`   the field order of the eighty bytes
 *   `swap32Hex`             `pool/src/bytes.ts`      big-endian wire scalar → little-endian header
 *   `headerPrevHashFromStratum` `pool/src/bytes.ts`  the word-order reversal, undone
 *   `targetForDifficulty`   `pool/src/pow.ts`        difficulty → the number the digest must not exceed
 *   `#submit`               `pool/src/session.ts`    the six positional parameters it destructures
 *
 * The reason for that discipline is the one `pool/src/bytes.ts` states at the top of itself, and it
 * is worth repeating from this side: **a byte order defect does not throw.** A header assembled with
 * one field reversed hashes to thirty-two bytes that are uniform and random, which fails the target
 * comparison in precisely the way an honest losing nonce does. The page would report a healthy
 * hashrate, submit nothing for hours, and be indistinguishable from bad luck. There is no runtime
 * signal to notice; the only defence is agreeing with the server's parser, which is what
 * `test/pool-contract.test.ts` asserts by importing the server's own modules.
 *
 * ── FOUR BYTE ORDERS, AND WHICH ONE EACH VALUE IS IN ──────────────────────────────────────────
 *
 * `pool/src/bytes.ts` names them, and this file uses the same four names throughout:
 *
 *   1. INTERNAL — what the header carries and what consensus hashes. Hashes little-endian.
 *   2. DISPLAY — what an explorer shows and what `mining.notify` carries for each merkle step. The
 *      reverse of internal. **Every step must be reversed on the way in**; the pool's own comment
 *      warns that folding display-order steps gives a root that is uniformly wrong.
 *   3. STRATUM PREVHASH — neither of the above: display order with its eight 4-byte words in
 *      reverse order, bytes within each word untouched. An artefact of the original Python pool,
 *      and the protocol regardless of its provenance.
 *   4. STRATUM SCALAR — `version`, `nbits`, `ntime`, `nonce` travel as big-endian hex and are
 *      written into the header as little-endian uint32.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────────────────────────
 *
 * No sockets, no timers, no ticket, no state. This module is a pile of pure functions over bytes so
 * the whole protocol can be tested without a network and without a clock, and so the Worker can
 * import the grinding half without dragging a connection manager into a second thread. The socket
 * lives in `lib/stratum-client.ts`; the credential never comes near this file at all.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import { sha256d } from './sha256.ts'

/* ══════════════════════════════ hex, in both directions ══════════════════════════════ */

export function isHex(value: unknown, bytes?: number): value is string {
  if (typeof value !== 'string') return false
  if (!/^[0-9a-fA-F]*$/.test(value)) return false
  if (value.length % 2 !== 0) return false
  return bytes === undefined || value.length === bytes * 2
}

export function hexToBytes(hex: string): Uint8Array {
  if (!isHex(hex)) throw new RangeError(`expected hex, got ${JSON.stringify(hex).slice(0, 32)}`)
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

const HEX_BYTE: readonly string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) out += HEX_BYTE[bytes[i] as number] as string
  return out
}

/** A uint32 as the 8-character big-endian hex Stratum puts on the wire. `toStratumScalar`'s twin. */
export function toStratumScalar(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`a uint32 was expected, got ${value}`)
  }
  return (value >>> 0).toString(16).padStart(8, '0')
}

/**
 * An 8-character big-endian hex scalar as the four little-endian bytes the header carries.
 *
 * The pool's `swap32Hex`. A miner that submits `ntime` as `686f1c40` means the uint32 0x686f1c40,
 * and bytes 68..72 of the header it hashed hold `40 1c 6f 68`.
 */
export function swap32Hex(hex: string): Uint8Array {
  if (!isHex(hex, 4)) throw new RangeError(`a 4-byte scalar was expected, got ${hex}`)
  const bytes = hexToBytes(hex)
  return new Uint8Array([bytes[3] as number, bytes[2] as number, bytes[1] as number, bytes[0] as number])
}

/**
 * The header's `hashPrevBlock`, from the wire form of `mining.notify`'s second parameter.
 *
 * The pool's `headerPrevHashFromStratum`, and the exact inverse of its `stratumPrevHash`: reverse
 * the WORD order and then the bytes WITHIN each word. Removing either half of that gives a header
 * built on a previous block that is not the chain's tip, and every share fails with nothing saying
 * why — which is why the pool writes it as one operation and so does this.
 */
export function headerPrevHashFromStratum(stratumHex: string): Uint8Array {
  if (!isHex(stratumHex, 32)) throw new RangeError(`a 32-byte hash was expected, got ${stratumHex}`)
  const wire = hexToBytes(stratumHex)
  const out = new Uint8Array(32)
  for (let word = 0; word < 8; word += 1) {
    for (let byte = 0; byte < 4; byte += 1) {
      out[word * 4 + byte] = wire[word * 4 + (3 - byte)] as number
    }
  }
  return out
}

/** A 32-byte hash from internal order into the display order a person reads. */
export function hashToDisplay(hash: Uint8Array): string {
  if (hash.length !== 32) throw new RangeError(`a 32-byte hash was expected, got ${hash.length}`)
  return bytesToHex(new Uint8Array(hash).reverse())
}

/* ══════════════════════════════ mining.subscribe ══════════════════════════════ */

export interface Subscription {
  /** The pool's per-connection extranonce. Fixed for the life of the socket. */
  readonly extranonce1: Uint8Array
  /** How many bytes of extranonce2 this miner owns. The pool sizes it; the miner counts in it. */
  readonly extranonce2Size: number
}

/**
 * The reply to `mining.subscribe`: `[[[notification, subscriptionId], …], extranonce1Hex, size]`.
 *
 * **`mining.subscribe` is mandatory and the written contract does not say so.** `pool/src/session.ts`
 * refuses `mining.submit` with error 25 unless `#subscribed`, and `pushJob` returns without sending
 * anything at all in the same condition — so a client that authorised and waited would sit on a
 * silent socket forever, receive no job, and have nothing to report but a working connection. This
 * is recorded as an under-specification of the wire contract rather than worked around quietly.
 *
 * The subscription ids in the first element are read by nobody on either side. They are not parsed
 * here beyond checking the reply is positional, because inventing a requirement the server does not
 * have is how a client starts rejecting servers that are fine.
 */
export function parseSubscribe(result: unknown): Subscription {
  if (!Array.isArray(result) || result.length < 3) {
    throw new Error('mining.subscribe replied with something that is not a three-element array')
  }
  const [, extranonce1Raw, sizeRaw] = result as unknown[]
  if (!isHex(extranonce1Raw)) throw new Error('mining.subscribe replied without a hex extranonce1')
  if (typeof sizeRaw !== 'number' || !Number.isInteger(sizeRaw) || sizeRaw < 1 || sizeRaw > 32) {
    throw new Error(`mining.subscribe replied with an extranonce2 size of ${String(sizeRaw)}`)
  }
  return { extranonce1: hexToBytes(extranonce1Raw), extranonce2Size: sizeRaw }
}

/* ══════════════════════════════ mining.notify ══════════════════════════════ */

/**
 * One job, parsed out of `mining.notify` and converted into the orders the header wants.
 *
 * Everything here is structured-cloneable on purpose: this object crosses `postMessage` into the
 * grinding Worker exactly as it stands. That is why the merkle steps are `Uint8Array`s rather than
 * a class, and why the scalars that never need arithmetic are kept as their wire hex — the fewer
 * conversions there are, the fewer places the two threads can disagree about what they hold.
 */
export interface StratumJob {
  readonly jobId: string
  /** INTERNAL order, ready for the header. */
  readonly prevHash: Uint8Array
  readonly coinb1: Uint8Array
  readonly coinb2: Uint8Array
  /** INTERNAL order — reversed on the way in from the display order the wire carries. */
  readonly merkleSteps: readonly Uint8Array[]
  /** STRATUM SCALAR hex, as received and as it must be echoed back. */
  readonly versionHex: string
  readonly bitsHex: string
  readonly ntimeHex: string
  /**
   * The pool says the previous job is dead: abandon it now rather than finishing the nonce range.
   *
   * Honoured because a share against a superseded tip is worth nothing to anybody — the pool would
   * answer 21, and the miner would have spent the interval producing something it knew was stale.
   */
  readonly cleanJobs: boolean
}

/**
 * The nine positional parameters of `mining.notify`, in the order `pool/src/work.ts` emits them.
 *
 * Positional, not named, and the position of every one is load-bearing: swapping `bits` and `ntime`
 * — both eight hex characters, both plausible — produces a header that assembles, hashes, and is
 * wrong. Each is therefore checked for the shape it must have rather than merely for presence.
 */
export function parseNotify(params: unknown): StratumJob {
  if (!Array.isArray(params) || params.length < 9) {
    throw new Error('mining.notify takes nine parameters')
  }
  const [jobId, prevHashHex, coinb1Hex, coinb2Hex, stepsRaw, versionHex, bitsHex, ntimeHex, clean] =
    params as unknown[]

  if (typeof jobId !== 'string' || jobId === '') throw new Error('mining.notify sent no job id')
  if (!isHex(prevHashHex, 32)) throw new Error('mining.notify sent a prevhash that is not 32 bytes of hex')
  if (!isHex(coinb1Hex)) throw new Error('mining.notify sent a coinb1 that is not hex')
  if (!isHex(coinb2Hex)) throw new Error('mining.notify sent a coinb2 that is not hex')
  if (!Array.isArray(stepsRaw)) throw new Error('mining.notify sent a merkle branch that is not an array')
  if (!isHex(versionHex, 4)) throw new Error('mining.notify sent a version that is not 4 bytes of hex')
  if (!isHex(bitsHex, 4)) throw new Error('mining.notify sent nbits that are not 4 bytes of hex')
  if (!isHex(ntimeHex, 4)) throw new Error('mining.notify sent an ntime that is not 4 bytes of hex')

  const merkleSteps = (stepsRaw as unknown[]).map((step) => {
    if (!isHex(step, 32)) throw new Error('a merkle step is not 32 bytes of hex')
    // DISPLAY → INTERNAL. `pool/src/work.ts` reverses each step on the way out and says why; this
    // is the other end of that single sentence.
    return hexToBytes(step).reverse()
  })

  return {
    jobId,
    prevHash: headerPrevHashFromStratum(prevHashHex),
    coinb1: hexToBytes(coinb1Hex),
    coinb2: hexToBytes(coinb2Hex),
    merkleSteps,
    versionHex,
    bitsHex,
    ntimeHex,
    // Anything truthy means clean. Some pools send 1 rather than true, and refusing a job over the
    // JSON type of a boolean would be a client that is right about nothing useful.
    cleanJobs: Boolean(clean),
  }
}

/* ══════════════════════════════ the coinbase, the root, the header ══════════════════════════════ */

/** `coinb1 ‖ extranonce1 ‖ extranonce2 ‖ coinb2`, which is the whole of the pool's `assembleCoinbase`. */
export function assembleCoinbase(
  job: StratumJob,
  extranonce1: Uint8Array,
  extranonce2: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(
    job.coinb1.length + extranonce1.length + extranonce2.length + job.coinb2.length,
  )
  let at = 0
  out.set(job.coinb1, at)
  at += job.coinb1.length
  out.set(extranonce1, at)
  at += extranonce1.length
  out.set(extranonce2, at)
  at += extranonce2.length
  out.set(job.coinb2, at)
  return out
}

/**
 * Fold the coinbase txid left-to-right through the branch, `sha256d(root ‖ step)` each time.
 *
 * The pool's `merkleRootFromBranch`, and the same direction. An empty branch returns the txid
 * unchanged, which is correct for a block containing only its coinbase.
 */
export function merkleRootFromBranch(coinbaseTxId: Uint8Array, steps: readonly Uint8Array[]): Uint8Array {
  let root = coinbaseTxId
  for (const step of steps) root = sha256d(root, step)
  return root
}

/**
 * The eighty bytes, assembled from a job and the four values the miner chooses.
 *
 * `version ‖ prevHash ‖ merkleRoot ‖ ntime ‖ nbits ‖ nonce`, all little-endian, which is
 * `buildHeader` in `pool/src/coinbase.ts` with the same fields in the same order. The scalars go in
 * through `swap32Hex` because they arrived big-endian, and doing that conversion HERE rather than at
 * each call site is the pool's rule too — a header builder that also reverses things is one whose
 * callers stop knowing what order they hold.
 */
export function buildHeader(args: {
  readonly job: StratumJob
  readonly merkleRoot: Uint8Array
  readonly ntimeHex: string
  readonly nonceHex: string
  /** Only when version rolling was negotiated; otherwise the job's own version is used. */
  readonly versionHex?: string
}): Uint8Array {
  const header = new Uint8Array(80)
  header.set(swap32Hex(args.versionHex ?? args.job.versionHex), 0)
  header.set(args.job.prevHash, 4)
  header.set(args.merkleRoot, 36)
  header.set(swap32Hex(args.ntimeHex), 68)
  header.set(swap32Hex(args.job.bitsHex), 72)
  header.set(swap32Hex(args.nonceHex), 76)
  return header
}

/** Where the nonce lives, for the grind loop that rewrites four bytes rather than eighty. */
export const HEADER_NONCE_OFFSET = 76

/**
 * Write a nonce into an assembled header in place.
 *
 * The Worker searches a nonce range against a header whose other seventy-six bytes are fixed, and
 * rebuilding the coinbase and re-folding the merkle branch per nonce would cost several SHA-256
 * compressions for every scrypt — which is to say, it would dominate the loop it was meant to
 * serve. Little-endian, the same four bytes `swap32Hex` would have produced.
 */
export function writeNonce(header: Uint8Array, nonce: number): void {
  header[HEADER_NONCE_OFFSET] = nonce & 0xff
  header[HEADER_NONCE_OFFSET + 1] = (nonce >>> 8) & 0xff
  header[HEADER_NONCE_OFFSET + 2] = (nonce >>> 16) & 0xff
  header[HEADER_NONCE_OFFSET + 3] = (nonce >>> 24) & 0xff
}

/**
 * The extranonce2 counter, as the fixed-width big-endian value the pool's length check demands.
 *
 * `assembleCoinbase` in `pool/src/coinbase.ts` refuses an extranonce2 that is not exactly
 * `extranonce2Size` bytes, and it is right to: the bytes would land at the correct offset but the
 * scriptSig length prefix written into `coinb1` counts a fixed number of them, so a short counter
 * would produce a transaction that deserialises into something neither side computed.
 */
export function extranonce2(counter: number, size: number): Uint8Array {
  const out = new Uint8Array(size)
  let remaining = counter >>> 0
  for (let i = size - 1; i >= 0 && remaining > 0; i -= 1) {
    out[i] = remaining & 0xff
    remaining = Math.floor(remaining / 256)
  }
  return out
}

/* ══════════════════════════════ targets and difficulty ══════════════════════════════ */

export type PowAlgorithm = 'sha256d' | 'scrypt'

/**
 * Difficulty 1, per algorithm — and the two are NOT the same number.
 *
 * `pool/src/pow.ts` carries both: `0xffff × 2^208` for SHA-256d, `0xffff × 2^224` for scrypt.
 * Litecoin's difficulty-1 target is 2^16 times looser than Bitcoin's, which is the whole reason a
 * "difficulty 1" share means sixty-five thousand times less work on one chain than the other. A
 * client that used Bitcoin's constant on Litecoin would submit only shares 65536× harder than
 * asked — perfectly valid, vanishingly rare, and it would look exactly like a slow computer.
 */
const DIFF1_SHA256D = 0xffffn * 2n ** 208n
const DIFF1_SCRYPT = 0xffffn * 2n ** 224n

export function diff1TargetFor(algorithm: PowAlgorithm): bigint {
  switch (algorithm) {
    case 'sha256d':
      return DIFF1_SHA256D
    case 'scrypt':
      return DIFF1_SCRYPT
  }
}

/**
 * The fixed-point scale the pool divides by, so a fractional difficulty is exact rather than floated.
 *
 * A browser's share difficulty is a small fraction — `pool/src/vardiff.ts` floors it at
 * `BROWSER_MIN_HASHES_PER_SHARE / hashesPerDifficulty`, which on scrypt is 256/65536 = 0.00390625 —
 * so integer difficulty arithmetic would round every browser's target to zero or to one, and both
 * answers are catastrophic in opposite directions.
 */
const DIFFICULTY_SCALE = 65_536n

/** The largest digest that still counts as a share at this difficulty. `pool/src/pow.ts`'s twin. */
export function targetForDifficulty(algorithm: PowAlgorithm, difficulty: number): bigint {
  if (!Number.isFinite(difficulty) || difficulty <= 0) {
    throw new RangeError(`difficulty must be a positive number, got ${difficulty}`)
  }
  const scaled = BigInt(Math.round(difficulty * Number(DIFFICULTY_SCALE)))
  if (scaled <= 0n) throw new RangeError(`difficulty ${difficulty} rounds to zero at this scale`)
  return (diff1TargetFor(algorithm) * DIFFICULTY_SCALE) / scaled
}

/**
 * A proof-of-work digest as the integer it is compared as: reversed, then read big-endian.
 *
 * The reversal is not decoration. The digest is in internal (little-endian) order and the target is
 * an ordinary big integer, so comparing them without it compares the wrong end of the number and
 * accepts almost exactly the digests it should reject.
 */
export function powHashToBigInt(hash: Uint8Array): bigint {
  return BigInt(`0x${hashToDisplay(hash)}`)
}

/**
 * Does this digest meet the target?
 *
 * `<=`, not `<`. The boundary value is a valid share; `pool/src/pow.ts` uses `<=` and a client that
 * used `<` would silently discard the rarest share it ever found.
 */
export function meetsTarget(hash: Uint8Array, target: bigint): boolean {
  return powHashToBigInt(hash) <= target
}

/** What difficulty this digest actually achieved, for the reconciliation the page shows. */
export function difficultyOfHash(algorithm: PowAlgorithm, hash: Uint8Array): number {
  const value = powHashToBigInt(hash)
  if (value === 0n) return Number.POSITIVE_INFINITY
  return Number((diff1TargetFor(algorithm) * DIFFICULTY_SCALE) / value) / Number(DIFFICULTY_SCALE)
}

/**
 * How many hashes one unit of difficulty is expected to cost.
 *
 * 2^32 on SHA-256d and 2^16 on scrypt, and it is the conversion every honest number on the page
 * depends on: shares per minute × difficulty × this = hashes per minute, which is the arithmetic a
 * reader can check against the measured rate shown beside it.
 */
export function hashesPerDifficulty(algorithm: PowAlgorithm): number {
  return Number((2n ** 256n * DIFFICULTY_SCALE) / diff1TargetFor(algorithm)) / Number(DIFFICULTY_SCALE)
}

/* ══════════════════════════════ mining.submit ══════════════════════════════ */

export interface SubmitFields {
  /** `params[0]`. Ignored by the pool on this transport, but it must be a non-empty string. */
  readonly worker: string
  readonly jobId: string
  readonly extranonce2Hex: string
  readonly ntimeHex: string
  readonly nonceHex: string
  readonly versionHex?: string | undefined
}

/**
 * The positional parameters of `mining.submit`, in the order the server destructures them.
 *
 * `pool/src/session.ts` reads `const [, jobIdRaw, extranonce2Raw, ntimeRaw, nonceRaw, versionRaw] =
 * params` and then requires all four of the middle ones to be `string`. So: six positions, the
 * first skipped, the sixth optional.
 *
 * **`params[0]` is skipped but must still be there.** The server destructures by position; a
 * five-element array that omitted the worker would put the job id where the worker belongs and
 * shift every field by one, and since all of them are strings the type checks would pass and the
 * share would be rejected as a job that does not exist. The contract's own wording — ignored, but
 * a non-empty string — is a requirement about the SHAPE of the array, not about the value.
 *
 * The version is appended only when it is actually present, rather than always with a default: the
 * server rejects a submitted version outright unless the connection negotiated version rolling
 * through `mining.configure`, and this client does not negotiate it. Scrypt hardware has never
 * needed it, and a browser exhausting 2^32 nonces before ntime moves is not a situation that
 * arises — 4.3 billion scrypt hashes at a browser's few thousand per second is a fortnight.
 */
export function buildSubmitParams(fields: SubmitFields): readonly string[] {
  if (fields.worker === '') throw new RangeError('mining.submit needs a non-empty worker name')
  const params = [
    fields.worker,
    fields.jobId,
    fields.extranonce2Hex,
    fields.ntimeHex,
    fields.nonceHex,
  ]
  if (fields.versionHex !== undefined) params.push(fields.versionHex)
  return params
}

/* ══════════════════════════════ the whole computation, once ══════════════════════════════ */

export interface Solution {
  readonly extranonce2Hex: string
  readonly ntimeHex: string
  readonly nonceHex: string
  /** The proof-of-work digest, internal order. */
  readonly powHash: Uint8Array
  readonly difficulty: number
}

/**
 * Everything between a job and a header, in one place, so the Worker and the tests do it identically.
 *
 * Returns the header rather than the hash because the two proof-of-work functions have different
 * costs and different homes: SHA-256d is in `lib/sha256.ts` and scrypt is in `lib/scrypt.ts`, and
 * which one applies is the chain's business, not this function's.
 */
export function headerFor(args: {
  readonly job: StratumJob
  readonly extranonce1: Uint8Array
  readonly extranonce2: Uint8Array
  readonly ntimeHex?: string
  readonly nonceHex?: string
}): Uint8Array {
  const coinbase = assembleCoinbase(args.job, args.extranonce1, args.extranonce2)
  const merkleRoot = merkleRootFromBranch(sha256d(coinbase), args.job.merkleSteps)
  return buildHeader({
    job: args.job,
    merkleRoot,
    ntimeHex: args.ntimeHex ?? args.job.ntimeHex,
    nonceHex: args.nonceHex ?? '00000000',
  })
}
