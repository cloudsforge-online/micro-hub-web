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

import {
  currentNetwork,
  envLabel,
  networkFromQuery,
  networkOrigin,
  surface,
  type SurfaceKey,
} from '@cloudsforge/ui'
import { keepNetworkInTheAddressBar } from '@cloudsforge/ui/network-view'
import { hosts } from './hosts.ts'

/** The hostname's own network. `currentNetwork` is null only off-registry (localhost); mainnet
 * is the safe reading there because localhost serves no testnet data either. */
function deploymentNetwork(): ViewedNetwork {
  return currentNetwork() ?? 'mainnet'
}

export type ViewedNetwork = 'mainnet' | 'testnet'

/**
 * The choice a link arrived carrying, read ONCE, at load.
 *
 *     "if you select testnet and switch product you are back to mainnet"
 *
 * Every surface is its own origin, so the module memory below stops at the hostname and a link
 * from the explorer to here could not bring the reader's choice with it. `?net=` is the one
 * channel that survives a cross-origin navigation without being storage — and it has to survive
 * the combined view's retirement redirect too, which it does: `hub-testnet.<apex>` 302s to
 * `hub.<apex>` preserving path and query.
 *
 * It is read and never written. Nothing here persists, so the estate's no-stored-network
 * invariant is untouched: the parameter is a statement the LINK made, not a preference this tab
 * keeps. Once the reader navigates in-app the parameter is gone and a reload falls back to the
 * hostname's own network, exactly as before this existed.
 *
 * Normalised through the same rule as `setViewedNetwork`: `?net=mainnet` on a mainnet page is not
 * an override, it is agreement, and recording it as an override would make every cross-estate
 * base composed below take the long way round to its own origin.
 *
 * Off-registry it answers null, and that check is `currentNetwork()` rather than
 * `deploymentNetwork()` on purpose. Localhost has no sibling estate: `NetworkSwitcher` hides
 * itself there, so no CLICK can produce an override — but a link can, and `deploymentNetwork()`
 * reads localhost as mainnet, so `?net=testnet` would have looked like a real choice.
 * `viewedApiOrigin()` would then have pointed a dev bundle's authenticated reads at the live
 * testnet estate. `viewedSurfaceUrl` already refuses to compose on a host it does not understand;
 * this is the same refusal, one layer earlier, where it also covers the API base.
 */
function fromLink(): ViewedNetwork | null {
  if (currentNetwork() === null) return null
  const asked = networkFromQuery()
  if (asked === null) return null
  return asked === deploymentNetwork() ? null : asked
}

let viewed: ViewedNetwork | null = fromLink()

/**
 * The address bar says what the reader is viewing, and keeps saying it.
 *
 *     "if we have testnet selected and we refresh the page it goes to mainnet"
 *
 * It did, and for the reason the paragraph above was proud of: the choice was module memory, and a
 * reload discards module memory. `keepNetworkInTheAddressBar` writes `?net=` in place on every
 * change — see it for why the reload case is not the stored-default this estate refuses, and why
 * the write is wrapped around `history` rather than taught to each router.
 */
const syncAddressBar = keepNetworkInTheAddressBar(() => viewed)
syncAddressBar()

/** The network the reader is viewing: their in-tab choice, or the hostname's network. */
export function viewedNetwork(): ViewedNetwork {
  return viewed ?? deploymentNetwork()
}

/**
 * Told when the choice changes, for the one consumer that CANNOT be remounted by the switcher.
 *
 * The refetch mechanism for everything else is `<Outlet key={viewed}>` in `components/shell.tsx`:
 * a switch remounts the page tree and every read in it runs again against the new estate. That
 * works for pages. It does not work for anything mounted ABOVE the shell, and `DeploymentProvider`
 * is deliberately mounted there — `src/app.tsx` argues why, and the argument still holds: the page
 * and the mining session in the bar both read pool presence, and two fetches are two chances to
 * disagree about it on one screen.
 *
 * So that one provider subscribes instead. Listeners are module-scoped and per tab like the choice
 * itself; nothing is persisted and nothing is read back, so the no-stored-network invariant is
 * untouched.
 */
type Listener = (network: ViewedNetwork) => void
const listeners = new Set<Listener>()

