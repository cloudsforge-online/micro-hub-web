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
 *   GET  /auth/challenge      server.ts   → { required, provider, siteKey, action }
 *   POST /auth/register       server.ts   → 202 { verificationRequired: true, email }
 *   POST /auth/login          server.ts   → tokens, OR { mfaRequired, challenge, factors }
 *   POST /auth/email/verify                   → { accessToken, refreshToken, expiresIn, user }
 *   POST /auth/email/verify/resend            → 202, one fixed sentence for every input
 *   POST /auth/mfa            server.ts   → { accessToken, refreshToken, expiresIn, user }
 *   POST /auth/password/forgot server.ts → 202 { status }, the same one for every input
 *   POST /auth/password/reset  server.ts → 204, or 401 spent/expired, or 400 with `fields`
 *   POST /auth/logout         server.ts   → 204
 *   POST /auth/handoff        server.ts  → { code, expiresInSeconds }   (via @cloudsforge/ui)
 *   POST /auth/handoff/redeem server.ts  → tokens                       (via @cloudsforge/ui)
 *
 * The two hand-off routes are NOT re-implemented here. They are the protocol, and the protocol
 * lives in `@cloudsforge/ui` beside `consumeAuthCallback`, which is the other end of it — a second
 * copy in this repository is the thing that went wrong last time.
 *
 * ── THIS FILE ASSERTS NO RULE ABOUT A CREDENTIAL ──────────────────────────────────────────────
 *
 * No password policy, no handle pattern, no "that email looks wrong", no lock-out arithmetic.
 * Every one of those is enforced in `@cloudsforge/contracts-auth` and applied by identity, which
 * answers with a `fields` array naming what it refused and why (`identity/src/server.ts`).
 * The form renders those sentences. 14 §11 records the reason a client must not hold the rule: a
 * game client once withheld four SKUs from its UI while the payment routes stayed live and
 * chargeable, and a client-side test of the hidden catalogue would have passed against it.
 *
 * The one thing this file does check is that a required box is not empty, and it does that by
 * marking the input `required` in the DOM — which is a nudge before a round trip, not a rule: the
 * submit still goes, identity still decides, and its answer still wins.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { handoffReturnUrl, mintHandoff } from '@cloudsforge/ui'
import { nimbus, setTokens, type AuthTokens } from './api.ts'

/** What identity puts in `user`, built by `toPublicUser` (`identity/src/users.ts`). */
export interface PublicUser {
  readonly id: string
  readonly handle: string
  readonly email: string
  readonly roles?: readonly string[]
}

/** A completed sign-in: `identity/src/server.ts`. */
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
 * A password accepted and NOTHING ELSE established: `identity/src/server.ts`.
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
 * `POST /auth/login` — `identity/src/server.ts`.
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
 * `POST /auth/mfa` — `identity/src/server.ts`.
 *
 * Always returns a session on success: identity does not chain a second challenge.
 */
export const answerMfaChallenge = (challenge: string, code: string): Promise<SignInOutcome> =>
  nimbus<unknown>('/auth/mfa', {
    method: 'POST',
    auth: false,
    body: { challenge, code: code.trim() },
  }).then((body) => required(readSignInOutcome(body)))

/* ─────────────────────────────── email verification ─────────────────────────────── */

/**
 * Registration created the account and is waiting for the address to be proved.
 *
 * The owner's decision, in their words: *"yes will need to validate your email with a link and
 * then redirect to signin (automatically from validation link you should be login)"*. So
 * registration no longer hands back a session — the link does.
 */
export interface VerificationRequired {
  readonly kind: 'verify-email'
  /** The address identity says it sent to, echoed so the page can name it. Never a token. */
  readonly email: string
}

export type RegisterOutcome = SignInOutcome | VerificationRequired

/**
 * The error code identity answers a sign-in with when the address is not proved yet.
 *
 * Spelled once, here, because two places would be two spellings — which is the defect
 * `IDENTITY_AUTH_ROUTES` in `@cloudsforge/ui` was created to stop after the SSO callback posted
 * for the life of the service to a route identity had never served.
 */
export const EMAIL_UNVERIFIED_CODE = 'email_unverified'

