/**
 * The network the reader is VIEWING — in-app network context (micro-org#459, the combined view).
 *
 * The explorer's `lib/viewed.ts` established the shape and its reconciliation with the estate's
 * no-stored-network invariant; the three properties hold here identically: nothing is persisted
 * (module memory, per tab), the default is the hostname's own network, and the viewed network is
 * always on screen — the bar's switcher shows it and the amber band follows it.
 *
 * ── WHAT IS DIFFERENT ON HUB, AND WHY IT IS SAFE ──────────────────────────────────────────────
 *
 * Hub's data is AUTHENTICATED — balances, deposits, mining assignments — so unlike the explorer,
 * the bearer IS forwarded on cross-estate reads. That is the entire point of stage 2: one
 * identity mints the user's token, both estates verify it, and the `net` claim lives on SERVICE
 * tokens only (micro-identity#20) precisely so a person's token crosses while a service's cannot.
 * Until the testnet estate trusts the shared identity (step 3), a cross-estate read answers 401
 * and the pages render their ordinary signed-out/error states — degraded, never wrong-network
 * data presented as right.
 *
 * ── WRITES, UNDER THE COMBINED VIEW ───────────────────────────────────────────────────────────
 *
 * The old rule — writes stay hostname-pinned — was premised on both hostnames existing. The
 * combined view retires the testnet hostnames, so a write follows the VIEWED network, and the
 * defence moves from the address bar to the marking: the amber band, and the network named in
 * anything that confirms value movement. What survives of the old rule is its asymmetry: a page
 * VIEWING testnet writes to testnet — worthless coins, worst case a wasted test — and a page
 * viewing mainnet writes to mainnet exactly as today. There is no path where a testnet-marked
 * screen moves real value.
 */

import { currentNetwork, networkOrigin } from '@cloudsforge/ui'

/** The hostname's own network. `currentNetwork` is null only off-registry (localhost); mainnet
 * is the safe reading there because localhost serves no testnet data either. */
function deploymentNetwork(): ViewedNetwork {
  return currentNetwork() ?? 'mainnet'
}

export type ViewedNetwork = 'mainnet' | 'testnet'

let viewed: ViewedNetwork | null = null

/** The network the reader is viewing: their in-tab choice, or the hostname's network. */
export function viewedNetwork(): ViewedNetwork {
  return viewed ?? deploymentNetwork()
}

/** Record the reader's choice. Choosing the hostname's own network clears the override. */
export function setViewedNetwork(network: ViewedNetwork): void {
  viewed = network === deploymentNetwork() ? null : network
}

/**
 * The API origin for the viewed network: '' for the deployment's own (requests stay relative),
 * the sibling estate's origin otherwise. The bearer rides along — see the header.
 */
export function viewedApiOrigin(): string {
  if (viewed === null) return ''
  return networkOrigin(viewed)
}
