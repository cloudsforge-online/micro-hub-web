/**
 * Settings: who you are signed in as, what you can change, and where each of those lives.
 *
 * ── What this page deliberately does NOT do ────────────────────────────────────────────────────
 *
 * It does not edit a profile. Identity owns the email, the handle and the password, and
 * `docs/ecosystem/03-repository-responsibilities.md` moves the Nimbus `/account` PAGE into
 * this repository — not a second copy of the account itself. Duplicating the edit forms here means
 * two validators, two rate limits and two places for a password change to go subtly wrong.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE REDESIGN, AND WHAT WAS ACTUALLY WRONG ─────────────────────────────────────────────────
 *
 *   *"it have a lot of ugly text in boxes in access and settings"*
 *
 * Measured rather than guessed: the page as it stood was FIVE paragraphs of prose, a two-row
 * definition list, and an eleven-row monospace dump of internal base URLs. Four of the five
 * paragraphs explained why a piece of the estate is built the way it is — which is true, is worth
 * writing down, and belongs in the source comments where it was ALREADY WRITTEN DOWN, verbatim,
 * directly above the paragraph that repeated it. The reader got the engineering rationale twice
 * and their own handle once, in 11px grey, above a wall of hostnames.
 *
 * Three changes, in order of how much they matter:
 *
 *   1. **The account is the subject again.** The handle is set at display size beside its initial,
 *      which is the only personal mark this bundle carries anywhere, and the roles are chips
 *      rather than a comma-joined string in a `<dd>`.
 *
 *   2. **A settings page is a list of things you can change**, so it is one. Three cards, each
 *      naming a thing and the place that owns it. Two of them are honest holes and stay honest —
 *      but a hole is one sentence and a dashed border, not a paragraph of service internals with
 *      `GET /preferences` set in code font.
 *
 *   3. **The hostname dump is diagnostics and is now labelled and folded as diagnostics.** It is
 *      genuinely useful — it is the fastest answer to "which environment am I talking to" without
 *      a console — and it was also four fifths of the page by height. `<details>` keeps every row
 *      one click away and stops it outweighing the account it describes. Nothing is removed: the
 *      rows, and the reasons the last four do not follow the network switcher, are all still here.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── Notification preferences are a stated hole ─────────────────────────────────────────────────
 *
 * `notify` serves `GET /preferences` and `PUT /preferences`, and it is not reachable from here at
 * all: `notify` has no entry in the surface registry (`@cloudsforge/ui/surfaces`), so
 * `cloudsforgeHosts()` cannot produce a URL for it, and hub-api composes notifications but exposes
 * no preferences route of its own. A registry entry, or one more hub-api route, closes it. Stated
 * rather than papered over with a switch that does nothing.
 */
import { Link } from 'react-router-dom'
import { useSession } from '../lib/auth.tsx'
import { APP_NAME, PRODUCT, hosts } from '../lib/hosts.ts'
import { viewedNetwork, viewedSurfaceUrl } from '../lib/viewed.ts'

