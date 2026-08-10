/**
 * BROWSER-MINED EMBER REACHING THE ACCOUNT BALANCE — the signer, and the policy in front of it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * micro-org#299. The reward is paid to a key this tab holds, because Hearth's `verifyPow` recovers
 * the signer from the proof and requires it to equal the coinbase key — there is no payout-address
 * field to point elsewhere. The fix is not to change that; it is to send the reward on, one
 * transaction later, to the account's own custodial deposit address, where wallet's existing
 * deposit path books it after EMBER's 60 confirmations.
 *
 * That makes a TRANSACTION SIGNER part of this bundle, which is the thing worth testing hardest. A
 * signer that is subtly wrong does not fail loudly: it produces bytes a node rejects as "invalid
 * sender" — a message about the recovered address, saying nothing about the encoding mistake that
 * moved it — or, worse, a valid transaction on a chain nobody meant.
 *
 * So the first group runs THE EIP-155 SPECIFICATION'S OWN WORKED EXAMPLE and requires the output
 * character for character. It is not a fixture generated from this code; it is the vector printed
 * in the EIP, with its private key, its signing hash and its signed bytes, and it exercises the
 * whole path — minimal-integer encoding, the `(chainId, 0, 0)` pre-image trick, low-S normalisation,
 * `v = recoveryId + chainId * 2 + 35`, and the RLP list framing.
 *
 * The second group is about the money rather than the bytes: what the sweep does when the balance
 * cannot pay its own fee, when the node refuses, when an earlier sweep is still in the mempool, and
 * which block tags it reads. Those are the branches where an error costs a reward rather than a
 * request.
 *
 * That last one was found in production rather than here, which is the reason for the fixture note
 * below. The fake in this file answered one string per METHOD, so `eth_getTransactionCount` gave
 * the same number at `latest` and at `pending` — and a sweep that reads a balance without a mempool
 * against a nonce with one cannot be wrong in a world where the mempool is always empty. It was
 * wrong on mainnet every other block.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { rpcCall, sweepToCustody, type SweepOutcome } from '../src/lib/embersweep.ts'

const tx = await import('../src/mining/tx.js')

function bytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

describe('the transaction signer, against the specification rather than against itself', () => {
  it('reproduces the EIP-155 worked example byte for byte', () => {
    // Straight out of EIP-155: nonce 9, 20 gwei, 21000 gas, 1 ETH to 0x3535…35, chain id 1, signed
    // with the key of all 0x46. If this line ever has to be "regenerated", something is wrong with
    // the change rather than with the vector.
    const signed = tx.signValueTransfer({
      nonce: 9,
      gasPrice: 20_000_000_000n,
      gasLimit: 21_000,
      to: '0x3535353535353535353535353535353535353535',
      value: 1_000_000_000_000_000_000n,
      chainId: 1,
      priv: bytes('46'.repeat(32)),
    })
    assert.equal(
      signed.raw,
      '0xf86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a7640000' +
        '8025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276' +
        'a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83',
    )
  })

  it('encodes zero as the empty string, which is the mistake that signs as somebody else', () => {
    // RLP has no leading zeroes, so the number 0 is NO BYTES (0x80) and not 0x00. A signer that
    // writes 0x00 for a zero nonce hashes a different pre-image, recovers a different sender, and
    // is rejected with a message that describes the address rather than the encoding.
    assert.equal(hex(tx.toMinimalBytes(0)), '')
    assert.equal(hex(tx.rlpEncode(tx.toMinimalBytes(0))), '80')
    assert.equal(hex(tx.toMinimalBytes(1)), '01')
    assert.equal(hex(tx.toMinimalBytes(256)), '0100')
    // A single byte under 0x80 is its own encoding; prefixing it decodes the same and hashes
    // differently, which is the only thing that matters here.
    assert.equal(hex(tx.rlpEncode(tx.toMinimalBytes(0x7f))), '7f')
    assert.equal(hex(tx.rlpEncode(tx.toMinimalBytes(0x80))), '8180')
    assert.equal(hex(tx.rlpEncode([])), 'c0')
  })

  it('refuses a chain id, so nothing this bundle signs is replayable elsewhere', () => {
    // A mining key that has just been paid is a bearer instrument. An unprotected signature moves
    // the same value on every EVM chain that key exists on, and the reader would never know.
    assert.throws(
      () =>
        tx.signValueTransfer({
          nonce: 0,
          gasPrice: 1n,
          gasLimit: 21_000,
          to: '0x3535353535353535353535353535353535353535',
          value: 1n,
          chainId: 0,
          priv: bytes('46'.repeat(32)),
        }),
      /chain id is required/,
    )
  })

  it('refuses a recipient that is not twenty bytes rather than padding one', () => {
    // The failure this prevents: a truncated address padded to length is a valid address belonging
    // to nobody, and the EMBER sent to it is gone with no error anywhere.
    assert.throws(
      () =>
        tx.signValueTransfer({
          nonce: 0,
          gasPrice: 1n,
          gasLimit: 21_000,
          to: '0x353535',
          value: 1n,
          chainId: 7411,
          priv: bytes('46'.repeat(32)),
        }),
      /20 bytes/,
    )
  })
})

/* ────────────────────────────────────────────────────────── the sweep's own decisions ───── */

