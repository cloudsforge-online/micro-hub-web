/**
 * Session state for the tree, and the gate in front of protected routes.
 *
 * Hiding a route is NOT the security boundary — every service verifies the token and the scope on
 * the request itself. This exists so that a signed-out user is sent to sign in instead of being
 * shown a screen made entirely of failures, and so that a signed-in one is not asked again.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import type { AccountState } from '@cloudsforge/ui'
import { AUTH_EXPIRED_EVENT, clearTokens, getAccessToken, hasSession, nimbus, signIn, signOut } from './api.ts'
import { readTokenClaims, type TokenClaims } from './claims.ts'

/**
 * What identity answers at `/auth/me`.
 *
 * The profile is **nested under `user`** — the body is
 * `{ user, session, organisations }` (`identity/src/server.ts`), and `user` is built by
 * `toPublicUser` (`identity/src/users.ts`). This interface used to declare `handle` and
 * `roles` at the TOP level, where identity has never put them: `roles` was therefore always
 * `undefined`, `isAdmin` was always false, and the switcher hid admin, lantern and beacon from
 * every signed-in operator. Nothing failed — the menu was simply, silently, short.
 *
 * Only the nested shape is accepted. Tolerating the flat one as a fallback would encode a
 * response identity does not send, and the next reader would not be able to tell which is real.
 */
interface Me {
  user?: {
    id?: string | null
    handle?: string | null
    roles?: readonly string[] | null
  } | null
}

export type SessionStatus = 'loading' | 'anonymous' | 'signedIn'

export interface Session {
  status: SessionStatus
  account: AccountState
  signIn: (returnTo?: string) => void
  signOut: () => void
}

const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const value = useContext(SessionContext)
  // Throwing beats returning a signed-out default: a component rendered outside the provider
  // would otherwise show an anonymous UI to a signed-in user and nobody would ever see why.
  if (!value) throw new Error('useSession must be used inside <AuthProvider>')
  return value
}

export function AuthProvider({ children }: { children: ReactNode }) {
  /**
   * THE SESSION IS RESOLVED BEFORE THE FIRST PAINT, FROM STORAGE, WITH NO REQUEST.
   *
   * This used to start at `loading` whenever a token was held, and `loading` renders as signed OUT
   * — so the bar said `Sign in` to a signed-in user for as long as `GET /auth/me` took, which is a
   * cross-origin preflight and a request over the tunnel, or four round trips when the access
   * token has expired. On the live estate that is hundreds of milliseconds on every page load, and
   * it is what the owner reported: a working sign-in that looks broken until something forces a
   * re-render.
   *
   * `lib/claims.ts` reads the handle and the roles out of the access token that is already in
   * `localStorage`. It is a DISPLAY read and never a decision — see that file's header for why
   * that distinction is the whole safety argument, and why the expiry is deliberately not checked.
   *
   * `loading` is kept for the one case it is still true of: a session is held and the token cannot
   * be read, so this build genuinely does not know the handle yet and `/auth/me` is the only way
   * to find out. It is no longer the ordinary path.
   */
  const [claims] = useState<TokenClaims | null>(() => readTokenClaims(getAccessToken()))
  const [status, setStatus] = useState<SessionStatus>(() => {
    if (!hasSession()) return 'anonymous'
    return claims ? 'signedIn' : 'loading'
  })
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    if (!hasSession()) return
    let live = true
    // The identity call is the one request that is allowed to fail quietly: an unreachable Nimbus
    // must not sign anyone out — that is the cascade the estate's readiness rules exist to avoid.
    nimbus<Me>('/auth/me')
      .then((profile) => {
        if (!live) return
        setMe(profile)
        setStatus('signedIn')
      })
      .catch(() => {
        if (!live) return
        setStatus(hasSession() ? 'signedIn' : 'anonymous')
      })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const onExpired = () => {
      clearTokens()
      setMe(null)
      setStatus('anonymous')
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [])

  const doSignOut = useCallback(() => {
    setMe(null)
    setStatus('anonymous')
    signOut()
  }, [])

  const value = useMemo<Session>(
    () => ({
      status,
      account: {
        // identity's answer wins the moment it arrives; the token's claims are what is shown
        // until then. `??` and not `||`: a service that one day answers `handle: ''` should show
        // the empty string it sent rather than silently falling back to a stale one.
        signedIn: status === 'signedIn',
        handle: me?.user?.handle ?? claims?.handle ?? null,
        roles: me?.user?.roles ?? claims?.roles ?? null,
      },
      signIn,
      signOut: doSignOut,
    }),
    [status, me, claims, doSignOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/**
 * Gate a route behind a session.
 *
 * The redirect carries the CURRENT path, search and hash, so a user who followed a link to a deep
 * page lands back on that page rather than on the dashboard. It is fired from an effect rather
 * than during render because a redirect during render runs twice under StrictMode, and the second
 * one would overwrite the first's return address.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status, signIn: go } = useSession()
  const location = useLocation()

  useEffect(() => {
    if (status !== 'anonymous') return
    const back = `${window.location.origin}${location.pathname}${location.search}${location.hash}`
    go(back)
  }, [status, location.pathname, location.search, location.hash, go])

  if (status === 'loading') {
    return <LoadingGate label="Checking your session" />
  }
  if (status === 'anonymous') {
    return <LoadingGate label="Taking you to sign in" />
  }
  return <>{children}</>
}

function LoadingGate({ label }: { label: string }) {
  return (
    <div className="wt-state wt-state--loading" role="status">
      <span className="wt-spinner" aria-hidden="true" />
      <p className="wt-state__title">{label}</p>
    </div>
  )
}