/** Subscribe to changes of the viewed network. Returns the unsubscribe. */
export function subscribeViewedNetwork(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Record the reader's choice. Choosing the hostname's own network clears the override. */
export function setViewedNetwork(network: ViewedNetwork): void {
  const before = viewedNetwork()
  viewed = network === deploymentNetwork() ? null : network
  syncAddressBar()
  const after = viewedNetwork()
  // Only on a real change. Re-selecting the network already being viewed is not an event, and
  // announcing it would make a listener that refetches do so on every click of the current entry.
  if (after !== before) for (const listener of listeners) listener(after)
}

/**
 * The API origin for the viewed network: '' for the deployment's own (requests stay relative),
 * the sibling estate's origin otherwise. The bearer rides along — see the header.
 */
export function viewedApiOrigin(): string {
  if (viewed === null) return ''
  return networkOrigin(viewed)
}

/**
 * The base URL of ANY surface on the viewed network — wallet, custody, the pool, Hearth's RPC.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS, AND IT IS THE HALF OF THE COMBINED VIEW THAT WAS MISSING
 *
 * `viewedApiOrigin()` above moves ONE base: hub-api, the BFF this app shares a hostname with.
 * Every other service this bundle calls builds its own base from `hosts()`, and `hosts()` reads
 * `window.location.hostname` — which, now that the frontends are merged behind the mainnet
 * hostnames, is ALWAYS the mainnet estate whatever the switcher says.
 *
 * So a reader who switched to Testnet and opened the Wallet got hub-api from testnet and
 * `micro-wallet` from MAINNET, on one page, with an amber testnet band across the top. Balances,
 * deposit addresses and — this is the sharp one — the withdrawal form all belonged to the network
 * the page said it was not showing. `pages/wallet.tsx` would have offered a reader a Send form
 * marked testnet that spends real coins.
 *
 * That never reached anybody, and only because a SECOND defect was standing in front of it: the
 * testnet gateway's CORS allowlist named its own retired `*-testnet` origins and not the merged
 * frontend's, so the hub-api read failed first and the page rendered "Cannot reach the server"
 * instead of a wrong-network Wallet. Fixing the allowlist without this would have exchanged a
 * visible failure for an invisible one, which is why the two ship together (micro-deploy).
 *
 * ── WHAT DOES *NOT* GO THROUGH HERE, AND WHY EACH ONE STAYS PUT ───────────────────────────────
 *
 *   `nimbus`   — identity. The reader's token was minted by the estate serving this page and is
 *                refreshed there; sending a refresh to the other estate would ask a service that
 *                did not mint the session to extend it. One identity is the premise of the
 *                combined view, not something it re-points per switch.
 *   `lantern`  — the observability ingest. Telemetry is about THIS running bundle on THIS
 *                deployment, so it belongs to the estate serving the page regardless of what the
 *                reader is looking at. Filing a mainnet bundle's errors under testnet would make
 *                both estates' error rates fiction.
 *
 * Everything else this bundle reads is the reader's own money or the chain's own state, and both
 * of those are properties of the NETWORK.
 *
 * ── DERIVED FROM THE PAGE'S APEX, NEVER WRITTEN DOWN ──────────────────────────────────────────
 *
 * The apex comes off the address bar and the label is composed with the registry's own
 * `envLabel(subdomain, env)` — `hub` + `testnet` is `hub-testnet`, not `hub.testnet`. That
 * distinction is not cosmetic: the edge's Universal SSL certificate is a wildcard over ONE label
 * of the apex, so the nested form fails the TLS handshake before a request is ever made.
 * `deploy/gateway/dynamic/policy.yml` records the same fact for the same reason. (The apex is not
 * spelled out here, and could not be: the `rules` job greps this directory for it — see below.)
 *
 * A literal apex would also fail CI — the `rules` job greps `src/` for one — and would be the
 * build-time environment this repository refuses.
 *
 * ── AND IT CHECKS ITS OWN COMPOSITION BEFORE IT TRUSTS IT ─────────────────────────────────────
 *
 * Composing an address for another estate means claiming to know how this estate is named, and
 * that claim is wrong on more hostnames than it looks. A preview deployment at
 * `pr-42.example.dev` HAS three labels and a first label that is not an environment, so every
 * naive rule strips it — and `cloudsforgeHosts()` deliberately does not, because a preview host
 * is its own apex. The first version of this function stripped it and produced
 * `https://pay-testnet.example.dev`, an address that resolves nowhere, which is the failure mode
 * `unlabelledSurfaceUrl` in `lib/hosts.ts` spells out at length: a link that fails tells the
 * reader the service is gone rather than that the page is confused.
 *
 * So rather than enumerate the hostnames the rule holds for, it is CHECKED: compose for the
 * network the page is already on, and if that does not reproduce `hosts()` exactly, this hostname
 * is not one the composition understands and the answer is the serving estate. One test — this
 * function agreeing with the registry about the page's own network — stands in for every hostname
 * shape that might otherwise need a branch here.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function viewedSurfaceUrl(key: SurfaceKey): string {
  const own = hosts()[key]
  // No override: the page's own estate, resolved exactly as every other caller resolves it.
  if (viewed === null) return own
  // Off-registry (localhost, a bare IP). `cloudsforgeHosts()` refuses to guess an apex there and
  // so does this — and `NetworkSwitcher` hides itself on those hosts, so a non-null `viewed` here
  // means something upstream is confused and the safe answer is "do not move".
  const here = currentNetwork()
  if (here === null) return own
  const parts = window.location.hostname.split('.')
  if (parts.length < 2) return own
  const apex = parts.length === 2 ? window.location.hostname : parts.slice(1).join('.')
  const s = surface(key)
  const compose = (network: ViewedNetwork): string => {
    const label = envLabel(s.subdomain, network === 'testnet' ? 'testnet' : '')
    return `https://${label ? `${label}.${apex}` : apex}${s.basePath ?? ''}`
  }
  // The self-check. See above: this is what makes a preview host, and anything else this rule does
  // not describe, fall back to the estate that is serving the page instead of inventing a sibling.
  if (compose(here) !== own) return own
  return compose(viewed)
}
