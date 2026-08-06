/**
 * The CloudsForge sign-in surface: sign in, register, sign out.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── WHY THE ESTATE'S SIGN-IN PAGE IS IN FORGE HUB ─────────────────────────────────────────────
 *
 * Because nothing else could serve it, and nothing was.
 *
 * Every SPA in the estate sends a signed-out visitor to `${accountUrl()}/login`
 * (`ui/packages/ui/src/index.tsx`). That resolved `account.<apex>` — a hostname **no repository in
 * the estate serves**. `micro-identity` binds the port behind it and renders no HTML at all: its
 * own header forbids it ("NO PRODUCT FEATURE LIVES HERE… no portal") and
 * `identity/src/server.test.ts` asserts that `/`, `/portal` and `/dashboard` 404. There is no
 * `account-web` among the 58 repositories. So the platform had no way in from a browser at all —
 * docs/ecosystem/22 §8.1, the largest blocker in the catalogue, blocking 86 of 318 scenarios.
 *
 * Forge Hub is the surface that can host it today: it is deployed, its nginx already serves
 * `/account/*`, and `hub.<apex>` is on the gateway's CORS allowlist
 * (`deploy/gateway/dynamic/policy.yml`) — which matters, because this page POSTs credentials to
 * `nimbus.<apex>` cross-origin and `account.<apex>` is not on that list. The registry
 * row `signin` in `@cloudsforge/ui` points here; the day a bundle is served at `account.<apex>`,
 * that row moves and these three components go with it.
 *
 * ── NOTHING ON THIS PAGE DECIDES ANYTHING ─────────────────────────────────────────────────────
 *
 * No password policy, no handle rules, no "is that an email", no attempt counter, no decision
 * about who may sign in. identity holds all of it and answers with a `fields` array naming what it
 * refused (`identity/src/server.ts`); this page renders those sentences beside those
 * inputs and keeps everything else the user typed. 14 §11 is explicit about why a client must not
 * hold the rule, and doc 22 §3.1 forbids a browser scenario from asserting one.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { useLatch } from '../lib/latch.ts'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError, clearTokens, getAccessToken, getRefreshToken, hasSession } from '../lib/api.ts'
import {
  EMAIL_UNVERIFIED_CODE,
  answerMfaChallenge,
  completeSignIn,
  readReturnTo,
  registerAccount,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  revokeRefreshToken,
  signInWithPassword,
  verifyEmail,
  type Completion,
  type SessionGranted,
  type SignInOutcome,
} from '../lib/identity.ts'
import { pageOrigin } from '../lib/hosts.ts'

/* ─────────────────────────────── shared pieces ─────────────────────────────── */

/** What the server refused, ready to render. Never anything this app decided. */
interface Refusal {
  readonly message: string
  readonly requestId: string | undefined
  /** field name → EVERY sentence the server sent for it, joined. */
  readonly byField: ReadonlyMap<string, string>
}

function refusalFrom(err: unknown): Refusal {
  if (err instanceof ApiError) {
    /*
     * GROUPED BY FIELD, NOT LAST-WINS.
     *
     * This was `new Map(err.fields.map(…))`, and a Map built from pairs keeps the LAST entry for a
     * repeated key. identity sends one entry PER FAILING RULE under ONE field name: `checkPassword`
     * pushes up to five, every one of them `field: 'newPassword'`
     * (`identity/node_modules/@cloudsforge/contracts-auth/src/index.ts` — too short, too
     * long, one character repeated, contains the handle, contains the email local part).
     *
     * So the old shape showed the reader the last rule they broke and silently dropped the rest.
     * They fix that one, submit, and are told about the next — one round trip per rule, from a
     * response that already listed all of them. It is worst on the reset form, where the answer to
     * a 400 costs the reader another mailed link.
     */
    const byField = new Map<string, string>()
    for (const field of err.fields) {
      const already = byField.get(field.field)
      byField.set(field.field, already ? `${already} ${field.message}` : field.message)
    }
    return { message: err.message, requestId: err.requestId, byField }
  }
  return {
    message:
      err instanceof Error && err.message !== ''
        ? err.message
        : 'That did not go through. Try again.',
    requestId: undefined,
    byField: new Map(),
  }
}

/**
 * The refusal banner.
 *
 * `role="alert"` so a screen reader hears it without moving focus, and the request id is on its
 * own line in the monospace token because it is going to be read down a phone line. 05:91 makes
 * form-state preservation the requirement on a rejected submit: nothing here clears an input.
 */
function RefusalNotice({ refusal }: { refusal: Refusal }) {
  return (
    <p className="wt-formerror" role="alert">
      {refusal.message}
      {refusal.requestId && (
        <>
          {' '}
          Quote <code className="cf-num wt-reqid">{refusal.requestId}</code> to support.
        </>
      )}
    </p>
  )
}

/** One labelled control, with the server's sentence for it when there is one. */
function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string | undefined
  error?: string | undefined
  children: (props: {
    id: string
    'aria-invalid'?: 'true'
    'aria-describedby': string
  }) => ReactElement
}) {
  const describedBy = error ? `${id}-error` : `${id}-hint`
  return (
    <div className="wt-field">
      <label className="wt-field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, ...(error ? { 'aria-invalid': 'true' as const } : {}), 'aria-describedby': describedBy })}
      {error ? (
        <p className="wt-field__error" id={`${id}-error`}>
          {error}
        </p>
      ) : (
        <p className="wt-field__hint" id={`${id}-hint`}>
          {hint ?? ''}
        </p>
      )}
    </div>
  )
}

/**
 * Where to go back to after signing in, and its safety.
 *
 * `?return=` is attacker-controllable — it is a query parameter on a public page — so it is never
 * trusted here. A same-origin address becomes an in-app navigation; anything else needs a hand-off
 * code, and identity refuses to mint one for an origin off its allowlist. See `completeSignIn`.
 */
function useReturnTo(): string {
  const [params] = useSearchParams()
  const raw = params.get('return') ?? ''
  const parsed = readReturnTo(raw)
  return parsed ? parsed.toString() : `${pageOrigin()}/`
}

