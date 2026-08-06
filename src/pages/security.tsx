/**
 * Security: what is protecting this account, where it is signed in, and what is restricted.
 *
 * ── Two sources, and neither may take the other down ───────────────────────────────────────────
 *
 * The security state, the alerts and the account restrictions are three tiles of `/v1/dashboard`.
 * The SESSION LIST is not composed by hub-api at all — identity serves it at `GET /sessions`
 * (identity/src/server.ts) behind `authenticateUser`, which refuses a service token, so
 * there is no credential hub-api could hold that would reach it. This page therefore reads both,
 * concurrently, through `settleBoth`: identity being unwell costs the session list and nothing
 * else. See lib/settled.ts for why `Promise.all` would have been the wrong call.
 *
 * ── Revoking is done against identity directly, on purpose ─────────────────────────────────────
 *
 * Identity records a revoke against the presenting session. A proxy in the middle would make every
 * sign-out in the estate look like it came from hub-api, which is an audit trail that has stopped
 * saying anything. `DELETE /sessions/:id` answers 204 whether or not there was one — "a 404 here
 * would say which session ids exist" — so the list is reloaded rather than a row being removed
 * optimistically from a delete that proves nothing.
 */
import { useCallback, useState } from 'react'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { NotComposed, TilePanel } from '../components/tile.tsx'
import { shortHash, utcDateTime } from '../lib/format.ts'
import { useSession } from '../lib/auth.tsx'
import { useLatch } from '../lib/latch.ts'
import {
  loadDashboard,
  loadSessions,
  revokeAllSessions,
  revokeSession,
  type Dashboard,
  type IdentitySession,
  type SecurityAlert,
  type SecurityView,
} from '../lib/hub.ts'
import { useResource } from '../lib/resource.ts'
import { allFailed, firstNotice, settleBoth, type Settled } from '../lib/settled.ts'
import { hasAnswer } from '../lib/tile.ts'

interface SecurityData {
  readonly dashboard: Settled<Dashboard>
  readonly sessions: Settled<{ sessions: readonly IdentitySession[] }>
}

const alwaysPresent = () => 1

