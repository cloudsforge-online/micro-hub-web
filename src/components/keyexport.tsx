/**
 * The key export ceremony — 05 journey 5, "the most security-sensitive flow in the programme".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── IT IS A CEREMONY WITH STAGES, NOT A BUTTON ────────────────────────────────────────────────
 *
 * Every stage below is a state `micro-custody` holds and enforces, read from
 * `custody/src/exports.ts`. This screen renders them; it decides none of them. A stage is refused
 * until the one before it completed because CUSTODY refuses it, and the screen shows the refusal
 * custody sent rather than pre-empting it with a disabled control — a disabled button says "not
 * now" and never says why.
 *
 *   1. Request       POST /v1/exports                 → status `cooling_off`, or `denied`
 *   2. Cooling-off   24 hours, held by custody        → `availableAt`, cancellable throughout
 *   3. Challenge     POST /v1/exports/:id/challenge   → a reveal token, ONCE, valid minutes
 *   4. Redeem        POST /v1/exports/:id/redeem      → the key material, ONCE
 *
 * The gates custody applies, and which this screen therefore does not:
 *
 *   - the address must be `active` and owned by the caller (`requestExport`);
 *   - the session's `amr` must carry BOTH `pwd` and `mfa` at request time;
 *   - `micro-policy` must return `allow` — `challenge` and `review` are recorded as `denied`,
 *     deliberately: "a ceremony left open on either would be one an attacker can return to";
 *   - the 24-hour hold must have elapsed, and the refusal states the seconds remaining;
 *   - the second factor must have been answered JUST NOW — custody compares the token's
 *     `auth_time` against its own TTL, so a day-old session is `stale_authentication`;
 *   - the reveal token is single-use, and redemption moves the wallet to `exported` in the same
 *     transaction that spends it.
 *
 * ── THE REVEAL TOKEN AND THE MATERIAL NEVER TOUCH STORAGE ─────────────────────────────────────
 *
 * Both live in component state and die with the component. The token is a bearer secret that
 * yields a private key, and `localStorage` survives the tab, every other tab, and a crash. The
 * material is delivered once, in a `no-store` response, and is never written anywhere by this
 * app — not to storage, not to the observability client, not into an error message.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, noticeFor, type ErrorNotice } from '../lib/api.ts'
import { utcDateTime } from '../lib/format.ts'
import {
  EXPORT_FORMATS,
  cancelKeyExport,
  challengeKeyExport,
  loadKeyExports,
  redeemKeyExport,
  requestKeyExport,
  type ExportFormat,
  type KeyExport,
  type RevealedKey,
} from '../lib/money.ts'
import type { Absence } from '../lib/tile.ts'
import type { WalletRecord } from '../lib/hub.ts'

/** The stages, in order, as a reader sees them. Labels only — custody owns the transitions. */
const STAGES: readonly { readonly status: string; readonly label: string }[] = [
  { status: 'requested', label: 'Requested' },
  { status: 'cooling_off', label: 'Cooling off, 24 hours' },
  { status: 'challenged', label: 'Second factor answered' },
  { status: 'redeemed', label: 'Key revealed' },
]