/**
 * Act on a completed sign-in.
 *
 * A FULL NAVIGATION IN BOTH CASES, including back into this same bundle. A router `navigate()`
 * would leave the running `AuthProvider` holding the status it computed at boot — `anonymous`,
 * because there was no session then — so the very next protected route would bounce the user
 * straight back to this page. One code path also means a same-origin sign-in and an SSO bounce
 * arrive at the destination in exactly the same state: a cold boot that reads its tokens from
 * storage, which is the only path the rest of the app has ever been written against.
 */
function useCompletion(): (completion: Completion) => void {
  return useCallback((completion: Completion) => {
    if (completion.kind === 'here') window.location.assign(`${pageOrigin()}${completion.path}`)
    else if (completion.kind === 'handoff') window.location.assign(completion.url)
  }, [])
}

/* ─────────────────────────────── sign in ─────────────────────────────── */

type Stage =
  | { readonly at: 'password' }
  | { readonly at: 'mfa'; readonly challenge: string; readonly factors: readonly { kind: string }[] }
  | { readonly at: 'handing-off'; readonly to: string }

export function SignInPage() {
  const returnTo = useReturnTo()
  const complete = useCompletion()

  const [stage, setStage] = useState<Stage>({ at: 'password' })
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  /**
   * The password was right and the address has not been proved yet.
   *
   * Kept as its own state rather than folded into `refusal`, because it is the one refusal on this
   * form with an ACTION attached — and the action is only offerable to someone who has just
   * presented the correct credential for that account, which is what keeps the resend from being
   * an enumeration oracle. `null` means it has not happened; `'sent'` means one has been issued.
   */
  const [unverified, setUnverified] = useState<null | 'offer' | 'sent'>(null)

  const finish = useCallback(
    async (outcome: SignInOutcome) => {
      if (outcome.kind === 'mfa') {
        setStage({ at: 'mfa', challenge: outcome.challenge, factors: outcome.factors })
        setBusy(false)
        return
      }
      setStage({ at: 'handing-off', to: returnTo })
      const completion = await completeSignIn(outcome, returnTo, pageOrigin())
      if (completion.kind === 'refused') {
        // Not silently redirected to the dashboard. identity would not hand a session to that
        // origin, which is a misconfiguration somebody has to see rather than a place to bounce
        // the user away from.
        setRefused(completion.origin)
        setStage({ at: 'password' })
        setBusy(false)
        return
      }
      complete(completion)
    },
    [complete, returnTo],
  )

  /*
   * ── ONE ACCOUNT SIGNS INTO EVERYTHING, ONCE ──────────────────────────────────────────────────
   *
   * A session already held here is a session; asking for the password again would make the SSO
   * hand-off worse than no SSO at all. So a signed-in visitor arriving from another surface is
   * handed straight over — vision test 1, BJ-ACC-04: "no second credential prompt on either hop".
   *
   * It runs once, guarded by a ref rather than by the effect's dependency list, because
   * StrictMode mounts every effect twice and a second run would spend a second hand-off code.
   */
  const handedOff = useRef(false)
  useEffect(() => {
    if (handedOff.current) return
    const accessToken = getAccessToken()
    const refreshToken = getRefreshToken()
    if (!hasSession() || !accessToken || !refreshToken) return
    handedOff.current = true
    const granted: SessionGranted = {
      kind: 'session',
      accessToken,
      refreshToken,
      expiresIn: 0,
      user: { id: '', handle: '', email: '' },
    }
    setStage({ at: 'handing-off', to: returnTo })
    void finish(granted)
  }, [finish, returnTo])

  /**
   * One credential attempt per press, on both steps of this form.
   *
   * Neither handler had a synchronous guard — only `disabled={busy}`, which is not on the DOM node
   * until the render commits and so cannot see a second event dispatched before that. Two Enter
   * presses on the password field sent two `POST /auth/login`, which identity counts against the
   * account's own rate limit: a user who double-taps Sign in spends two of their attempts on one
   * intention and is locked out twice as fast.
   *
   * On the MFA step it is worse and not merely wasteful. identity spends the challenge whether or
   * not the code was right — "a challenge that survives a wrong code is an unlimited offline-speed
   * oracle against a six-digit secret" — so of two same-tick answers the first consumes the
   * challenge and the second is refused. The refusal resolves last, so a user who entered the
   * RIGHT code is sent back to the password step and told their code was rejected.
   */
  const attempt = useLatch()

  const submitPassword = (event: FormEvent) => {
    event.preventDefault()
    if (!attempt.take()) return
    setBusy(true)
    setRefusal(null)
    setRefused(null)
    setUnverified(null)
    signInWithPassword(identifier, password)
      .then(finish)
      .catch((err: unknown) => {
        // The password is cleared and the identifier is NOT. Retyping an email address after a
        // typo in a password is the friction that makes people paste credentials from somewhere
        // less safe; the password field is cleared because a wrong one is not worth editing.
        setPassword('')
        setRefusal(refusalFrom(err))
        // The one refusal with an action. Offered only here, after the correct password: a resend
        // reachable without one would answer differently for a real and an invented address.
        if (err instanceof ApiError && err.code === EMAIL_UNVERIFIED_CODE) setUnverified('offer')
        setBusy(false)
      })
      // In a `finally`, so a refused sign-in leaves the form usable. Released only after `finish`
      // has resolved: it is `finish` that performs the hand-off, and a latch dropped before then
      // would let a second press start a second hand-off for one sign-in.
      .finally(() => attempt.release())
  }

  const submitMfa = (event: FormEvent) => {
    event.preventDefault()
    if (stage.at !== 'mfa') return
    if (!attempt.take()) return
    setBusy(true)
    setRefusal(null)
    answerMfaChallenge(stage.challenge, code)
      .then(finish)
      .catch((err: unknown) => {
        // identity spends the challenge whether or not the code was right — "a challenge that
        // survives a wrong code is an unlimited offline-speed oracle against a six-digit secret"
        // — so there is nothing to retry here and the user goes back to the password step. Saying
        // so is the difference between a dead form and an understood one.
        setCode('')
        setStage({ at: 'password' })
        setRefusal(refusalFrom(err))
        setBusy(false)
      })
      .finally(() => attempt.release())
  }

  if (stage.at === 'handing-off') {
    return (
      <AccountFrame title="Signing you in">
        <div className="wt-state wt-state--loading" role="status" aria-live="polite">
          <span className="wt-spinner" aria-hidden="true" />
          <p className="wt-state__title">Taking you back to {new URL(stage.to).host}</p>
        </div>
      </AccountFrame>
    )
  }

  if (stage.at === 'mfa') {
    return (
      <AccountFrame title="One more step">
        <form className="wt-form" onSubmit={submitMfa} noValidate>
          <p className="wt-note">
            Your password was accepted. Enter the code from your{' '}
            {stage.factors[0]?.kind === 'totp' ? 'authenticator app' : 'second factor'}, or one of
            your recovery codes.
          </p>
          {refusal && <RefusalNotice refusal={refusal} />}
          <Field id="mfa-code" label="Code" hint="Six digits, or a recovery code.">
            {(props) => (
              <input
                {...props}
                className="cf-input cf-input--mono"
                type="text"
                name="code"
                value={code}
                autoComplete="one-time-code"
                inputMode="text"
                autoFocus
                required
                onChange={(event) => setCode(event.target.value)}
              />
            )}
          </Field>
          <div className="wt-form__actions">
            <button type="submit" className="cf-btn cf-btn--ember" disabled={busy}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </div>
        </form>
      </AccountFrame>
    )
  }

  return (
    <AccountFrame title="Sign in to CloudsForge">
      <form className="wt-form" onSubmit={submitPassword} noValidate>
        {refused && (
          <p className="wt-formerror" role="alert">
            You are signed in, but CloudsForge will not hand a session to{' '}
            <code className="cf-num">{refused}</code>. Sign in on that surface directly, or ask an
            operator to add it to the hand-off allowlist.
          </p>
        )}
        {refusal && <RefusalNotice refusal={refusal} />}

        {/*
          identity has said this account exists, the password is right, and the address is not
          proved. Nothing here decides that — the code comes off identity's own error envelope
          (`EMAIL_UNVERIFIED_CODE`) and the sentence above it is identity's.

          The resend is fired and NOT awaited into a success claim: identity answers 202 with one
          fixed string for every input, so there is no outcome to report and pretending otherwise
          would put a claim on screen that the response does not support. The failure is swallowed
          for the same reason — a 202 that did not arrive tells the user nothing they can act on
          that "check your spam folder" does not already cover.
        */}
        {unverified !== null && (
          <p className="wt-note" role="status" aria-live="polite">
            {unverified === 'sent' ? (
              <>If that account is waiting to be confirmed, another link is on its way. It works once and expires in 24 hours.</>
            ) : (
              <>
                <button
                  type="button"
                  className="wt-link"
                  onClick={() => {
                    setUnverified('sent')
                    void resendVerification(identifier).catch(() => undefined)
                  }}
                >
                  Send the confirmation link again
                </button>
              </>
            )}
          </p>
        )}

        <Field
          id="identifier"
          label="Email or handle"
          hint="Either works."
          error={refusal?.byField.get('identifier')}
        >
          {(props) => (
            <input
              {...props}
              className="cf-input"
              type="text"
              name="identifier"
              value={identifier}
              autoComplete="username"
              autoFocus
              required
              onChange={(event) => setIdentifier(event.target.value)}
            />
          )}
        </Field>

        <Field id="password" label="Password" error={refusal?.byField.get('password')}>
          {(props) => (
            <input
              {...props}
              className="cf-input"
              type="password"
              name="password"
              value={password}
              autoComplete="current-password"
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>

        <div className="wt-form__actions">
          <button type="submit" className="cf-btn cf-btn--ember" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <Link className="wt-link" to={`/account/register?return=${encodeURIComponent(returnTo)}`}>
            Create an account
          </Link>
          {/*
            The only route to a reset, and it is HERE rather than on a page a stranger can reach
            from nowhere. Not for secrecy — `/account/forgot` is a public address and has to be —
            but because this is where the reader already is when they discover they cannot get in.
            A sign-in form whose refusal offers no way out is the screen people abandon accounts on;
            doc 22 §8.1 counts the sign-in surface's dead ends among the estate's largest blockers.
          */}
          <Link className="wt-link" to={`/account/forgot?return=${encodeURIComponent(returnTo)}`}>
            Forgot your password?
          </Link>
        </div>
      </form>
    </AccountFrame>
  )
}

/* ─────────────────────────────── register ─────────────────────────────── */

export function RegisterPage() {
  const returnTo = useReturnTo()
  const complete = useCompletion()

  const [email, setEmail] = useState('')
  const [handle, setHandle] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  /**
   * Set when the two password fields disagreed on the last press of Create account, cleared the
   * moment either is edited. It is not computed live from `password !== confirmation`, because
   * that reads "those do not match" at every keystroke of a field somebody has only started
   * typing — an error before the user has finished making the mistake.
   */
  const [mismatched, setMismatched] = useState(false)
  /** The address identity says it sent the link to, once it has. Never a token. */
  const [sent, setSent] = useState<string | null>(null)

  /**
   * `POST /auth/register` carries no idempotency key, and this is the sharpest handler on the
   * surface for it.
   *
   * With only `disabled={busy}` in the way, two same-tick presses of Create account sent two
   * registrations for one person. The first creates the account; the second is refused because
   * the handle and the email are now taken — by the account that was just made for them — and it
   * resolves last, so what the user is left looking at is "that handle is already in use" on a
   * form for an account that exists and that they are not signed in to. They then pick a
   * different handle, and the estate has two accounts for one person, or the user concludes
   * registration is broken and leaves.
   */
  const attempt = useLatch()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    /*
     * ── THE ONE RULE THIS PAGE IS ALLOWED TO HOLD ────────────────────────────────────────────
     *
     * The header of this file says nothing here decides anything, and that stands. This is not an
     * exception to it: a confirmation is the one check identity CANNOT make, because identity is
     * sent one password and a mismatch has no representation in the request at all. There is no
     * server rule for this to be stricter or looser than, so it cannot teach the user a lie and
     * cannot drift.
     *
     * ── AND WHY THERE IS STILL NO STRENGTH RULE HERE ─────────────────────────────────────────
     *
     * The policy is `checkPassword` in `@cloudsforge/contracts-auth`
     * (`identity/node_modules/@cloudsforge/contracts-auth/src/index.ts`): at least
     * `PASSWORD_MIN_LENGTH` = 8 code points, at most 128, not one character repeated, and not
     * containing the handle or the email local part. The last two are CONTEXTUAL — they depend on
     * the other two fields and on `normaliseEmail` — so a copy here would be a second
     * implementation of a rule with inputs, which is the drift this file was written to avoid.
     * This bundle does not depend on that package, so importing the real function is not
     * available either. identity answers a weak password with a `fields` entry and the sentence
     * appears under this control (`error={refusal?.byField.get('password')}`), which costs one
     * round trip and is never wrong.
     *
     * The submit is refused BEFORE the latch is taken, so a mismatch spends neither an attempt nor
     * a registration — `POST /auth/register` carries no idempotency key.
     */
    if (password !== confirmation) {
      setMismatched(true)
      setRefusal(null)
      return
    }
    if (!attempt.take()) return
    setBusy(true)
    setRefusal(null)
    registerAccount({ email, handle, password })
      .then(async (outcome) => {
        // THE ORDINARY OUTCOME IS NOW "GO AND READ YOUR EMAIL", NOT A SESSION. The account exists
        // and is unverified; the link in the mail is what creates the session, on whichever
        // browser opens it — which is usually a phone, and is why nothing here waits for this tab.
        if (outcome.kind === 'verify-email') {
          setSent(outcome.email || email.trim())
          setBusy(false)
          return
        }
        // A deployment of identity that predates verification still answers with tokens. Honouring
        // that is not a fall-back for a broken server: the client half of a rolling deploy ships
        // first, and a bundle that refused this answer would break a registration that succeeded.
        if (outcome.kind !== 'session') throw new Error('This account needs a second factor to finish signing in.')
        const completion = await completeSignIn(outcome, returnTo, pageOrigin())
        if (completion.kind === 'refused') {
          throw new Error(`CloudsForge will not hand a session to ${completion.origin}.`)
        }
        complete(completion)
      })
      .catch((err: unknown) => {
        // EVERY FIELD KEEPS ITS VALUE. 05:91 makes that the requirement, and a form that clears on
        // a taken handle is the failure BJ-ACC-02 exists to catch: the user retypes an address and
        // a password they had right, to fix one word.
        setRefusal(refusalFrom(err))
        setBusy(false)
      })
      .finally(() => attempt.release())
  }

  /*
   * The account exists and the link is in the post.
   *
   * THIS SCREEN DOES NOT WAIT AND DOES NOT POLL. The link creates the session in whichever browser
   * opens it, and that is usually a phone — so a tab that sat here spinning would be waiting for
   * something that is not going to happen to it. Saying so plainly is the whole screen.
   *
   * The address is echoed because the commonest reason a verification mail "never arrives" is a
   * typo in it, and a person cannot check a value they can no longer see.
   */
  if (sent !== null) {
    return (
      <AccountFrame title="Check your email">
        <div className="wt-state" role="status" aria-live="polite">
          <p className="wt-state__title">
            Your account is created. We have sent a link to <strong>{sent}</strong>.
          </p>
          <p className="wt-note">
            Open it and you will be signed in — on whichever device you open it on. The link works
            once and expires in 24 hours. You can close this page.
          </p>
          <p className="wt-note">
            Nothing arrived? Check the spelling above and your spam folder, then{' '}
            <Link className="wt-link" to={`/account/login?return=${encodeURIComponent(returnTo)}`}>
              sign in
            </Link>{' '}
            to have another one sent.
          </p>
        </div>
      </AccountFrame>
    )
  }

  return (
    <AccountFrame title="Create a CloudsForge account">
      <form className="wt-form" onSubmit={submit} noValidate>
        {refusal && <RefusalNotice refusal={refusal} />}

        <Field
          id="email"
          label="Email"
          hint="Used for sign-in and for security notifications."
          error={refusal?.byField.get('email')}
        >
          {(props) => (
            <input
              {...props}
              className="cf-input"
              type="email"
              name="email"
              value={email}
              autoComplete="email"
              autoFocus
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>

        <Field
          id="handle"
          label="Handle"
          hint="How you appear across CloudsForge."
          error={refusal?.byField.get('handle')}
        >
          {(props) => (
            <input
              {...props}
              className="cf-input"
              type="text"
              name="handle"
              value={handle}
              autoComplete="username"
              required
              onChange={(event) => setHandle(event.target.value)}
            />
          )}
        </Field>

        {/*
          No strength meter and no inline rules. The policy lives in `@cloudsforge/contracts-auth`
          and is applied by identity; a copy here would be a second policy that drifts, and a
          browser test of the copy would pass while the real one disagreed. See `submit` for the
          rules identity actually applies and why none of them is restated here.
        */}
        <Field
          id="new-password"
          label="Password"
          hint="At least 8 characters. CloudsForge will tell you if it is not strong enough."
          error={refusal?.byField.get('password')}
        >
          {(props) => (
            <input
              {...props}
              className="cf-input"
              type="password"
              name="password"
              value={password}
              autoComplete="new-password"
              required
              onChange={(event) => {
                setPassword(event.target.value)
                setMismatched(false)
              }}
            />
          )}
        </Field>

        {/*
          The confirmation. A second field rather than a strength meter, because a mistyped
          password is the failure this form actually has: the account is created, the user is
          signed in by the registration itself, and the credential they think they chose is not
          the one stored — so they discover it at the next sign-in, on a different machine, with
          no way to prove the account is theirs.

          `name="confirmPassword"` is on the control for the browser's sake and NOT sent: the
          request body is built from `{ email, handle, password }` in `submit`, so the second copy
          of the password never leaves this page. `autoComplete="new-password"` on both fields is
          what makes a password manager offer to fill the pair rather than treat this one as a
          sign-in.
        */}
        <Field
          id="confirm-password"
          label="Confirm password"
          hint="Type it again, so a slip is caught here rather than at your next sign-in."
          error={mismatched ? 'Those two passwords are not the same.' : undefined}
        >
          {(props) => (
            <input
              {...props}
              className="cf-input"
              type="password"
              name="confirmPassword"
              value={confirmation}
              autoComplete="new-password"
              required
              onChange={(event) => {
                setConfirmation(event.target.value)
                setMismatched(false)
              }}
            />
          )}
        </Field>

        <div className="wt-form__actions">
          <button type="submit" className="cf-btn cf-btn--ember" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
          <Link className="wt-link" to={`/account/login?return=${encodeURIComponent(returnTo)}`}>
            I already have an account
          </Link>
        </div>
      </form>
    </AccountFrame>
  )
}

/* ─────────────────────────────── verify ─────────────────────────────── */

/**
 * The page the verification link lands on.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE TOKEN IS IN THE FRAGMENT, AND EVERY PART OF THAT IS DELIBERATE ────────────────────────
 *
 * The link is `https://hub.<apex>/account/verify#token=…`, never `?token=`. A link that both
 * verifies and authenticates is a bearer credential in a URL, and URLs leak in ways passwords do
 * not — browser history, `Referer` on any outbound link from this page, mail scanners, screen
 * shares. Three defences, and they cover different things:
 *
 *   1. **A fragment is not sent to a server.** It is not in the request line, so the token reaches
 *      no access log, no reverse proxy and no `Referer`. `identity/src/passwordReset.ts`
 *      records what the alternative cost: Nimbus used `?token=`, its own request log wrote the live
 *      credential to stdout on the request that spent it, and Lantern lifted it into an indexed
 *      column and every backup.
 *   2. **A mail scanner that pre-fetches the link consumes nothing.** This is the one that decides
 *      the shape. Corporate mail security opens every link in every message; with the token in the
 *      query string, a single-use credential is spent before the human sees it, and the user meets
 *      a dead link they never clicked. Because the fragment is never transmitted, the pre-fetch is
 *      `GET /account/verify` with no token at all — it loads this bundle, which does nothing.
 *      Switching the verb to POST would not have helped: the token would still have been in the
 *      URL the scanner fetched.
 *   3. **The mutation is a POST.** `verifyEmail` posts the token that only this page can see. No
 *      link-follower issues a POST, and there is no GET route in identity that spends a token.
 *
 * The hash is stripped with `replaceState` BEFORE the request goes out, not after it resolves —
 * the same ordering, for the same reasons, as `consumeAuthCallback` in `@cloudsforge/ui`: a code
 * left in the address bar during a round trip is in the history, in the referrer of anything the
 * page loads next, and in any screenshot taken while the request is in flight. And an "after"
 * version never strips it at all when the request throws.
 *
 * ── IT RUNS ONCE, AND THE REF IS WHY ──────────────────────────────────────────────────────────
 *
 * `main.tsx` mounts under StrictMode, which runs every effect twice. A second run would spend a
 * second token — except there is no second token, so it would present the one already consumed and
 * report a working link as expired. Guarded by a ref rather than by the dependency list, exactly
 * as `SignInPage`'s hand-off is.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
type VerifyStage =
  | { readonly at: 'working' }
  | { readonly at: 'no-token' }
  | { readonly at: 'failed'; readonly refusal: Refusal }

export function VerifyEmailPage() {
  const returnTo = useReturnTo()
  const complete = useCompletion()
  const [stage, setStage] = useState<VerifyStage>({ at: 'working' })
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const raw = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash
    const token = new URLSearchParams(raw).get('token')
    if (!token) {
      // Which is also what a mail scanner's pre-fetch produces, and what it must produce: a page
      // that says how to get a link, having spent nothing.
      setStage({ at: 'no-token' })
      return
    }

    // Strip first, then spend. The token is already captured in a local.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)

    verifyEmail(token)
      .then(async (outcome) => {
        if (outcome.kind !== 'session') {
          throw new Error('This account needs a second factor to finish signing in.')
        }
        const completion = await completeSignIn(outcome, returnTo, pageOrigin())
        if (completion.kind === 'refused') {
          throw new Error(`CloudsForge will not hand a session to ${completion.origin}.`)
        }
        complete(completion)
      })
      .catch((err: unknown) => setStage({ at: 'failed', refusal: refusalFrom(err) }))
  }, [complete, returnTo])

  if (stage.at === 'working') {
    return (
      <AccountFrame title="Confirming your email">
        <div className="wt-state wt-state--loading" role="status" aria-live="polite">
          <span className="wt-spinner" aria-hidden="true" />
          <p className="wt-state__title">Signing you in</p>
        </div>
      </AccountFrame>
    )
  }

  return (
    <AccountFrame title="That link did not work">
      <div className="wt-state" role="status">
        {stage.at === 'no-token' ? (
          <p className="wt-state__title">
            This address needs the link from your email. Open the message and follow the link in it
            rather than copying the address out of it — the part that matters is after the #, and
            some mail clients drop it.
          </p>
        ) : (
          <RefusalNotice refusal={stage.refusal} />
        )}
        {/*
          Sending another one is a step on the SIGN-IN page and not a button here, and that is not
          laziness. Issuing a link from this page would need an address typed into a public form
          that answers differently for a known and an unknown one — an enumeration oracle, in the
          one place a fresh visitor is most likely to be probed. Sign-in already has the identifier
          and already answers identically either way.
        */}
        <p className="wt-note">
          <Link className="wt-link" to={`/account/login?return=${encodeURIComponent(returnTo)}`}>
            Sign in
          </Link>{' '}
          to have another link sent. A link works once and expires 24 hours after it is issued.
        </p>
      </div>
    </AccountFrame>
  )
}