/**
 * Read a registration answer.
 *
 * `verificationRequired: true` is the marker, and it is deliberately the same SHAPE identity
 * already uses for `mfaRequired: true` on `POST /auth/login` — one convention for "the credential
 * was accepted and something else has to happen before there is a session".
 *
 * The session branch is kept rather than removed. A deployment of identity that predates
 * verification still answers with tokens, and a bundle that could not read that answer would
 * refuse to complete a registration that had in fact succeeded — the two are a rolling deploy
 * apart, and the client is the half that ships first.
 */
export function readRegisterOutcome(body: unknown): RegisterOutcome | null {
  if (typeof body !== 'object' || body === null) return null
  const source = body as Record<string, unknown>
  if (source['verificationRequired'] === true) {
    return { kind: 'verify-email', email: asString(source, 'email') }
  }
  return readSignInOutcome(body)
}

/* ─────────────────────────────── the registration challenge ─────────────────────────────── */

/**
 * What a client must do before it may register, ASKED OF THE DEPLOYMENT rather than compiled in.
 *
 * The site key is public — it appears in the page source of every site that uses Turnstile — so
 * there is no secrecy argument for fetching it. The argument is that this repository has NO
 * build-time configuration at all (`test/no-build-time-config.test.ts` greps for it, `lib/hosts.ts`
 * derives every address from `window.location`), because one image has to serve localhost, the
 * micro network and mainnet. micro-org#361 suggests baking the key into the bundle; that is safe
 * and it would be the first thing in this repository to need a build per environment.
 */
export interface RegistrationChallenge {
  readonly required: boolean
  /** Public. `null` when this deployment has no challenge. */
  readonly siteKey: string | null
  /** The `action` identity asserts on the way back, so the widget is configured with the same one. */
  readonly action: string
}

/**
 * The answer for a deployment with no Turnstile account — a developer machine, CI, every micro
 * network — and the answer this app falls back to when it cannot ask.
 *
 * **Falling back to "no challenge" is not a bypass.** It is a statement about what to RENDER, and
 * rendering is not deciding: identity refuses a tokenless registration whether or not this bundle
 * ever drew a widget. The alternative — refusing to show the form when the challenge cannot be
 * fetched — would turn a blip on one GET into "nobody can open an account", which is a worse
 * failure than a form that is submitted and answered honestly.
 */
export const NO_CHALLENGE: RegistrationChallenge = { required: false, siteKey: null, action: 'signup' }

/**
 * Read a challenge answer, or say it was not one.
 *
 * `required: true` with no site key is unreadable rather than "required": a widget cannot be
 * rendered without a key, so treating it as required would leave a form nobody can complete and no
 * sentence saying why. It is refused here so the caller falls back to the honest thing — submit,
 * and let identity say what it wants.
 */
export function readChallenge(body: unknown): RegistrationChallenge | null {
  if (typeof body !== 'object' || body === null) return null
  const source = body as Record<string, unknown>
  if (typeof source['required'] !== 'boolean') return null
  const siteKey = typeof source['siteKey'] === 'string' && source['siteKey'] !== '' ? source['siteKey'] : null
  if (source['required'] && siteKey === null) return null
  return {
    required: source['required'],
    siteKey,
    action: asString(source, 'action') || 'signup',
  }
}

/**
 * `GET /auth/challenge` — `identity/src/server.ts`.
 *
 * `auth: false`: it is asked by somebody who has no account yet, and a stale token in storage must
 * not turn this GET into a refresh attempt that signs a reader out of a session they were not
 * using — the same reason every call on this page carries it.
 *
 * Never rejects. An identity that predates this route answers 404, an offline browser throws, and
 * both mean the same thing to the page: draw no widget. See `NO_CHALLENGE`.
 */
export const fetchRegistrationChallenge = (): Promise<RegistrationChallenge> =>
  nimbus<unknown>('/auth/challenge', { method: 'GET', auth: false })
    .then((body) => readChallenge(body) ?? NO_CHALLENGE)
    .catch(() => NO_CHALLENGE)