export function KeyExportPanel({
  wallets,
  walletsAbsent = null,
}: {
  wallets: readonly WalletRecord[]
  /**
   * Set when the wallet list could not be READ, as opposed to being empty.
   *
   * Same conflation as `SendPanel`'s `balanceAbsent`, and worse here: "there is no managed wallet
   * to export" told to somebody whose wallet list simply failed to load is this screen saying
   * CloudsForge holds no key for them, which is the opposite of true.
   */
  walletsAbsent?: Absence | null
}) {
  // Only a managed wallet has a key in custody to export. An external or watch wallet's key was
  // never here, and offering it would be offering something that cannot exist.
  const exportable = wallets.filter((w) => w.origin === 'managed' && w.status === 'active')

  const [address, setAddress] = useState(exportable[0]?.address ?? '')
  const [format, setFormat] = useState<ExportFormat>('keystore')
  const [records, setRecords] = useState<readonly KeyExport[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<ErrorNotice | null>(null)
  /** In memory only. See the header. */
  const [revealToken, setRevealToken] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<RevealedKey | null>(null)
  const [passphrase, setPassphrase] = useState('')

  const reload = useCallback(() => {
    const controller = new AbortController()
    loadKeyExports(controller.signal)
      .then((answer) => setRecords(answer.exports))
      .catch((err: unknown) => {
        // Custody being unreachable costs this panel and nothing else on the page. It is set as a
        // notice rather than as an empty list, because "no export requests" and "could not ask"
        // are different sentences and an empty list would tell the user the wrong one.
        setRecords([])
        setNotice(noticeFor(err, 'Could not read your export requests.'))
      })
    return () => controller.abort()
  }, [])

  useEffect(() => reload(), [reload])

  /**
   * In flight, in a REF rather than in `busy`.
   *
   * ── Why the state flag is not enough on this panel specifically ────────────────────────────
   *
   * `busy` is state, so a second press that lands before React has re-rendered reads the value
   * from the same closure as the first and sails through. On the Send form that is survivable:
   * `POST /v1/withdrawals` requires an `Idempotency-Key`, one key is minted per intent, and
   * `wallet/src/server.ts:674-676` collapses the duplicates — the flag is a convenience and the
   * key is the contract.
   *
   * **There is no key on this route.** `custody/src/server.ts:474` requires none and custody
   * dedupes nothing, so two presses are two ceremonies: two 24-hour clocks, two emails, and two
   * things the user has to cancel. With no server-side collapse to fall back on, the client-side
   * guard has to hold on its own, and a guard that depends on a re-render having happened does
   * not. `lib/idempotency.ts:70-72` states the same rule for the same reason: "the key lives in a
   * ref, not in state: reading it must never depend on a render having happened, because the
   * submit handler reads it during the click that a re-render would race."
   *
   * `busy` stays, because it is what disables the controls and changes their labels. This decides
   * whether the work runs.
   */
  const inFlight = useRef(false)

  const act = (run: () => Promise<unknown>, fallback: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setNotice(null)
    run()
      .then(() => reload())
      .catch((err: unknown) => setNotice(noticeFor(err, fallback)))
      .finally(() => {
        inFlight.current = false
        setBusy(false)
      })
  }

  const live = (records ?? []).filter(
    (r) => r.status !== 'cancelled' && r.status !== 'redeemed' && r.status !== 'denied',
  )
  const history = (records ?? []).filter((r) => !live.includes(r))

  if (exportable.length === 0) {
    return (
      <section className="wt-panel">
        <header className="wt-panel__head">
          <h2 className="wt-panel__title">Export a private key</h2>
        </header>
        {walletsAbsent ? (
          <p className="wt-note wt-note--caveat" role="alert">
            ▲ CloudsForge could not read your wallet list — {walletsAbsent.reason}. That is not the
            same as having no wallet in custody, and nothing here should be read as saying so.
            Reload in a moment.
          </p>
        ) : (
          <p className="wt-note">
            There is no managed wallet to export. CloudsForge only holds keys for wallets it
            provisioned; a wallet you connected yourself was never in custody here.
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="wt-panel">
      <header className="wt-panel__head">
        <h2 className="wt-panel__title">Export a private key</h2>
      </header>

      <p className="wt-note wt-note--caveat">
        Exporting hands you the private key and takes the wallet out of CloudsForge custody
        permanently. It runs over 24 hours, needs your second factor twice, and can be cancelled at
        any point in that window — including from the email CloudsForge sends you when it starts.
      </p>

      {notice && <PanelNotice notice={notice} onEnrol={notice.message.toLowerCase().includes('factor')} />}

      {revealed ? (
        <Revealed revealed={revealed} onDone={() => setRevealed(null)} />
      ) : live.length > 0 ? (
        live.map((record) => (
          <Ceremony
            key={record.id}
            record={record}
            busy={busy}
            passphrase={passphrase}
            onPassphrase={setPassphrase}
            hasToken={revealToken !== null}
            onCancel={() => act(() => cancelKeyExport(record.id), 'That export could not be cancelled.')}
            onChallenge={() =>
              act(
                () =>
                  challengeKeyExport(record.id).then((answer) => {
                    setRevealToken(answer.revealToken)
                  }),
                'The second-factor step could not be completed.',
              )
            }
            onRedeem={() => {
              if (!revealToken) return
              setBusy(true)
              setNotice(null)
              redeemKeyExport(
                record.id,
                revealToken,
                record.format === 'keystore' ? passphrase : undefined,
              )
                .then((answer) => {
                  // The token is spent. Dropping it here as well means a second press cannot even
                  // attempt a replay that custody would refuse anyway.
                  setRevealToken(null)
                  setPassphrase('')
                  setRevealed(answer.export)
                  reload()
                })
                .catch((err: unknown) => setNotice(noticeFor(err, 'The key could not be revealed.')))
                .finally(() => setBusy(false))
            }}
          />
        ))
      ) : (
        <form
          className="wt-form"
          onSubmit={(event) => {
            event.preventDefault()
            act(
              () => requestKeyExport(address, format),
              'That export could not be requested.',
            )
          }}
        >
          <div className="wt-field">
            <label className="wt-field__label" htmlFor="export-address">
              Wallet
            </label>
            <select
              className="cf-select cf-select--mono"
              id="export-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            >
              {exportable.map((w) => (
                <option key={w.id} value={w.address}>
                  {w.chain} · {w.address}
                </option>
              ))}
            </select>
          </div>
          <div className="wt-field">
            <label className="wt-field__label" htmlFor="export-format">
              Format
            </label>
            <select
              className="cf-select"
              id="export-format"
              value={format}
              onChange={(event) => setFormat(event.target.value as ExportFormat)}
            >
              {EXPORT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            {/*
              Every format is offered and custody refuses the ones that make no sense for the
              scheme (`formatRefusal`). Filtering here would need a copy of which schemes support
              which formats, and the copy is the thing that goes stale.
            */}
            <p className="wt-field__hint">
              A keystore is encrypted with a passphrase you choose at the end. CloudsForge will
              refuse a format this wallet’s key cannot be written in.
            </p>
          </div>
          <div className="wt-form__actions">
            <button type="submit" className="cf-btn" disabled={busy}>
              {busy ? 'Starting…' : 'Start the export'}
            </button>
          </div>
        </form>
      )}

      {history.length > 0 && (
        <ul className="wt-rows">
          {history.map((record) => (
            <li className="wt-row" key={record.id}>
              <span className="wt-dot wt-dot--pending" aria-hidden="true" />
              <span className="wt-row__main">
                <span className="wt-row__title cf-num">{record.address}</span>
                <span className="wt-row__sub">
                  {record.status} · {record.format} ·{' '}
                  <span className="cf-num">{utcDateTime(record.requestedAt)}</span>
                  {record.policyDecision && record.policyDecision !== 'allow' && (
                    <> · refused by policy: {record.policyReasons.join(', ') || record.policyDecision}</>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** One live ceremony, with every stage visible and the cancel route always on screen. */
function Ceremony({
  record,
  busy,
  passphrase,
  onPassphrase,
  hasToken,
  onCancel,
  onChallenge,
  onRedeem,
}: {
  record: KeyExport
  busy: boolean
  passphrase: string
  onPassphrase: (value: string) => void
  hasToken: boolean
  onCancel: () => void
  onChallenge: () => void
  onRedeem: () => void
}) {
  const reached = STAGES.findIndex((s) => s.status === record.status)
  const holdOver =
    record.availableAt !== null && new Date(record.availableAt).getTime() <= Date.now()

  return (
    <div className="wt-confirm">
      <h3 className="wt-panel__title">Export in progress</h3>
      <p className="wt-note cf-num">{record.address}</p>

      <ol className="wt-stages">
        {STAGES.map((stage, index) => (
          <li
            key={stage.status}
            className={`wt-stage${index < reached ? ' is-done' : ''}${index === reached ? ' is-current' : ''}`}
          >
            <span className="wt-stage__mark" aria-hidden="true">
              {index < reached ? '✔' : index === reached ? '▸' : '·'}
            </span>
            <span>{stage.label}</span>
          </li>
        ))}
      </ol>

      {record.status === 'cooling_off' && (
        <p className="wt-note">
          {holdOver ? (
            <>The 24-hour hold has passed. Answer your second factor to continue.</>
          ) : (
            <>
              Available from{' '}
              <span className="cf-num">{utcDateTime(record.availableAt)}</span>. Nothing happens
              until then, and you can stop this at any point before it.
            </>
          )}
        </p>
      )}

      {record.status === 'challenged' && (
        <>
          <p className="wt-note">
            Reveal window closes{' '}
            <span className="cf-num">{utcDateTime(record.tokenExpiresAt)}</span>. The key is shown
            once and CloudsForge keeps no copy of it.
          </p>
          {record.format === 'keystore' && (
            <div className="wt-field">
              <label className="wt-field__label" htmlFor="export-passphrase">
                Passphrase for the keystore
              </label>
              <input
                className="cf-input"
                id="export-passphrase"
                type="password"
                value={passphrase}
                autoComplete="new-password"
                onChange={(event) => onPassphrase(event.target.value)}
              />
              {/*
                No length rule here. custody refuses a passphrase under twelve characters
                (`passphrase_required`) and says so; a second minimum in this file is a second
                rule to keep in step with the first.
              */}
              <p className="wt-field__hint">
                CloudsForge cannot recover this. Without it the keystore is not openable.
              </p>
            </div>
          )}
        </>
      )}

      <div className="wt-form__actions">
        {record.status === 'cooling_off' && (
          <button type="button" className="cf-btn" onClick={onChallenge} disabled={busy}>
            {busy ? 'Checking…' : 'Continue with my second factor'}
          </button>
        )}
        {record.status === 'challenged' && hasToken && (
          <button type="button" className="cf-btn cf-btn--ember" onClick={onRedeem} disabled={busy}>
            {busy ? 'Revealing…' : 'Reveal my key'}
          </button>
        )}
        {record.status === 'challenged' && !hasToken && (
          // The reveal token lives in memory and does not survive a reload — deliberately. The
          // honest thing to say is that this window has to be started again, not to offer a
          // button that would post a token this tab does not have.
          <p className="wt-note">
            This tab no longer holds the reveal token. Answer your second factor again to get a new
            reveal window.
          </p>
        )}
        {/* Available at EVERY point in the window, and it needs no second factor (05:296). */}
        <button type="button" className="cf-btn" onClick={onCancel} disabled={busy}>
          Cancel this export
        </button>
      </div>
    </div>
  )
}

/**
 * The material, once.
 *
 * Selectable in whole, wrapping rather than scrolling, and with no copy button that would put a
 * private key on the system clipboard where every other application can read it.
 */
function Revealed({ revealed, onDone }: { revealed: RevealedKey; onDone: () => void }) {
  return (
    <div className="wt-confirm" role="alert">
      <h3 className="wt-panel__title">Your private key, shown once</h3>
      <p className="wt-note wt-note--caveat">
        This wallet has left CloudsForge custody. Store this somewhere only you can reach. It is not
        shown again and CloudsForge cannot produce it a second time.
      </p>
      <dl className="wt-facts wt-facts--mono">
        <dt>Address</dt>
        <dd>
          <code className="cf-num wt-addr">{revealed.address}</code>
        </dd>
        <dt>Chain</dt>
        <dd>
          {revealed.chain} · {revealed.network} · {revealed.scheme}
        </dd>
        {revealed.derivationPath && (
          <>
            <dt>Derivation path</dt>
            <dd className="cf-num">{revealed.derivationPath}</dd>
          </>
        )}
        <dt>Format</dt>
        <dd>{revealed.format}</dd>
      </dl>
      <pre className="wt-secret">{revealed.material}</pre>
      <div className="wt-form__actions">
        <button type="button" className="cf-btn" onClick={onDone}>
          I have saved it
        </button>
      </div>
    </div>
  )
}

function PanelNotice({ notice, onEnrol }: { notice: ErrorNotice; onEnrol: boolean }) {
  return (
    <p className="wt-formerror" role="alert">
      {notice.message}
      {onEnrol && (
        <>
          {' '}
          <Link className="wt-link" to="/security">
            Check your second factors
          </Link>
          . Enrolling one has no screen in Forge Hub yet — identity serves the routes
          (`identity/src/server.ts:1156` onward) and nothing renders them.
        </>
      )}
      {notice.requestId && (
        <>
          {' '}
          Quote <code className="cf-num wt-reqid">{notice.requestId}</code> to support.
        </>
      )}
    </p>
  )
}

/** Re-exported so a test can assert the stage list is the one custody actually holds. */
export const EXPORT_STAGES = STAGES

/** Kept for the type-checker's benefit where a refusal is inspected. */
export const isRefusal = (err: unknown): err is ApiError => err instanceof ApiError
