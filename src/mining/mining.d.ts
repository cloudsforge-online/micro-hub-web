/**
 * Types for the recovered miner.
 *
 * The implementation is JavaScript on purpose and stays that way: it is a restored, byte-for-byte
 * port of the node's proof-of-work, checked against `hearth/node/src/pow.js` for digest equality.
 * Rewriting it in TypeScript would mean re-deriving the hash, and a digest that differs from the
 * node's in one bit is work the chain refuses while the page looks busy. So the algorithm is left
 * exactly as it was and only its shape is declared here.
 */

declare module '*/mining/account.js' {
  export interface MiningKey {
    readonly priv: Uint8Array
    readonly pubHex: string
    readonly address: string
    readonly privHex: string
  }
  /** A fresh key from the platform CSPRNG. */
  export function generateKey(): MiningKey
  /** A key a reader pastes back, so a machine can point at an address it already owns. */
  export function keyFromHex(text: string): MiningKey
  export function addressFor(priv: Uint8Array): string
  export function publicKeyHex(priv: Uint8Array): string
  export function toChecksumAddress(addr: string): string
}

declare module '*/mining/tx.js' {
  /**
   * A signed EIP-155 legacy value transfer, ready for `eth_sendRawTransaction`.
   *
   * Declared because `lib/embersweep.ts` imports it from TypeScript. The implementation is
   * JavaScript for the same reason its neighbours are: it sits directly on `secp256k1.js` and
   * `keccak.js`, which are the byte-for-byte port, and a module boundary between them would be a
   * boundary in the middle of one signature.
   */
  export function signValueTransfer(tx: {
    readonly nonce: bigint | number
    readonly gasPrice: bigint | number
    readonly gasLimit: bigint | number
    /** 20 bytes as hex, `0x`-prefixed or not. Any other length throws rather than being padded. */
    readonly to: string
    readonly value: bigint | number
    /** Required. An unprotected signature is replayable on every chain that shares the key. */
    readonly chainId: bigint | number
    readonly priv: Uint8Array
  }): { readonly raw: string; readonly hash: string }
  /** RLP over byte strings and lists of them. No integer branch: see the comment on it. */
  export function rlpEncode(item: Uint8Array | readonly unknown[]): Uint8Array
  /** Big-endian, minimal, and zero is the EMPTY string rather than a `0x00` byte. */
  export function toMinimalBytes(value: bigint | number): Uint8Array
  export function hexToBytes(text: string): Uint8Array
}

declare module '*/mining/miner.js' {
  export interface MinerOptions {
    readonly rpc: string
    readonly key: { readonly priv: Uint8Array; readonly pubHex: string }
    readonly workers?: number
    readonly duty?: number
    readonly pauseOnBattery?: boolean
  }
  /**
   * Emits: `state` {running}, `hashrate` {hashrate,total}, `template` {height,…},
   * `accepted` {height,id,reward}, `stale` {templateId}, `rejected` {err}, `error` {message},
   * `power` {onPower,known}, `duty` {…}, `follow` {following,everyMs}.
   */
  export class Miner extends EventTarget {
    constructor(options: MinerOptions)
    start(): Promise<void>
    stop(): void
    readonly running: boolean
    readonly hashrate: number
    readonly accepted: number
    /**
     * Is the tip reaching this tab live over `GET /events`, or is it on the fallback poll?
     *
     * Declared because the page renders it, not because it is internal. It was silently false —
     * the stream was DELETED from this copy — for as long as the gateway answered 405
     * (micro-org#236). The `_follow` internals are declared with it so `test/mining-follow.test.ts`
     * can drive the two `EventSource` transitions by hand, which is the only way to assert a state
     * machine whose inputs are a browser's callbacks.
     */
    readonly following: boolean
    /** Writable: the duty calculation reads it live, so it can be changed on a running pool. */
    pauseOnBattery: boolean
    /**
     * Declared because `mining/session.tsx` drives politeness for both miners from one place and
     * needs the SAME two methods on each. They have always existed on the implementation; the page
     * that used to own this miner reached past them and poked `duty` then `_applyDuty()` by hand,
     * which is the shape that lets a caller set one without recomputing the other.
     */
    setDuty(duty: number): void
    setPauseOnBattery(on: boolean): void
    /** Recomputes duty and pushes it to every worker. Call after changing `pauseOnBattery`. */
    _applyDuty(): void
    /** Opens the event stream and arms the fallback poll. Called by `start()`. */
    _follow(): void
    /** The fallback poll's current period, in ms: 45 s while following, 10 s while blind. */
    readonly _refreshEveryMs: number
    readonly _refreshTimer: number | null
    readonly _sse: EventSource | null
  }
  export const POW_SIG_FORM: string
  export function proofSignature(digestHex: string, priv: Uint8Array): string
}
