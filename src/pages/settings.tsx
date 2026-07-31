/**
 * Settings: the profile Forge Hub can show, and honest statements about the rest.
 *
 * ── What this page deliberately does NOT do ────────────────────────────────────────────────────
 *
 * It does not edit a profile. Identity owns the email, the handle and the password, and
 * `docs/ecosystem/03-repository-responsibilities.md:150` moves the Nimbus `/account` PAGE into
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
 * all — not because of a missing token but because `notify` has no entry in the surface registry
 * (`@cloudsforge/ui/surfaces`), so `cloudsforgeHosts()` cannot produce a URL for it, and it is not
 * one of hub-api's seven upstreams either, which is why the `notifications` tile of every
 * dashboard is permanently `unavailable` (hub-api/src/dashboard.ts:581-598). Two things are
 * missing, both small, and both named here rather than papered over with a switch that does
 * nothing.
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
        <p className="wt-note">
          Your email address, handle, password and account deletion are held once, at the
          CloudsForge Account portal — this app has no copy of them to edit.{' '}
          <a className="wt-link" href={resolved.account}>
            Open account settings
          </a>
        </p>
        <p className="wt-note">
          {/* A router Link, not an anchor: an in-app address served through a full page load
              throws away the session state and the scroll position for no reason. */}
          Two-factor authentication, recovery codes and the list of places you are signed in are on{' '}
          <Link className="wt-link" to="/security">
            Security
          </Link>
          , which reads and writes them against the identity service directly.
        </p>
      </section>

      <NotComposed title="Notification preferences">
        <p>
          The <code>notify</code> service owns notification preferences and serves them at{' '}
          <code>GET /preferences</code> and <code>PUT /preferences</code>. Forge Hub cannot reach
          it: <code>notify</code> has no entry in the CloudsForge surface registry, so there is no
          hostname to resolve at runtime, and it is not one of hub-api&rsquo;s seven upstreams, so
          the notifications tile on every dashboard reports itself unavailable with that reason
          rather than being quietly dropped. A registry entry and one upstream client fix both.
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
          Derived from <code>{window.location.hostname}</code> at runtime, on every call. This
          build contains no environment of its own — the same image serves localhost, a preview
          deployment and production, which is why it can be promoted rather than rebuilt.
        </p>
        <dl className="wt-facts wt-facts--mono">
          <dt>This surface ({PRODUCT})</dt>
          <dd>{resolved[PRODUCT]}</dd>
          <dt>Wallet (a path inside Hub)</dt>
          <dd>{resolved.wallet}</dd>
          <dt>Nimbus (tokens)</dt>
          <dd>{resolved.nimbus}</dd>
          <dt>Account (sign-in)</dt>
          <dd>{resolved.account}</dd>
          <dt>Lantern (error ingest)</dt>
          <dd>{resolved.lantern}</dd>
          <dt>Reported as</dt>
          <dd>{APP_NAME}</dd>
        </dl>
      </section>
    </>
  )
}
