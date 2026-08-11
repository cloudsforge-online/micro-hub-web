/**
 * WHETHER THIS DEPLOYMENT HAS A MINING POOL BEHIND IT AT ALL.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * This is the only thing this bundle learns from its container rather than from `window.location`,
 * from hub-api or from another surface's API, and it took a measured defect to justify the
 * exception. micro-org#406, 2026-08-11: the TESTNET hub's `/mine` could not load pool status,
 * because `GET /v1/pool` against that estate's own pool surface answers **502** and always
 * will. `MinePage` renders `<Failed>` for the whole page when that read fails, so the one thing on
 * this page that has nothing to do with the pool — EMBER, mined directly against the network in
 * this tab — was unreachable behind an error about a service the reader was not asking for.
 *
 * Nothing was broken. micro-pool is behind `profiles: ["pool"]` in
 * `deploy/compose/docker-compose.estate.yml`; `compose/mainnet.env` names that profile and
 * `compose/testnet.env` does not, so on a testnet estate the API container is never created and
 * Traefik has no backend to forward `/v1` to. That is deliberate and permanent — micro-pool
 * validates `POOL_NETWORK` against what the node reports and requires a node URL and a payout
 * address per chain, so a pool started on a testnet estate refuses to boot.
 *
 * (Hostnames are described here, never written out. The `rules` job in CI greps `src/` for a
 * literal estate apex and does NOT strip comments — deliberately, because a rule you can evade by
 * writing the string in a comment is a rule that ends up written in comments — and this bundle is
 * not served only by the estate this defect was measured on.)
 *
 * ── WHAT THIS PAGE OWES A READER THAT `pool-web` DOES NOT ─────────────────────────────────────
 *
 * `pool-web` answers this same question (micro-pool-web#21) and substitutes an explanation for its
 * whole console, because a pool console with no pool has nothing else to be. Here the stake is the
 * opposite one: **the absence of a pool must cost this page nothing except the pool.** EMBER is
 * mined against hearth, not through micro-pool, and it is the only chain this estate mines that a
 * browser can meaningfully mine at all. So `absent` removes the pool panel and puts a sentence in
 * its place; it does not remove the picker, the EMBER panel, the sweep, or the Start button.
 *
 * ── WHY THIS IS NOT DERIVED FROM THE HOSTNAME, WHICH IS THIS FILE'S WHOLE POINT ───────────────
 *
 * Everything else in this bundle resolves from `window.location.hostname` (`src/lib/hosts.ts`), and
 * the tempting move is to do it here too: this hostname carries an environment label, `testnet` has
 * no pool, done. It is wrong, and it is wrong in the direction that costs the most.
 *
 * "Which network is this" and "does this network run a mining pool" are two different questions.
 * The second is a property of one `COMPOSE_PROFILES` line in one env file, and it can change on
 * either network without a hostname changing: a staging estate could run a pool, and mainnet's own
 * pool was behind that same profile until 2026-08-09, when its payout address and its fee were
 * decided. A rule that read the environment label would have told miners on mainnet there was no
 * pool for as long as that was true, and then gone on saying it after the pool appeared.
 *
 * ── WHY IT IS NOT A BUILD-TIME CONSTANT EITHER ────────────────────────────────────────────────
 *
 * `test/no-build-time-config.test.ts` forbids every form of build-time environment anywhere in
 * `src/` — the bundler's own env object and the prefixed variables it inlines — and the `rules` job
 * in `.github/workflows/ci.yml` greps for the same forms WITHOUT stripping comments, so naming them
 * here in prose fails the build. (Deliberate on their part, and left that way rather than loosened:
 * a rule that tolerates its own name in a comment is a rule somebody disables with a comment.) The
 * reason for all of it is that the image is built once, tagged once and promoted, and the estate
 * pins one image per deployable by digest. So the answer arrives at RUNTIME, as a document this
 * container's own nginx composes from `POOL_API_PRESENCE` in its environment. One image, one
 * digest, and the environment stays in the environment. `nginx.conf` holds the mechanism.
 *
 * ── ABSENT IS SAID EXPLICITLY OR NOT AT ALL ───────────────────────────────────────────────────
 *
 * `PRESENT` is the answer to every ambiguity: a 404, a body that is not JSON, a missing field, a
 * value that is anything but the exact string `absent`, a request that never landed, and — see
 * `usePoolApi()` — a tree with no provider over it. The asymmetry is the whole safety of the
 * mechanism. Silence must not become a page telling somebody with hardware pointed at a working
 * pool that the pool does not exist; an operator who deletes the variable gets today's page back,
 * and today's page works everywhere the pool exists.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { pageOrigin } from './hosts.ts'

/**
 * Where the answer lives.
 *
 * Same origin and a fixed path, so no hostname is composed and no CORS grant is needed — which is
 * why this is not simply a read of `pool.<apex>/deployment.json`: the pool console serves that
 * document with no cross-origin headers, deliberately, and a surface that needed one would be a
 * surface whose explanation of the pool's absence depends on the pool's own container answering.
 *
 * It is NOT under `/v1`: on this surface that prefix is hub-api's, and on the pool's it is the
 * service whose absence this document reports.
 */
