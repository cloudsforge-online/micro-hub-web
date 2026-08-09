/**
 * SHA-256, synchronously, in about a hundred lines.
 *
 * ── Why not `crypto.subtle.digest`, which every browser already ships ──────────────────────────
 *
 * Because it is a promise, and every caller here is inside a loop that cannot await. A scrypt
 * iteration performs thousands of HMAC-SHA-256 compressions per hash and a Stratum share needs a
 * SHA-256d per merkle step; awaiting a microtask per compression would spend more time in the
 * scheduler than in the hash. WebCrypto is the right tool for a single digest of a large buffer
 * and the wrong one for a great many digests of thirty-two bytes.
 *
 * ── Why not a dependency ───────────────────────────────────────────────────────────────────────
 *
 * This bundle has four runtime dependencies and three of them are React. A hash is the one kind of
 * code where "well established" and "correct" can be checked directly rather than inferred from
 * download counts: `test/scrypt.test.ts` runs this against Node's own `crypto.createHash('sha256')`
 * over random inputs of every length that crosses a block and a padding boundary, and against the
 * two SHA-256 vectors everybody knows by sight. A hash that agrees with OpenSSL on all of that is
 * not "probably" SHA-256.
 *
 * THE OUTPUT IS A FRESH ARRAY EVERY CALL. There is a reusable-buffer version of this that is
 * faster and it is deliberately not written here: the merkle fold in `lib/stratum.ts` holds two
 * digests at once, and a shared output buffer would make the second call silently overwrite the
 * first. Where the allocation matters — the scrypt inner loop — the caller reuses ITS OWN buffers
 * instead, which is a decision visible at the call site.
 */

/** Round constants: the first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const INIT = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
])

/**
 * A streaming SHA-256.
 *
 * Streaming rather than one-shot because HMAC needs to hash a key block and then a message without
 * concatenating them into a third buffer, and PBKDF2 hashes the same key block tens of thousands
 * of times. `reset()` returns the instance to its initial state so one object serves a whole loop.
 */
export class Sha256 {
  readonly #state = new Uint32Array(8)
  readonly #block = new Uint8Array(64)
  readonly #words = new Uint32Array(64)
  #buffered = 0
  #length = 0

  constructor() {
    this.reset()
  }

  reset(): this {
    this.#state.set(INIT)
    this.#buffered = 0
    this.#length = 0
    return this
  }

  update(data: Uint8Array): this {
    this.#length += data.length
    let offset = 0
    // Top up a partial block first, then take whole blocks straight out of the input.
    if (this.#buffered > 0) {
      const need = Math.min(64 - this.#buffered, data.length)
      this.#block.set(data.subarray(0, need), this.#buffered)
      this.#buffered += need
      offset = need
      if (this.#buffered === 64) {
        this.#compress(this.#block, 0)
        this.#buffered = 0
      }
    }
    while (offset + 64 <= data.length) {
      this.#compress(data, offset)
      offset += 64
    }
    if (offset < data.length) {
      this.#block.set(data.subarray(offset), 0)
      this.#buffered = data.length - offset
    }
    return this
  }

  /** Write the digest into `out`, which must be 32 bytes. The instance is spent until `reset()`. */
  digestInto(out: Uint8Array): Uint8Array {
    const bits = this.#length * 8
    this.#block.fill(0, this.#buffered)
    this.#block[this.#buffered] = 0x80
    if (this.#buffered >= 56) {
      this.#compress(this.#block, 0)
      this.#block.fill(0)
    }
    // The length is 64 bits big-endian. Written as two 32-bit halves through arithmetic rather than
    // a BigInt: nothing this hashes is anywhere near 2^53 bytes, and a BigInt here would allocate
    // once per digest in the hottest loop in the bundle.
    const high = Math.floor(bits / 0x100000000)
    const low = bits >>> 0
    this.#block[56] = (high >>> 24) & 0xff
    this.#block[57] = (high >>> 16) & 0xff
    this.#block[58] = (high >>> 8) & 0xff
    this.#block[59] = high & 0xff
    this.#block[60] = (low >>> 24) & 0xff
    this.#block[61] = (low >>> 16) & 0xff
    this.#block[62] = (low >>> 8) & 0xff
    this.#block[63] = low & 0xff
    this.#compress(this.#block, 0)
    for (let i = 0; i < 8; i += 1) {
      const word = this.#state[i] as number
      out[i * 4] = (word >>> 24) & 0xff
      out[i * 4 + 1] = (word >>> 16) & 0xff
      out[i * 4 + 2] = (word >>> 8) & 0xff
      out[i * 4 + 3] = word & 0xff
    }
    return out
  }

  digest(): Uint8Array {
    return this.digestInto(new Uint8Array(32))
  }

  #compress(input: Uint8Array, at: number): void {
    const w = this.#words
    for (let i = 0; i < 16; i += 1) {
      const j = at + i * 4
      w[i] =
        ((input[j] as number) << 24) |
        ((input[j + 1] as number) << 16) |
        ((input[j + 2] as number) << 8) |
        (input[j + 3] as number)
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15] as number
      const y = w[i - 2] as number
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0
    }

    let a = this.#state[0] as number
    let b = this.#state[1] as number
    let c = this.#state[2] as number
    let d = this.#state[3] as number
    let e = this.#state[4] as number
    let f = this.#state[5] as number
    let g = this.#state[6] as number
    let h = this.#state[7] as number

    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + (K[i] as number) + (w[i] as number)) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }

    this.#state[0] = ((this.#state[0] as number) + a) | 0
    this.#state[1] = ((this.#state[1] as number) + b) | 0
    this.#state[2] = ((this.#state[2] as number) + c) | 0
    this.#state[3] = ((this.#state[3] as number) + d) | 0
    this.#state[4] = ((this.#state[4] as number) + e) | 0
    this.#state[5] = ((this.#state[5] as number) + f) | 0
    this.#state[6] = ((this.#state[6] as number) + g) | 0
    this.#state[7] = ((this.#state[7] as number) + h) | 0
  }
}

const scratch = new Sha256()

/** One SHA-256. */
export function sha256(...parts: readonly Uint8Array[]): Uint8Array {
  scratch.reset()
  for (const part of parts) scratch.update(part)
  return scratch.digest()
}

/**
 * SHA-256 applied twice — Bitcoin's hash, and the hash of every merkle node and transaction id in
 * the family that includes Litecoin.
 *
 * Named separately from `sha256` because forgetting the second application is a silent defect: the
 * result is still thirty-two uniformly random-looking bytes, and it disagrees with the pool about
 * every merkle root while looking exactly like an unlucky nonce.
 */
export function sha256d(...parts: readonly Uint8Array[]): Uint8Array {
  return sha256(sha256(...parts))
}
