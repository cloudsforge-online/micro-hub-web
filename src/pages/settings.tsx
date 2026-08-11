/**
 * Settings: the profile Forge Hub can show, and honest statements about the rest.
 *
 * ── What this page deliberately does NOT do ────────────────────────────────────────────────────
 *
 * It does not edit a profile. Identity owns the email, the handle and the password, and
 * `docs/ecosystem/03-repository-responsibilities.md` moves the Nimbus `/account` PAGE into
 * this repository — not a second copy of the account itself. Duplicating the edit forms here means
 * two validators, two rate limits and two places for a password change to go subtly wrong; the
 * portal is one link away and it is the thing that owns them.
 *
 * What Forge Hub does own and shows here: which environment this bundle is talking to, resolved
 * at runtime from the address bar, and where each of the account's own settings actually lives.
 *
 * ── Notification preferences are a stated hole ─────────────────────────────────────────────────
 *
 * `notify` serves `GET /preferences` and `PUT /preferences`, and it is not reachable from here at
 * all: `notify` has no entry in the surface registry (`@cloudsforge/ui/surfaces`), so
 * `cloudsforgeHosts()` cannot produce a URL for it, and hub-api composes notifications but
 * exposes no preferences route of its own. One of the two things this paragraph used to name has
 * since been done — `notify` IS an upstream of hub-api now, and the `notifications` tile it made
 * permanently `unavailable` is composed (micro-org #415). The remaining hole is stated here rather
 * than papered over with a switch that does nothing.
 */
import { Link } from 'react-router-dom'
import { useSession } from '../lib/auth.tsx'
import { NotComposed } from '../components/tile.tsx'
import { APP_NAME, PRODUCT, hosts } from '../lib/hosts.ts'

export function SettingsPage() {
  const { account } = useSession()
  const resolved = hosts()

  return (
    <>
      <header className="wt-page__head">
        <h1 className="wt-page__title">Settings</h1>
      </header>

      <section className="wt-panel">
        <header className="wt-panel__head">
          <h2 className="wt-panel__title">Profile</h2>
        </header>
        <dl className="wt-facts">
          <dt>Signed in as</dt>
          <dd>{account.handle ?? 'nobody'}</dd>
          <dt>Roles</dt>
          <dd>{account.roles?.length ? account.roles.join(', ') : 'none'}</dd>
        </dl>
        {/*
          ── THIS PARAGRAPH USED TO LINK TO `account.<apex>`, WHICH DOES NOT RESOLVE ───────────

          `resolved.account` is the RESERVED hostname. It is one of exactly two subdomains out of
          twenty-seven with no DNS record on either network (the other is `worlds-api`), so the
          link did not 404 — it failed to resolve at all, and the browser showed its own error
          page rather than anything of ours. The sentence around it was wrong in the same way: it
          promised a "CloudsForge Account portal", and there is no such surface in the estate.
          `micro-identity` binds 4001, serves an API and renders no HTML at all
          (`identity/src/server.ts` §3, asserted at `identity/src/server.test.ts`).

          So the link is not repointed, it is retired, and the paragraph now says what is true.
          Repointing it at `signin` would have been the same defect as the account menu's: sending
          a reader who is already signed in to the sign-in form. The one destination that exists
          and does something is Security, which is in-app and already linked below.
        */}
        <p className="wt-note">
          Your email address, your handle and your password are stored in exactly one place and
          shared by every CloudsForge product. That service answers other programs rather than
          people, and nothing yet puts a page in front of it — so there is nowhere we can send you
          to edit them. We keep no second copy here to change instead, which would only be a copy
          that drifts. The gap is real and we would rather name it than give you a link that goes
          nowhere.
        </p>
        <p className="wt-note">
          {/* A router Link, not an anchor: an in-app address served through a full page load
              throws away the session state and the scroll position for no reason. */}
          Your second factor, your recovery codes and every place you are currently signed in all
          live on{' '}
          <Link className="wt-link" to="/security">
            Security
          </Link>
          , which reads and changes them at the source rather than through a copy.
        </p>
      </section>

      <NotComposed title="Notification preferences">
        <p>
          The <code>notify</code> service owns notification preferences and serves them at{' '}
          <code>GET /preferences</code> and <code>PUT /preferences</code>. Forge Hub cannot reach
          it: <code>notify</code> has no entry in the CloudsForge surface registry, so there is no
          hostname to resolve at runtime, and hub-api — which now reads notifications themselves,
          and shows the newest of them on your Overview — exposes no route for the preferences
          behind them. A registry entry, or one more route on hub-api, closes it.
        </p>
      </NotComposed>

      {/*
        Resolved hosts, on screen. It is the fastest way to answer "which environment am I talking
        to" without a console, and it is only ever a list of public base URLs.
      */}
      <section className="wt-panel">
        <header className="wt-panel__head">
          <h2 className="wt-panel__title">Resolved hosts</h2>
        </header>
        <p className="wt-note">
          Worked out from <code>{window.location.hostname}</code> as each call is made. This build
          carries no environment inside it: one identical image serves a laptop, a preview and the
          live site, which is what lets a release be promoted rather than rebuilt for each.
        </p>
        <dl className="wt-facts wt-facts--mono">
          <dt>This surface ({PRODUCT})</dt>
          <dd>{resolved[PRODUCT]}</dd>
          <dt>Wallet (a path inside Hub)</dt>
          <dd>{resolved.wallet}</dd>
          <dt>Nimbus (tokens)</dt>
          <dd>{resolved.nimbus}</dd>
          {/*
            `signin`, not `account`. This row is labelled "sign-in" and showed the reserved
            `account.<apex>` hostname, which has no DNS record — so a reader checking which
            environment they were on was shown an address that resolves nowhere, on the one panel
            whose entire purpose is to be trusted for that answer.
          */}
          <dt>Account (sign-in)</dt>
          <dd>{resolved.signin}</dd>
          <dt>Lantern (error ingest)</dt>
          <dd>{resolved.lantern}</dd>
          <dt>Reported as</dt>
          <dd>{APP_NAME}</dd>
        </dl>
      </section>
    </>
  )
}
