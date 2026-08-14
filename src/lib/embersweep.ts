/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * **BROWSER-MINED EMBER, SWEPT INTO THE ACCOUNT'S OWN CUSTODIAL BALANCE.** micro-org#299.
 *
 * The constraint that created the defect is a consensus rule and does not bend. `verifyPow` in
 * `hearth/node/src/chain/header.js` recovers the signer from a signature over the winning digest
 * and requires it to equal the coinbase key, and `Templates.issue(pubHex)` takes a public key and
 * DERIVES the coinbase address from it — there is no payout-address field to point somewhere else,
 * deliberately, so that "a miner cannot repoint the coinbase". So the key that signs the proof has
 * to be in the tab, and the reward has to land on that key.
 *
 * micro-custody, equally correctly, releases a key only through a 24-hour ceremony with a second
 * factor, and will not hand one to a web page. Both constraints are right and together they left no
 * path from a browser-mined block to a CloudsForge balance. What shipped instead was the honest
 * minimum: show the throwaway key, tell the reader to save it, gate Start behind a checkbox. That
 * is a self-custody flow appearing without warning inside a custodial product.
 *
 * ── THE PATH THAT WAS THERE ALL ALONG ──────────────────────────────────────────────────────────
 *
 * The reward does not have to STAY on the tab's key. It has to be PAID to it. One transaction later
 * it can be anywhere, and the account already has a place for it: the custodial EMBER deposit
 * address `wallet` mints from `POST /v1/deposits`. So the tab keeps signing with a throwaway key,
 * and the moment a block is accepted it sends the balance to that deposit address. From there the
 * estate's existing deposit path does every remaining thing, and does it the way the estate already
 * agreed to:
 *
 *   - the address is already registered with the indexer under a `deposit:<userId>` label, by
 *     wallet's own `deposit.watch` job, and is therefore already inside `INDEXER_CUSTODY_LABEL_PREFIXES`;
 *   - the credit is already booked double-entry by `handleDepositConfirmed` in
 *     `wallet/src/deposits.ts`, driven by the indexer's `indexer.deposit.confirmed` webhook;
 *   - and the ORPHAN RE-CHECK the issue asks for is already in front of it. `isConfirmed` in
 *     `contracts/packages/chain` requires `CHAINS.EMBER.confirmations`, which is **60** — about
 *     fifteen minutes at Hearth's fifteen-second target. A reward that loses a reorg never reaches
 *     that depth and is never credited.
 *
 * Nothing new is watched, nothing new is booked, and no new label enters the custody sum — which is
 * the constraint the issue's audit gave in advance, because a watched-but-unbooked address under
 * `deposit:` or `treasury:` is micro-org#248's estate-wide EMBER freeze reproduced exactly. This
 * path adds no address to that set at all; it sends to one that is already in it and already
 * accounted for.
 *
 * This is the issue's option 1 — a reassignment that credits the account for an accepted block —
 * done ON CHAIN from the tab that already holds the key, rather than server-side. That choice is
 * argued in `mine.tsx` where the alternative would have been visible to a reader. Option 3 (a pool
 * for EMBER) is refused in `pool/src/chains.ts`, and option 2 (custody releasing a session key)
 * would need the ceremony rule to grow a case.
 *
 * ── WHAT THIS FILE WILL NOT DO ─────────────────────────────────────────────────────────────────
 *
 *   - **Send to an unwatched address.** `POST /v1/deposits` reports `watchedAt`, and wallet's own
 *     comment on it is "an unwatched address produces no events" — a deposit sent to one arrives on
 *     chain and is never credited. This refuses rather than sending, and the page falls back to
 *     saying the reward is on the tab's key. Losing the sweep is recoverable; sending EMBER into a
 *     hole is not.
 *   - **Guess a chain id.** `eth_chainId` is asked every sweep. A transaction signed without EIP-155
 *     replay protection, from a key that has just been paid, is a bearer instrument.
 *   - **Retry a send.** A transaction that was broadcast and whose response was lost is ALREADY IN
 *     THE MEMPOOL with a nonce; re-signing the same nonce is a race and re-signing the next one
 *     double-spends the reward into a fee. A failed send leaves the balance where it is, and the
 *     next accepted block sweeps both.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
