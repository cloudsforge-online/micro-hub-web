/**
 * scrypt (RFC 7914), and Litecoin's proof of work on top of it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE FUNCTION HAS TO BE THE SAME ONE THE POOL COMPUTES, TO THE BIT ─────────────────────────
 *
 * `pool/src/pow.ts` hashes a share with Node's `crypto.scryptSync(header, header, 32,
 * { N: 1024, r: 1, p: 1 })`, which is OpenSSL's scrypt. A browser has no scrypt at all: WebCrypto
 * exposes PBKDF2, HKDF, AES and ECDSA and nothing else, and there is no proposal to add one. So
 * this file exists because the platform does not supply the function, not because the platform's
 * version was unsatisfactory.
 *
 * The consequence of getting it wrong is the one this whole area of the estate keeps repeating: a
 * wrong scrypt does not throw. It returns thirty-two uniformly distributed bytes that fail the
 * target comparison exactly as an honest losing nonce does, so the page hashes all afternoon,
 * reports a healthy rate, and submits nothing — or submits and is told `low difficulty share`
 * forever. `test/scrypt.test.ts` therefore checks this implementation against `node:crypto`'s
 * OpenSSL binding directly, over the real Litecoin genesis header and over random headers, rather
 * than against a vector copied out of a document.
 *
 * ── WHY IT IS WRITTEN HERE RATHER THAN TAKEN FROM npm ─────────────────────────────────────────
 *
 * `scrypt-js` is the obvious candidate and it is genuinely well established. It is rejected for
 * two reasons, neither of them "not invented here":
 *
 *   1. It is asynchronous by default — it yields to the event loop on a callback schedule so a
 *      main-thread caller stays responsive. Inside a dedicated Worker that is precisely the wrong
 *      shape: the whole point of the Worker is that blocking is free, and the synchronous entry
 *      point it also exposes is a second code path with the same correctness question.
 *   2. This bundle has four runtime dependencies, three of which are React, and it is consumed
 *      through a linked design system whose lockfile is already the fiddliest thing in CI. A
 *      dependency added for one function in one Worker is a supply-chain edge for the sake of
 *      about a hundred and fifty lines that can be checked against OpenSSL in a test.
 *
 * ── WHAT IS NOT HERE ──────────────────────────────────────────────────────────────────────────
 *
 * No `p > 1` parallelism beyond the trivial sequential loop, and no attempt at SIMD or WebAssembly.
 * Litecoin's parameters are N=1024, r=1, p=1 and have been since 2011; the memory this touches is
 * 128 × N × r = 128 KiB per Worker, which is a rounding error next to a React tree. If a chain
 * with different parameters ever arrives, the parameters are arguments and the code already takes
 * them — what must not happen is a constant baked in somewhere that stops matching the pool.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { Sha256 } from './sha256.ts'

/* ══════════════════════════════ HMAC-SHA-256 and PBKDF2 ══════════════════════════════ */

/**
 * HMAC-SHA-256, with the key block computed once and reused.
 *
 * scrypt calls PBKDF2 twice with the SAME password, and PBKDF2 with c=1 calls HMAC once per output
 * block. Re-deriving the padded key each time is not the bottleneck, but keeping it in an object
 * makes the two calls obviously the same keying — which is the part that would be a defect if it
 * drifted.
 */
class HmacSha256 {
  readonly #inner = new Uint8Array(64)
  readonly #outer = new Uint8Array(64)
  readonly #hash = new Sha256()

  constructor(key: Uint8Array) {
    // A key longer than the block size is hashed first; anything shorter is zero-padded. An 80-byte
    // block header is longer, so this branch is the one Litecoin actually takes.
    const normalised = key.length > 64 ? new Sha256().update(key).digest() : key
    this.#inner.set(normalised)
    this.#outer.set(normalised)
    for (let i = 0; i < 64; i += 1) {
      this.#inner[i] = (this.#inner[i] as number) ^ 0x36
      this.#outer[i] = (this.#outer[i] as number) ^ 0x5c
    }
  }

  /** HMAC over the concatenation of `parts`, written into `out` (32 bytes). */
  digestInto(parts: readonly Uint8Array[], out: Uint8Array): void {
    this.#hash.reset().update(this.#inner)
    for (const part of parts) this.#hash.update(part)
    this.#hash.digestInto(out)
    const inner = out.slice()
    this.#hash.reset().update(this.#outer).update(inner).digestInto(out)
  }
}

/**
 * PBKDF2-HMAC-SHA-256 with ONE iteration, which is all scrypt ever asks for.
 *
 * Written as the special case rather than the general algorithm on purpose. The general form's
 * inner loop — XOR c-1 further HMACs into the block — is dead code at c=1, and dead code in a
 * primitive is code nothing exercises. scrypt's own definition fixes the iteration count at 1 in
 * both of its PBKDF2 calls (RFC 7914 §6 steps 1 and 5); if a caller ever needed a real PBKDF2 it
 * would want the general function, and it would want it tested.
 */