export const DEPLOYMENT_PATH = '/deployment.json'

/**
 * How long this page waits for its own container to answer a static string.
 *
 * Two seconds. This is nginx answering a `return 200` from the origin that just served the
 * document, not a read across the estate, and the pathological case resolves to `present` anyway —
 * so a long timeout would spend a reader's time on the one outcome that changes nothing.
 */
export const DEPLOYMENT_TIMEOUT_MS = 2000

/**
 * `unknown` is a real state and the page renders it as such — as the loading state it already had.
 *
 * It lasts one same-origin round trip. What it must not do is default to `absent` for that round
 * trip: a page that flashed "this network does not run a mining pool" before its own numbers
 * arrived would show every reader, on every load, on every estate, the one sentence that is only
 * true on some of them.
 */
export type PoolApiPresence = 'unknown' | 'present' | 'absent'

/**
 * Read the document's claim, refusing to be clever about it.
 *
 * Anything that is not the exact string `absent` in the `poolApi` field is `present`, including the
 * empty string.
 */
export function readPresence(body: unknown): 'present' | 'absent' {
  if (body === null || typeof body !== 'object') return 'present'
  return (body as Record<string, unknown>)['poolApi'] === 'absent' ? 'absent' : 'present'
}

/**
 * Ask this container what it is.
 *
 * Never rejects and never throws. Every failure — a 404 from an older image that has no such
 * location, an nginx that answered HTML, an abort, a timeout — is `present`, which is the state
 * this page has always been in and knows how to render.
 */
export async function fetchPresence(signal?: AbortSignal): Promise<'present' | 'absent'> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEPLOYMENT_TIMEOUT_MS)
  const onCallerAbort = () => controller.abort()
  signal?.addEventListener('abort', onCallerAbort, { once: true })
  try {
    const res = await fetch(new URL(DEPLOYMENT_PATH, pageOrigin()), {
      method: 'GET',
      headers: { accept: 'application/json' },
      // No cookies and no bearer. This is a static read of a deploy fact; attaching a session to it
      // would put a credential on a request that has no account in it.
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) return 'present'
    return readPresence(await res.json())
  } catch {
    // Deliberately swallowed and deliberately not reported to observability. There is no failure
    // here anybody can act on: the fallback IS the working page, and an image built before this
    // document existed would otherwise report an error on every page load on every estate.
    return 'present'
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCallerAbort)
  }
}

/**
 * THE DEFAULT IS `present`, AND IT IS THE DEFAULT FOR A TREE WITH NO PROVIDER OVER IT.
 *
 * That is not the same choice `pool-web` made — its context defaults to `unknown` — and the
 * difference is deliberate. There, every page is about the pool and a page that renders before the
 * answer arrives has nothing to render. Here, `present` is the behaviour this page has always had,
 * so a mount without the provider (a test of one panel, a future embedding) behaves exactly as it
 * did before this file existed rather than hanging on a question nobody is answering.
 */
const PoolApiContext = createContext<PoolApiPresence>('present')

/**
 * Fetched once for the whole app, above the router.
 *
 * A provider rather than a call per consumer, because two consumers read it — the page and the
 * mining session that outlives it — and two reads of one deploy fact are two chances to disagree
 * about it on one screen.
 *
 * The provider starts at `unknown` rather than at the context default, which is what lets a
 * consumer under it decline to fire a request that is known to fail. Outside it there is no such
 * round trip to wait for, so there is nothing to distinguish.
 */
export function DeploymentProvider({ children }: { children: ReactNode }) {
  const [presence, setPresence] = useState<PoolApiPresence>('unknown')

  useEffect(() => {
    const controller = new AbortController()
    void fetchPresence(controller.signal).then((answer) => {
      if (!controller.signal.aborted) setPresence(answer)
    })
    return () => controller.abort()
  }, [])

  return <PoolApiContext.Provider value={presence}>{children}</PoolApiContext.Provider>
}

/** Whether there is a pool API on this deployment. See the constant above for what no provider means. */
export function usePoolApi(): PoolApiPresence {
  return useContext(PoolApiContext)
}

/**
 * Should a caller ask `pool.<apex>` for anything right now?
 *
 * One predicate, used by both readers, so "wait while unknown, never ask while absent" is written
 * once. `unknown` blocks rather than allows for the reason the type's comment gives: the wait is one
 * same-origin round trip, and a request fired during it is a request that lands on the 502 this
 * whole mechanism exists to stop rendering.
 */
export function poolApiWorthAsking(presence: PoolApiPresence): boolean {
  return presence === 'present'
}
