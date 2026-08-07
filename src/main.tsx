/**
 * The boot sequence. The order is not arbitrary.
 *
 *   1. Observability first, so an exception thrown by anything below is reported rather than lost.
 *      A crash during the first render is the single most valuable event this app can send.
 *   2. `bootstrapSession()` second, and AWAITED, so the SSO hand-off code in the URL fragment is
 *      redeemed before React mounts. It strips `#cf_code` from the address bar before the
 *      exchange goes over the wire — see the note in @cloudsforge/ui. Rendering first would show
 *      a signed-out shell to a user who has just signed in, and would leave the code on screen
 *      for the length of a network round trip.
 *   3. Render last.
 *
 * `.finally` rather than `.then`: a failed hand-off is a signed-out boot, not a broken app, and an
 * app that refuses to mount because an exchange failed leaves the reader with a blank page and no
 * sign-in button to press.
 *
 * Consent is primed BETWEEN 1 and 2 — see the note beside `initAnalytics()` for why it has to be
 * before the session bootstrap and not after it.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@cloudsforge/ui/tokens.css'
import '@cloudsforge/ui/ui.css'
import './styles.css'
import { initAnalytics } from '@cloudsforge/ui/consent'
import { App } from './app.tsx'
import { bootstrapSession } from './lib/api.ts'
import { initObs } from './lib/obs.ts'

initObs()

/*
 * Consent Mode is primed with every category DENIED before anything else runs — two pushes onto a
 * plain array, no request, no cookie — and the analytics tag is loaded ONLY if this reader granted
 * consent on a previous visit. A first-time reader gets nothing until they press Accept.
 *
 * It goes here, second, rather than inside a component, because the denied default has to be in
 * place before any tag could conceivably arrive; a default installed after a script has begun
 * running is a race, and the losing branch of that race sets a cookie.
 *
 * ── AND STRICTLY BEFORE `bootstrapSession()`, WHICH IS AWAITED ────────────────────────────────
 *
 * Two independent reasons, and the second is this surface's own:
 *
 *   1. The hand-off is a network round trip. A window in which a tag could arrive with storage
 *      permitted by default is the window this module exists to close, and the round trip is the
 *      widest one on the page.
 *   2. `bootstrapSession()` is awaited so the bar shows the handle on the FIRST paint rather than
 *      flashing `Sign in` at somebody who is already signed in (`src/lib/auth.tsx` §"THE SESSION IS
 *      RESOLVED BEFORE THE FIRST PAINT"). Nothing may be inserted into or after that await which
 *      could delay, reorder or re-enter the render — so this call is placed before it, where it is
 *      synchronous and cannot.
 */
initAnalytics()

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

void bootstrapSession().finally(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
