/**
 * This surface's slice of `docs/ecosystem/22-browser-journeys.md`, as data.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE CATALOGUE IS DATA AND NOT JUST A LIST OF `it(...)` TITLES
 *
 * Doc 22 §3.2 makes the layer boundary mechanical rather than advisory: every scenario declares
 * one `asserts` kind, and any scenario whose outcome depends on a SERVER-SIDE rule must carry
 * `ownedBy` — "a path, resolvable by grep, in the service that enforces the rule". A meta-test
 * reads these and fails the suite when one is missing. Advice does not survive a deadline; a
 * meta-test does.
 *
 * The second reason is doc 22 §8. Forty-eight of its 318 scenarios could not be run when it was
 * written, and it argues — correctly — that "a scenario that exists and cannot run is a gap
 * somebody can close, and an absent scenario is a gap nobody can see". So the ones that still
 * cannot run are here too, with the blocker named.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS CATALOGUE IS SCOPED TO, AND WHY IT IS NOT THE WHOLE OF GROUPS A AND B
 *
 * Doc 22 assigns 16 `BJ-ACC` and 24 `BJ-WAL` scenarios. This file does NOT claim all forty, and
 * saying so is the point: claiming an id is claiming it is covered, and a catalogue that listed
 * every id in both groups while testing a third of them would be a coverage number that is a
 * lie — the exact failure mode doc 22 §1 was written about.
 *
 * The scope is **the scenarios doc 22 recorded as BLOCKED on §8.1 and §8.2 and which this surface
 * now serves**, plus the three page-level properties (BJ-WAL-07, BJ-ADV-23, and the a11y pair)
 * that those two screens brought into existence. Doc 22 §8.1 and §8.2 are, verbatim:
 *
 *   §8.1 "Two things have to land before BJ-ACC-01 can be written as code: a sign-in surface in
 *        the estate, and …"  — 86 of 318 scenarios blocked, the largest blocker in the catalogue.
 *   §8.2 "`hub-web/src/pages/wallet.tsx` contains no `<form>`, no `<button>`, no `onClick` and no
 *        mutation."         — BJ-WAL-08..22, BJ-ADV-20, BJ-ADV-21, BJ-A11Y-13, BJ-A11Y-14.
 *
 * Both statements are now false of the working tree, which is what this file exists to record.
 * The read-only wallet rows (BJ-WAL-01..06) and the session/security rows (BJ-ACC-06..14, 16) were
 * never blocked and are untouched by this change; they remain uncovered, and that is visible here
 * rather than hidden by an inflated list. `DOC22_UNCLAIMED` names them so the gap is countable.
 *
 * ── Locally-minted ids ────────────────────────────────────────────────────────────────────────
 *
 * Five properties of the sign-in surface have no doc 22 row at all, because doc 22 was written
 * when the surface did not exist and could only describe it from the outside. They carry the
 * `BJ-SIGNIN-` prefix rather than a `BJ-ACC-` number, deliberately: doc 22 owns the `BJ-ACC`
 * sequence and will extend it, and minting into somebody else's sequence is how two scenarios end
 * up sharing an id. `market-web/test/journeys.ts` sets the precedent with `BJ-MARKET-404`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Doc 22 §3.1. Nothing else is assertable from a browser. `absence` is deliberately not a kind. */
export type Asserts = 'presentation' | 'client-request' | 'navigation'

/** Doc 22 §4. T3 is not implemented here — it lives in `micro-beacon`. */
export type Tier = 'T1' | 'T2' | 'T3'

