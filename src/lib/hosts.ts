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