import { viewedSurfaceUrl } from './viewed.ts'

/**
 * A plain value transfer to an externally-owned account, exactly. Not an estimate.
 *
 * `eth_estimateGas` is deliberately not called: the answer for this transaction is fixed by the
 * yellow paper at 21000, an estimate is a round trip that can fail on its own, and a node that
 * answered anything else would be answering about a different transaction than the one being sent.
 */
const TRANSFER_GAS = 21_000n

/**
 * How long the sweep will wait for a reward to become spendable before calling it too small.
 *
 * There is no coinbase maturity on the account model — `_creditReward` in
 * `hearth/node/src/chain/blockchain.js` adds the subsidy straight to the balance, spendable in the
 * next block, and `params.js` says so in terms. The wait is therefore not for maturity; it is for
 * the accepted block to have been APPLIED and for the RPC port to be answering about the same tip
 * the mining port just accepted onto. Three reads a second and a half apart, and then it gives up
 * quietly, because the next accepted block sweeps both rewards together.
 */
const SETTLE_ATTEMPTS = 3
const SETTLE_DELAY_MS = 1_500

/** What happened, in the words the page puts on screen. Every branch is a state, not an error. */
export type SweepOutcome =
  | { readonly kind: 'sent'; readonly hash: string; readonly value: bigint; readonly to: string }
  /** The balance did not cover its own transfer fee. Nothing was sent and nothing was lost. */
  | { readonly kind: 'too_small'; readonly balance: bigint; readonly fee: bigint }
  /**
   * An earlier sweep is still in the mempool, so part of this balance is already committed and
   * cannot be counted twice. Nothing was sent, nothing was lost, and the next accepted block
   * sweeps both rewards together. See the settle loop for why this is a state and not an error.
   */
  | { readonly kind: 'in_flight'; readonly queued: bigint }
  | { readonly kind: 'failed'; readonly message: string }

export interface SweepDeps {
  /**
   * The JSON-RPC base — the `rpc` surface on the VIEWED network, port 8545, NOT the 8645 REST base
   * the miner uses. Defaulted rather than required because the sweep is fired from an `accepted`
   * event listener registered once per session, and a base captured there would be the network the
   * reader was looking at when they pressed Start rather than the one the reward belongs to.
   */
  readonly rpc?: string
  readonly fetch?: typeof globalThis.fetch
  /** Overridable so a test does not spend five seconds proving it waited. */
  readonly delay?: (ms: number) => Promise<void>
}

/** One JSON-RPC call. Errors carry the node's own message, because geth's strings are diagnostic. */
export async function rpcCall(
  method: string,
  params: readonly unknown[],
  deps: SweepDeps = {},
): Promise<string> {
  const doFetch = deps.fetch ?? globalThis.fetch
  const base = deps.rpc ?? viewedSurfaceUrl('rpc')
  const res = await doFetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    // No credentials. This is a public chain endpoint and the tab's session has no business on it.
    credentials: 'omit',
  })
  if (!res.ok) throw new Error(`the node answered ${res.status} to ${method}`)
  const body = (await res.json()) as { result?: unknown; error?: { message?: unknown } }
  if (body.error) {
    const message = typeof body.error.message === 'string' ? body.error.message : 'the node refused'
    throw new Error(`${method}: ${message}`)
  }
  if (typeof body.result !== 'string') throw new Error(`${method} answered something that is not a quantity`)
  return body.result
}

/**
 * Send everything the mining key holds to `to`, less exactly one transfer's worth of fee.
 *
 * The whole balance and not the block reward, on purpose. The reward is what the chain credited and
 * the balance is what is actually there, and the two differ whenever a previous sweep failed, two
 * blocks landed between reads, or the reader mined into the same key earlier in the session. Paying
 * out the balance makes every one of those self-correcting; paying out a remembered reward leaves
 * dust on a key nobody will ever look at again.
 */
