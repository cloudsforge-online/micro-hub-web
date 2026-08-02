/**
 * The sign-in surface's client for `micro-identity`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── EVERY ROUTE HERE WAS READ OFF IDENTITY'S OWN ROUTE TABLE ──────────────────────────────────
 *
 * Not off a document. Three of this estate's own documents have been found stale, and the defect
 * this file exists to fix was itself a route taken on faith: `@cloudsforge/ui` posted the SSO code
 * to `/auth/exchange`, which identity has never served. So each function below carries the
 * `identity/src/server.ts` line its path and its response shape were verified against.
 *
 *   POST /auth/register       server.ts:688   → { accessToken, refreshToken, expiresIn, user, … }
 *   POST /auth/login          server.ts:732   → the same, OR { mfaRequired, challenge, factors }
 *   POST /auth/mfa            server.ts:826   → { accessToken, refreshToken, expiresIn, user }
 *   POST /auth/logout         server.ts:926   → 204
 *   POST /auth/handoff        server.ts:1076  → { code, expiresInSeconds }   (via @cloudsforge/ui)
 *   POST /auth/handoff/redeem server.ts:1084  → tokens                       (via @cloudsforge/ui)
 *
 * The two hand-off routes are NOT re-implemented here. They are the protocol, and the protocol
 * lives in `@cloudsforge/ui` beside `consumeAuthCallback`, which is the other end of it — a second
 * copy in this repository is the thing that went wrong last time.
 *
 * ── THIS FILE ASSERTS NO RULE ABOUT A CREDENTIAL ──────────────────────────────────────────────
 *
 * No password policy, no handle pattern, no "that email looks wrong", no lock-out arithmetic.
 * Every one of those is enforced in `@cloudsforge/contracts-auth` and applied by identity, which
 * answers with a `fields` array naming what it refused and why (`identity/src/server.ts:434-445`).
 * The form renders those sentences. 14 §11 records the reason a client must not hold the rule: a
 * game client once withheld four SKUs from its UI while the payment routes stayed live and
 * chargeable, and a client-side test of the hidden catalogue would have passed against it.
 *
 * The one thing this file does check is that a required box is not empty, and it does that by
 * marking the input `required` in the DOM — which is a nudge before a round trip, not a rule: the
 * submit still goes, identity still decides, and its answer still wins.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { handoffReturnUrl, mintHandoffCode } from '@cloudsforge/ui'
import { nimbus, setTokens, type AuthTokens } from './api.ts'

/** What identity puts in `user`, built by `toPublicUser` (`identity/src/users.ts:52-63`). */
export interface PublicUser {
  readonly id: string
  readonly handle: string
  readonly email: string
  readonly roles?: readonly string[]
}

/** A completed sign-in: `identity/src/server.ts:810-819`. */
export interface SessionGranted {
  readonly kind: 'session'
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresIn: number
  readonly user: PublicUser
  /** identity flags a session started from a device it has not seen before. */
  readonly newDevice?: boolean
}

/**
 * A password accepted and NOTHING ELSE established: `identity/src/server.ts:789-798`.
 *
 * No session, no token, nothing to rotate — "a challenge that mints nothing until a factor
 * answers". The challenge is spent by the next call whether or not the code is right, so a wrong
 * code sends the user back to the password step rather than letting them try again here.
 */
export interface MfaRequired {
  readonly kind: 'mfa'
  readonly challenge: string
  readonly factors: readonly { id: string; kind: string; label: string }[]
}

export type SignInOutcome = SessionGranted | MfaRequired

/* ─────────────────────────────── reading the answer ─────────────────────────────── */