/* ─────────────────────────────── forgot ─────────────────────────────── */

/**
 * The sentence shown when identity answered without a readable `status`.
 *
 * It exists so that a proxy's empty 202, or a body this bundle could not parse, still ends on the
 * SAME screen a normal answer ends on — the shape of this page must not depend on anything, because
 * the moment it does the difference is a signal, and a signal about a mailbox is what
 * `POST /auth/password/forgot` was written to have none of.
 *
 * It deliberately restates NO POLICY FIGURE. identity's own sentence carries "30 minutes" and
 * "works once" (`identity/src/passwordReset.ts`); a second copy of those numbers here is a copy
 * that goes stale the day the expiry changes, and it would be showing a reader a lifetime nothing
 * had promised them.
 */
const RESET_REQUEST_RECORDED = 'If that account exists, a reset is on its way.'

/**
 * The form that asks identity for a reset link.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THIS FORM HAS ONE OUTCOME, AND IT IS THE SAME ONE EVERY TIME ──────────────────────────────
 *
 * `POST /auth/password/forgot` answers 202 with one fixed body for a known address, an unknown one
 * and a string that is not an address at all (`identity/src/server.ts`). identity pays
 * real money for that: the delivery runs in `after`, once the response is on the wire, because
 * awaiting it made the response TIME say what the status and the body were so carefully written not
 * to — 10ms for an unknown address against 6015ms for a known one, measured.
 *
 * A UI that branched would hand all of that back. So:
 *
 *   - there is no success/failure distinction on this screen, because there is none in the answer;
 *   - the address is NOT validated here. A client-side "that is not an email" would answer
 *     instantly for a malformed address and after a round trip for a well-formed one, which is a
 *     timing oracle this page would have built for itself, in the browser, where it is easiest to
 *     measure. `type="email"` is on the control as a keyboard hint, and `noValidate` on the form is
 *     what stops the browser turning it into a gate;
 *   - identity's own sentence is rendered, not one written here. This page makes no claim about
 *     whether anything was sent, because it cannot know and must not appear to.
 *
 * ── THE ONE BRANCH, AND WHY IT CANNOT BE AN ORACLE ────────────────────────────────────────────
 *
 * `ApiError.status === 0` is `lib/api.ts`: `fetch` itself threw, so the request reached no
 * server at all. Nothing that never arrived can depend on the address in it, so reporting it leaks
 * nothing — and the alternative is worse than a leak: telling a reader with no connection to go and
 * check their email is a claim about an action that did not happen, and they would wait for a mail
 * nobody was ever asked to send. Every answered response, including a 429 and a 500, ends on the
 * confirmation, because those are facts about the service and the reader can act on none of them.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
function ForgotPasswordForm({ signInHref }: { signInHref: string }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  /** identity's own sentence, once it has answered. `null` means it has not been asked yet. */
  const [status, setStatus] = useState<string | null>(null)
  /** The request never left. See the header: the one failure that cannot be about the address. */
  const [unreachable, setUnreachable] = useState<Refusal | null>(null)

  /**
   * `POST /auth/password/forgot` carries no idempotency key and costs an email.
   *
   * identity rate-limits it at 5 (`identity/src/server.ts`) precisely because "it costs an
   * email, and an uncapped one is a mailbox somebody else has to read". Two same-tick presses of
   * one button spend two of a reader's five on one intention — and `disabled={busy}` cannot stop
   * them, because the attribute is not on the node until the render commits and the second event
   * was dispatched before it was.
   */
  const attempt = useLatch()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!attempt.take()) return
    setBusy(true)
    setUnreachable(null)
    requestPasswordReset(email)
      .then((sentence) => setStatus(sentence || RESET_REQUEST_RECORDED))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 0) {
          setUnreachable(refusalFrom(err))
          return
        }
        setStatus(RESET_REQUEST_RECORDED)
      })
      .finally(() => {
        setBusy(false)
        attempt.release()
      })
  }

  if (status !== null) {
    return (
      <div className="wt-state" role="status" aria-live="polite">
        <p className="wt-state__title">{status}</p>
        {/*
          The address is echoed, and the sentence around it is chosen with care. Registration says
          "we have sent a link to X" because there the account definitely exists; here that phrasing
          would be a claim identity refused to make. "You asked about X" is a statement about what
          the READER typed — it depends on nothing the server knows — and it is worth showing
          because a typo is the commonest reason a reset "never arrives" and nobody can check a
          value they can no longer see.
        */}
        <p className="wt-note">
          You asked about <strong>{email.trim()}</strong>. Check that spelling and your spam folder.
          This page cannot tell you whether that address has an account, and that is deliberate —
          the answer would be the same for anyone else who typed it in.
        </p>
        <p className="wt-note">
          Open the link on any device; it lands on a page that asks for a new password. Then{' '}
          <Link className="wt-link" to={signInHref}>
            sign in
          </Link>{' '}
          with it.
        </p>
      </div>
    )
  }

  return (
    <form className="wt-form" onSubmit={submit} noValidate>
      {unreachable && <RefusalNotice refusal={unreachable} />}
      <Field
        id="forgot-email"
        label="Email"
        hint="The address on the account. Nothing else is needed."
      >
        {(props) => (
          <input
            {...props}
            className="cf-input"
            type="email"
            name="email"
            value={email}
            autoComplete="email"
            autoFocus
            required
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
      </Field>
      <div className="wt-form__actions">
        <button type="submit" className="cf-btn cf-btn--ember" disabled={busy}>
          {busy ? 'Sending…' : 'Send a reset link'}
        </button>
        <Link className="wt-link" to={signInHref}>
          Back to sign in
        </Link>
      </div>
    </form>
  )
}

/**
 * `/account/forgot` — where the sign-in page's "Forgot your password?" goes.
 *
 * Public by definition, and declared so in `lib/routes.ts`: a reader who cannot sign in cannot be
 * asked to sign in first. The whole of the interesting reasoning is on `ForgotPasswordForm`, which
 * the dead-end states of `ResetPasswordPage` render too — one form, so there is one behaviour to
 * get right rather than two that drift.
 */
export function ForgotPasswordPage() {
  const returnTo = useReturnTo()
  return (
    <AccountFrame title="Reset your password">
      <ForgotPasswordForm signInHref={`/account/login?return=${encodeURIComponent(returnTo)}`} />
    </AccountFrame>
  )
}

/* ─────────────────────────────── reset ─────────────────────────────── */

/**
 * The page the reset link lands on: `https://hub.<apex>/account/reset#token=<64 hex>`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE TOKEN IS IN THE FRAGMENT, AND HERE IT IS A PASSWORD-EQUIVALENT ────────────────────────
 *
 * Everything in `VerifyEmailPage`'s header applies, and applies harder: this token does not merely
 * prove an address, it CHANGES THE CREDENTIAL and revokes every session on the account. The three
 * defences are the same three —
 *
 *   1. **A fragment is not sent to a server.** It is not in the request line, so it reaches no
 *      access log, no reverse proxy and no `Referer`. `identity/src/passwordReset.ts` is the
 *      incident: Nimbus used `?token=`, its own request log wrote the live credential to stdout on
 *      the request that spent it, and Lantern lifted it into an indexed column and every backup.
 *   2. **A mail scanner's pre-fetch consumes nothing.** Corporate mail security opens every link in
 *      every message. Because the fragment is never transmitted, that pre-fetch is
 *      `GET /account/reset` with no token at all: it loads this bundle, which posts nothing and
 *      renders the "ask for another link" screen. With the token in the query string it would spend
 *      a single-use credential before the human ever saw the message.
 *   3. **The mutation is a POST**, which no link-follower issues.
 *
 * ── AND FOUR RULES ABOUT WHERE THE TOKEN MAY EXIST IN THIS PAGE ───────────────────────────────
 *
 * It lives in a `useRef` and goes into one request body. It is NEVER:
 *
 *   - **in the DOM.** Not as text, not as a hidden input, not as an attribute. A hidden input is the
 *     obvious way to carry a value from a link to a submit and it is the wrong one: the value is in
 *     the page source, in "view source", in a copied selection, in an accessibility tree and in
 *     whatever a browser extension reads. A ref is visible to this component and to nothing else.
 *   - **in a query string.** Not on this address, not on the one it navigates to afterwards.
 *   - **in a log line.** No `report()` on this path carries it, and `refusalFrom` never sees it.
 *   - **in a rendered error.** Every sentence on this screen is identity's own or is written here;
 *     none of them interpolates the token, which is why a failure cannot put it back on screen.
 *
 * The hash is stripped with `replaceState` BEFORE anything else happens, the token having been
 * captured in a local first — the same ordering as `VerifyEmailPage` and `consumeAuthCallback`. It
 * matters more here, because this page then WAITS for a human to type two passwords: an "after the
 * request resolves" version would leave a credential in the address bar for as long as somebody
 * takes to choose a password, in the history, in the referrer of anything the page loads next, and
 * in any screenshot or screen share taken meanwhile.
 *
 * ── IT RUNS ONCE, AND THE REF IS WHY ──────────────────────────────────────────────────────────
 *
 * `main.tsx` mounts under StrictMode, which runs every effect twice. The second run would read a
 * hash the first one has already stripped, find nothing, and replace a working form with "this link
 * was incomplete" — a working link reported as broken, on a page whose whole job is to work once.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
type ResetStage =
  /** Before the effect has read the fragment. One tick, and never a screen anybody reads. */
  | { readonly at: 'reading' }
  /** No token in the hash — which is also exactly what a mail scanner's pre-fetch produces. */
  | { readonly at: 'no-token' }
  | { readonly at: 'choosing' }
  /** identity answered 401: spent, expired, or never real. It will not say which, deliberately. */
  | { readonly at: 'expired'; readonly refusal: Refusal }
  | { readonly at: 'done' }

export function ResetPasswordPage() {
  const returnTo = useReturnTo()
  const signInHref = `/account/login?return=${encodeURIComponent(returnTo)}`

  const [stage, setStage] = useState<ResetStage>({ at: 'reading' })
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [mismatched, setMismatched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)

  /**
   * The credential from the link, and the only copy of it in this page.
   *
   * A ref rather than state because state is rendered by definition — every re-render of a
   * component holding it is an opportunity for it to reach the DOM — and because nothing on this
   * screen changes when it does. `null` after it has been spent or refused: a token that can never
   * work again has no reason to outlive the request that proved it.
   */
  const token = useRef<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const raw = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash
    const found = new URLSearchParams(raw).get('token')
    if (!found) {
      // A mail scanner's pre-fetch, or somebody who copied the address out of a client that
      // dropped the fragment. NOTHING IS SPENT: there is no request on this path at all.
      setStage({ at: 'no-token' })
      return
    }

    // Capture, THEN strip, and only then is there a form. The token is already in the ref, so the
    // address bar is clean from the first moment there is anything on screen to read it from.
    token.current = found
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setStage({ at: 'choosing' })
  }, [])

  /**
   * One reset per press.
   *
   * `POST /auth/password/reset` carries no idempotency key and identity marks the token used before
   * it validates the password (`identity/src/server.ts`). Two same-tick submits therefore
   * present the same token twice: the first spends it, the second is answered 401, and the refusal
   * resolves LAST — so a reader whose password was in fact changed is shown "that reset link is
   * invalid or has expired" and goes off to ask for another link they do not need.
   */
  const attempt = useLatch()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const held = token.current
    if (!held) return
    /*
     * The one rule this page is allowed to hold, for the reason `RegisterPage.submit` gives at
     * length: a confirmation is the check identity CANNOT make, because it is sent one password and
     * a mismatch has no representation in the request. There is no server rule for it to be
     * stricter or looser than, so it cannot teach the reader a lie and cannot drift.
     *
     * It is checked BEFORE the latch is taken, so a mismatch spends neither an attempt nor — much
     * more expensively here — the single-use token.
     */
    if (password !== confirmation) {
      setMismatched(true)
      setRefusal(null)
      return
    }
    if (!attempt.take()) return
    setBusy(true)
    setRefusal(null)
    resetPassword(held, password)
      .then(() => {
        token.current = null
        /*
         * IDENTITY HAS JUST REVOKED EVERY REFRESH FAMILY ON THIS ACCOUNT (SD-04,
         * `identity/src/server.ts`) — including this browser's, if it happened to hold one.
         * Clearing them here is not tidiness: leaving them makes the rest of this bundle believe it
         * has a session, render a dashboard against it, and collect a 401 per panel before the
         * refresh fails and signs the reader out. The tokens are already dead; the only question is
         * whether anybody finds out politely.
         */
        clearTokens()
        setStage({ at: 'done' })
        setBusy(false)
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          // Spent, expired, or never real. identity will not say which — "separating them would say
          // whether a guessed token had ever existed" — so neither does this screen. The form goes
          // with it: there is nothing left to submit, and a live form over a dead token is an
          // invitation to type a password twice more for nothing.
          token.current = null
          setStage({ at: 'expired', refusal: refusalFrom(err) })
          setBusy(false)
          return
        }
        /*
         * Everything else keeps the form and every character in it — 05:91, and it costs more here
         * than anywhere: this reader cannot simply try again, because a fresh attempt needs a fresh
         * mailed link.
         *
         * A 400 is the password policy, and its sentences arrive in `fields` under `newPassword`
         * (`identity/src/server.ts`), which is what `error=` reads below. NOTE, for whoever
         * reads this next: identity marks the token used BEFORE it checks the password
         * (`identity/src/server.ts`), so the retry this screen invites is answered 401 by
         * a service that has already consumed the link. That is identity's ordering to fix and not
         * this page's to hide — showing the reader the rules they broke is still strictly better
         * than swallowing them, and inventing a "your link is probably gone too" sentence would be
         * this bundle guessing at a service's internals on screen.
         */
        setRefusal(refusalFrom(err))
        setBusy(false)
      })
      .finally(() => attempt.release())
  }

  if (stage.at === 'reading') {
    return (
      <AccountFrame title="Reset your password">
        <div className="wt-state wt-state--loading" role="status" aria-live="polite">
          <span className="wt-spinner" aria-hidden="true" />
          <p className="wt-state__title">Reading your link</p>
        </div>
      </AccountFrame>
    )
  }

  if (stage.at === 'done') {
    return (
      <AccountFrame title="Your password is changed">
        <div className="wt-state" role="status" aria-live="polite">
          <p className="wt-state__title">
            Sign in with your new password. Everything else was signed out.
          </p>
          {/*
            Said plainly, because it is a consequence the reader has to know about rather than
            discover: identity revokes every refresh family on a reset (SD-04) — "whoever forced the
            reset must not survive it". Their phone and their other laptop will ask for the new
            password, and somebody who has just been told their password changed and is then
            silently signed out on three devices concludes they have been attacked.

            There is NO TIMED REDIRECT. This sentence is the only place that consequence is stated,
            and a screen that leaves on its own is a screen nobody finished reading. The button
            below is the same navigation, taken when the reader is ready.
          */}
          <p className="wt-note">
            Every other device that was signed in to this account has been signed out — that is what
            a reset does, so that whoever prompted it cannot outlive it. You will be asked for the
            new password on each of them.
          </p>
          <div className="wt-form__actions">
            <Link className="cf-btn cf-btn--ember" to={signInHref}>
              Sign in
            </Link>
          </div>
        </div>
      </AccountFrame>
    )
  }

  if (stage.at === 'no-token' || stage.at === 'expired') {
    return (
      <AccountFrame title={stage.at === 'no-token' ? 'That link is incomplete' : 'That link did not work'}>
        <div className="wt-state">
          {stage.at === 'no-token' ? (
            <p className="wt-state__title" role="status">
              This address needs the link from your email, and the part that matters is after the #
              — some mail clients drop it when you copy the address out. Open the message and follow
              the link itself, or ask for a new one here.
            </p>
          ) : (
            <RefusalNotice refusal={stage.refusal} />
          )}
          {/*
            The form is rendered HERE, rather than a link to it, and unlike `VerifyEmailPage` that
            is safe: `POST /auth/password/forgot` answers 202 with one fixed sentence for every
            input, so an address typed into this form cannot tell anybody whether it has an account.
            The verify page has no equivalent route to offer and sends the reader to sign-in
            instead. One less dead end on the surface doc 22 §8.1 counts the estate's dead ends on.
          */}
          <ForgotPasswordForm signInHref={signInHref} />
        </div>
      </AccountFrame>
    )
  }

  return (
    <AccountFrame title="Choose a new password">
      <form className="wt-form" onSubmit={submit} noValidate>
        {refusal && <RefusalNotice refusal={refusal} />}

        {/*
          No strength meter and no inline rules, for the reason `RegisterPage` gives: the policy is
          `checkPassword` in `@cloudsforge/contracts-auth`, two of its rules are CONTEXTUAL — a
          password may not contain the handle or the email local part — and this bundle does not
          depend on that package. A copy here would be a second implementation of a rule with
          inputs, and it would be the copy a browser test proved. identity's sentences arrive in
          `fields` under `newPassword` and are rendered under this control, all of them.

          THE TOKEN IS NOT IN THIS FORM. There is no hidden input carrying it; `submit` reads it out
          of a ref and puts it in the request body. See the header, rule 1.
        */}
        <Field
          id="reset-password"
          label="New password"
          hint="At least 8 characters. CloudsForge will tell you if it is not strong enough."
          error={refusal?.byField.get('newPassword')}
        >
          {(props) => (
            <input
              {...props}
              className="cf-input"
              type="password"
              name="newPassword"
              value={password}
              autoComplete="new-password"
              autoFocus
              required
              onChange={(event) => {
                setPassword(event.target.value)
                setMismatched(false)
              }}
            />
          )}
        </Field>

        <Field
          id="reset-confirm"
          label="Confirm new password"
          hint="Type it again, so a slip is caught here rather than at your next sign-in."
          error={mismatched ? 'Those two passwords are not the same.' : undefined}
        >
          {(props) => (
            <input
              {...props}
              className="cf-input"
              type="password"
              name="confirmPassword"
              value={confirmation}
              autoComplete="new-password"
              required
              onChange={(event) => {
                setConfirmation(event.target.value)
                setMismatched(false)
              }}
            />
          )}
        </Field>

        <div className="wt-form__actions">
          <button type="submit" className="cf-btn cf-btn--ember" disabled={busy}>
            {busy ? 'Saving…' : 'Set new password'}
          </button>
        </div>
        <p className="wt-note">
          Setting a new password signs out every other device on this account, and this link stops
          working the moment it is used.
        </p>
      </form>
    </AccountFrame>
  )
}