const KEY = { priv: bytes('46'.repeat(32)), address: '0x9d8A62f656a8d1615C1294fd71e9CFb3E4855A4F' }
const CUSTODY = '0x3535353535353535353535353535353535353535'

/**
 * A node that answers from a script, and records every method it was asked.
 *
 * An answer may be a function, and it receives the CALL'S PARAMS, because the defect this file now
 * guards against lives entirely in the difference between two params of the same method:
 * `eth_getTransactionCount(addr, 'latest')` and `…(addr, 'pending')` are different questions and a
 * fake that cannot tell them apart cannot reproduce the bug — which is why the original tests here
 * passed while mainnet failed every other block.
 */
function node(answers: Record<string, string | ((params: readonly unknown[]) => string)>) {
  const asked: { method: string; params: readonly unknown[] }[] = []
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const call = JSON.parse(init.body) as { method: string; params: readonly unknown[] }
    asked.push(call)
    const answer = answers[call.method]
    if (answer === undefined) {
      return {
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, error: { message: `no answer for ${call.method}` } }),
      }
    }
    return {
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: typeof answer === 'function' ? answer(call.params) : answer,
      }),
    }
  }) as unknown as typeof globalThis.fetch
  return { asked, deps: { rpc: 'http://node.test', fetch: fetchImpl, delay: async () => {} } }
}