function asString(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Read a sign-in response, or say it was not one.
 *
 * A cast would let a 200 from something that is not identity — a gateway courtesy page, a
 * misrouted deploy — be stored as a session made of `undefined`. The same reasoning as
 * `readCallbackTokens` in `@cloudsforge/ui`: check the fields about to be used, check nothing else.
 */
export function readSignInOutcome(body: unknown): SignInOutcome | null {
  if (typeof body !== 'object' || body === null) return null
  const source = body as Record<string, unknown>

  if (source['mfaRequired'] === true) {
    const challenge = asString(source, 'challenge')
    if (challenge === '') return null
    const factors = Array.isArray(source['factors'])
      ? (source['factors'] as Record<string, unknown>[])
          .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
          .map((f) => ({
            id: asString(f, 'id'),
            kind: asString(f, 'kind'),
            label: asString(f, 'label'),
          }))
      : []
    return { kind: 'mfa', challenge, factors }
  }

  const accessToken = asString(source, 'accessToken')
  const refreshToken = asString(source, 'refreshToken')
  if (accessToken === '' || refreshToken === '') return null
  const rawUser = (typeof source['user'] === 'object' && source['user'] !== null
    ? source['user']
    : {}) as Record<string, unknown>
  const roles = Array.isArray(rawUser['roles'])
    ? (rawUser['roles'] as unknown[]).filter((r): r is string => typeof r === 'string')
    : undefined

  return {
    kind: 'session',
    accessToken,
    refreshToken,
    expiresIn: typeof source['expiresIn'] === 'number' ? source['expiresIn'] : 0,
    user: {
      id: asString(rawUser, 'id'),
      handle: asString(rawUser, 'handle'),
      email: asString(rawUser, 'email'),
      ...(roles ? { roles } : {}),
    },
    ...(source['newDevice'] === true ? { newDevice: true } : {}),
  }
}

/** Thrown when identity answered 200 with something that is not a sign-in. */
export class UnreadableIdentityResponse extends Error {
  constructor() {
    super('Sign-in did not complete. Try again, or tell support the address you were on.')
    this.name = 'UnreadableIdentityResponse'
  }
}

function required(outcome: SignInOutcome | null): SignInOutcome {
  if (!outcome) throw new UnreadableIdentityResponse()
  return outcome
}

/* ─────────────────────────────── the calls ─────────────────────────────── */

/**
 * `POST /auth/login` — `identity/src/server.ts:732`.
 *
 * `auth: false`: this request must never carry a bearer token. A stale token on a sign-in would
 * make `request()` attempt a refresh on the 401 that a wrong password produces, and a refresh
 * failure fires the session-expired event in the middle of a sign-in — signing the user out of a
 * session they were in the act of creating.
 *
 * The identifier is sent as typed and trimmed only of surrounding space. identity decides whether
 * it is an email or a handle (`contracts/packages/auth/src/index.ts`, `validateLogin`), and
 * guessing here would mean a second, divergent copy of that rule.
 */
export const signInWithPassword = (identifier: string, password: string): Promise<SignInOutcome> =>
  nimbus<unknown>('/auth/login', {
    method: 'POST',
    auth: false,
    body: { identifier: identifier.trim(), password },
  }).then((body) => required(readSignInOutcome(body)))

/**
 * `POST /auth/mfa` — `identity/src/server.ts:826`.
 *
 * Always returns a session on success: identity does not chain a second challenge.
 */
export const answerMfaChallenge = (challenge: string, code: string): Promise<SignInOutcome> =>
  nimbus<unknown>('/auth/mfa', {
    method: 'POST',
    auth: false,
    body: { challenge, code: code.trim() },
  }).then((body) => required(readSignInOutcome(body)))

/**
 * `POST /auth/register` — `identity/src/server.ts:688`.
 *
 * A fresh account has no factors, so registration completes a session immediately and never
 * answers `mfaRequired`. It is still read through the same function: a route that cannot return
 * one shape today is not a route that will not tomorrow, and the alternative is a cast.
 */
export const registerAccount = (input: {
  email: string
  handle: string
  password: string
}): Promise<SignInOutcome> =>
  nimbus<unknown>('/auth/register', {
    method: 'POST',
    auth: false,
    body: { email: input.email.trim(), handle: input.handle.trim(), password: input.password },
  }).then((body) => required(readSignInOutcome(body)))

/**
 * `POST /auth/logout` — `identity/src/server.ts:926`. Revokes the presented refresh token.
 *
 * Answers 204 whether or not the token was live, so there is nothing to read and nothing a
 * failure would tell the user. The caller clears local storage either way: a sign-out that leaves
 * the tokens in the browser because the network blinked is the failure that matters.
 */
export const revokeRefreshToken = (refreshToken: string): Promise<void> =>
  nimbus<void>('/auth/logout', { method: 'POST', auth: false, body: { refreshToken } })

/* ─────────────────────────────── finishing a sign-in ─────────────────────────────── */

/** Where a completed sign-in should send the browser next. */
export type Completion =
  | { readonly kind: 'here'; readonly path: string }
  | { readonly kind: 'handoff'; readonly url: string }
  | { readonly kind: 'refused'; readonly origin: string }

/**
 * Store the session and work out where the browser goes.
 *
 * ── Two cases, and they are genuinely different ────────────────────────────────────────────────
 *
 * The return address is on THIS origin (a Hub deep link, the common case): the tokens are already
 * in this app's storage under the shared `cf.*` keys, so there is nothing to hand over. The
 * browser navigates within the app. Minting a code and bouncing through the address bar would put
 * a credential in the history for no reason at all.
 *
 * The return address is another surface (Worlds, Market, the marketing site): that origin cannot
 * read this one's storage, so identity mints a 60-second, single-use, origin-bound code and the
 * code — not a token — travels in the fragment. `mintHandoffCode` and `handoffReturnUrl` are in
 * `@cloudsforge/ui` beside `consumeAuthCallback`, which is what reads it at the other end.
 *
 * A refusal is its own case rather than a silent fall-back to Hub. identity refuses an origin that
 * is not on `IDENTITY_HANDOFF_ORIGINS` (`identity/src/handoff.ts:31-47`), and that is a
 * misconfiguration somebody has to fix — sending the user to a dashboard they did not ask for
 * would hide it and look like the surface they came from is broken.
 */
export async function completeSignIn(
  granted: SessionGranted,
  returnTo: string,
  hereOrigin: string,
): Promise<Completion> {
  const tokens: AuthTokens = {
    accessToken: granted.accessToken,
    refreshToken: granted.refreshToken,
  }
  setTokens(tokens)

  const target = readReturnTo(returnTo)
  // Unparseable, or a scheme a browser must never be sent to. The dashboard is the honest
  // fall-back for "signed in, but the address you arrived with was not usable".
  if (!target) return { kind: 'here', path: '/' }

  if (target.origin === hereOrigin) {
    return { kind: 'here', path: `${target.pathname}${target.search}${target.hash}` }
  }

  // THE OPEN-REDIRECT GUARD IS IDENTITY'S ALLOWLIST, AND IT IS THE ONLY ONE THAT COUNTS.
  //
  // `?return=` is attacker-controllable — it is a query parameter on a public page. This app does
  // not hold a list of surfaces it will hand a session to, and must not: a second list is a list
  // that drifts, and the estate has already paid for that with CORS_ORIGINS. identity refuses to
  // MINT for an origin that is not on `IDENTITY_HANDOFF_ORIGINS` (`identity/src/handoff.ts:31-47`),
  // so a code for somebody else's page is never issued, and the redirect below only ever happens
  // to an origin the platform has already agreed to hand tokens to.
  const code = await mintHandoffCode(granted.accessToken, target.origin)
  if (!code) return { kind: 'refused', origin: target.origin }
  return { kind: 'handoff', url: handoffReturnUrl(target.toString(), code) }
}

/**
 * Parse a `?return=` value, refusing anything that is not a web address.
 *
 * `new URL('javascript:…')` parses happily and yields an origin of `null`; so does `data:`. Both
 * would be refused a hand-off code a moment later, but neither should reach that far — a URL this
 * app might one day navigate to is checked for being navigable at the point it is read.
 */
export function readReturnTo(raw: string): URL | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}
