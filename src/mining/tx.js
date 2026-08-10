/* An EIP-155 legacy transaction, built and signed in the tab. Nothing else.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS AT ALL, GIVEN `account.js` SAYS IT DELIBERATELY DOES NOT DO THIS.
 *
 * `account.js` opens with "the pre-migration wallet derived addresses through `transaction.js`,
 * which carries RLP, gas maths and a signer — 441 lines this page has no use for". That was true
 * while the mined EMBER stayed on the tab's own key, which is the defect micro-org#299 is about:
 * the reward landed on a throwaway key, the page showed the key and asked the reader to save it,
 * and a custodial product had quietly handed somebody a self-custody problem at the worst moment.
 *
 * The fix is one transaction — sweep the reward from the tab's key to the account's own custodial
 * EMBER deposit address, so the deposit path that already exists books it. That needs a signer, so
 * the page now has a use for one, and this is the smallest honest version of it: RLP for the two
 * shapes a transfer uses, one signing function, no gas estimation, no contract calls, no type-2.
 * It is 21000-gas value transfers to an EOA and nothing else, because that is all the sweep is.
 *
 * ── LEGACY, TYPE 0, AND THAT IS NOT A SHORTCUT ─────────────────────────────────────────────────
 *
 * Hearth refuses type-2. `hearth/node/src/jsonrpc/methods.js` omits `baseFeePerGas` from blocks so
 * that ethers, viem, MetaMask and Hardhat all pick the legacy path by themselves, and a 1559-shaped
 * call is re-priced from `maxFeePerGas` rather than honoured. `eth_gasPrice` answered `0x3b9aca00`
 * on mainnet on 2026-08-10 — 1 gwei, which is `EVM_MIN_GAS_PRICE` in `hearth/node/src/params.js`,
 * a mempool policy rather than a consensus rule. So there is exactly one transaction shape to
 * encode and no fee market to reason about.
 *
 * ── WHAT IS CHECKED, AND WHERE ─────────────────────────────────────────────────────────────────
 *
 * `test/ember-sweep.test.ts` runs the EIP-155 specification's own worked example — the one in the
 * EIP text, nonce 9 to `0x3535…35`, chain id 1 — and requires this file to produce the signed bytes
 * character for character. That vector is the reason to hand-roll this rather than reason about it:
 * a signer that is subtly wrong produces a transaction the node rejects, or worse, one it accepts
 * against the wrong chain.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
import * as secp from './secp256k1.js'
import { keccak256 } from './keccak.js'

/** RLP's own encoding of a zero-length input, and of the empty list. Named so the branches read. */
const RLP_EMPTY_STRING = 0x80
const RLP_EMPTY_LIST = 0xc0

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * A quantity as RLP wants it: big-endian, minimal, and ZERO IS THE EMPTY STRING.
 *
 * That last part is the rule that is easiest to get wrong and impossible to notice: RLP has no
 * leading zeroes, so the number 0 encodes as no bytes at all (`0x80`), not as `0x00`. A signer that
 * writes `0x00` for a zero nonce produces a different signing hash and therefore a transaction
 * signed by a key that is not the sender's, which the node rejects with "invalid sender" — a
 * message that says nothing about the actual mistake.
 */
export function toMinimalBytes(value) {
  let v = BigInt(value)
  if (v < 0n) throw new Error('a transaction field cannot be negative')
  if (v === 0n) return new Uint8Array(0)
  const out = []
  while (v > 0n) {
    out.unshift(Number(v & 0xffn))
    v >>= 8n
  }
  return Uint8Array.from(out)
}

/** `0x`-prefixed or bare hex to bytes. Odd-length input is a caller bug, not something to pad. */
export function hexToBytes(text) {
  const clean = String(text).replace(/^0x/i, '')
  if (clean.length % 2 !== 0) throw new Error(`hex of odd length: ${clean.length} characters`)
  if (clean.length > 0 && !/^[0-9a-fA-F]+$/.test(clean)) throw new Error('that is not hex')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** The length prefix RLP puts in front of a payload: short form under 56 bytes, long form above. */
function lengthPrefix(length, offset) {
  if (length < 56) return Uint8Array.from([offset + length])
  const len = toMinimalBytes(length)
  return concat([Uint8Array.from([offset + 55 + len.length]), len])
}

/**
 * RLP, for the two things a transaction is made of: byte strings and lists of them.
 *
 * Deliberately not general. There is no integer branch, because a number reaching here without
 * having been through `toMinimalBytes` is ambiguous — RLP has no notion of a number — and no object
 * branch, because there is nothing in a transaction that is one. An unrecognised input throws
 * rather than being coerced, which is the difference between a bug that fails and one that signs.
 */
export function rlpEncode(item) {
  if (Array.isArray(item)) {
    const body = concat(item.map(rlpEncode))
    if (body.length === 0) return Uint8Array.from([RLP_EMPTY_LIST])
    return concat([lengthPrefix(body.length, RLP_EMPTY_LIST), body])
  }
  if (!(item instanceof Uint8Array)) {
    throw new Error('rlpEncode takes Uint8Array and arrays of them, nothing else')
  }
  if (item.length === 0) return Uint8Array.from([RLP_EMPTY_STRING])
  // A single byte below 0x80 is its own encoding. Prefixing it would still decode, but it would not
  // be the canonical form, and a transaction hash is over the exact bytes.
  if (item.length === 1 && item[0] < RLP_EMPTY_STRING) return Uint8Array.from([item[0]])
  return concat([lengthPrefix(item.length, RLP_EMPTY_STRING), item])
}

/**
 * Sign a value transfer and return the raw bytes `eth_sendRawTransaction` takes.
 *
 * `v = recoveryId + chainId * 2 + 35` — EIP-155 replay protection, and the reason the chain id is a
 * required parameter with no default. A transaction signed without it is valid on every EVM chain
 * that shares the key, which for a mining key that has just been paid is a bearer instrument
 * somebody can lift and replay elsewhere. The chain id is read from the node with `eth_chainId`
 * rather than compiled in, so testnet (7412) and mainnet (7411) are the same bundle.
 *
 * `sign` in `secp256k1.js` already normalises to low-S and flips the recovery id with it (EIP-2),
 * so nothing here has to.
 */
export function signValueTransfer({ nonce, gasPrice, gasLimit, to, value, chainId, priv }) {
  const recipient = hexToBytes(to)
  if (recipient.length !== 20) throw new Error(`a recipient is 20 bytes, not ${recipient.length}`)
  const id = BigInt(chainId)
  if (id <= 0n) throw new Error('a chain id is required; an unprotected signature is replayable')

  const body = [
    toMinimalBytes(nonce),
    toMinimalBytes(gasPrice),
    toMinimalBytes(gasLimit),
    recipient,
    toMinimalBytes(value),
    // No data. A transfer to an externally-owned account carries none, and 21000 gas pays for none.
    new Uint8Array(0),
  ]

  // The pre-image is the body plus (chainId, 0, 0) — EIP-155's trick for making the chain id part
  // of the signed message without changing the encoding's arity.
  const signingHash = keccak256(rlpEncode([...body, toMinimalBytes(id), new Uint8Array(0), new Uint8Array(0)]))
  const sig = secp.sign(signingHash, priv)
  if (!sig) throw new Error('the transaction could not be signed')

  const v = BigInt(sig.recoveryId) + id * 2n + 35n
  const raw = rlpEncode([...body, toMinimalBytes(v), toMinimalBytes(sig.r), toMinimalBytes(sig.s)])
  return { raw: `0x${hex(raw)}`, hash: `0x${hex(keccak256(raw))}` }
}