/* ─────────────────────────────── sign out ─────────────────────────────── */

/**
 * `${accountUrl()}/logout?return=…`, which `signOutRedirect()` sends every surface to.
 *
 * THE LOCAL TOKENS GO FIRST. The revocation is a network call and may fail; the clearing cannot.
 * A sign-out that left the tokens in the browser because the wifi blinked is the failure that
 * matters here — the refresh token being alive on the server for its remaining life is the lesser
 * one, and it is what "sign out everywhere" on the Security page exists for.
 */
export function SignOutPage() {
  const returnTo = useReturnTo()
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true
    const refreshToken = getRefreshToken()
    clearTokens()
    const leave = () => window.location.assign(returnTo)
    if (!refreshToken) {
      leave()
      return
    }
    revokeRefreshToken(refreshToken).catch(() => undefined).finally(leave)
  }, [returnTo])

  return (
    <AccountFrame title="Signing you out">
      <div className="wt-state wt-state--loading" role="status" aria-live="polite">
        <span className="wt-spinner" aria-hidden="true" />
        <p className="wt-state__title">Ending your session</p>
      </div>
    </AccountFrame>
  )
}

/* ─────────────────────────────── frame ─────────────────────────────── */

function AccountFrame({ title, children }: { title: string; children: ReactElement }) {
  return (
    <div className="wt-account">
      <header className="wt-page__head">
        <h1 className="wt-page__title">{title}</h1>
      </header>
      {children}
    </div>
  )
}