export interface Scenario {
  /** Doc 22's stable id, or a `BJ-SIGNIN-` one. Never renumbered: a renamed scenario abandons its metric history. */
  readonly id: string
  /** What doc 22's row says fails if the feature breaks, in one line. */
  readonly what: string
  readonly asserts: Asserts
  readonly tier: Tier
  /** Release-gate (★ in doc 22). */
  readonly gate?: boolean
  /**
   * The server-side test that owns the rule this scenario's outcome depends on.
   *
   * Required by doc 22 §3.2 whenever the expected outcome is a refusal, a denial, a 4xx or an
   * absence. `<repo>/<path>` relative to the estate root, plus the symbol to grep for.
   */
  readonly ownedBy?: { readonly path: string; readonly grep: string }
  /** Why this cannot be implemented here, when it cannot. Absent means it is implemented. */
  readonly blocked?: string
  /**
   * Implemented, but not the whole of doc 22's row — and here is the half that is missing.
   *
   * This field exists because the alternative is worse in a specific way. BJ-WAL-08 asks for two
   * things: that the destination submitted is the destination rendered, AND that the fee is shown
   * before confirmation. The first is now true and testable. The second cannot be true at all —
   * `micro-wallet` quotes the fee inside `POST /v1/withdrawals` and serves no route that quotes
   * one. Marking the whole scenario implemented would claim the fee half; marking it blocked would
   * throw away the destination half, which is the most valuable assertion on this surface. So it
   * is implemented, and the shortfall is data that a meta-test insists be substantive.
   */
  readonly caveat?: string
  /**
   * The doc 22 §8 blocker this scenario was recorded under, and what removed it.
   *
   * Only for the scenarios that were ⛔ in doc 22 and are not any more. It is what makes this file
   * readable as a diff against the document rather than as a fresh opinion.
   */
  readonly unblocks?: { readonly was: string; readonly by: string }
}

