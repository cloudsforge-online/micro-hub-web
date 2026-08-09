/**
 * Where this app talks to, resolved at runtime.
 *
 * `cloudsforgeHosts()` reads `window.location.hostname` on every call, so the same bundle
 * addresses `http://localhost:3010` when served from localhost and `https://hub.<apex>` when
 * served from the apex. Nothing here reads a build-time constant; see the note in vite.config.ts.
 */
import { cloudsforgeHosts, type CloudsForgeHosts, type SurfaceKey } from '@cloudsforge/ui'

/**
 * The surface this application IS.
 *
 * `hub` is a `surface` rather than a `product` in the registry, and it is deliberately not a
 * switcher entry — it is the container the reader is already inside. It resolves to `--cf-ember`
 * rather than to a product accent, which is why `data-cf-product="hub"` is set statically in
 * index.html.
 */
export const PRODUCT: SurfaceKey = 'hub'

/** The name reported to the observability ingest and shown in error copy. */
export const APP_NAME = 'hub'

/**
 * The base URL for this app's OWN API — hub-api.
 *
 * In production the SPA and the BFF are the same origin: nginx serves the bundle, hub-api serves
 * `/v1` behind the same hostname, and every request below stays relative. Under `pnpm dev` the
 * page is on Vite's port (5180) while hub-api is on the registry's dev port for `hub` (3010), so
 * the base is absolute and the request goes cross-origin.
 *
 * The difference is derived by COMPARING ORIGINS rather than by a `DEV` flag, because a flag is a
 * build-time constant and this repository has none: an image built for production and opened on
 * localhost would then point at a host that is not there.
 */
export function resolveApiBase(pageOrigin: string, hosts: CloudsForgeHosts, key: SurfaceKey): string {
  const own = hosts[key]
  // With no page origin there is nothing for a relative URL to resolve against, so the absolute
  // form is the only correct answer.
  if (!pageOrigin) return own
  // A surface may carry a basePath (the wallet is a path inside Hub), so compare ORIGINS rather
  // than whole URLs — otherwise every such surface would look cross-origin to itself.
  return new URL(own).origin === pageOrigin ? '' : own
}

/** Every CloudsForge base URL, for the current environment. */
export function hosts(): CloudsForgeHosts {
  return cloudsforgeHosts()
}

/** This app's API base, resolved now. Call it per request; never cache it in a module constant. */
export function apiBase(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return resolveApiBase(origin, cloudsforgeHosts(), PRODUCT)
}

/** The page origin, or a stable placeholder when there is no document (tests, prerender). */
export function pageOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin
}

/**
 * ══ WHERE EMBER'S `/mining/template` AND `/mining/submit` ACTUALLY ARE ═════════════════════════
 *
 * `hosts().rpc` is NOT the answer, and copying it — which is what `network-site/src/pages/mine.tsx`
 * does — is a defect that only shows up on a developer's machine. Hearth serves TWO protocols on
 * TWO ports and the registry publishes only one of them:
 *
 *   8545  Ethereum JSON-RPC 2.0 (`hearth/node/src/jsonrpc/server.js`). This is what the `rpc`
 *         surface row means, it is the number published in `ethereum-lists/chains`, and it is what
 *         MetaMask and Hardhat point at. It does not serve `/mining/*` at all.
 *   8645  the REST API, which is where `/mining/template` and `/mining/submit` live
 *         (`hearth/node/src/rpc.js`). Deliberately unpublished as a surface, because nothing
 *         about it is a wallet's business.
 *
 * `ui/packages/ui/src/surfaces.ts` says this out loud on the `rpc` row — "NOT 8645, and this is
 * the one confusion worth spelling out beside the number" — so the registry is right and the
 * consumer has to do the last step itself.
 *
 * IN PRODUCTION THE TWO COLLAPSE INTO ONE HOSTNAME AND NOTHING HAS TO BE SWAPPED. Read on
 * 2026-08-09, `deploy/gateway/dynamic/estate-web.yml` carries a router `cf-api-mining` matching
 * `Host(rpc<suffix>) && (Path(/mining/template) || Path(/mining/submit))` and sends it to
 * `cf-svc-hearth-mining`, whose upstream port is 8645. So on a real deployment `https://rpc.<apex>`
 * is correct for these two paths and for nothing else — which is why this returns `hosts().rpc`
 * unchanged the moment the host is not a dev port.
 *
 * UNDER `pnpm dev` THERE IS NO GATEWAY, so the port has to be corrected here. The swap is written
 * as an exact match on `:8545` rather than a regex over the whole URL, because the only thing that
 * may change is the port the registry allocated to `rpc`, and a looser rule would happily rewrite
 * a hostname that merely contained the digits.
 *
 * ── AND THE THING THIS PATH MUST NOT ASSUME: SERVER-SENT EVENTS ────────────────────────────────
 *
 * `network-site`'s miner opens `new EventSource(`${rpc}/events`)` to follow new tips and treats the
 * 45-second timer as a backstop. The gateway router above routes EXACTLY TWO PATHS, and `/events`
 * is not one of them, so on a real deployment that stream never connects: the miner would sit on
 * a template until the timer fired. The port of that miner therefore treats the timer as the
 * PRIMARY refresh — see `src/mining/miner.js` where the change is recorded — and the SSE
 * connection is not opened at all rather than opened and silently failing.
 */
export function emberMiningBase(): string {
  const rpc = hosts().rpc
  return rpc.endsWith(':8545') ? `${rpc.slice(0, -':8545'.length)}:8645` : rpc
}