export async function sweepToCustody(
  key: { readonly priv: Uint8Array; readonly address: string },
  to: string,
  deps: SweepDeps = {},
): Promise<SweepOutcome> {
  const delay = deps.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  try {
    const chainId = BigInt(await rpcCall('eth_chainId', [], deps))
    const gasPrice = BigInt(await rpcCall('eth_gasPrice', [], deps))
    const fee = gasPrice * TRANSFER_GAS

    /*
     * ── THE BALANCE AND THE NONCE MUST BE READ AT THE SAME MOMENT IN TIME ─────────────────────
     *
     * This loop used to read the balance at `latest` and then take the nonce at `pending`, and the
     * two tags do not describe the same world. `eth_getTransactionCount(addr, 'pending')` consults
     * the mempool — `getNonce` in `hearth/node/src/chain/rpcadapter.js` calls
     * `mempool.pendingNonce()` for that tag and only for that tag — while `eth_getBalance` has no
     * mempool path at all: its `_stateFor('pending')` returns `stateAtTip()`, which is `latest`.
     * So the nonce knew about the sweep already in flight and the balance did not, and the value
     * was computed as though money already committed to that transaction were still available.
     *
     * The owner reported it from mainnet on 2026-08-10, and the feed shows the signature exactly:
     *
     *   block 10,919  5.3929 EMBER sent
     *   block 10,920  not moved — eth_sendRawTransaction: insufficient funds for gas * price + value
     *   block 10,921  10.7859 EMBER sent          ← precisely twice 5.3929
     *   block 10,922  not moved — insufficient funds
     *   block 10,923  10.7859 EMBER sent
     *
     * Sweep T1 commits the whole balance and is broadcast. The next block credits reward R before
     * T1 is mined, so `latest` reports (T1's value + fee) + R and T2 is signed to spend all of it.
     * T1 executes first, leaves R, and T2 is refused for exactly the amount T1 took. Nothing is
     * lost — the file's own rule is that a failed send leaves the balance where it is — so the
     * block after that sweeps both rewards, which is where the doubling comes from. Then it
     * alternates forever, and every other line the reader sees is red.
     *
     * The fix is not to subtract a guess. It is to refuse to compute a value while an earlier
     * transaction is unmined, because this bundle cannot know what that transaction is spending,
     * and to say so as a state rather than a failure. `queued > 0` is that condition, read from
     * the two tags of the same call, and it is checked in the same loop as the balance so a sweep
     * that only has to wait for the previous one to land waits rather than reporting anything.
     */
    let balance = 0n
    let queued = 0n
    let nonce = 0n
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await delay(SETTLE_DELAY_MS)
      const mined = BigInt(await rpcCall('eth_getTransactionCount', [key.address, 'latest'], deps))
      // `pending`, not `latest`, for the nonce that is actually signed: a sweep whose send
      // succeeded and whose response was lost is sitting in the mempool holding one, and asking
      // `latest` would re-use it. When `queued` is zero the two are equal by definition.
      nonce = BigInt(await rpcCall('eth_getTransactionCount', [key.address, 'pending'], deps))
      queued = nonce - mined
      balance = BigInt(await rpcCall('eth_getBalance', [key.address, 'latest'], deps))
      if (queued === 0n && balance > fee) break
    }
    if (queued > 0n) return { kind: 'in_flight', queued }
    if (balance <= fee) return { kind: 'too_small', balance, fee }

    const { signValueTransfer } = await import('../mining/tx.js')
    const value = balance - fee
    const { raw } = signValueTransfer({
      nonce,
      gasPrice,
      gasLimit: TRANSFER_GAS,
      to,
      value,
      chainId,
      priv: key.priv,
    })
    const hash = await rpcCall('eth_sendRawTransaction', [raw], deps)
    return { kind: 'sent', hash, value, to }
  } catch (err) {
    return { kind: 'failed', message: err instanceof Error ? err.message : 'the sweep did not go through' }
  }
}
