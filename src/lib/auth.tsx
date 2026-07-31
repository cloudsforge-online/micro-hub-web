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
import { AUTH_EXPIRED_EVENT, clearTokens, hasSession, nimbus, signIn, signOut } from './api.ts'

/** What Nimbus answers at `/auth/me`, narrowed to what the bar needs. */
interface Me {
  handle?: string | null
  roles?: readonly string[] | null
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
  const [status, setStatus] = useState<SessionStatus>(() => (hasSession() ? 'loading' : 'anonymous'))
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
        signedIn: status === 'signedIn',
        handle: me?.handle ?? null,
        roles: me?.roles ?? null,
      },
      signIn,
      signOut: doSignOut,
    }),
    [status, me, doSignOut],
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
