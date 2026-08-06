/**
 * `lib/claims.ts` — the display fields read out of a held access token.
 *
 * This is the pure half of the fix for the defect the owner reported on the live estate: the bar
 * said `Sign in` to a signed-in user until `GET /auth/me` came back. The rendered half is
 * BJ-SIGNIN-07 in `journeys.test.ts`; what is asserted here is the one function that made it
 * possible to answer the question without a request.
 *
 * NOTHING IN THIS FILE IS A CREDENTIAL. Every token below is built here, unsigned, out of two
 * public display fields, by the same helper the journey uses and for the same reason: this module
 * verifies nothing, so a test that had to mint a signature would be asserting a property the
 * module does not have and must not acquire.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readTokenClaims } from '../src/lib/claims.ts'

const b64url = (value: string): string =>
  Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A JWS-shaped string whose payload is exactly `payload`. The signature segment is a word. */
const token = (payload: unknown): string =>
  `${b64url(JSON.stringify({ alg: 'RS256' }))}.${b64url(JSON.stringify(payload))}.unsigned`

describe('readTokenClaims', () => {
  it('reads the two claims identity puts in an access token', () => {
    // The shape is `identity/src/tokens.ts,58-64`: `handle` and `roles` at the top level of
    // the payload, beside `sub`, `sid`, `amr`, `iss`, `aud`, `jti`, `iat` and `exp`.
    const claims = readTokenClaims(
      token({ typ: 'user', sub: 'user-1', sid: 's-1', handle: 'savvanis', roles: ['player', 'admin'] }),
    )
    assert.deepEqual(claims, { handle: 'savvanis', roles: ['player', 'admin'] })
  })

  it('decodes a handle that is not ASCII, rather than its UTF-8 spelling', () => {
    // `atob` returns one code unit per BYTE, so a naive read renders "Ωμέγα" as mojibake in the
    // bar of every page. The bytes go through TextDecoder for exactly this case.
    const handle = 'Ωμέγα'
    assert.equal(readTokenClaims(token({ handle }))?.handle, handle)
  })

  it('does NOT consult the expiry — an expired access token beside a live refresh is signed in', () => {
    // Deliberate, and load-bearing. `lib/api.ts` refreshes on the next 401; treating an expired
    // access token as anonymous would put the flash back for people returning to an open tab,
    // which is the population that suffers it most. `AUTH_EXPIRED_EVENT` is the one authority on
    // being signed out, and it fires only when the refresh itself fails.
    const expired = token({ handle: 'savvanis', roles: ['player'], exp: 1, iat: 0 })
    assert.equal(readTokenClaims(expired)?.handle, 'savvanis')
  })

  it('answers null for anything it cannot read, and never invents an account', () => {
    // Each of these is a real shape. The opaque string is what this repository's own signed-in
    // fixtures use (`test/journeys.test.ts`), so a build that treated an unreadable token as a
    // decoded one would have been reporting a handle it made up.
    for (const [what, value] of [
      ['nothing at all', null],
      ['undefined', undefined],
      ['the empty string', ''],
      ['an opaque string with no dots', 'held-access-token'],
      ['two segments', 'aGVhZGVy.eyJoYW5kbGUiOiJhIn0'],
      ['four segments', `${token({ handle: 'a' })}.extra`],
      ['an empty payload segment', 'aGVhZGVy..unsigned'],
      ['a payload that is not base64', 'aGVhZGVy.!!!!.unsigned'],
      ['a payload that is not JSON', `aGVhZGVy.${b64url('not json')}.unsigned`],
      ['a payload that is JSON but not an object', `aGVhZGVy.${b64url('"a string"')}.unsigned`],
      ['a payload that is null', `aGVhZGVy.${b64url('null')}.unsigned`],
    ] as const) {
      assert.equal(readTokenClaims(value), null, `${what} produced claims`)
    }
  })

  it('answers null for a token that parses and carries neither field', () => {
    // A service token has `sub` and `scopes` and no handle. Returning `{handle: null, roles: null}`
    // would be indistinguishable from a decoded account with no name, and the caller would render
    // the signed-in bar with an empty label instead of waiting for /auth/me.
    assert.equal(readTokenClaims(token({ typ: 'service', sub: 'svc-1' })), null)
  })

  it('keeps the halves independent, and drops a non-string out of roles', () => {
    // A handle with no roles is an ordinary player token read by an older build of identity; roles
    // with no handle is the shape that existed before `handle` was added to the claims. Both are
    // usable, and neither may drag the other to null.
    assert.deepEqual(readTokenClaims(token({ handle: 'solo' })), { handle: 'solo', roles: null })
    assert.deepEqual(readTokenClaims(token({ roles: ['player'] })), { handle: null, roles: ['player'] })
    // `roles` is read for one purpose — whether operator surfaces appear in the switcher — and a
    // non-string in it would be rendered as `[object Object]` by an `includes` that never matches.
    assert.deepEqual(readTokenClaims(token({ roles: ['player', 7, null, 'admin'] })), {
      handle: null,
      roles: ['player', 'admin'],
    })
    assert.equal(readTokenClaims(token({ handle: '', roles: 'admin' })), null)
  })
})
