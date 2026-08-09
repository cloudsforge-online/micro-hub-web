/**
 * The two hash functions this repository had to write itself, pinned against things that are not
 * this repository.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * A hash is the one kind of code where "correct" can be established rather than argued. There is a
 * published function with published answers, and either these bytes are those bytes or they are
 * not. So nothing below asserts against a constant this codebase produced: every expected value is
 * from RFC 7914, from a chain's live history, or from OpenSSL through `node:crypto`.
 *
 * The stakes are the reason for the belt and braces. `src/lib/scrypt.ts` exists because no browser
 * ships scrypt, and the pool computes shares with OpenSSL's. A disagreement between the two does
 * not raise: it produces thirty-two uniformly distributed bytes that fail the target comparison in
 * exactly the way an honest losing nonce does. The miner would report a healthy hashrate, submit
 * nothing all afternoon, and be indistinguishable from bad luck on a slow machine.
 *
 * ── THE FOUR INDEPENDENT CHECKS, AND WHY NONE OF THEM SUBSUMES ANOTHER ────────────────────────
 *
 *   1. **RFC 7914's own vectors**, transcribed from the document. These do not depend on Node
 *      having a correct scrypt — they would catch the case where OpenSSL and this file are wrong
 *      in the same way, which is not a serious risk, and more usefully they catch a transcription
 *      error in the parameters rather than in the algorithm.
 *   2. **Litecoin's genesis block**, which is a fixed real vector in the strongest sense: a header
 *      that exists, whose SHA-256d is the block hash every explorer prints, and whose scrypt digest
 *      clears the target its own `nbits` field encodes. Passing that is reproducing a proof of work
 *      the network accepted in 2011, and it cannot happen by accident.
 *   3. **OpenSSL, over random headers**, using the exact call `pool/src/pow.ts` makes. This is the
 *      one that would catch an input-length-dependent defect the fixed vectors happen to miss.
 *   4. **SHA-256 across every length that crosses a block or padding boundary**, because scrypt is
 *      built on it and a padding defect at, say, 55 or 56 bytes would show up only for particular
 *      message sizes — and an 80-byte header is one particular message size.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import assert from 'node:assert/strict'
import { createHash, randomBytes, scryptSync } from 'node:crypto'
import { describe, it } from 'node:test'
import { LITECOIN_SCRYPT, scrypt, scryptPow } from '../src/lib/scrypt.ts'
import { Sha256, sha256, sha256d } from '../src/lib/sha256.ts'
import { bytesToHex, hashToDisplay, hexToBytes, meetsTarget, powHashToBigInt } from '../src/lib/stratum.ts'

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('SHA-256', () => {
  it('agrees with OpenSSL at every length that crosses a block or padding boundary', () => {
    // 55/56 is where the length counter stops fitting in the final block, 63/64/65 is the block
    // itself, and 119/120 is the same padding boundary one block later. A hash that is wrong only
    // at one of these is wrong only for particular message sizes, which is the hardest kind to
    // notice and the easiest kind to write.
    for (const length of [0, 1, 3, 32, 55, 56, 57, 63, 64, 65, 80, 119, 120, 127, 128, 129, 1000]) {
      const data = randomBytes(length)
      assert.equal(
        bytesToHex(sha256(new Uint8Array(data))),
        createHash('sha256').update(data).digest('hex'),
        `SHA-256 of ${length} bytes`,
      )
    }
  })

  it('produces the two answers everybody knows by sight', () => {
    assert.equal(
      bytesToHex(sha256(new Uint8Array(0))),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    assert.equal(
      bytesToHex(sha256(utf8('abc'))),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('hashes a concatenation the same as the concatenated bytes', () => {
    // The variadic form is what the merkle fold uses — `sha256d(root, step)` rather than
    // `sha256d(concat(root, step))` — so the equivalence is load-bearing, not cosmetic.
    const left = randomBytes(32)
    const right = randomBytes(32)
    assert.equal(
      bytesToHex(sha256(new Uint8Array(left), new Uint8Array(right))),
      bytesToHex(sha256(new Uint8Array(Buffer.concat([left, right])))),
    )
  })

  it('streams the same digest as a single update', () => {
    const data = randomBytes(300)
    const streamed = new Sha256()
    for (let at = 0; at < data.length; at += 7) {
      streamed.update(new Uint8Array(data.subarray(at, Math.min(at + 7, data.length))))
    }
    assert.equal(bytesToHex(streamed.digest()), createHash('sha256').update(data).digest('hex'))
  })

  it('applies SHA-256 twice for sha256d', () => {
    const data = randomBytes(80)
    assert.equal(
      bytesToHex(sha256d(new Uint8Array(data))),
      createHash('sha256').update(createHash('sha256').update(data).digest()).digest('hex'),
    )
  })
})

describe('scrypt', () => {
  /**
   * RFC 7914 §12, transcribed from the document rather than generated.
   *
   * The fourth vector — N=1048576, r=8, p=1 — is deliberately absent. It needs a gibibyte of
   * working memory and tens of seconds, and it tests nothing the third does not: the difference is
   * the size of N, which is a loop bound, and every structural property of the algorithm is already
   * exercised. A test suite nobody will wait for is a test suite that gets skipped.
   */
  const RFC_7914 = [
    {
      password: '',
      salt: '',
      params: { N: 16, r: 1, p: 1, dkLen: 64 },
      expected:
        '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442' +
        'fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906',
    },
    {
      password: 'password',
      salt: 'NaCl',
      params: { N: 1024, r: 8, p: 16, dkLen: 64 },
      expected:
        'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b373162' +
        '2eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640',
    },
    {
      password: 'pleaseletmein',
      salt: 'SodiumChloride',
      params: { N: 16384, r: 8, p: 1, dkLen: 64 },
      expected:
        '7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2' +
        'd5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887',
    },
  ] as const

  for (const vector of RFC_7914) {
    it(`matches RFC 7914 for N=${vector.params.N} r=${vector.params.r} p=${vector.params.p}`, () => {
      assert.equal(
        bytesToHex(scrypt(utf8(vector.password), utf8(vector.salt), vector.params)),
        vector.expected,
      )
    })
  }

  /**
   * `r=8, p=16` is the vector that proves the BlockMix interleave, and it is why that step is
   * written out rather than simplified away.
   *
   * At Litecoin's r=1 the "even results then odd results" reordering is the identity — there is one
   * of each — so an implementation that dropped it would agree with every other test in this file
   * and with the entire Litecoin network. The second RFC vector is the only thing here that would
   * notice, which is exactly why it is not optional.
   */
  it('exercises the BlockMix interleave that r=1 cannot see', () => {
    const interleaved = RFC_7914[1]
    assert.ok(interleaved.params.r > 1, 'the interleave is only observable above r=1')
  })

  it('agrees with OpenSSL over random 80-byte headers, using the pool’s exact call', () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const header = randomBytes(80)
      assert.equal(
        bytesToHex(scryptPow(new Uint8Array(header))),
        scryptSync(header, header, 32, { N: 1024, r: 1, p: 1 }).toString('hex'),
      )
    }
  })

  it('agrees with OpenSSL for inputs that are not 80 bytes either', () => {
    // scryptPow's password and salt are the same 80 bytes, which is a special case in two ways at
    // once. This covers a short key (no pre-hash inside HMAC) and a long one (pre-hashed), which
    // are different branches.
    for (const length of [0, 1, 63, 64, 65, 200]) {
      const password = randomBytes(length)
      const salt = randomBytes(17)
      assert.equal(
        bytesToHex(scrypt(new Uint8Array(password), new Uint8Array(salt), LITECOIN_SCRYPT)),
        scryptSync(password, salt, 32, { N: 1024, r: 1, p: 1 }).toString('hex'),
        `a ${length}-byte password`,
      )
    }
  })

  it('refuses an N that is not a power of two, rather than masking it', () => {
    // The `Integerify … mod N` step is implemented as a bitmask, which is free and correct for a
    // power of two and silently a different function for anything else.
    assert.throws(() => scrypt(utf8('x'), utf8('y'), { N: 1000, r: 1, p: 1, dkLen: 32 }), RangeError)
    assert.throws(() => scrypt(utf8('x'), utf8('y'), { N: 1, r: 1, p: 1, dkLen: 32 }), RangeError)
  })
})

