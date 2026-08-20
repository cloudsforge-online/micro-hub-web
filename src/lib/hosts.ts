/**
 * Where this app talks to, resolved at runtime.
 *
 * `cloudsforgeHosts()` reads `window.location.hostname` on every call, so the same bundle
 * addresses `http://localhost:3010` when served from localhost and `https://hub.<apex>` when
 * served from the apex. Nothing here reads a build-time constant; see the note in vite.config.ts.
 */
import { cloudsforgeHosts, envLabel, splitEnvLabel, surface, type CloudsForgeHosts, type SurfaceKey } from '@cloudsforge/ui'

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

/**
 * THE MINING POOL ON THE UNADORNED ENVIRONMENT — the one address this app composes that is not on
 * the network it is being served from.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `cloudsforgeHosts()` answers "where are my siblings", and every one of its answers is on THIS
 * environment. It has no way to say "and where is the pool on the environment that has one", which
 * is exactly the sentence `/mine` needs on a network with no pool (micro-org#406,
 * `src/lib/deployment.tsx`): telling somebody the pool does not run here without telling them
 * where it does run is half an answer.
 *
 * Derived rather than written down, because the `rules` job in CI greps `src/` for a literal apex
 * and is right to — an image that names one estate is an image that works on one estate, which is
 * the build-time environment this repository refuses, wearing a hat. So the apex comes off the
 * address of the page, and the first label is recomposed with `envLabel(subdomain, '')`, the
 * registry's own inverse of `splitEnvLabel()`. That is what makes this produce the name the
 * registry would have produced rather than a second opinion about how the estate is named.
 *
 * ── NULL IS THE ANSWER MORE OFTEN THAN A CALLER EXPECTS, AND EVERY CASE IS DELIBERATE ─────────
 *
 *   * A HOSTNAME WHOSE FIRST LABEL NAMES NO ENVIRONMENT: localhost, a preview deployment, a
 *     tunnel, a two-label apex. `cloudsforgeHosts()` refuses to guess an apex from those and so
 *     does this — a composed `https://pool.<whatever-this-is>` resolves to nothing, and a "the pool
 *     is over here" link that fails is worse than no link, because the reader concludes the pool is
 *     gone rather than that the page is confused.
 *   * THE UNADORNED ENVIRONMENT ITSELF, where `hub.<apex>` has no environment label to strip. The
 *     composed address would be this same estate's pool, which is the one this page has just been
 *     told is not there. That state is either an operator's choice or a misconfiguration, and the
 *     honest rendering is the explanation with no link. `src/pages/mine.tsx` renders exactly that,
 *     with different words, and both are asserted.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function unlabelledSurfaceUrl(hostname: string, key: SurfaceKey): string | null {
  const parts = hostname.split('.')
  // `> 2` for the same reason `cloudsforgeHosts()` requires it: a two-label hostname IS an apex and
  // has no first label to spend on a subdomain or an environment.
  if (parts.length <= 2) return null
  if (splitEnvLabel(parts[0] ?? '') === null) return null
  const apex = parts.slice(1).join('.')
  // ── AN EMPTY SUBDOMAIN IS AN APEX, NOT A LABEL — AND A MOUNT COMES AFTER IT ─────────────────
  //
  // This read `https://${envLabel(subdomain, '')}.${apex}`, which was right while every surface it
  // is called for owned a hostname. Wave 3d made the mining pool `<apex>/pool`, so its `subdomain`
  // is the empty string and `envLabel('', '')` is empty too — and the old form composed
  //
  //     https://.cloudsforge.online
  //
  // a leading dot, which is not a hostname at all. Every read against it rejects, so the browser
  // miner's chain picker lost Litecoin entirely: `GET /v1/pool` never answers, no chain comes back,
  // and the only option left is EMBER, which is mined directly and needs no pool. Caught by this
  // repository's own suite before the image published — 23 failures, and the picker ones are the
  // ones that would have been noticed by a person.
  //
  // The same composition `lib/viewed.ts` already uses one file over, and micro-ui's
  // `viewedSurfaceUrl` upstream: OMIT the label when there is none rather than emptying it, and
  // append `basePath` after the host.
  const s = surface(key)
  const label = envLabel(s.subdomain, '')
  return `https://${label ? `${label}.${apex}` : apex}${s.basePath ?? ''}`
}

/** The pool console on the unadorned environment, resolved now, or null. See above for every null. */
export function unlabelledPoolUrl(): string | null {
  return unlabelledSurfaceUrl(typeof window === 'undefined' ? '' : window.location.hostname, 'pool')
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
 * 2026-08-10, `deploy/gateway/dynamic/estate-web.yml` carries a router `cf-api-mining` matching
 * `Host(rpc<suffix>) && (Path(/mining/template) || Path(/mining/submit))` and a second router
 * `cf-api-mining-events` matching `Host(rpc<suffix>) && Path(/events)`, both sent to
 * `cf-svc-hearth-mining`, whose upstream port is 8645. So on a real deployment `https://rpc.<apex>`
 * is correct for those three paths and for nothing else — which is why this returns `hosts().rpc`
 * unchanged the moment the host is not a dev port.
 *
 * UNDER `pnpm dev` THERE IS NO GATEWAY, so the port has to be corrected here. The swap is written
 * as an exact match on `:8545` rather than a regex over the whole URL, because the only thing that
 * may change is the port the registry allocated to `rpc`, and a looser rule would happily rewrite
 * a hostname that merely contained the digits.
 *
 * ── SERVER-SENT EVENTS: THIS BASE NOW CARRIES THEM, AND DID NOT (micro-org#236) ────────────────
 *
 * The miner opens `new EventSource(`${rpc}/events`)` to follow new tips and treats the timer as a
 * backstop. Until 2026-08-10 the gateway routed EXACTLY TWO PATHS and `/events` was not one, so
 * on a real deployment the stream was answered 405 by the JSON-RPC router — and a non-200 is fatal
 * to an `EventSource`, so it failed once, silently, forever. This file's previous note recorded
 * that, and `src/mining/miner.js` responded by DELETING the stream outright.
 *
 * Both halves are undone: `cf-api-mining-events` publishes the path and the miner opens it again.
 * What is kept from that episode is the caution, in a form that cannot go stale — the miner no
 * longer ASSUMES the stream works. It wires `onopen`/`onerror`, polls at 10 s while the stream is
 * down and 45 s while it is up, and puts which of the two it is in on the page.
 *
 * ── WHY THE JSON-RPC BASE IS AN ARGUMENT AND NOT `hosts().rpc` ────────────────────────────────
 *
 * It used to read `hosts().rpc` itself, and under the combined view (micro-org#459) that is no
 * longer a question this file can answer: `hosts()` resolves from the page's hostname, and both
 * networks are now served from the mainnet hostnames. The caller knows which network the reader is
 * looking at — `lib/viewed.ts` — and hands it in. Taking the base rather than fetching it also
 * keeps this module free of that dependency, which would otherwise be a cycle, and makes the one
 * thing this function actually does testable without a hostname.
 *
 * The choice MATTERS, and `mining/session.tsx` says why beside `payingIn`: the reward is swept to
 * a deposit address minted by the wallet, and if the chain being mined and the wallet that minted
 * that address are on different networks, the sweep sends real EMBER to an address nothing on that
 * chain is watching. The two must resolve through the same network, always.
 */
export function emberMiningBase(rpc: string): string {
  return rpc.endsWith(':8545') ? `${rpc.slice(0, -':8545'.length)}:8645` : rpc
}