function pbkdf2Once(hmac: HmacSha256, salt: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length)
  const counter = new Uint8Array(4)
  const block = new Uint8Array(32)
  const blocks = Math.ceil(length / 32)
  for (let i = 1; i <= blocks; i += 1) {
    // The block index is appended big-endian, as INT(i) in PKCS#5.
    counter[0] = (i >>> 24) & 0xff
    counter[1] = (i >>> 16) & 0xff
    counter[2] = (i >>> 8) & 0xff
    counter[3] = i & 0xff
    hmac.digestInto([salt, counter], block)
    out.set(block.subarray(0, Math.min(32, length - (i - 1) * 32)), (i - 1) * 32)
  }
  return out
}

/* ══════════════════════════════ Salsa20/8 and BlockMix ══════════════════════════════ */

/**
 * The Salsa20/8 core: eight rounds, then add the input back in.
 *
 * EIGHT, not twenty. scrypt uses a deliberately reduced-round Salsa20 — it is a mixing function
 * here, not a cipher, and the security argument rests on the memory access pattern rather than on
 * the core's cryptographic strength. Using the full twenty rounds would compute a different
 * function from every other scrypt in the world.
 *
 * `x` is scratch supplied by the caller so this allocates nothing: it runs four thousand times per
 * Litecoin hash.
 */
function salsa20_8(block: Uint32Array, at: number, x: Uint32Array): void {
  for (let i = 0; i < 16; i += 1) x[i] = block[at + i] as number

  for (let round = 0; round < 8; round += 2) {
    // Column round.
    let t = ((x[0] as number) + (x[12] as number)) | 0
    x[4] = (x[4] as number) ^ ((t << 7) | (t >>> 25))
    t = ((x[4] as number) + (x[0] as number)) | 0
    x[8] = (x[8] as number) ^ ((t << 9) | (t >>> 23))
    t = ((x[8] as number) + (x[4] as number)) | 0
    x[12] = (x[12] as number) ^ ((t << 13) | (t >>> 19))
    t = ((x[12] as number) + (x[8] as number)) | 0
    x[0] = (x[0] as number) ^ ((t << 18) | (t >>> 14))

    t = ((x[5] as number) + (x[1] as number)) | 0
    x[9] = (x[9] as number) ^ ((t << 7) | (t >>> 25))
    t = ((x[9] as number) + (x[5] as number)) | 0
    x[13] = (x[13] as number) ^ ((t << 9) | (t >>> 23))
    t = ((x[13] as number) + (x[9] as number)) | 0
    x[1] = (x[1] as number) ^ ((t << 13) | (t >>> 19))
    t = ((x[1] as number) + (x[13] as number)) | 0
    x[5] = (x[5] as number) ^ ((t << 18) | (t >>> 14))

    t = ((x[10] as number) + (x[6] as number)) | 0
    x[14] = (x[14] as number) ^ ((t << 7) | (t >>> 25))
    t = ((x[14] as number) + (x[10] as number)) | 0
    x[2] = (x[2] as number) ^ ((t << 9) | (t >>> 23))
    t = ((x[2] as number) + (x[14] as number)) | 0
    x[6] = (x[6] as number) ^ ((t << 13) | (t >>> 19))
    t = ((x[6] as number) + (x[2] as number)) | 0
    x[10] = (x[10] as number) ^ ((t << 18) | (t >>> 14))

    t = ((x[15] as number) + (x[11] as number)) | 0
    x[3] = (x[3] as number) ^ ((t << 7) | (t >>> 25))
    t = ((x[3] as number) + (x[15] as number)) | 0
    x[7] = (x[7] as number) ^ ((t << 9) | (t >>> 23))
    t = ((x[7] as number) + (x[3] as number)) | 0
    x[11] = (x[11] as number) ^ ((t << 13) | (t >>> 19))
    t = ((x[11] as number) + (x[7] as number)) | 0
    x[15] = (x[15] as number) ^ ((t << 18) | (t >>> 14))

    // Row round.
    t = ((x[0] as number) + (x[3] as number)) | 0
    x[1] = (x[1] as number) ^ ((t << 7) | (t >>> 25))
    t = ((x[1] as number) + (x[0] as number)) | 0
    x[2] = (x[2] as number) ^ ((t << 9) | (t >>> 23))
    t = ((x[2] as number) + (x[1] as number)) | 0
    x[3] = (x[3] as number) ^ ((t << 13) | (t >>> 19))
    t = ((x[3] as number) + (x[2] as number)) | 0
    x[0] = (x[0] as number) ^ ((t << 18) | (t >>> 14))

    t = ((x[5] as number) + (x[4] as number)) | 0
    x[6] = (x[6] as number) ^ ((t << 7) | (t >>> 25))
    t = ((x[6] as number) + (x[5] as number)) | 0
    x[7] = (x[7] as number) ^ ((t << 9) | (t >>> 23))
    t = ((x[7] as number) + (x[6] as number)) | 0
    x[4] = (x[4] as number) ^ ((t << 13) | (t >>> 19))
    t = ((x[4] as number) + (x[7] as number)) | 0
    x[5] = (x[5] as number) ^ ((t << 18) | (t >>> 14))

    t = ((x[10] as number) + (x[9] as number)) | 0
    x[11] = (x[11] as number) ^ ((t << 7) | (t >>> 25))
    t = ((x[11] as number) + (x[10] as number)) | 0
    x[8] = (x[8] as number) ^ ((t << 9) | (t >>> 23))
    t = ((x[8] as number) + (x[11] as number)) | 0
    x[9] = (x[9] as number) ^ ((t << 13) | (t >>> 19))
    t = ((x[9] as number) + (x[8] as number)) | 0
    x[10] = (x[10] as number) ^ ((t << 18) | (t >>> 14))

    t = ((x[15] as number) + (x[14] as number)) | 0
    x[12] = (x[12] as number) ^ ((t << 7) | (t >>> 25))
    t = ((x[12] as number) + (x[15] as number)) | 0
    x[13] = (x[13] as number) ^ ((t << 9) | (t >>> 23))
    t = ((x[13] as number) + (x[12] as number)) | 0
    x[14] = (x[14] as number) ^ ((t << 13) | (t >>> 19))
    t = ((x[14] as number) + (x[13] as number)) | 0
    x[15] = (x[15] as number) ^ ((t << 18) | (t >>> 14))
  }

  for (let i = 0; i < 16; i += 1) block[at + i] = ((block[at + i] as number) + (x[i] as number)) | 0
}

