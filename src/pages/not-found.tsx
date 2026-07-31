/**
 * The unknown-path page.
 *
 * It is rendered under an HTTP 404, not a 200 — nginx.conf enumerates this app's real routes and
 * lets everything else fall through to `error_page 404 /index.html`, which serves this bundle
 * while KEEPING the status. The estate's current site returns 200 for every unknown path, so its
 * "page not found" screen is served as a success: crawlers index it, monitors call it healthy,
 * and a broken link in a deploy looks exactly like a working one.
 *
 * Two consequences worth knowing before this file is edited:
 *
 *   - Adding a route to `src/app.tsx` without adding it to `nginx.conf` produces a page that works
 *     under `pnpm dev` and 404s on a hard refresh in production. The list in `NAV` is the third
 *     copy and they all have to agree.
 *   - The reusable `web-ci.yml` in the org repository probes a deep link and expects 200, which is
 *     the opposite of this rule. That is why hub-web does not call its image job — see the note in
 *     `.github/workflows/ci.yml`.
 */
import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="wt-state wt-state--empty" role="status">
      <span className="wt-state__icon" aria-hidden="true">
        ◇
      </span>
      <p className="wt-state__title">There is no page at this address</p>
      <p className="wt-state__hint">
        The link may be out of date, or the page may have moved. This response carries a 404
        status, so whatever sent you here can be fixed.
      </p>
      <div className="wt-state__action">
        <Link className="cf-btn" to="/">
          Back to the overview
        </Link>
      </div>
    </div>
  )
}