describe('sweeping the reward into the account, and the three ways it declines to', () => {
  it('sends the whole balance less exactly one transfer fee', async () => {
    const n = node({
      eth_chainId: '0x1cf3', // 7411, mainnet, read from the node rather than compiled in
      eth_gasPrice: '0x3b9aca00', // 1 gwei — EVM_MIN_GAS_PRICE, measured on mainnet 2026-08-10
      eth_getBalance: '0xde0b6b3a7640000', // 1 EMBER
      eth_getTransactionCount: '0x0',
      eth_sendRawTransaction: '0xabc',
    })
    const out: SweepOutcome = await sweepToCustody(KEY, CUSTODY, n.deps)

    assert.equal(out.kind, 'sent')
    if (out.kind !== 'sent') return
    assert.equal(out.hash, '0xabc')
    // 21000 gas at 1 gwei. Paying out the balance rather than a remembered reward is what makes a
    // failed earlier sweep, or two blocks landing between reads, self-correcting.
    assert.equal(out.value, 1_000_000_000_000_000_000n - 21_000n * 1_000_000_000n)

    // `pending`, not `latest`, for the nonce that gets signed. A send whose response was lost is
    // holding a nonce in the mempool, and re-using it is a race whose loser is a reward.
    const tags = n.asked
      .filter((c) => c.method === 'eth_getTransactionCount')
      .map((c) => (c.params as readonly unknown[])[1])
    assert.ok(tags.includes('pending'), 'the nonce was never asked at `pending`')
    // And `latest` as well, in the same pass — the difference between the two IS the in-flight
    // check, and asking only one of them is what shipped the defect below.
    assert.ok(tags.includes('latest'), 'the mined nonce was never asked, so nothing detects a queue')
    for (const c of n.asked.filter((c) => c.method === 'eth_getTransactionCount')) {
      assert.equal((c.params as readonly unknown[])[0], KEY.address)
    }
  })

  it('a balance that cannot pay its own fee is a state, not a failure, and sends nothing', async () => {
    // Dust on the key is the ordinary end of a session. Broadcasting a transaction whose value is
    // zero or negative is either refused by the node or spends the whole balance on its own fee.
    const n = node({
      eth_chainId: '0x1cf3',
      eth_gasPrice: '0x3b9aca00',
      eth_getBalance: '0x1',
      eth_getTransactionCount: '0x0',
      eth_sendRawTransaction: '0xabc',
    })
    const out = await sweepToCustody(KEY, CUSTODY, n.deps)

    assert.equal(out.kind, 'too_small')
    assert.ok(!n.asked.some((c) => c.method === 'eth_sendRawTransaction'), 'it broadcast anyway')
  })

  it('waits for the reward to land before calling it dust', async () => {
    // The accepted block is applied on the mining port; this reads the JSON-RPC one. They are the
    // same node, but not necessarily the same instant, and a sweep that gave up on the first read
    // would report dust for a reward that arrived a second later.
    let reads = 0
    const n = node({
      eth_chainId: '0x1cf3',
      eth_gasPrice: '0x3b9aca00',
      eth_getBalance: () => {
        reads += 1
        return reads < 3 ? '0x0' : '0xde0b6b3a7640000'
      },
      eth_getTransactionCount: '0x0',
      eth_sendRawTransaction: '0xabc',
    })
    const out = await sweepToCustody(KEY, CUSTODY, n.deps)

    assert.equal(out.kind, 'sent')
    assert.equal(reads, 3)
  })

  it('a refused send leaves the balance where it is and says why', async () => {
    // Deliberately NOT retried. The transaction may already be in the mempool; re-signing the same
    // nonce races it and re-signing the next one turns the reward into two fees. The next accepted
    // block sweeps both.
    const n = node({
      eth_chainId: '0x1cf3',
      eth_gasPrice: '0x3b9aca00',
      eth_getBalance: '0xde0b6b3a7640000',
      eth_getTransactionCount: '0x0',
    })
    const out = await sweepToCustody(KEY, CUSTODY, n.deps)

    assert.equal(out.kind, 'failed')
    if (out.kind !== 'failed') return
    assert.match(out.message, /eth_sendRawTransaction/)
    assert.equal(n.asked.filter((c) => c.method === 'eth_sendRawTransaction').length, 1, 'it retried')
  })

  it('will not sign while an earlier sweep is unmined, and says so as a state', async () => {
    // The two tags disagree: three transactions are mined, four are known. That difference is one
    // transaction of this key's money already committed and not yet subtracted from any balance
    // this page can read, so there is no value it could compute that would be right.
    const n = node({
      eth_chainId: '0x1cf3',
      eth_gasPrice: '0x3b9aca00',
      eth_getBalance: '0xde0b6b3a7640000',
      eth_getTransactionCount: (params) => (params[1] === 'pending' ? '0x4' : '0x3'),
      eth_sendRawTransaction: '0xabc',
    })
    const out = await sweepToCustody(KEY, CUSTODY, n.deps)

    assert.equal(out.kind, 'in_flight')
    if (out.kind !== 'in_flight') return
    assert.equal(out.queued, 1n)
    assert.ok(!n.asked.some((c) => c.method === 'eth_sendRawTransaction'), 'it signed anyway')
  })

  it('reproduces the mainnet alternation and does not overdraw the second sweep', async () => {
    /*
     * THE DEFECT, AS THE OWNER SAW IT ON MAINNET ON 2026-08-10 — every other block red:
     *
     *   block 10,919  5.3929 EMBER sent
     *   block 10,920  not moved — eth_sendRawTransaction: insufficient funds for gas * price + value
     *   block 10,921  10.7859 EMBER sent          ← exactly twice 5.3929
     *
     * `eth_getBalance` has no mempool in Hearth (`_stateFor('pending')` returns `stateAtTip()`),
     * so the balance still counts money committed to a sweep that has not been mined. This walks
     * the three blocks with a node that keeps the two apart, which the fixture above could not.
     */
    const REWARD = 5_392_900_000_000_000_000n
    const FEE = 21_000n * 1_000_000_000n

    let balance = 0n
    let minedNonce = 0n
    let inMempool: bigint | null = null // the value of the unmined sweep, or null

    const n = node({
      eth_chainId: '0x1cf3',
      eth_gasPrice: '0x3b9aca00',
      eth_getBalance: () => `0x${balance.toString(16)}`,
      eth_getTransactionCount: (params) =>
        `0x${(params[1] === 'pending' && inMempool !== null ? minedNonce + 1n : minedNonce).toString(16)}`,
      eth_sendRawTransaction: '0xt1',
    })

    // Block 10,919. Nothing pending, one reward on the key.
    balance = REWARD
    const first = await sweepToCustody(KEY, CUSTODY, n.deps)
    assert.equal(first.kind, 'sent')
    if (first.kind !== 'sent') return
    assert.equal(first.value, REWARD - FEE)
    inMempool = first.value

    // Block 10,920. The next reward lands before that transfer is mined, so `latest` now reports
    // both — and all but one of them is already spoken for.
    balance += REWARD
    const sendsBefore = n.asked.filter((c) => c.method === 'eth_sendRawTransaction').length
    const second = await sweepToCustody(KEY, CUSTODY, n.deps)
    assert.equal(second.kind, 'in_flight', 'it computed a value from a balance it does not own')
    // This is the line that used to be red. The old code signed `2R − fee` here; once the first
    // transfer executed the account held `R`, and the node refused the difference by name.
    assert.equal(
      n.asked.filter((c) => c.method === 'eth_sendRawTransaction').length,
      sendsBefore,
      'a second transaction was broadcast while the first was unmined',
    )

    // Block 10,921. The first transfer is mined; the key holds exactly the one reward it was not
    // able to send, and the sweep resumes with no gap and nothing lost.
    balance -= inMempool + FEE
    minedNonce += 1n
    inMempool = null
    const third = await sweepToCustody(KEY, CUSTODY, n.deps)
    assert.equal(third.kind, 'sent')
    if (third.kind !== 'sent') return
    assert.equal(third.value, REWARD - FEE)

    // Two rewards, two transfers, two fees, and no failure anywhere in the feed.
    assert.equal(first.value + third.value, 2n * REWARD - 2n * FEE)
  })

  it('carries no credentials to the chain endpoint', async () => {
    // The node is a public endpoint and the tab's session has no business on it. A cookie sent to
    // `rpc.<apex>` is a session identifier handed to something that has no use for one.
    let sent: { credentials?: string } | null = null
    const fetchImpl = (async (_url: string, init: { body: string; credentials?: string }) => {
      sent = init
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x1' }) }
    }) as unknown as typeof globalThis.fetch

    await rpcCall('eth_chainId', [], { rpc: 'http://node.test', fetch: fetchImpl })
    assert.equal((sent as { credentials?: string } | null)?.credentials, 'omit')
  })
})