export function SecurityPage() {
  const { signOut } = useSession()
  /** Which revoke is in flight, by session id, or `'all'`. Disables every button while set. */
  const [busy, setBusy] = useState<string | null>(null)
  /**
   * And what actually enforces "one at a time", because `busy` cannot.
   *
   * `busy` is state: two same-tick presses of End both read `null` and both sent. On a single
   * session that is merely two `DELETE /sessions/:id` and two reloads — identity answers 204
   * whether or not a session existed, so nothing breaks. On **Sign out everywhere** it is not
   * cosmetic: the first `DELETE /sessions` revokes this tab's own tokens, so the second is sent
   * with a credential that is already dead, 401s, and lands in the `catch` — which calls
   * `reload()` against a revoked session and paints a failure over a sign-out that worked.
   *
   * One latch covers both controls rather than one each, because `disabled={busy !== null}`
   * already says only one revoke may run at a time; the latch is what makes that true.
   */
  const revoking = useLatch()

  const load = useCallback(
    (signal: AbortSignal): Promise<SecurityData> =>
      settleBoth(loadDashboard(signal), loadSessions(signal), {
        first: 'We could not read how this account is protected.',
        second: 'We could not read where you are signed in.',
      }).then((settled) => ({ dashboard: settled.first, sessions: settled.second })),
    [],
  )

  const { state, data, error, reload } = useResource(load, alwaysPresent, 'We could not read how this account is protected.')

  if (state === 'forbidden') return <Forbidden notice={error ?? undefined} />
  if (state === 'failed' && error) return <Failed notice={error} onRetry={reload} />
  if (state === 'loading' || !data) return <Loading label="Checking how this account is protected" />

  // The one honest page-level failure: neither read arrived, so there is nothing to render but
  // the error.
  if (allFailed(data.dashboard, data.sessions)) {
    const notice = firstNotice(data.dashboard, data.sessions)
    return notice ? <Failed notice={notice} onRetry={reload} /> : <Loading />
  }

  const dashboard = data.dashboard.value
  const security = dashboard?.tiles.security ?? null
  const view = security?.data ?? null

  const endSession = (id: string) => {
    if (!revoking.take()) return
    setBusy(id)
    revokeSession(id)
      // A failed revoke needs no message of its own: the reload that follows shows the session
      // still listed, which is the accurate report of what happened.
      .catch(() => undefined)
      .finally(() => {
        revoking.release()
        setBusy(null)
        // Reloaded from identity rather than spliced out here. The 204 is returned whether or not
        // a session existed, so it proves nothing about the list.
        reload()
      })
  }

  const endEverything = () => {
    if (!revoking.take()) return
    setBusy('all')
    revokeAllSessions()
      // The current session is revoked too — deliberately, because "a 'sign out everywhere' that
      // spares the button that was pressed is not the operation the user asked for". So the tokens
      // in this tab are dead the moment this resolves, and holding on to them would leave the app
      // making 401s until something noticed.
      .then(() => signOut())
      .catch(() => {
        setBusy(null)
        reload()
      })
      // Released even on the success path, where `signOut()` has already torn the session down.
      // It costs nothing there and it is the only way to be sure the failure path cannot wedge
      // the control — the two must not be allowed to diverge.
      .finally(() => revoking.release())
  }

  return (
    <>
      <header className="wt-page__head">
        <h1 className="wt-page__title">Security</h1>
        <p className="wt-page__lede">
          One account guards everything you have across CloudsForge, so it is worth a second
          factor. We support an authenticator app and one-use recovery codes, and we deliberately
          refuse text-message codes — a phone number can be taken off you by a stranger with a
          convincing story. You can see every place you are currently signed in below, and end any
          of them, or all of them at once.
        </p>
      </header>

      {dashboard && hasAnswer(dashboard.tiles.alerts) && dashboard.tiles.alerts.data.length > 0 && (
        <ul className="wt-alerts">
          {dashboard.tiles.alerts.data.map((alert) => (
            <AlertRow key={`${alert.kind}:${alert.message}`} alert={alert} />
          ))}
        </ul>
      )}

      {security && (
        <TilePanel
          title="This account"
          tile={security}
          empty={
            <p className="wt-note">
              Nothing came back about how this account is protected, which is unusual and worth
              telling us about.
            </p>
          }
        >
          {view ? <AccountFacts view={view} /> : null}
        </TilePanel>
      )}

      {security && view && (
        <TilePanel
          title="Second factors"
          tile={security}
          empty={
            <p className="wt-note">
              Your password is the only thing standing in front of this account. Adding an
              authenticator app takes a minute and is the single largest improvement available.
            </p>
          }
        >
          {view.factors.length === 0 ? null : (
            <ul className="wt-rows">
              {view.factors.map((factor) => (
                <li className="wt-row" key={factor.id}>
                  <span
                    className={`wt-dot wt-dot--${factor.status === 'active' ? 'active' : 'pending'}`}
                    aria-hidden="true"
                  />
                  <span className="wt-row__main">
                    <span className="wt-row__title">{factor.label}</span>
                    <span className="wt-row__sub">
                      {factor.kind} ·{' '}
                      {factor.lastUsedAt === null
                        ? 'never used'
                        : `last used ${utcDateTime(factor.lastUsedAt)}`}
                    </span>
                  </span>
                  <span className="wt-row__meta">
                    <span className="wt-chip">{factor.status}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TilePanel>
      )}

      <SessionsPanel
        sessions={data.sessions}
        currentSessionId={view?.sessionId ?? null}
        busy={busy}
        onEnd={endSession}
        onEndAll={endEverything}
      />

      {dashboard && (
        <TilePanel
          title="Restrictions"
          tile={dashboard.tiles.restrictions}
          empty={<p className="wt-note">Nothing on this account is held back or blocked.</p>}
        >
          {dashboard.tiles.restrictions.data.length === 0 ? null : (
            <ul className="wt-rows">
              {dashboard.tiles.restrictions.data
                .filter((freeze) => freeze.clearedAt === null)
                .map((freeze) => (
                  <li className="wt-row wt-row--critical" key={freeze.id}>
                    <span className="wt-dot wt-dot--critical" aria-hidden="true" />
                    <span className="wt-row__main">
                      <span className="wt-row__title">{freeze.scope} is frozen</span>
                      <span className="wt-row__sub">{freeze.reason}</span>
                    </span>
                    <span className="wt-row__meta cf-num">{utcDateTime(freeze.createdAt)}</span>
                  </li>
                ))}
            </ul>
          )}
        </TilePanel>
      )}

      {/*
        Devices are a real entity in identity — `sessions.device_id` joins to a `devices` table
        with a user-agent and an OS family, which is where `userAgentFamily` on a session comes
        from — but identity exposes no route that lists them, so there is no device inventory to
        show and no way to name a device that is not currently signed in.
      */}
      <NotComposed title="Devices">
        <p>
          Each session above carries what we know of the machine behind it — the browser and the
          kind of operating system. What does not exist is a list of your devices in their own
          right, so a laptop you have already signed out of cannot be shown here, and there is
          nothing to forget it from.
        </p>
      </NotComposed>
    </>
  )
}

function AccountFacts({ view }: { view: SecurityView }) {
  return (
    <dl className="wt-facts">
      <dt>Signed in as</dt>
      <dd>{view.handle}</dd>
      <dt>Email</dt>
      <dd>
        {view.email}{' '}
        {view.emailVerified ? (
          <span className="wt-chip wt-chip--ok">verified</span>
        ) : (
          <span className="wt-chip wt-chip--warn">not verified</span>
        )}
      </dd>
      <dt>Two-factor</dt>
      <dd>
        {view.mfaEnabled ? (
          <span className="wt-chip wt-chip--ok">enabled</span>
        ) : (
          <span className="wt-chip wt-chip--warn">not enabled</span>
        )}
      </dd>
      <dt>Recovery codes</dt>
      {/*
        A count, never a bar or a fraction of an invented maximum: identity publishes how many are
        LEFT and nothing about how many were issued, so a denominator here would be made up.
      */}
      <dd className="cf-num">{view.recoveryCodesRemaining} remaining</dd>
      <dt>This session used</dt>
      <dd>{view.amr.length > 0 ? view.amr.join(', ') : 'a password'}</dd>
      <dt>Roles</dt>
      <dd>{view.roles.length > 0 ? view.roles.join(', ') : 'none'}</dd>
      {view.organisations.length > 0 && (
        <>
          <dt>Organisations</dt>
          <dd>{view.organisations.map((org) => org.name).join(', ')}</dd>
        </>
      )}
    </dl>
  )
}

function SessionsPanel({
  sessions,
  currentSessionId,
  busy,
  onEnd,
  onEndAll,
}: {
  sessions: Settled<{ sessions: readonly IdentitySession[] }>
  currentSessionId: string | null
  busy: string | null
  onEnd: (id: string) => void
  onEndAll: () => void
}) {
  return (
    <section className="wt-panel">
      <header className="wt-panel__head">
        <h2 className="wt-panel__title">Where you are signed in</h2>
        {sessions.value && sessions.value.sessions.length > 1 && (
          <button type="button" className="cf-btn" onClick={onEndAll} disabled={busy !== null}>
            {busy === 'all' ? 'Signing out…' : 'Sign out everywhere'}
          </button>
        )}
      </header>

      {sessions.error ? (
        <p className="wt-tilenote wt-tilenote--unavailable" role="alert">
          <span className="wt-tilenote__icon" aria-hidden="true">
            ■
          </span>
          <span>
            {sessions.error.message} Everything else on this page loaded.
            {sessions.error.requestId && (
              <>
                {' '}
                Quote <code className="cf-num wt-reqid">{sessions.error.requestId}</code> to support.
              </>
            )}
          </span>
        </p>
      ) : sessions.value && sessions.value.sessions.length === 0 ? (
        // Identity lists ACTIVE sessions only, so an empty list here is genuinely odd — the
        // request that produced it was itself made with a live session.
        <p className="wt-note">
          Not one live session is recorded — odd, given you are reading this on one.
        </p>
      ) : (
        <ul className="wt-rows">
          {(sessions.value?.sessions ?? []).map((session) => {
            const current = session.id === currentSessionId
            return (
              <li className="wt-row" key={session.id}>
                <span className="wt-dot wt-dot--active" aria-hidden="true" />
                <span className="wt-row__main">
                  <span className="wt-row__title">
                    {session.userAgentFamily ?? 'Unknown browser'}
                    {session.osFamily ? ` on ${session.osFamily}` : ''}
                    {current && <span className="wt-chip wt-chip--ok">this device</span>}
                  </span>
                  <span className="wt-row__sub cf-num">
                    active {utcDateTime(session.lastActiveAt)} · started{' '}
                    {utcDateTime(session.createdAt)}
                    {/* A PREFIX, not an address: identity deliberately stores no full client IP. */}
                    {session.ipPrefix && ` · from ${session.ipPrefix}`}
                  </span>
                </span>
                <span className="wt-row__meta">
                  <code className="cf-num wt-addr wt-addr--short">{shortHash(session.id, 8, 4)}</code>
                  {!current && (
                    <button
                      type="button"
                      className="cf-btn"
                      onClick={() => onEnd(session.id)}
                      disabled={busy !== null}
                    >
                      {busy === session.id ? 'Ending…' : 'End'}
                    </button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function AlertRow({ alert }: { alert: SecurityAlert }) {
  return (
    <li className={`wt-alert wt-alert--${alert.severity}`} role="alert">
      <span className="wt-alert__icon" aria-hidden="true">
        {alert.severity === 'critical' ? '■' : '▲'}
      </span>
      <span>{alert.message}</span>
      <span className="wt-alert__source">{alert.source}</span>
    </li>
  )
}