export const SCENARIOS: readonly Scenario[] = [
  /* ══════════════════════════════════════════════════════════════════════════════════════════
     6.1 Group A — account and session. Every row here was ⛔ on §8.1, "no sign-in surface".
     ══════════════════════════════════════════════════════════════════════════════════════ */
  {
    id: 'BJ-ACC-01',
    what: 'register: submit email/handle/password, and the browser ends on the return address with a session',
    asserts: 'navigation',
    tier: 'T1',
    gate: true,
    unblocks: {
      was: '§8.1 — "sign-in surface (§8.1), identity". The estate served no HTML at account.<apex>.',
      by: 'src/pages/account.tsx RegisterPage, routed at src/app.tsx:148 as a PUBLIC route.',
    },
    caveat:
      'Doc 22 puts the second half at T3 — "the account handle rendered in the bar equals the ' +
      'handle submitted" — and that half is a property of the DESTINATION surface, which this ' +
      'repository cannot mount. What is asserted here is the client half at T1: the fields ' +
      'submitted are the fields typed, and the browser is sent to the address it was asked to ' +
      'return to. The bar belongs to whichever surface `?return=` named.',
  },
  {
    id: 'BJ-ACC-02',
    what: 'register with a taken handle: the field carries the server’s sentence and every other field keeps its value',
    asserts: 'presentation',
    tier: 'T1',
    ownedBy: { path: 'identity/src/server.ts', grep: 'fields' },
    unblocks: {
      was: '§8.1 — "sign-in surface, identity".',
      by: 'src/pages/account.tsx:409-415, which sets a refusal and clears nothing.',
    },
  },
  {
    id: 'BJ-ACC-03',
    what: 'sign in arriving from a protected deep link: the browser ends on /portfolio, not on /',
    asserts: 'navigation',
    tier: 'T1',
    gate: true,
    unblocks: {
      was: '§8.1 — "sign-in surface, identity, hub-api".',
      by: 'src/pages/account.tsx useReturnTo + useCompletion, and src/lib/identity.ts completeSignIn.',
    },
  },
  {
    id: 'BJ-ACC-04',
    what: 'SSO hand-off: a session already held here is handed over with no second credential prompt, and exactly one code is minted',
    asserts: 'client-request',
    tier: 'T1',
    gate: true,
    unblocks: {
      was: '§8.1 — "sign-in surface, identity, worlds".',
      by: 'src/pages/account.tsx:219-235, the handedOff ref.',
    },
    caveat:
      'Doc 22’s row ends "Worlds renders /player without a second credential prompt". Mounting ' +
      'Worlds is tier 3 and lives in micro-beacon (doc 22 §4). The half that is a property of ' +
      'THIS surface — that a held session produces a hand-off rather than a password form, and ' +
      'that the code is minted once and not twice under StrictMode — is asserted at T1.',
  },
  {
    id: 'BJ-ACC-05',
    what: 'the hand-off code is single-use: replaying the callback URL in a second tab does not sign it in',
    asserts: 'presentation',
    tier: 'T3',
    blocked:
      'The refusal is identity’s (`identity/src/handoff.ts` spends the code) and the sentence ' +
      'shown is rendered by the CONSUMING surface’s boot path, not by this one — ' +
      '`consumeAuthCallback` lives in @cloudsforge/ui and this bundle only calls it. Two tabs ' +
      'against one service is tier 3 by doc 22 §4 in any case, and doc 22 §4 puts tier 3 in ' +
      'micro-beacon. What IS asserted here is that this surface mints exactly one code per ' +
      'hand-off, which is BJ-ACC-04.',
  },
  {
    id: 'BJ-ACC-15',
    what: 'MFA lockout (05 journey 21): the recovery-code path, then the no-codes path',
    asserts: 'presentation',
    tier: 'T3',
    blocked:
      'Doc 22 §8.1 records that identity serves factor enrolment, recovery-code issue and factor ' +
      'removal and that nothing renders them; that is still true — `grep -r "auth/mfa/factors" ' +
      'src/` in this repository finds nothing, and src/pages/security.tsx renders mfaEnabled as a ' +
      'fact and offers no enrolment. The sign-in surface answers a challenge; it does not manage ' +
      'factors, and a scenario about the no-codes path has no screen to run against.',
  },

  /* ── Properties of the sign-in surface that doc 22 has no row for ─────────────────────────── */
  {
    id: 'BJ-SIGNIN-01',
    what: 'password accepted and nothing else established: the challenge is answered, and a wrong code returns to the password step rather than re-offering a spent challenge',
    asserts: 'presentation',
    tier: 'T1',
    ownedBy: { path: 'identity/src/server.ts', grep: 'mfaRequired' },
  },
  {
    id: 'BJ-SIGNIN-02',
    what: 'every credential request goes to a route identity actually serves, and a request to any other address fails the scenario outright',
    asserts: 'client-request',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-SIGNIN-03',
    what: 'sign-out clears the local tokens even when the revocation call fails, and leaves anyway',
    asserts: 'navigation',
    tier: 'T1',
  },
  {
    id: 'BJ-SIGNIN-04',
    what: 'a ?return= that is not an http(s) address never reaches location.assign; the dashboard is the fall-back',
    asserts: 'navigation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-SIGNIN-05',
    what: 'an origin identity will not mint for is said out loud, and the browser is not quietly bounced to the dashboard',
    asserts: 'presentation',
    tier: 'T1',
    ownedBy: { path: 'identity/src/handoff.ts', grep: 'IDENTITY_HANDOFF_ORIGINS' },
  },

  /* ══════════════════════════════════════════════════════════════════════════════════════════
     6.2 Group B — wallet and withdrawal. BJ-WAL-08..22 were ⛔ on §8.2, "no UI exists".
     ══════════════════════════════════════════════════════════════════════════════════════ */
  {
    id: 'BJ-WAL-07',
    what: 'wallet down and ledger up: the wallet strip says it is unavailable and prints no figure, and the other strips render independently',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-WAL-08',
    what: 'Send: the destination submitted is byte-identical to the destination rendered on the confirmation step',
    asserts: 'client-request',
    tier: 'T1',
    gate: true,
    unblocks: {
      was: '§8.2 — "no UI exists (§8.2)". wallet.tsx had no form, no button and no mutation.',
      by: 'src/components/send.tsx, whose frozen `Armed.intent` is both rendered and posted.',
    },
    caveat:
      'The other half of doc 22’s row — "the fee is shown BEFORE confirmation, never after ' +
      '(05:269)" — is not asserted and cannot be. `micro-wallet` quotes the network fee inside ' +
      '`POST /v1/withdrawals` (`wallet/src/withdrawals.ts:298-303`) and serves no route that ' +
      'quotes one: there is no `GET /v1/fees` and no fee on any read route. The confirmation step ' +
      'therefore says the fee is not yet known and that the amount entered is the gross, and the ' +
      'receipt states it where it becomes known. Asserting a fee before confirmation would ' +
      'require this bundle to invent a figure, which is the defect the row exists to prevent.',
  },
  {
    id: 'BJ-WAL-09',
    what: 'Send: double-submit the confirm button — exactly one withdrawal request leaves the browser',
    asserts: 'client-request',
    tier: 'T1',
    unblocks: { was: '§8.2 — "no UI exists".', by: 'src/components/send.tsx confirm(), guarded by `busy`.' },
  },
  {
    id: 'BJ-WAL-10',
    what: 'Send: the back button after the confirmation step does not re-arm a second submit against the same intent',
    asserts: 'navigation',
    tier: 'T1',
    unblocks: { was: '§8.2 — "no UI exists".', by: 'src/components/send.tsx, the armed intent is component state.' },
  },
  {
    id: 'BJ-WAL-11',
    what: 'Send: the request fails — nothing was added to the in-flight list, and the failure is stated with its request id',
    asserts: 'presentation',
    tier: 'T1',
    ownedBy: { path: 'wallet/src/withdrawals.ts', grep: 'insufficient' },
    unblocks: { was: '§8.2 — "no UI exists".', by: 'src/components/send.tsx:144-153.' },
  },
  {
    id: 'BJ-WAL-12',
    what: 'Send: policy returns deny — the reason in plain language, the limit, when it resets, and one route to raise it',
    asserts: 'presentation',
    tier: 'T3',
    blocked:
      'The withdrawal path in `micro-wallet` consults no policy service at all. `grep -n policy ' +
      'wallet/src/withdrawals.ts` finds nothing, and the refusals that path can produce are ' +
      'withdrawals_disabled, not_withdrawable, invalid_amount, fee_unavailable, amount_too_small ' +
      'and the ledger’s insufficient-funds — none of which carries a limit or a reset time. A ' +
      '"your limit resets at…" panel would be a screen for a decision nothing in the estate ' +
      'makes, and doc 22 §3 forbids a browser scenario from asserting a rule in any case. The ' +
      'refusals wallet CAN produce are asserted by BJ-WAL-11 and BJ-ADV-23.',
  },
  {
    id: 'BJ-WAL-13',
    what: 'Send: policy returns challenge — MFA is prompted inline and the flow continues without re-entering the amount',
    asserts: 'presentation',
    tier: 'T3',
    blocked:
      'Same finding as BJ-WAL-12: nothing consults micro-policy on the withdrawal path, so there ' +
      'is no challenge decision for a browser to render. `micro-custody` DOES consult policy for ' +
      'the export ceremony and records challenge and review as denied deliberately — "a ceremony ' +
      'left open on either would be one an attacker can return to" — which is a different ' +
      'decision and is covered by BJ-WAL-18.',
  },
  {
    id: 'BJ-WAL-14',
    what: 'Send: policy returns review — the expected turnaround is stated and the request is visible as queued rather than failed',
    asserts: 'presentation',
    tier: 'T3',
    blocked:
      'Same finding as BJ-WAL-12 and BJ-WAL-13: no policy call exists on the withdrawal path, and ' +
      'no route in the estate publishes a turnaround for a review that nothing issues. There is ' +
      'no queued-for-review state in wallet’s withdrawal machine — its non-terminal states are ' +
      'requested, reserved, queued, settling and stuck (`lib/hub.ts` WithdrawalRecord).',
  },
  {
    id: 'BJ-WAL-15',
    what: 'Send: safe retry on a stuck withdrawal — the control exists and pressing it twice produces one outbound',
    asserts: 'client-request',
    tier: 'T3',
    blocked:
      'There is no retry route. `micro-wallet` serves POST /v1/withdrawals and nothing that ' +
      're-broadcasts an existing one; 05:485-487 describes the operator-side bump-fee path, which ' +
      'doc 22 itself puts in admin-web as BJ-ADM-21 and records as having no screen either ' +
      '(§8.4). A retry button here would post a SECOND withdrawal under a new key, which is the ' +
      'opposite of what the scenario asks for. The stuck state is rendered with its reason ' +
      '(`src/pages/wallet.tsx:260-284`), which is the half that exists.',
  },
  {
    id: 'BJ-WAL-16',
    what: 'Receive: the address rendered is the address in the response, and an unwatched address says so rather than looking ready',
    asserts: 'presentation',
    tier: 'T1',
    unblocks: { was: '§8.2 — "no UI exists".', by: 'src/components/receive.tsx.' },
    caveat:
      'Two parts of doc 22’s row are not asserted. **The QR code**: this bundle has no QR ' +
      'dependency, and hand-rolling a Reed-Solomon encoder in the screen that produces a payment ' +
      'destination is worse than the address in full — a QR that encodes one character wrong is ' +
      'unreadable by eye and looks exactly like a correct one. **The confirmation depth**: ' +
      'nothing in the estate publishes a depth policy, and hub-api omits the denominator from a ' +
      'confirmation count for that exact reason ("41/0 is worse than 41 confirmations", ' +
      'hub-api/src/nextactions.ts:146-148). A number invented here would be the denominator ' +
      'hub-api refused to invent.',
  },
  {
    id: 'BJ-WAL-17',
    what: 'Receive: both sentences — managed wallet and deposit address — are in the page at body size, not in a tooltip',
    asserts: 'presentation',
    tier: 'T1',
    unblocks: { was: '§8.2 — "no UI exists".', by: 'src/components/receive.tsx:141-151.' },
  },
  {
    id: 'BJ-WAL-18',
    what: 'the key export ceremony: every stage is on screen, the cooling-off is stated with its cancel route, and the secret is revealed once and never stored',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
    ownedBy: { path: 'custody/src/exports.ts', grep: 'cooling_off' },
    unblocks: { was: '§8.2 — "no UI exists".', by: 'src/components/keyexport.tsx.' },
    caveat:
      'Doc 22 says "all ten stages". `custody/src/exports.ts` holds four — requested, ' +
      'cooling_off, challenged, redeemed — plus cancelled and denied as terminals, and ' +
      '`src/components/keyexport.tsx:55-60` renders exactly those four in order. Ten is doc 22 ' +
      'counting 05 journey 5’s prose steps rather than the service’s state machine. The scenario ' +
      'is written against the machine, because the machine is what refuses.',
  },
  {
    id: 'BJ-WAL-19',
    what: 'key export: cancel needs no second factor and is on screen at every point in the window',
    asserts: 'presentation',
    tier: 'T1',
    ownedBy: { path: 'custody/src/server.ts', grep: '/v1/exports/:id/cancel' },
    unblocks: { was: '§8.2 — "no UI exists".', by: 'src/components/keyexport.tsx:373-376.' },
    caveat:
      'Doc 22’s row says "cancel FROM THE NOTIFICATION LINK". The link is in an email, and an ' +
      'email is not a surface this repository serves or can mount. The property that link exists ' +
      'to deliver — that cancellation is available throughout and demands no factor — is asserted ' +
      'here against the in-app control.',
  },
  {
    id: 'BJ-WAL-20',
    what: 'key export with no factor enrolled: the page says enrol first and offers the route, rather than showing a disabled button',
    asserts: 'presentation',
    tier: 'T1',
    ownedBy: { path: 'custody/src/exports.ts', grep: 'mfa_required' },
    unblocks: { was: '§8.2 — "no UI exists".', by: 'src/components/keyexport.tsx:424-437, PanelNotice.' },
  },
  {
    id: 'BJ-WAL-21',
    what: 'connect an external wallet: challenge nonce → sign → verify → grant the closed five authorisations individually',
    asserts: 'client-request',
    tier: 'T3',
    blocked:
      'The middle step is the whole flow and it needs a SIGNER — a browser extension, a hardware ' +
      'device or a mobile deep link. This bundle has none and no dependency provides one; a form ' +
      'that asked a user to paste a signature they produced elsewhere is not journey 6, it is a ' +
      'way to make people move their key to a machine that can sign a string. ' +
      '`src/pages/wallet.tsx:158-166` states the same finding on the page, which is what ' +
      'BJ-WAL-21-ABSENT asserts instead.',
  },
  {
    id: 'BJ-WAL-22',
    what: 'an unverified external address contributes to portfolio display only and is not offered as a withdrawal destination',
    asserts: 'presentation',
    tier: 'T3',
    blocked:
      'Doc 22’s own row calls this a server rule (14 §12, "Withdrawal destination negative") and ' +
      'says the browser asserts the absence of the option RELATIVE TO THE AUTHORISATIONS THE API ' +
      'RETURNED. hub-api’s wallets tile carries no per-wallet authorisation set — ' +
      '`lib/hub.ts` WalletRecord has origin, status and verifiedAt and no grants — so there is no ' +
      'response for a browser to assert relative to. `components/send.tsx:92-95` records the same ' +
      'finding and offers the list as a convenience rather than a permission, which is why the ' +
      'destination field is not a closed list.',
  },
  {
    id: 'BJ-WAL-21-ABSENT',
    what: 'the five things this surface does not build are named on the page with their reasons, rather than being silently absent',
    asserts: 'presentation',
    tier: 'T1',
  },

  /* ══════════════════════════════════════════════════════════════════════════════════════════
     6.19 Group S — the adversarial matrix. BJ-ADV-20 and -21 were ⛔ "no UI (§8.2)".
     ══════════════════════════════════════════════════════════════════════════════════════ */
  {
    id: 'BJ-ADV-20-H1',
    what: 'Send, double-submit: the key is minted when the intent forms, not per fetch — one intent keeps one key and a changed intent gets a different one',
    asserts: 'client-request',
    tier: 'T1',
    gate: true,
    unblocks: { was: '§6.19 BJ-ADV-20 ⛔★ "Send — does not exist".', by: 'src/components/send.tsx:120-129.' },
  },
  {
    id: 'BJ-ADV-20-H2',
    what: 'Send, back after a confirmation: a settled intent cannot be re-committed under the key that settled it',
    asserts: 'navigation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-ADV-20-H3',
    what: 'Send, two tabs one intent: exactly one effect, and the losing tab renders the replay in words',
    asserts: 'client-request',
    tier: 'T3',
    gate: true,
    blocked:
      'Two browser contexts against one service. Tier 3 by doc 22 §4 — "T3 assumes the estate" — ' +
      'and nothing in this repository can hold two browsers open; the harness in test/dom.ts ' +
      'installs ONE happy-dom window over the process globals. The single-context half is ' +
      'BJ-ADV-20-H1. The REPLAY half, which is what the losing tab would see, is asserted at T1 ' +
      'by BJ-WAL-09: a 200 with replayed:true renders "Pressing Send twice does not send twice" ' +
      'and not an error.',
  },
  {
    id: 'BJ-ADV-20-H4',
    what: 'Send, the request fails after the UI moved: the confirmation step survives with the server’s reason and the intent intact',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
    // NOT `wallet/src/server.ts` for the string `idempotency_key_reused`, which was the first
    // citation written here and which the meta-test rejected: that literal appears nowhere in
    // micro-wallet. The rule is real and lives here — "a reused key with a different body is
    // refused, not replayed" — and the 409 it produces is what this scenario renders.
    ownedBy: {
      path: 'wallet/src/idempotency.ts',
      grep: 'reused key with a different body is refused',
    },
  },
  {
    id: 'BJ-ADV-20-H5',
    what: 'Send, session expires mid-flow: the re-authentication sentence is shown and no stale figure is left rendered as current',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
    unblocks: {
      was: 'doc 22 §6.19 put H5 at T3 for every form, because "signInRedirect() into a surface that does not exist".',
      by: 'the surface exists — src/app.tsx:147 — so the re-authentication path now terminates somewhere.',
    },
  },
  {
    id: 'BJ-ADV-20-H6',
    what: 'Send against an upstream that did not answer: the reason is stated and no control is offered that would post against a balance nobody could read',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-ADV-21-H1',
    what: 'key export, double-submit: two presses of Start the export produce one export request',
    asserts: 'client-request',
    tier: 'T1',
    gate: true,
    unblocks: { was: '§6.19 BJ-ADV-21 ⛔★ "Key export — does not exist".', by: 'src/components/keyexport.tsx.' },
  },
  {
    id: 'BJ-ADV-21-H2',
    what: 'key export, back after the reveal: nothing re-arms a second redemption, because the reveal token is gone',
    asserts: 'navigation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-ADV-21-H3',
    what: 'key export, two tabs one ceremony',
    asserts: 'client-request',
    tier: 'T3',
    gate: true,
    blocked:
      'Two browser contexts, tier 3 by doc 22 §4, exactly as BJ-ADV-20-H3. The property that ' +
      'makes the second tab harmless is asserted at T1 instead and is stronger than the tab test ' +
      'would be: the reveal token lives in component state and is in neither localStorage nor ' +
      'sessionStorage (BJ-WAL-18), so a second tab has nothing to redeem with and custody would ' +
      'refuse it a second time in any case.',
  },
  {
    id: 'BJ-ADV-21-H5',
    what: 'key export, session expires mid-ceremony: the sentence is shown with its request id and no key material is on the page',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-ADV-23',
    what: 'every failure state on these two screens renders the request id to quote to support',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },

  /* ══════════════════════════════════════════════════════════════════════════════════════════
     6.20 Group T — accessibility. Both rows were ⛔ "no UI (§8.2)".
     ══════════════════════════════════════════════════════════════════════════════════════ */
  {
    id: 'BJ-A11Y-13',
    what: 'keyboard-only: the send flow is traversable and completable, and the confirm control is not reachable before the intent is armed',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
    unblocks: { was: '§6.20 ⛔★ "no UI (§8.2)".', by: 'src/components/send.tsx.' },
  },
  {
    id: 'BJ-A11Y-14',
    what: 'keyboard-only: the export ceremony is traversable, and cancel is reachable by keyboard at every stage',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
    unblocks: { was: '§6.20 ⛔★ "no UI (§8.2)".', by: 'src/components/keyexport.tsx.' },
  },
]