/**
 * scryptBlockMix: 2r Salsa applications, then the interleave that gives the function its shape.
 *
 * The output ordering — all the even-indexed results, then all the odd-indexed ones — is the step
 * that is invisible at r=1 (there is one of each and the order is unchanged) and load-bearing at
 * any larger r. It is written out anyway. A version that "simplified" it away would pass every
 * Litecoin test in this repository and compute the wrong function for any future chain, which is
 * the worst possible place for a latent defect: it would be introduced by a change that had
 * nothing to do with it.
 */
function blockMix(
  block: Uint32Array,
  out: Uint32Array,
  r: number,
  x: Uint32Array,
  scratch: Uint32Array,
): void {
  const last = (2 * r - 1) * 16
  for (let i = 0; i < 16; i += 1) x[i] = block[last + i] as number
  for (let i = 0; i < 2 * r; i += 1) {
    for (let j = 0; j < 16; j += 1) x[j] = (x[j] as number) ^ (block[i * 16 + j] as number)
    salsa20_8(x, 0, scratch)
    // Even results go to the front half, odd ones to the back half.
    const target = (i % 2 === 0 ? i / 2 : r + (i - 1) / 2) * 16
    for (let j = 0; j < 16; j += 1) out[target + j] = x[j] as number
  }
}

interface Arena {
  readonly v: Uint32Array
  readonly y: Uint32Array
  readonly x: Uint32Array
  readonly scratch: Uint32Array
}

let cached: { key: string; arena: Arena } | null = null

/**
 * The working memory ROMix needs, allocated once per parameter set rather than once per hash.
 *
 * V is 128 × N × r bytes — 128 KiB at Litecoin's parameters — and a miner calls this a thousand
 * times a second. Allocating it per hash is 180 MB/s of garbage for a buffer that is fully
 * overwritten before it is read, which is the one case where reuse costs nothing: every word of V
 * is written in the first loop before the second loop indexes it, so a stale value from the
 * previous hash cannot be observed.
 *
 * **This makes `scrypt` non-reentrant, and that is a deliberate trade rather than an oversight.**
 * JavaScript is single-threaded and there is no `await` anywhere in this file, so the only way to
 * re-enter is to call `scrypt` from inside `scrypt` — which nothing does and which the module
 * structure makes hard to do by accident. Each Worker gets its own module instance and therefore
 * its own arena, so parallel miners do not share this. The header of `lib/sha256.ts` argues the
 * opposite way for digests and names this as the exception: the place where the allocation
 * genuinely dominates, the caller reuses its own buffers, and the decision is visible.
 */
function arena(N: number, r: number): Arena {
  const key = `${N}:${r}`
  if (cached?.key === key) return cached.arena
  const arena: Arena = {
    v: new Uint32Array(N * 32 * r),
    y: new Uint32Array(32 * r),
    x: new Uint32Array(16),
    scratch: new Uint32Array(16),
  }
  cached = { key, arena }
  return arena
}

