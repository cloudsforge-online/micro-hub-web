/**
 * Who the held access token says you are — readable at first paint, with no request.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE DEFECT THIS EXISTS TO CLOSE ───────────────────────────────────────────────────────────
 *
 * The bar rendered `Sign in` to a user who was already signed in, on every page, until something
 * forced a re-render. Reported from the live estate in those words: *"after login, the top right
 * part of the page where the account name is shown … said Sign in; when I click it, it refreshed
 * and then proceeded to account name."*
 *
 * The cause was an ordering one, not a caching one. `AuthProvider` began at `loading` whenever a
 * token was in storage (`lib/auth.tsx`), and `AccountState.signedIn` is false for `loading` — so
 * `CloudsForgeBar` was handed a signed-OUT account for exactly as long as `GET /auth/me` took.
 * That is not a frame: the request is cross-origin to `nimbus.<apex>`, so a browser sends a CORS
 * preflight first, and both hops cross the tunnel that is this estate's only ingress. Measured
 * against the live estate on 2026-08-05, the preflight alone was 308ms. If the access token has
 * expired — fifteen minutes, `exp - iat` on a live token — the 401, the single-flight refresh and
 * the retry make it four round trips before the handle appears.
 *
 * Clicking `Sign in` then "fixed" it because it is a full navigation to `/account/login`, whose
 * effect hands an existing session straight back (`pages/account.tsx`) and navigates
 * again — by which time the tokens are fresh and `/auth/me` answers sooner. The user's own
 * description, "it refreshed and then proceeded to account name", is that sequence exactly.
 *
 * ── WHY THE ANSWER IS THE TOKEN AND NOT A CACHE ───────────────────────────────────────────────
 *
 * The estate has NO COOKIES. A session is `cf.accessToken` / `cf.refreshToken` in `localStorage`
 * (`lib/api.ts`), which is per-origin and synchronous. So at the moment of first paint the
 * bundle already holds the answer — it was asking the network for something it had in hand.
 *
 * And the token itself carries the display fields. `identity/src/tokens.ts,58-64` puts
 * `handle` and `roles` in the claims, and its own comment records why `handle` is there at all:
 * without it "twenty-two services [get] a principal whose handle is silently `''`". Reading them
 * here costs nothing, cannot fail open, and is exactly as fresh as the credential the next request
 * will present anyway.
 *
 * ── THIS IS A DISPLAY READ. IT IS NOT A VERIFICATION, AND MUST NEVER BECOME ONE ────────────────
 *
 * Nothing below checks a signature, an issuer, an audience or an expiry, and nothing below may
 * ever be used to decide whether an action is permitted. The security boundary is unchanged and is
 * where it has always been: every service verifies the token and the scope on the request itself
 * (`lib/auth.tsx`). A user who edits their own `localStorage` to a forged payload changes the
 * name in their own title bar and nothing else — every request that name is attached to is refused
 * by the service that receives it.
 *
 * The expiry is deliberately NOT checked. An expired access token beside a live refresh token is a
 * signed-in user, and `request()` refreshes it on the next 401 (`lib/api.ts`); treating them as
 * anonymous would reintroduce the flash for the exact population that suffers it worst — people
 * who come back to a tab. When the refresh genuinely fails, `AUTH_EXPIRED_EVENT` clears the tokens
 * and the provider drops to anonymous, which is the one authority on the question.
 *
 * `/auth/me` still runs, and its answer still wins. This changes what is on screen for the first
 * few hundred milliseconds and nothing else.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** The two display fields a CloudsForge access token carries. Never a secret, never a decision. */
export interface TokenClaims {
  readonly handle: string | null
  readonly roles: readonly string[] | null
}

/**
 * Decode one base64url segment to text.
 *
 * `atob` gives back a binary string — one code unit per BYTE — so a handle outside ASCII would
 * arrive mojibaked if it were used directly. The bytes are handed to `TextDecoder` instead, which
 * is what makes a non-Latin handle render as itself rather than as its UTF-8 spelling.
 */
function decodeSegment(segment: string): string | null {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
  try {
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * The `handle` and `roles` claims of an access token, or null when there is nothing to read.
 *
 * NULL IS THE HONEST ANSWER FOR ANYTHING UNREADABLE, and every caller must treat it as "I do not
 * know yet" rather than as "signed out". A token this function cannot parse is still a token: the
 * suite's own signed-in fixtures are opaque strings (`test/journeys.test.ts`), and a build that
 * signed those scenarios out would have been reporting on a session it invented.
 */
export function readTokenClaims(token: string | null | undefined): TokenClaims | null {
  if (typeof token !== 'string' || token === '') return null
  const parts = token.split('.')
  // Three segments, and the middle one non-empty. Anything else is not a JWS compact serialisation
  // and there is nothing here worth guessing at.
  if (parts.length !== 3 || !parts[1]) return null

  const json = decodeSegment(parts[1])
  if (json === null) return null

  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null) return null

  const { handle, roles } = payload as Record<string, unknown>
  const readHandle = typeof handle === 'string' && handle !== '' ? handle : null
  const readRoles = Array.isArray(roles)
    ? roles.filter((role): role is string => typeof role === 'string')
    : null

  // A payload that parsed but carries neither field tells us nothing, and returning a
  // `{ handle: null, roles: null }` would let a caller mistake it for a decoded account.
  if (readHandle === null && readRoles === null) return null
  return { handle: readHandle, roles: readRoles }
}