/**
 * `POST /auth/register`.
 *
 * Answers 202 and `{ verificationRequired: true, email }` for a fresh account: the account exists,
 * unverified, and the link in the mail is what creates the session.
 *
 * `cf-turnstile-response` is Cloudflare's own field name and is sent verbatim — it is what the
 * widget writes into a plain HTML form and what every Turnstile guide names, and a second spelling
 * on our side would be one more thing for the two halves to disagree about. It is OMITTED rather
 * than sent empty when there is no token: identity separates "no challenge was attempted" from "a
 * challenge did not hold", and an empty string would blur the two.
 */
export const registerAccount = (input: {
  email: string
  handle: string
  password: string
  challengeToken?: string
}): Promise<RegisterOutcome> =>
  nimbus<unknown>('/auth/register', {
    method: 'POST',
    auth: false,
    body: {
      email: input.email.trim(),
      handle: input.handle.trim(),
      password: input.password,
      ...(input.challengeToken ? { 'cf-turnstile-response': input.challengeToken } : {}),
    },
  }).then((body) => {
    const outcome = readRegisterOutcome(body)
    if (!outcome) throw new UnreadableIdentityResponse()
    return outcome
  })

/**
 * `POST /auth/email/verify` — spend the token from the link.
 *
 * **A POST, and the token comes out of `location.hash`.** Both halves matter and neither is
 * incidental:
 *
 *   - the fragment is never transmitted, so the link a corporate mail scanner pre-fetches carries
 *     `GET /account/verify` and nothing else — it loads a static bundle and consumes no token. A
 *     `GET` that spends a credential is the trap this shape is built to avoid, and putting the
 *     token in the query string would spring it whether the verb were GET or not;
 *   - the mutation is a POST, which no link-follower issues.
 *
 * `auth: false` for the same reason as sign-in: a stale token must not turn the 401 of a spent
 * link into a refresh attempt that signs the user out mid-verification.
 */
export const verifyEmail = (token: string): Promise<SignInOutcome> =>
  nimbus<unknown>('/auth/email/verify', {
    method: 'POST',
    auth: false,
    body: { token },
  }).then((body) => required(readSignInOutcome(body)))

/**
 * `POST /auth/email/verify/resend`.
 *
 * Answers 202 with one fixed sentence for every input — a known address and an unknown one are
 * indistinguishable in status, body and timing, exactly as `POST /auth/password/forgot` is. So
 * there is nothing to read, and the page must not pretend there is: it says what identity says,
 * which is "if that account exists…".
 */
export const resendVerification = (identifier: string): Promise<void> =>
  nimbus<void>('/auth/email/verify/resend', {
    method: 'POST',
    auth: false,
    body: { identifier: identifier.trim() },
  })

/* ─────────────────────────────── password reset ─────────────────────────────── */

/**
 * `POST /auth/password/forgot` — `identity/src/server.ts`.
 *
 * ── IT ANSWERS 202 FOR EVERY INPUT, AND THAT IS THE FEATURE ───────────────────────────────────
 *
 * A known address, an address nobody has ever registered and a string that is not an address at
 * all all get status 202 and the same body, `{ status: RESET_REQUEST_STATUS }`
 * (`identity/src/passwordReset.ts`). identity goes further than the status line: the delivery
 * runs in `after`, once the response is already on the wire, because awaiting it made the RESPONSE
 * TIME say what the status code and the body were written not to — measured at 10ms for an unknown
 * address against 6015ms for a known one.
 *
 * So THERE IS NOTHING HERE TO BRANCH ON, and a caller that invented a branch would hand back the
 * enumeration oracle identity spent that much care removing. This function returns the server's own
 * sentence — never a boolean, never a "sent"/"not sent" — and the page renders it verbatim.
 *
 * `auth: false` for the reason sign-in gives: a stale access token in storage must not turn a
 * failure on this route into a refresh attempt that signs the reader out of a session they were not
 * using.
 *
 * The address is trimmed of surrounding space and NOT otherwise touched. identity normalises it
 * (`normaliseEmail`) and decides whether it is well-formed; a check here would be a second copy of
 * a rule with inputs, and — worse on this route than on any other — a client-side "that is not an
 * email" would answer instantly for a malformed address and after a round trip for a real one,
 * which is a timing oracle this page built for itself.
 */
