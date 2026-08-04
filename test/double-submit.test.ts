/**
 * Two events in one tick, on every control on this surface that writes.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS FILE EXISTS FOR
 *
 *   A GUARD WRITTEN AS COMPONENT STATE CANNOT SEE A SECOND EVENT IN THE SAME TICK.
 *
 * `components/send.tsx` used to read `if (!armed || busy) return` out of the render closure.
 * `setBusy(true)` only SCHEDULES a render, so two Confirm clicks dispatched before React commits
 * both read `busy === false` from their own closures and both post. `disabled={busy}` has the
 * identical hole from the other end: the attribute is not on the DOM node until that render
 * commits, and the second event was dispatched before it did.
 *
 * ── WHY THIS SURVIVED SO LONG, WHICH IS THE INTERESTING PART ──────────────────────────────────
 *
 * Because on Send the NET EFFECT was already correct, and for a reason that has nothing to do
 * with the guard. One intent mints one `Idempotency-Key` (`lib/idempotency.ts`), both requests
 * carry it, and `wallet/src/server.ts:674-676` replays the second — so no money ever moved twice.
 *
 * That is the service cleaning up after this client, and it is not a guard. It says nothing about
 * the routes on this surface that carry NO key, and there are several:
 *
 *   POST /v1/deposits (rotate)      two rotations; the address on screen is the second, and the
 *                                   first is retired after the user may have copied it
 *   POST /v1/exports/:id/redeem     custody spends the token on the first, refuses the second,
 *                                   and the refusal resolves LAST — a failure notice over the one
 *                                   and only sight of a private key
 *   POST /auth/mfa                  identity spends the challenge either way, so the right code
 *                                   entered twice is reported as rejected
 *   POST /auth/register             the second is refused "handle taken" by the account the first
 *                                   just created
 *
 * ── WHY THIS IS THE CLIENT'S BUSINESS AND NOT THE SERVICE'S ───────────────────────────────────
 *
 * Doc 22 §3 forbids a browser scenario from asserting a business rule, and collapsing duplicates
 * IS a service's rule. HOW MANY TIMES A BROWSER SENDS is not: it is the one thing about a
 * duplicate that is squarely the client's own, which is why it is asserted here and nowhere else.
 *
 * ── THE ASSERTION THIS FILE REPLACES ──────────────────────────────────────────────────────────
 *
 * `journeys.test.ts` BJ-WAL-09 already pressed Confirm twice with `clickNoFlush`, and then
 * declined to count the requests, under a comment claiming the count was "a property of the
 * harness's scheduling rather than of the screen" and that in a real browser "two clicks are two
 * discrete events and React flushes state between them". Both halves are false. React does not
 * flush between two clicks dispatched in one task — which is exactly why `micro-beacon`'s
 * BJ-WAL-09 drives real Chromium, dispatches both from ONE `page.evaluate`, and found two POSTs.
 * The scenario asserted `posted.length >= 1`, which cannot fail. It is corrected in place.
 *
 * ── AND BOTH WAYS ROUND ───────────────────────────────────────────────────────────────────────
 *
 * `src/main.tsx:33` renders under `<StrictMode>`; this harness mounted without it until this file
 * added `strict`. A ref latch is CREATED TWICE on a StrictMode mount, so a guard proven only in
 * the plain mode has never been run the way the app runs it. Every proof below runs twice.
 *
 * **And `strict` is itself proven**, by the meta-test at the top. Three repos in the previous
 * estate-wide sweep shipped a mutation that made `strict: true` a no-op and survived it, which
 * means their paired tests had been silent duplicates all along. A meta-test is the only thing
 * that stops this file becoming the same test written twice.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, useRef, useState, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Screen } from './dom.ts'
import * as fx from './fixtures.ts'
import { useLatch } from '../src/lib/latch.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import { __resetAuth } from '../src/lib/api.ts'
import { SendPanel } from '../src/components/send.tsx'
import { ReceivePanel } from '../src/components/receive.tsx'
import { KeyExportPanel } from '../src/components/keyexport.tsx'
import { RegisterPage, SignInPage } from '../src/pages/account.tsx'
import { SecurityPage } from '../src/pages/security.tsx'

const ORIGIN = 'https://hub.cloudsforge.online'
const fresh = (): void => __resetAuth()

/** The two shared token keys, for a scenario that starts signed in. `lib/api.ts:27-28`. */
const SIGNED_IN = { 'cf.accessToken': 'held-access-token', 'cf.refreshToken': 'held-refresh-token' }