/**
 * scryptROMix: fill V with N successive block-mixes, then take N pseudo-random steps back through it.
 *
 * This is where scrypt's memory-hardness lives and it is the reason the function cannot be
 * meaningfully accelerated on hardware that lacks the memory. `j` is `Integerify(X) mod N`, which
 * RFC 7914 defines as the LAST 64-byte block of X read as a little-endian integer — of which only
 * the low word can matter for a power-of-two N, which is why the read is one word and not sixteen.
 */
function roMix(block: Uint32Array, N: number, r: number): void {
  const words = 32 * r
  const { v, y, x, scratch } = arena(N, r)

  for (let i = 0; i < N; i += 1) {
    v.set(block, i * words)
    blockMix(block, y, r, x, scratch)
    block.set(y)
  }
  for (let i = 0; i < N; i += 1) {
    const j = (block[words - 16] as number) & (N - 1)
    const at = j * words
    for (let k = 0; k < words; k += 1) block[k] = (block[k] as number) ^ (v[at + k] as number)
    blockMix(block, y, r, x, scratch)
    block.set(y)
  }
}

/* ══════════════════════════════ the byte/word boundary ══════════════════════════════ */

/**
 * scrypt's blocks are BYTES on the outside and little-endian 32-bit WORDS on the inside.
 *
 * Converted explicitly rather than by casting a `Uint8Array`'s buffer to a `Uint32Array`, which
 * would be faster and would produce the wrong answer on a big-endian machine. Those are rare and
 * they are not extinct, and a hash that is wrong only on some hardware is a defect that cannot be
 * reproduced by whoever receives the bug report.
 */
function bytesToWordsLE(bytes: Uint8Array, words: Uint32Array): void {
  for (let i = 0; i < words.length; i += 1) {
    words[i] =
      ((bytes[i * 4] as number) |
        ((bytes[i * 4 + 1] as number) << 8) |
        ((bytes[i * 4 + 2] as number) << 16) |
        ((bytes[i * 4 + 3] as number) << 24)) >>>
      0
  }
}

function wordsToBytesLE(words: Uint32Array, bytes: Uint8Array): void {
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] as number
    bytes[i * 4] = word & 0xff
    bytes[i * 4 + 1] = (word >>> 8) & 0xff
    bytes[i * 4 + 2] = (word >>> 16) & 0xff
    bytes[i * 4 + 3] = (word >>> 24) & 0xff
  }
}

/* ══════════════════════════════ scrypt ══════════════════════════════ */

export interface ScryptParams {
  readonly N: number
  readonly r: number
  readonly p: number
  readonly dkLen: number
}

/**
 * scrypt, RFC 7914 §6, as a synchronous function.
 *
 * N must be a power of two greater than one: `Integerify … mod N` above is implemented as a
 * bitmask, which is what every implementation does and what makes the modulus free. A non-power-of
 * -two N is refused rather than silently masked, because masking would compute a function that
 * agrees with nothing.
 */
export function scrypt(password: Uint8Array, salt: Uint8Array, params: ScryptParams): Uint8Array {
  const { N, r, p, dkLen } = params
  if (N < 2 || (N & (N - 1)) !== 0) throw new RangeError(`N must be a power of two above 1, got ${N}`)
  if (r < 1 || p < 1) throw new RangeError(`r and p must be at least 1, got r=${r} p=${p}`)

  const hmac = new HmacSha256(password)
  const blocked = pbkdf2Once(hmac, salt, p * 128 * r)

  const words = new Uint32Array(32 * r)
  const chunk = new Uint8Array(128 * r)
  for (let i = 0; i < p; i += 1) {
    chunk.set(blocked.subarray(i * 128 * r, (i + 1) * 128 * r))
    bytesToWordsLE(chunk, words)
    roMix(words, N, r)
    wordsToBytesLE(words, chunk)
    blocked.set(chunk, i * 128 * r)
  }

  return pbkdf2Once(hmac, blocked, dkLen)
}

/**
 * Litecoin's proof of work: scrypt with the 80-byte block header as BOTH the password and the salt.
 *
 * Anyone who has met scrypt as a password hash will expect a distinct salt. There is none. It is
 * not an oversight in this file or in the chain: the function Litecoin's consensus rules apply is
 * scrypt(header, header, N=1024, r=1, p=1, 32), and introducing a salt would compute something the
 * network has never validated against. `pool/src/pow.ts` says the same thing at greater length
 * and is the other half of this agreement.
 */
export const LITECOIN_SCRYPT: ScryptParams = Object.freeze({ N: 1024, r: 1, p: 1, dkLen: 32 })

export function scryptPow(header: Uint8Array): Uint8Array {
  return scrypt(header, header, LITECOIN_SCRYPT)
}