/**
 * ══ LITECOIN'S GENESIS BLOCK, WHICH IS THE FIXED REAL VECTOR ══════════════════════════════════
 *
 * Mined on 2011-10-07 and still the first block of the chain this page will mine. Every field below
 * is public and checkable, and the header is ASSEMBLED here from those fields rather than pasted as
 * eighty bytes — so this also tests the header layout in `lib/stratum.ts`, not only the hash.
 *
 * The two assertions are independent and both matter:
 *
 *   - the SHA-256d of these bytes is `12a765e3…`, which is the block hash Litecoin's own
 *     `getblockhash 0` returns and which every explorer prints. That proves the eighty bytes are
 *     the real header, in the real order, before any claim is made about scrypt.
 *   - the scrypt digest clears the target encoded in the header's own `nbits`. That is the proof of
 *     work itself. A wrong scrypt cannot produce a digest under a target of 2^-20 of the space by
 *     accident; the odds against are a million to one per attempt and there is one attempt.
 */
describe('Litecoin’s genesis block', () => {
  const VERSION = 1
  const MERKLE_ROOT_DISPLAY = '97ddfbbae6be97fd6cdf3e7ca13232a3afff2353e29badfab7f73011edd4ced9'
  const TIME = 1_317_972_665
  const BITS = 0x1e0ffff0
  const NONCE = 2_084_524_493
  const BLOCK_HASH = '12a765e31ffd4059bada1e25190f6e98c99d9714d334efa41a195a7e7e04bfe2'

  /** The eighty bytes, little-endian throughout, with a previous-block hash of all zeros. */
  function genesisHeader(): Uint8Array {
    const header = new Uint8Array(80)
    const view = new DataView(header.buffer)
    view.setUint32(0, VERSION, true)
    // Bytes 4..36 are the previous block hash and stay zero: this is the first block.
    header.set(hexToBytes(MERKLE_ROOT_DISPLAY).reverse(), 36)
    view.setUint32(68, TIME, true)
    view.setUint32(72, BITS, true)
    view.setUint32(76, NONCE, true)
    return header
  }

  it('hashes to the block hash the chain reports', () => {
    assert.equal(hashToDisplay(sha256d(genesisHeader())), BLOCK_HASH)
  })

  it('has a scrypt proof of work that clears its own stated target', () => {
    // `nbits` is a compact float: the low three bytes are the mantissa, the top byte the exponent.
    const mantissa = BigInt(BITS & 0x00ffffff)
    const target = mantissa * 2n ** (8n * BigInt((BITS >>> 24) - 3))
    const digest = scryptPow(genesisHeader())

    assert.ok(
      meetsTarget(digest, target),
      `the genesis scrypt digest ${hashToDisplay(digest)} does not clear its target ` +
        `${target.toString(16).padStart(64, '0')} — this implementation is not Litecoin's scrypt`,
    )
    // Stated as a number on screen, per the estate's own rule about quantitative claims: the digest
    // is about twenty binary orders of magnitude below the whole space, which is what "clears the
    // target" means in the only units that check.
    assert.ok(powHashToBigInt(digest) < 2n ** 236n)
  })

  /**
   * The known answer, recorded so a future change has to be deliberate.
   *
   * Cited last on purpose. The two assertions above establish that this value is Litecoin's actual
   * proof of work without anyone having to trust a pasted constant; this one exists so that a
   * change which broke scrypt in a way that still happened to clear the target — vanishingly
   * unlikely, but the cost of missing it is a mining page that quietly earns nothing — is caught
   * too. Display order, as an explorer would show it.
   */
  it('produces the digest it has produced since 2011', () => {
    assert.equal(
      hashToDisplay(scryptPow(genesisHeader())),
      '0000050c34a64b415b6b15b37f2216634b5b1669cb9a2e38d76f7213b0671e00',
    )
  })
})