/**
 * The ids doc 22 assigns to this surface that this catalogue deliberately does NOT claim.
 *
 * Every one of them is a real gap. They are listed rather than omitted for the reason doc 22 §8
 * gives about its own blocked set: "a scenario that exists and cannot run is a gap somebody can
 * close, and an absent scenario is a gap nobody can see". None was blocked by §8.1 or §8.2, so
 * none is in this change's scope — they were coverable before it and are still uncovered.
 *
 * `journeys.test.ts` asserts SCENARIOS and this list do not overlap, so a scenario cannot be
 * counted as both claimed and unclaimed, and an id cannot be quietly moved from here to there by
 * deleting a test.
 */
export const DOC22_UNCLAIMED: readonly string[] = [
  // §6.1 — session mechanics and the Security page. Neither was blocked on the sign-in surface.
  'BJ-ACC-06',
  'BJ-ACC-07',
  'BJ-ACC-08',
  'BJ-ACC-09',
  'BJ-ACC-10',
  'BJ-ACC-11',
  'BJ-ACC-12',
  'BJ-ACC-13',
  'BJ-ACC-14',
  'BJ-ACC-16',
  // §6.2 — the read-only wallet rows. wallet.tsx rendered all of these before this change.
  'BJ-WAL-01',
  'BJ-WAL-02',
  'BJ-WAL-03',
  'BJ-WAL-04',
  'BJ-WAL-05',
  'BJ-WAL-06',
  'BJ-WAL-23',
  'BJ-WAL-24',
  // §6.3 — the dashboard group, which is seven other pages.
  'BJ-DSH-08',
  'BJ-DSH-11',
  'BJ-DSH-12',
  'BJ-DSH-17',
  'BJ-DSH-21',
  'BJ-DSH-22',
  // §6.19 — the security page's two forms.
  'BJ-ADV-19-H1',
  'BJ-ADV-19-H3',
  'BJ-ADV-19-H5',
  // §6.19, §6.20 — page-level rows that span every surface, not just this one.
  'BJ-ADV-22',
  'BJ-A11Y-01',
  'BJ-A11Y-03',
  'BJ-A11Y-10',
  'BJ-A11Y-12',
]

export const byId = (id: string): Scenario => {
  const found = SCENARIOS.find((s) => s.id === id)
  if (!found) throw new Error(`no scenario ${id} in test/journeys.ts`)
  return found
}
