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
   * `power` {onPower,known}, `duty` {…}.
   */
  export class Miner extends EventTarget {
    constructor(options: MinerOptions)
    start(): Promise<void>
    stop(): void
    readonly running: boolean
    readonly hashrate: number
    readonly accepted: number
    /** Writable: the duty calculation reads it live, so it can be changed on a running pool. */
    pauseOnBattery: boolean
    /** Recomputes duty and pushes it to every worker. Call after changing `pauseOnBattery`. */
    _applyDuty(): void
  }
  export const POW_SIG_FORM: string
  export function proofSignature(digestHex: string, priv: Uint8Array): string
}
