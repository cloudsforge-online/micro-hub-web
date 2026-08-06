/**
 * The route table: which component renders at each address.
 *
 * The ADDRESSES themselves are declared once, in `src/lib/routes.ts`, which the sub-navigation
 * derives from and which `test/routes.test.ts` checks this file and `nginx.conf` against. nginx
 * serves the bundle only for the paths it enumerates and 404s everything else on purpose, so a
 * route added here and not there works under `pnpm dev` and dies on the first hard refresh in
 * production. The test is the mechanism; "remember to update nginx.conf" is not.
 *
 * ── Every route here is behind the gate, except the three that cannot be ──────────────────────
 *
 * Forge Hub has no page that SHOWS anything without a session: every one of them reads an
 * authenticated composition of somebody's money, sessions and entitlements. The wrapper is applied
 * per route rather than around the whole table, which is what lets a genuinely public route exist
 * without it — and hiding a route is never the security boundary in either case. Every service
 * verifies the token and the scope on the request itself; this exists so a signed-out reader is
 * sent to sign in rather than shown a screen made entirely of failures.
 *
 * The exceptions are the `account/*` addresses of the estate's sign-in surface — `login`,
 * `register`, `verify`, `forgot`, `reset` and `logout` — which live here because nothing else in
 * the estate served one at all (docs/ecosystem/22 §8.1). Each of them either shows nothing or is
 * the landing page for a link in an email, and the reader of a mailed link has no session by
 * definition. They are declared in `lib/routes.ts` as PUBLIC_ROUTES and
 * `test/routes.test.ts` reads that list — an ungated route that is not on it fails the build, and
 * so does a listed route that is gated. The list is not a comment; it is what the test compares
 * against.
 */
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/shell.tsx'
import { AuthProvider, ProtectedRoute } from './lib/auth.tsx'
import {
  ForgotPasswordPage,
  RegisterPage,
  ResetPasswordPage,
  SignInPage,
  SignOutPage,
  VerifyEmailPage,
} from './pages/account.tsx'
import { ActivityPage } from './pages/activity.tsx'
import { EntitlementsPage } from './pages/entitlements.tsx'
import { NotFoundPage } from './pages/not-found.tsx'
import { OverviewPage } from './pages/overview.tsx'
import { PortfolioPage } from './pages/portfolio.tsx'
import { SearchPage } from './pages/search.tsx'
import { SecurityPage } from './pages/security.tsx'
import { SettingsPage } from './pages/settings.tsx'
import { WalletPage } from './pages/wallet.tsx'

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route
              index
              element={
                <ProtectedRoute>
                  <OverviewPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="portfolio"
              element={
                <ProtectedRoute>
                  <PortfolioPage />
                </ProtectedRoute>
              }
            />
            {/*
              `wallet/*`, not `wallet`. hub-api's next-action cards deep-link to
              `/wallet/deposits/:id` and `/wallet/withdrawals/:id` (nextactions.ts, 180), and a
              card whose button 404s is worse than no card. There is no per-deposit page yet, so
              those addresses land on the wallet page itself, where the deposit is listed — which
              is the honest resolution of a link to a detail view that does not exist.
            */}
            <Route
              path="wallet/*"
              element={
                <ProtectedRoute>
                  <WalletPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="activity"
              element={
                <ProtectedRoute>
                  <ActivityPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="security"
              element={
                <ProtectedRoute>
                  <SecurityPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="entitlements"
              element={
                <ProtectedRoute>
                  <EntitlementsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="settings"
              element={
                <ProtectedRoute>
                  <SettingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="search"
              element={
                <ProtectedRoute>
                  <SearchPage />
                </ProtectedRoute>
              }
            />
            {/*
              hub-api's "needs you" cards deep-link into two prefixes this app does not otherwise
              use: `/account/security` and `/account/restrictions/:id` for the identity and policy
              cards, and `/billing/subscriptions/:id` for the past-due card (nextactions.ts,
              214, 235, 251). Every card "carries a verb and a destination… a card a user cannot
              act on from the dashboard is a worry with no outlet" — and a destination that 404s is
              exactly that. They are honoured here rather than rewritten client-side, because
              rewriting would leave the address hub-api actually emits broken for anything else
              that follows it.

              Both land on the page that holds the thing named: restrictions are a panel on
              Security, subscriptions are a panel on Access. Neither has a per-record detail view
              yet, and sending a reader to the list that contains their record is a better answer
              than a page that does not exist.
            */}
            {/*
              THE SIX ADDRESSES THAT MUST NOT BE GATED, and the only ones in this app.

              `@cloudsforge/ui`'s `signin` surface resolves to `<hub>/account`, so `signInRedirect()`
              in every product in the estate sends its signed-out visitors to `/account/login` and
              `signOutRedirect()` sends them to `/account/logout`. A session gate in front of a
              sign-in page is a redirect loop, and until these existed the redirect went to
              `account.<apex>`, which nothing serves at all (docs/ecosystem/22 §8.1).

              They are declared in `lib/routes.ts` as PUBLIC_ROUTES and `test/routes.test.ts`
              checks each <Route> here against that list in both directions — an ungated route
              that is not declared public fails the build, and so does a declared one that is
              gated. Being listed FIRST is not what makes them match; react-router ranks by
              specificity, so `account/login` wins over `account/*` wherever it is written.
            */}
            <Route path="account/login" element={<SignInPage />} />
            <Route path="account/register" element={<RegisterPage />} />
            <Route path="account/logout" element={<SignOutPage />} />
            {/*
              The last three, and the ones that MUST be ungated: they are where the links in
              CloudsForge's mail land, and the reader following one has no session BY DEFINITION —
              proving the address is what creates a session, and a reader asking for a password
              reset is a reader who cannot sign in at all. A gate on any of them bounces the reader
              to a sign-in they cannot complete, so the mailed link fails for exactly the person it
              was addressed to. That is the loop this whole group exists outside of.

              `account/reset` is also the address `micro-identity` needs to exist before it will
              send the mail at all: `notify` refuses to send when no link can be built, so until
              this route was routed and served, the reset email could not go out.
            */}
            <Route path="account/verify" element={<VerifyEmailPage />} />
            <Route path="account/forgot" element={<ForgotPasswordPage />} />
            <Route path="account/reset" element={<ResetPasswordPage />} />
            <Route
              path="account/*"
              element={
                <ProtectedRoute>
                  <SecurityPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="billing/*"
              element={
                <ProtectedRoute>
                  <EntitlementsPage />
                </ProtectedRoute>
              }
            />
            {/* Unknown paths render inside the shell, so the reader keeps the bar and the
                navigation they need to get back out. The STATUS is nginx's doing, not this
                route's — see pages/not-found.tsx. */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