/** A page under a router at `path`. */
const page = (element: ReactElement, path: string): ReactElement =>
  h(MemoryRouter, { initialEntries: [path] }, element)

/** The message an assertion prints when a control sent twice. */
const once = (what: string, n: number, cost: string): string =>
  `${what} left the browser ${n} times for ONE double click. ` +
  `A guard read from component state cannot see the second event in the same tick — take the ` +
  `latch in a ref before the first await. ${cost}`

/** Enough text to clear the harness's forty-character "did anything render" floor. */
const FLOOR = 'A probe with enough text to clear the forty-character floor this harness enforces.'

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   THE META-TEST. Without this, every paired scenario below is one test written twice.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('the `strict` option really is StrictMode', () => {
  it('double-invokes the component function under strict, and does not without it', async () => {
    /**
     * A probe that counts its own render passes into a box the test owns.
     *
     * StrictMode double-invokes the component function on mount, so the count MUST differ between
     * the two modes. Asserting "differs" rather than an exact number keeps this honest across
     * React versions without pinning it to an implementation detail.
     */
    const plain = { passes: 0 }
    const strict = { passes: 0 }
    const Probe = ({ box }: { box: { passes: number } }): ReactElement => {
      box.passes += 1
      return h('p', null, FLOOR)
    }

    await withScreen(h(Probe, { box: plain }), { url: ORIGIN }, async () => undefined)
    await withScreen(h(Probe, { box: strict }), { url: ORIGIN, strict: true }, async () => undefined)

    assert.ok(plain.passes > 0, 'the plain probe never rendered at all')
    assert.ok(
      strict.passes > plain.passes,
      `\`strict: true\` did not change how the tree was rendered: ${plain.passes} render pass(es) ` +
        `plain and ${strict.passes} under strict. The option is a no-op, which means every ` +
        `"under StrictMode" scenario in this file is a silent duplicate of its plain twin and ` +
        `proves nothing. This is the exact failure three repos shipped in the previous sweep.`,
    )
  })

  it('a ref survives the StrictMode double-invocation, which is why the latch may be one', async () => {
    // Both initialisers run on a StrictMode mount and one ref is discarded. From the first commit
    // there is exactly one, and it is the one both clicks of a double click read. This scenario
    // states that in code so the claim in `lib/latch.ts` is not merely a comment.
    const seen: unknown[] = []
    const Probe = (): ReactElement => {
      const ref = useRef({})
      seen.push(ref.current)
      return h('p', null, FLOOR)
    }
    await withScreen(h(Probe), { url: ORIGIN, strict: true }, async () => undefined)
    assert.ok(seen.length >= 2, 'the probe did not render twice, so this proves nothing about strict')
    assert.equal(
      new Set(seen).size,
      1,
      'the committed tree kept more than one ref identity, so a latch in a ref would not be shared ' +
        'between two clicks of a double click',
    )
  })

  /*
   * ── AND THE HARNESS REALLY DOES DISPATCH BOTH EVENTS BEFORE A RENDER ──────────────────────
   *
   * The assertion that makes every count below meaningful. If `clickNoFlush` were to flush — or
   * if `act` were to commit between the two dispatches — the second handler would read the
   * post-click state, a `busy` guard would hold, and every scenario in this file would pass
   * against the defect it was written for. So it is checked directly, with a control that has NO
   * latch: two presses must reach the handler twice, with the same `busy` both times.
   */
  it('two clickNoFlush calls really do reach one handler twice, before any render commits', async () => {
    const seenBusy: boolean[] = []
    const Probe = (): ReactElement => {
      const [busy, setBusy] = useState(false)
      return h(
        'div',
        null,
        h(
          'button',
          {
            type: 'button',
            onClick: () => {
              seenBusy.push(busy)
              setBusy(true)
            },
          },
          'Do the thing',
        ),
        h('p', null, FLOOR),
      )
    }

    await withScreen(h(Probe), { url: ORIGIN }, async (s) => {
      const button = s.byRole('button', 'Do the thing')
      s.clickNoFlush(button)
      s.clickNoFlush(button)
      await s.settle(10)
      assert.deepEqual(
        seenBusy,
        [false, false],
        'the two dispatches did not both observe the pre-click state, so this harness cannot ' +
          'reproduce a double submit and no count in this file proves anything',
      )
    })
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   THE LATCH ITSELF, at its narrowest — one button, one counter, nothing else in the way.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

for (const strict of [false, true]) {
  const mode = strict ? 'under StrictMode' : 'plain'

  describe(`useLatch runs the work once per double click — ${mode}`, () => {
    const Probe = ({ box, throws = false, ms = 30 }: {
      box: { runs: number }
      throws?: boolean
      ms?: number
    }): ReactElement => {
      const latch = useLatch()
      const [busy, setBusy] = useState(false)
      const run = () => {
        if (!latch.take()) return
        setBusy(true)
        box.runs += 1
        void new Promise((r) => setTimeout(r, ms))
          .then(() => {
            if (throws) throw new Error('the upstream is unreachable')
          })
          .catch(() => undefined)
          .finally(() => {
            latch.release()
            setBusy(false)
          })
      }
      return h(
        'div',
        null,
        h('button', { type: 'button', disabled: busy, onClick: run }, 'Do the thing'),
        h('p', null, busy ? 'Working… and long enough to clear the floor.' : FLOOR),
      )
    }

    it(`starts one run, not two (${mode})`, async () => {
      const box = { runs: 0 }
      await withScreen(h(Probe, { box }), { url: ORIGIN, strict }, async (s) => {
        const button = s.byRole('button', 'Do the thing')
        s.clickNoFlush(button)
        s.clickNoFlush(button)
        await s.settle(5)
        // Mid-flight the affordance HAS committed — `busy` is still worth setting, it is just not
        // the guard. Asserting it here is what stops a "fix" that deletes `busy` altogether.
        assert.match(s.text(), /Working…/, 'the busy affordance never rendered')
        await s.settle(60)
        assert.equal(box.runs, 1, once('the work', box.runs, 'One press is one run.'))
      })
    })

    it(`releases the latch when the work throws, so the control is not wedged (${mode})`, async () => {
      // The failure mode that gets a latch deleted rather than fixed: released after the `try`
      // instead of in `finally`, the first throw kills the button for the life of the page.
      const box = { runs: 0 }
      await withScreen(h(Probe, { box, throws: true, ms: 5 }), { url: ORIGIN, strict }, async (s) => {
        await s.click(s.byRole('button', 'Do the thing'))
        await s.settle(20)
        await s.click(s.byRole('button', 'Do the thing'))
        await s.settle(20)
        assert.equal(
          box.runs,
          2,
          `the second press did not run: the latch was not released after a throw, so one failed ` +
            `attempt wedges this control for the life of the page (${box.runs} run(s))`,
        )
      })
    })

    it(`the latch is the same one across a re-render mid-flight (${mode})`, async () => {
      // A latch written as `{ current: false }` inline instead of `useRef` passes every same-tick
      // proof above — both clicks come from ONE render's closure, so they share one box. It breaks
      // the moment a render lands between the two events, which `setBusy(true)` guarantees will
      // happen. So this fires again AFTER the busy render has committed, calling the handler the
      // way a form's Enter key does rather than through a control the affordance has disabled.
      const box = { runs: 0 }
      let fire: (() => void) | null = null
      const Reentrant = (): ReactElement => {
        const latch = useLatch()
        const [busy, setBusy] = useState(false)
        const run = () => {
          if (!latch.take()) return
          setBusy(true)
          box.runs += 1
          void new Promise((r) => setTimeout(r, 60)).finally(() => {
            latch.release()
            setBusy(false)
          })
        }
        fire = run
        return h(
          'div',
          null,
          h('button', { type: 'button', onClick: run }, 'Do the thing'),
          h('p', null, busy ? 'Working… and long enough to clear the floor.' : FLOOR),
        )
      }

      await withScreen(h(Reentrant), { url: ORIGIN, strict }, async (s) => {
        await s.click(s.byRole('button', 'Do the thing'))
        assert.match(s.text(), /Working…/, 'the first run had already finished, so this proves nothing')
        await s.settle(5)
        ;(fire as unknown as () => void)()
        await s.settle(120)
        assert.equal(
          box.runs,
          1,
          `a second run started while the first was still in flight (${box.runs} runs). The latch ` +
            `is not stable across renders — a fresh box per render is not a latch.`,
        )
      })
    })

    it(`releases busy when the work finishes, so the control is usable again (${mode})`, async () => {
      // `busy` is affordance rather than guard, which is not the same as saying it does not
      // matter: never clearing it leaves the control reading "Working…" and disabled for the life
      // of the page.
      const box = { runs: 0 }
      await withScreen(h(Probe, { box, ms: 20 }), { url: ORIGIN, strict }, async (s) => {
        await s.click(s.byRole('button', 'Do the thing'))
        await s.settle(80)
        assert.doesNotMatch(s.text(), /Working…/, 'busy never cleared: the control is stuck mid-flight')
        assert.equal(
          (s.byRole('button', 'Do the thing') as unknown as { disabled: boolean }).disabled,
          false,
          'the control is still disabled after the work finished',
        )
      })
    })
  })
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   THE REAL SCREENS. One press, one request — counted, in both modes.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/** A Send panel with one spendable holding and one of this account's own wallets. */
const sendPanel = () =>
  h(SendPanel, { holdings: [fx.holding()], wallets: [fx.wallet()], onSent: () => undefined })

/** Fill the form and press Review, so there is a Confirm step to press twice. */
async function arm(s: Screen, destination: string, amount: string): Promise<void> {
  await s.type(s.byRole('textbox', 'Destination address'), destination)
  await s.type(s.byRole('textbox', 'Amount'), amount)
  await s.click(s.byRole('button', 'Review'))
  assert.ok(s.text().includes('Confirm this payment'), 'Review did not arm the confirmation step')
}

for (const strict of [false, true]) {
  const mode = strict ? 'under StrictMode' : 'plain'

  describe(`one press is one request — ${mode}`, () => {
    /* ── Send: the keyed write, and the one BJ-WAL-09 drives in a real browser ───────────────── */

    it(`BJ-WAL-09: two synchronous Confirm clicks send ONE withdrawal (${mode})`, async () => {
      fresh()
      const path = 'POST /v1/withdrawals'
      await withScreen(
        sendPanel(),
        {
          url: `${ORIGIN}/wallet`,
          strict,
          routes: {
            // The service's real behaviour under one key: the first is created, a repeat replays.
            // A stub that answered both identically would still let the COUNT assertion below do
            // its job, but this is what wallet actually does and the scenario should say so.
            [path]: (_w, n) => ({
              status: n === 1 ? 201 : 200,
              body: { withdrawal: fx.withdrawal(), replayed: n > 1 },
              delayMs: 30,
            }),
          },
        },
        async (s) => {
          await arm(s, fx.OTHER_ADDRESS, '1')
          const send = s.byRole('button', 'Send it')
          // Both presses land before the first response, which is the hazard. Nothing is awaited
          // between them: awaiting would test a case a double click never produces.
          s.clickNoFlush(send)
          s.clickNoFlush(send)
          await s.settle(90)

          const sent = s.api.matching(path)
          assert.equal(
            sent.length,
            1,
            once(
              'a withdrawal',
              sent.length,
              'The key is what stops this being two payments; the guard is what stops it being ' +
                'two requests, and only one of those is this bundle’s job.',
            ),
          )
          // And the key half stays right, because the fix must not have been to drop it: one
          // intent, one key. That is what makes a genuine RETRY safe, and it is orthogonal.
          const key = sent[0]?.headers['idempotency-key']
          assert.ok(
            typeof key === 'string' && key.length >= 8,
            `the withdrawal carried no usable Idempotency-Key (${String(key)})`,
          )
        },
      )
    })

    /* ── Receive: no key, and `rotate` is a real second effect ───────────────────────────────── */

    it(`rotating a deposit address sends ONE request, not two (${mode})`, async () => {
      fresh()
      const path = 'POST /v1/deposits'
      await withScreen(
        h(ReceivePanel, { holdings: [fx.holding()] }),
        {
          url: `${ORIGIN}/wallet`,
          strict,
          confirm: true,
          routes: {
            [path]: (_w, n) => ({
              // A DIFFERENT address each time, which is what a second rotation really produces.
              body: { assignment: { ...depositAssignment, id: `dep-${n}`, address: `0xrotated${n}` } },
              delayMs: 30,
            }),
          },
        },
        async (s) => {
          const show = s.byRole('button', /deposit address/i)
          s.clickNoFlush(show)
          s.clickNoFlush(show)
          await s.settle(90)

          const sent = s.api.matching(path)
          assert.equal(
            sent.length,
            1,
            once(
              'a deposit-address request',
              sent.length,
              'With `rotate`, the second mints an address the first is retired in favour of — ' +
                'and the user may already have copied the first off the screen.',
            ),
          )
        },
      )
    })

    /* ── The export ceremony: no key, and the second request is a lie over a private key ─────── */

    it(`two presses of Start the export begin ONE ceremony (${mode})`, async () => {
      fresh()
      const path = 'POST /v1/exports'
      await withScreen(
        h(KeyExportPanel, { wallets: [fx.wallet()] }),
        {
          url: `${ORIGIN}/wallet`,
          strict,
          routes: {
            'GET /v1/exports': { body: { exports: [] } },
            [path]: { status: 201, body: { export: fx.keyExport() }, delayMs: 30 },
          },
        },
        async (s) => {
          const start = s.byRole('button', 'Start the export')
          s.clickNoFlush(start)
          s.clickNoFlush(start)
          await s.settle(90)

          const sent = s.api.matching(path)
          assert.equal(
            sent.length,
            1,
            once(
              'an export request',
              sent.length,
              'custody requires no key here and dedupes nothing, so two presses are two ' +
                '24-hour ceremonies, two emails, and two things to cancel.',
            ),
          )
        },
      )
    })

    /* ── The reveal: the sharpest one on the surface ─────────────────────────────────────────── */

    it(`two presses of Reveal my key redeem ONCE (${mode})`, async () => {
      fresh()
      const id = 'exp-0000-0000-0000-000000000001'
      const redeem = `POST /v1/exports/${id}/redeem`
      // The stage is driven by whether the challenge has actually been ANSWERED, not by a count of
      // `GET` calls: under `<StrictMode>` the panel's mount effect runs twice, so a call counter
      // would have the ceremony advance before anything was pressed.
      let challenged = false
      await withScreen(
        h(KeyExportPanel, { wallets: [fx.wallet()] }),
        {
          url: `${ORIGIN}/wallet`,
          strict,
          routes: {
            // The ceremony advances at the server: cooling_off until the challenge is answered,
            // challenged afterwards. One fixed body could not represent a ceremony moving at all.
            'GET /v1/exports': () => ({
              body: {
                exports: [
                  fx.keyExport({
                    id,
                    format: 'raw',
                    ...(challenged
                      ? {
                          status: 'challenged',
                          challengedAt: '2026-08-04T09:00:00.000Z',
                          tokenExpiresAt: '2026-08-04T09:10:00.000Z',
                        }
                      : { status: 'cooling_off', availableAt: '2026-08-03T08:00:00.000Z' }),
                  }),
                ],
              },
            }),
            [`POST /v1/exports/${id}/challenge`]: () => {
              challenged = true
              return {
                body: {
                  export: fx.keyExport({ id, status: 'challenged' }),
                  revealToken: 'reveal-token-abc',
                },
              }
            },
            // custody spends the token on the first redemption and the wallet moves to `exported`
            // in the same transaction, so a replay updates no row. The second is refused — and
            // under the defect it resolved LAST and painted its failure over the revealed key.
            [redeem]: (_w, n) =>
              n === 1
                ? { body: { export: fx.revealed() }, delayMs: 30 }
                : {
                    status: 409,
                    body: fx.errorBody('token_spent', 'That reveal token has already been used.'),
                    delayMs: 30,
                  },
          },
        },
        async (s) => {
          await s.click(s.byRole('button', 'Continue with my second factor'))
          await s.settle(40)
          const reveal = s.byRole('button', 'Reveal my key')
          s.clickNoFlush(reveal)
          s.clickNoFlush(reveal)
          await s.settle(90)

          const sent = s.api.matching(redeem)
          assert.equal(
            sent.length,
            1,
            once(
              'a redemption',
              sent.length,
              'The loser is refused "token spent" and resolves last, so the user is told the key ' +
                'could not be revealed — about the key that is on screen, which they get one ' +
                'chance to copy and which CloudsForge keeps no copy of.',
            ),
          )
          // And the reveal really happened, so this cannot pass by never getting that far.
          assert.match(s.text(), /KEYMATERIAL-a7f3c19e-NEVER-STORED/, 'the key was never revealed at all')
        },
      )
    })

    /* ── Registration: no key, and the second is refused by the account the first created ────── */

    it(`two presses of Create account register ONCE (${mode})`, async () => {
      fresh()
      const path = 'POST /auth/register'
      await withScreen(
        page(h(RegisterPage), '/account/register'),
        {
          url: `${ORIGIN}/account/register`,
          strict,
          routes: {
            // The service's real behaviour: the first creates the account, the second is refused
            // because the handle it asks for was just taken — by the first. A stub that answered
            // both 201 would let this scenario pass against a client that sent two.
            [path]: (_w, n) =>
              n === 1
                ? { status: 201, body: fx.session(), delayMs: 30 }
                : {
                    status: 409,
                    body: fx.errorBody('handle_taken', 'That registration was refused.', [
                      { field: 'handle', code: 'taken', message: 'That handle is already in use.' },
                    ]),
                    delayMs: 30,
                  },
          },
        },
        async (s) => {
          await s.type(s.byRole('textbox', 'Email'), 'newcomer@example.com')
          await s.type(s.byRole('textbox', 'Handle'), 'newcomer')
          await s.type(passwordField(s), 'a-long-passphrase')
          const create = s.byRole('button', 'Create account')
          s.clickNoFlush(create)
          s.clickNoFlush(create)
          await s.settle(90)

          const sent = s.api.matching(path)
          assert.equal(
            sent.length,
            1,
            once(
              'a registration',
              sent.length,
              'The loser is refused "handle taken" by the account the winner just created, and ' +
                'resolves last — so the user is told their handle is taken, on a form for the ' +
                'account they now have and are not signed in to.',
            ),
          )
        },
      )
    })

    /* ── Sign-in: two attempts spent against the account's own rate limit ────────────────────── */

    it(`two presses of Sign in send ONE credential attempt (${mode})`, async () => {
      fresh()
      const path = 'POST /auth/login'
      await withScreen(
        page(h(SignInPage), '/account/signin'),
        {
          url: `${ORIGIN}/account/signin`,
          strict,
          routes: {
            [path]: { status: 401, body: fx.errorBody('invalid_credentials', 'Those details did not match.'), delayMs: 30 },
          },
        },
        async (s) => {
          await s.type(s.byRole('textbox', /email|handle|identifier/i), 'someone@example.com')
          await s.type(passwordField(s), 'a-long-passphrase')
          const signIn = s.byRole('button', 'Sign in')
          s.clickNoFlush(signIn)
          s.clickNoFlush(signIn)
          await s.settle(90)

          const sent = s.api.matching(path)
          assert.equal(
            sent.length,
            1,
            once(
              'a sign-in',
              sent.length,
              'identity counts each against the account’s own rate limit, so a double tap locks ' +
                'the user out in half the presses they were given.',
            ),
          )
        },
      )
    })

    /* ── Sign out everywhere: the second request carries a credential the first revoked ──────── */

    it(`two presses of Sign out everywhere send ONE revocation (${mode})`, async () => {
      fresh()
      const path = 'DELETE /sessions'
      await withScreen(
        page(h(AuthProvider, null, h(SecurityPage)), '/security'),
        {
          url: `${ORIGIN}/security`,
          strict,
          storage: SIGNED_IN,
          routes: {
            'GET /auth/me': { body: { id: fx.USER_ID, handle: 'someone', email: 'someone@example.com' } },
            'GET /v1/dashboard': { body: fx.dashboard() },
            // TWO sessions: "Sign out everywhere" is only offered when there is more than one to
            // sign out of (`pages/security.tsx`, the SessionsPanel header).
            'GET /sessions': { body: { sessions: [identitySession('sess-1'), identitySession('sess-2')] } },
            // The first revokes this tab's own tokens, so a second sent afterwards is
            // unauthenticated. That is what makes the duplicate visible rather than merely wasteful.
            [path]: (_w, n) =>
              n === 1
                ? { body: { revoked: 3 }, delayMs: 30 }
                : { status: 401, body: fx.errorBody('unauthenticated', 'That session has ended.'), delayMs: 30 },
          },
        },
        async (s) => {
          const all = s.byRole('button', 'Sign out everywhere')
          s.clickNoFlush(all)
          s.clickNoFlush(all)
          await s.settle(90)

          const sent = s.api.matching(path)
          assert.equal(
            sent.length,
            1,
            once(
              'a global sign-out',
              sent.length,
              'The second is sent with the credential the first revoked, 401s, and lands in the ' +
                'catch — painting a failure over a sign-out that worked.',
            ),
          )
        },
      )
    })
  })
}

/* ── fixtures and helpers used above ─────────────────────────────────────────────────────────── */

/** A deposit assignment, shaped as `wallet/src/deposits.ts:76-91` serves one. */
const depositAssignment = {
  id: 'dep-1',
  assetCode: 'EMBER',
  chain: 'ember',
  network: 'testnet',
  walletId: 'wal-1',
  address: '0xdeadbeef00000000000000000000000000000001',
  status: 'active' as const,
  assignedAt: '2026-08-03T09:00:00.000Z',
  watchedAt: '2026-08-03T09:00:01.000Z',
}

/** One session, shaped as `identity/src/server.ts:1077-1080` serves them. */
const identitySession = (id: string) => ({
  id,
  userId: fx.USER_ID,
  deviceId: null,
  refreshFamilyId: `fam-${id}`,
  ipPrefix: '203.0.113.0/24',
  createdAt: '2026-08-01T09:00:00.000Z',
  lastActiveAt: '2026-08-03T09:00:00.000Z',
  revokedAt: null,
  revokeReason: null,
  userAgentFamily: 'Firefox',
  osFamily: 'Linux',
})

/**
 * The password control, by its `<label>`.
 *
 * Not `byRole('textbox')`: a password input has no `textbox` role, which is why the journey suite
 * carries the same helper. Kept local so this file stands on its own.
 */
function passwordField(s: Screen): Element {
  const found = [...s.document.querySelectorAll('label')].filter((l) =>
    (l.textContent ?? '').trim().toLowerCase().startsWith('password'),
  )
  assert.equal(found.length, 1, `expected exactly one <label> starting "Password", found ${found.length}`)
  const id = found[0]?.getAttribute('for')
  const control = id ? s.document.getElementById(id) : null
  assert.ok(control, 'the label "Password" points at no control')
  return control
}