export const requestPasswordReset = (email: string): Promise<string> =>
  nimbus<unknown>('/auth/password/forgot', {
    method: 'POST',
    auth: false,
    body: { email: email.trim() },
  }).then((body) =>
    typeof body === 'object' && body !== null
      ? asString(body as Record<string, unknown>, 'status')
      : '',
  )

/**
 * `POST /auth/password/reset` — `identity/src/server.ts`. Spend the token from the link.
 *
 * A POST carrying the token in the BODY, for the same two reasons `verifyEmail` is:
 *
 *   - the token reached this page in the fragment, which a browser never transmits, so the address
 *     a corporate mail scanner pre-fetches is `GET /account/reset` with no credential in it at all
 *     — it loads a static bundle and spends nothing;
 *   - the mutation is a POST, which no link-follower issues.
 *
 * Three answers, and the caller has to tell them apart: 204 done, 401 for a token that is spent,
 * expired or was never real (identity refuses to say which — "separating them would say whether a
 * guessed token had ever existed"), and 400 with a `fields` array for a password the policy
 * refuses. `ApiError.status` carries the first two and `ApiError.fields` the third.
 *
 * `auth: false` is load-bearing HERE IN PARTICULAR. A reader whose session expired weeks ago still
 * has two `cf.*` keys in storage; without this flag the 401 of a spent reset link would be taken
 * for an expired access token, `request()` would refresh, the refresh would fail, and the reader
 * would be signed out of the browser by the act of following a link that told them their link had
 * expired.
 */
export const resetPassword = (token: string, newPassword: string): Promise<void> =>
  nimbus<void>('/auth/password/reset', {
    method: 'POST',
    auth: false,
    body: { token, newPassword },
  })

/**
 * `POST /auth/logout` — `identity/src/server.ts`. Revokes the presented refresh token.
 *
 * Answers 204 whether or not the token was live, so there is nothing to read and nothing a
 * failure would tell the user. The caller clears local storage either way: a sign-out that leaves
 * the tokens in the browser because the network blinked is the failure that matters.
 */
export const revokeRefreshToken = (refreshToken: string): Promise<void> =>
  nimbus<void>('/auth/logout', { method: 'POST', auth: false, body: { refreshToken } })

/* ─────────────────────────────── finishing a sign-in ─────────────────────────────── */

/**
 * Why a hand-off did not happen, and it is THREE facts rather than one — micro-org#480.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * The bug this type exists to end: every failure to mint printed *"CloudsForge will not hand a
 * session to that origin… ask an operator to add it to the hand-off allowlist"*, and the apex was
 * never off the allowlist. Measured on 2026-08-17: `/auth/handoff` answers 201 for
 * `https://cloudsforge.online`, and identity's audit log holds zero `handoff_refused` lines for it
 * in 72 hours. What people were actually hitting is an EXPIRED ACCESS TOKEN — `hasSession()` tests
 * that `cf.accessToken` is PRESENT, never that it is live, and an access token lives 15 minutes.
 * Reopen the browser the next morning and the mint goes out with a dead bearer, comes back 401,
 * and the reader is told to go and talk to an operator about a list they are already on.
 *
 * A sentence blaming configuration for an expired session is worse than no sentence: it sends the
 * one person who could fix it (sign in again) to bother somebody who cannot.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   `origin`  — identity refused this origin. `micro-identity#22` answers a distinct
 *               `handoff_origin_refused` 403 code for it, which is the only thing that may
 *               produce the allowlist sentence.
 *   `session` — the bearer was not accepted. Nothing is misconfigured; sign in again.
 *   `unknown` — the mint failed and said nothing usable, or this bundle is running against a
 *               `@cloudsforge/ui` that still collapses every refusal to null. Neither claim may be
 *               made, so neither is.
 */
export type HandoffRefusal = 'origin' | 'session' | 'unknown'

