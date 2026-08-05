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
 * `identity/src/server.test.ts:890` asserts that `/`, `/portal` and `/dashboard` 404. There is no
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
 * refused (`identity/src/server.ts:434-445`); this page renders those sentences beside those
 * inputs and keeps everything else the user typed. 14 §11 is explicit about why a client must not
 * hold the rule, and doc 22 §3.1 forbids a browser scenario from asserting one.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { useLatch } from '../lib/latch.ts'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError, clearTokens, getAccessToken, getRefreshToken, hasSession } from '../lib/api.ts'
import {
  answerMfaChallenge,
  completeSignIn,
  readReturnTo,
  registerAccount,
  revokeRefreshToken,
  signInWithPassword,
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
  /** field name → the server's sentence for it. */
  readonly byField: ReadonlyMap<string, string>
}

function refusalFrom(err: unknown): Refusal {
  if (err instanceof ApiError) {
    return {
      message: err.message,
      requestId: err.requestId,
      byField: new Map(err.fields.map((f) => [f.field, f.message])),
    }
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
    signInWithPassword(identifier, password)
      .then(finish)
      .catch((err: unknown) => {
        // The password is cleared and the identifier is NOT. Retyping an email address after a
        // typo in a password is the friction that makes people paste credentials from somewhere
        // less safe; the password field is cleared because a wrong one is not worth editing.
        setPassword('')
        setRefusal(refusalFrom(err))
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
     * (`identity/node_modules/@cloudsforge/contracts-auth/src/index.ts:1148-1185`): at least
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
        // A fresh account has no factors, so identity never answers `mfaRequired` here. If it ever
        // did, sending the user to the sign-in form is the honest handling — it is the page that
        // knows how to answer a challenge.
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
