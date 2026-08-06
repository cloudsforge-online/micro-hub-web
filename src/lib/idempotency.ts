/**
 * The `Idempotency-Key` every money-moving call to `micro-wallet` must carry.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THE HEADER IS REQUIRED, AND A KEY IDENTIFIES AN INTENT — NOT A REQUEST.**
 *
 * `wallet/src/server.ts, 712, 738, 765` calls `requireIdempotencyKey` on every mutating
 * money route, and `wallet/src/idempotency.ts` refuses a request without one: *"without one a
 * retry moves money twice"*. The key must be 8 to 200 characters.
 *
 * So a key is minted ONCE, when the user forms the intent — the Send form is opened, the confirm
 * button is armed — and REUSED for every retry of that intent. A key minted per `fetch` would
 * defeat the whole mechanism: two clicks would be two keys and two withdrawals. `useIntentKey`
 * below holds one for the life of a form and mints a fresh one only after a success, which is
 * what makes BJ-WAL-09 ("double-submit the confirm button → exactly one withdrawal request
 * leaves the browser") and BJ-WAL-10 (the back button does not re-arm a second submit) true.
 *
 * The service answers 200 with `replayed: true` for a repeat under the same key and 201 for a
 * fresh one (`wallet/src/server.ts`), so a second click reads back the FIRST withdrawal
 * rather than failing — which is why nothing here may translate `replayed` into an error.
 *
 * The same key with a genuinely DIFFERENT body is a distinct refusal, and it is a bug in this
 * app rather than something the user can fix: it means two different intents were sent under one
 * key. It is shown with its request id rather than swallowed.
 *
 * Modelled on `market-web/src/lib/idempotency.ts`, which states the same rule for `micro-market`.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import { useCallback, useRef, useState } from 'react'

/** The header name, spelled once. `wallet/src/server.ts`. */
export const IDEMPOTENCY_HEADER = 'idempotency-key'

/** wallet's own pattern, restated so a bad key is caught before it costs a round trip. */
export const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9_:.-]{8,200}$/

/**
 * Mint a key for one intent.
 *
 * `crypto.randomUUID` where the browser has it, and a fallback built from `getRandomValues` where
 * it does not — Safari only gained `randomUUID` in 15.4, and a `TypeError` thrown here would take
 * out the Send button rather than degrade it. The prefix names the intent, so a key seen in a log
 * says what it was for.
 */
export function mintIdempotencyKey(intent: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : randomHex()
  const key = `${intent}:${random}`.replace(/[^A-Za-z0-9_:.-]/g, '-')
  // Truncating rather than throwing: a long intent name is a caller's mistake and must not be the
  // reason a withdrawal cannot be sent. 200 is the service's own ceiling.
  return key.slice(0, 200)
}

function randomHex(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    // No CSPRNG at all. This is not a place to silently use Math.random: a guessable key is a key
    // somebody else's retry can collide with, and a collision here replays a stranger's payment.
    throw new Error('This browser has no secure random source, so a payment cannot be made safely.')
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * One key for the life of one intent, with an explicit way to start a new one.
 *
 * The key lives in a ref, not in state: reading it must never depend on a render having happened,
 * because the submit handler reads it during the click that a re-render would race.
 */
export function useIntentKey(intent: string): { key: () => string; renew: () => void } {
  const held = useRef<string | null>(null)
  // Only used to force the ref to be re-minted after a success; nothing renders it.
  const [, bump] = useState(0)

  const key = useCallback(() => {
    if (held.current === null) held.current = mintIdempotencyKey(intent)
    return held.current
  }, [intent])

  const renew = useCallback(() => {
    held.current = null
    bump((n) => n + 1)
  }, [])

  return { key, renew }
}