/** Where a completed sign-in should send the browser next. */
export type Completion =
  | { readonly kind: 'here'; readonly path: string }
  | { readonly kind: 'handoff'; readonly url: string }
  | { readonly kind: 'refused'; readonly origin: string; readonly why: HandoffRefusal }

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
 * code — not a token — travels in the fragment. `mintHandoff` and `handoffReturnUrl` are in
 * `@cloudsforge/ui` beside `consumeAuthCallback`, which is what reads it at the other end.
 *
 * A refusal is its own case rather than a silent fall-back to Hub. Sending the user to a dashboard
 * they did not ask for would hide it and look like the surface they came from is broken. But WHICH
 * refusal it was is carried out of here rather than assumed: see `HandoffRefusal` above for the
 * months this app spent blaming an allowlist for an expired access token.
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
  // MINT for an origin that is not on `IDENTITY_HANDOFF_ORIGINS` (`identity/src/handoff.ts`),
  // so a code for somebody else's page is never issued, and the redirect below only ever happens
  // to an origin the platform has already agreed to hand tokens to.
  const minted = readMint(await mintHandoff(granted.accessToken, target.origin))
  if (minted.code === null) {
    return { kind: 'refused', origin: target.origin, why: minted.why }
  }
  return { kind: 'handoff', url: handoffReturnUrl(target.toString(), minted.code) }
}

/**
 * Read what `@cloudsforge/ui` answered a mint with, WITHOUT asserting which shape it is.
 *
 * ── WHY THIS TAKES `unknown` WHEN THE CALLER IS TYPED ─────────────────────────────────────────
 *
 * `mintHandoffCode` collapsed EVERY non-2xx to `null`. Its own comment said *"there is nothing
 * useful for a caller to do with the distinction"*, and micro-org#480 is the proof that there is:
 * the distinction is the difference between "sign in again" and "go and find an operator", and
 * for months this app told everyone the second when the truth was the first. `mintHandoff` is the
 * widened call that reports it, and `completeSignIn` above uses it.
 *
 * The two repositories ship separately and `@cloudsforge/ui` is linked, not versioned, so a
 * checkout can hold either. Narrowing at RUNTIME rather than by type means an older package —
 * which answers with the bare code or `null` — degrades to `unknown`, the one sentence that is
 * true whatever happened, instead of throwing inside a sign-in. A version check would have to be
 * kept in step with a release; a shape check is true whenever it is run.
 *
 * ── AN ERROR CODE IS NEVER MISTAKEN FOR A HAND-OFF CODE ───────────────────────────────────────
 *
 * A refusal envelope carries a code too — `handoff_origin_refused` IS a code, of a different kind
 * — so a code is only read once it has been established that this is not a refusal. Getting that
 * backwards would put the word `handoff_origin_refused` in the fragment of a redirect and hand the
 * browser to the other surface with rubbish in its address bar, which fails in a way nobody would
 * trace back to here.
 */
function readMint(minted: unknown): { readonly code: string | null; readonly why: HandoffRefusal } {
  // An older `@cloudsforge/ui`: the code itself, or null for every possible reason.
  if (typeof minted === 'string') {
    return minted.length > 0 ? { code: minted, why: 'unknown' } : { code: null, why: 'unknown' }
  }
  if (minted === null || typeof minted !== 'object') return { code: null, why: 'unknown' }

  const shape = minted as {
    ok?: unknown
    code?: unknown
    refusal?: unknown
    errorCode?: unknown
    error?: unknown
    status?: unknown
  }
  const said = typeof shape.errorCode === 'string' ? shape.errorCode : typeof shape.error === 'string' ? shape.error : ''
  const status = typeof shape.status === 'number' ? shape.status : null
  const refused = shape.ok === false || said !== '' || (status !== null && (status < 200 || status > 299))
  if (refused) {
    /*
     * The package's own word for it wins over the status, because the package read the body and
     * this did not. Its vocabulary is four values to these three: `unreachable` and `refused` both
     * become `unknown`, which is the correct claim for both — the request never arrived, or
     * identity refused for a reason it did not name, and neither supports blaming the allowlist.
     */
    if (shape.refusal === 'origin' || shape.refusal === 'session') {
      return { code: null, why: shape.refusal }
    }
    if (shape.refusal === 'unreachable' || shape.refusal === 'refused') return { code: null, why: 'unknown' }
    if (said === 'handoff_origin_refused' || status === 403) return { code: null, why: 'origin' }
    if (status === 401) return { code: null, why: 'session' }
    return { code: null, why: 'unknown' }
  }
  const code = shape.code
  return typeof code === 'string' && code.length > 0
    ? { code, why: 'unknown' }
    : { code: null, why: 'unknown' }
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