export function SettingsPage() {
  const { account } = useSession()
  const resolved = hosts()
  const viewed = viewedNetwork()
  const handle = account.handle ?? null
  const roles = account.roles ?? []

  return (
    <>
      <header className="wt-page__head">
        <h1 className="wt-page__title">Settings</h1>
      </header>

      <section className="wt-panel">
        <div className="wt-identity">
          <span className="wt-identity__initial" aria-hidden="true">
            {(handle ?? '?').slice(0, 1)}
          </span>
          <span className="wt-identity__who">
            <p className="wt-identity__handle">{handle ?? 'Signed in'}</p>
            {roles.length > 0 ? (
              <ul className="wt-identity__roles">
                {roles.map((role) => (
                  <li key={role}>
                    <span className="wt-chip">{role}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="wt-setting__sub">No extra roles on this account.</p>
            )}
          </span>
        </div>

        <ul className="wt-settings">
          {/*
            The one card with somewhere to go, so it is first and it is the only one with a button.
            A router Link and not an anchor: an in-app address served through a full page load
            throws away the session state and the scroll position for no reason.
          */}
          <li className="wt-setting">
            <p className="wt-setting__title">Sign-in and security</p>
            <p className="wt-setting__sub">
              Your second factor, your recovery codes, and every device you are currently signed in
              on.
            </p>
            <Link className="cf-btn wt-setting__go" to="/security">
              Open Security
            </Link>
          </li>

          {/*
            ── THIS CARD USED TO BE A LINK TO `account.<apex>`, WHICH DOES NOT RESOLVE ──────────

            `resolved.account` is the RESERVED hostname. It is one of exactly two subdomains out of
            twenty-seven with no DNS record on either network (the other is `worlds-api`), so the
            link did not 404 — it failed to resolve at all and the browser showed its own error
            page. The sentence around it was wrong the same way: it promised a "CloudsForge Account
            portal", and there is no such surface. `micro-identity` binds 4001, serves an API and
            renders no HTML at all (`identity/src/server.ts` §3, asserted at its own test).

            So it is not repointed, it is retired. Repointing at `signin` would be the account
            menu's old defect: sending a reader who is already signed in to the sign-in form.
          */}
          <li className="wt-setting wt-setting--none">
            <p className="wt-setting__title">Email, handle and password</p>
            <p className="wt-setting__sub">
              Held in one place and shared by every CloudsForge product. That service answers
              programs rather than people and has no page yet, so there is nowhere we can send you
              to edit them. We keep no second copy here to change instead — it would only be a copy
              that drifts.
            </p>
          </li>

          <li className="wt-setting wt-setting--none">
            <p className="wt-setting__title">Notification preferences</p>
            <p className="wt-setting__sub">
              Choosing what we email you about is not wired up yet. The service that owns it is not
              reachable from this page, and a switch that changed nothing would be worse than
              saying so.
            </p>
          </li>
        </ul>
      </section>

      {/*
        Resolved hosts, folded. It is only ever a list of public base URLs.

        ── IT HAS TO ANSWER TWO QUESTIONS, BECAUSE THERE ARE TWO ANSWERS ──────────────────────

        Until the combined view (micro-org#459) the hostname decided everything and one list was
        the whole truth. It is not any more: the switcher moves the money services and the chain to
        the viewed network while identity and the error ingest deliberately stay on the estate
        serving this bundle (`lib/viewed.ts` says which and why). A single list would therefore be
        wrong about half its rows for any reader who had switched — on the ONE panel whose entire
        purpose is to be trusted for that answer, which is exactly the defect the `account` row
        below was already fixed for once.
      */}
      <section className="wt-panel">
        <header className="wt-panel__head">
          <h2 className="wt-panel__title">Connection</h2>
          <span className="wt-chip cf-num">{viewed}</span>
        </header>
        <p className="wt-note">
          You are viewing <strong>{viewed}</strong> data, from a page served by{' '}
          <code className="cf-num">{window.location.hostname}</code>. Switching networks moves your
          balances, deposits and the chain; your sign-in stays where it was issued.
        </p>

        <details className="wt-more">
          <summary>Every address this page is calling — useful if you are reporting a problem</summary>
          <dl className="wt-facts wt-facts--mono">
            <dt>This surface ({PRODUCT})</dt>
            <dd>{resolved[PRODUCT]}</dd>
            <dt>Wallet (a path inside Hub)</dt>
            <dd>{resolved.wallet}</dd>
            {/*
              The four that follow the switcher. `viewedSurfaceUrl` is the same call the code paths
              make, not a re-derivation of it — a diagnostics panel that computes its own answer is
              a panel that can agree with itself while disagreeing with the request that was sent.
            */}
            <dt>Balances and deposits</dt>
            <dd>{viewedSurfaceUrl('pay')}</dd>
            <dt>Custody (keys)</dt>
            <dd>{viewedSurfaceUrl('keyvault')}</dd>
            <dt>Mining pool</dt>
            <dd>{viewedSurfaceUrl('pool')}</dd>
            <dt>Hearth (JSON-RPC)</dt>
            <dd>{viewedSurfaceUrl('rpc')}</dd>
            {/*
              `signin`, not `account`. This row is labelled "sign-in" and showed the reserved
              `account.<apex>` hostname, which has no DNS record — so a reader checking which
              environment they were on was shown an address that resolves nowhere, on the one panel
              whose entire purpose is to be trusted for that answer.
            */}
            <dt>Account (sign-in)</dt>
            <dd>{resolved.signin}</dd>
            <dt>Nimbus (tokens)</dt>
            <dd>{resolved.nimbus}</dd>
            <dt>Lantern (error ingest)</dt>
            <dd>{resolved.lantern}</dd>
            <dt>Reported as</dt>
            <dd>{APP_NAME}</dd>
          </dl>
          <p className="wt-note">
            Worked out from the address bar and the network you are viewing, as each call is made —
            this build carries no environment inside it, which is what lets one image serve a
            laptop, a preview and the live site. The last four do not move when you switch
            networks: your sign-in belongs to the estate that issued it, and errors from this page
            are filed against the deployment that served it.
          </p>
        </details>
      </section>
    </>
  )
}
