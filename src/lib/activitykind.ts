/**
 * What one activity record MEANS, as a shape the feed can draw.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE DEFECT ────────────────────────────────────────────────────────────────────────────────
 *
 *   *"It is just text. Also it might be good to have more information except 'signed in (my
 *   account)'."*  — micro-org#482
 *
 * Both halves are true and they have different causes.
 *
 * "Just text" was the page: an undifferentiated column of `summary` strings, no marker, no
 * grouping, no amount column, and nothing saying which network a figure belonged to.
 *
 * "More information except signed in" is upstream of this bundle and cannot be fixed here.
 * `micro-identity` emits `identity.session.created` with `deviceId` — a UUID — while
 * `activity/src/classify.ts` reads `text(event, 'device', 48)` and falls back to the bare string
 * `'Signed in.'` when it is absent, which it always is. The `ipPrefix` IS on the payload and is
 * dropped with it, because the classifier only prints it inside the device branch. So every
 * sign-in row in the estate reads `Signed in.` and always has. Repairing it needs a change in
 * `micro-identity` (emit a device NAME) or `micro-activity` (read `deviceId`).
 *
 * ── WHICH IS WHY A ROW MUST NOT DEPEND ON ITS SENTENCE ────────────────────────────────────────
 *
 * This module gives every record a TITLE, a DIRECTION, a standing MEANING and a DESTINATION,
 * derived from `type` — a value activity assigns from a frozen topic table, so it is stable in a
 * way an authored sentence is not. A row is then informative even when the sentence that came
 * with it says four words.
 *
 * `hint` is the sentence a reader gets when the service's own summary adds nothing beyond the
 * title — see `detailFor` below. It is a STANDING property of the event type, never a fact about
 * this particular record: this module has no payload to read and must not invent one.
 *
 * ── EVERY TYPE THE ESTATE CAN EMIT IS NAMED HERE ──────────────────────────────────────────────
 *
 * `activity/src/classify.ts` maps 70 registered topics onto 79 `type` values, and all 79 are in
 * the table below, grouped by the category activity files them under. Ten of them are
 * `visibility: 'internal'` and can therefore never reach a person's feed — they are kept anyway
 * and marked, because a visibility change in `micro-activity` must not produce an unlabelled row
 * in a browser running this bundle.
 *
 * A type this bundle does not know still renders: `kindOf` falls back to the CATEGORY, and then
 * to a plain note. A newer service must never be able to produce a blank row here.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import type { ActivityRecord } from './hub.ts'

/**
 * Five tones, and each one is a shape as well as a colour.
 *
 * Colour is never the only channel (design-system.md §4), so every tone carries a glyph that
 * differs in outline, and the title says the same thing in words.
 *
 *   `in`    ↓  value arrived
 *   `out`   ↑  value left
 *   `alert` ▲  something needs a person: stuck, failed, uncredited, taken away
 *   `guard` ◆  access to the account itself changed
 *   `note`  ◇  it happened, nothing is owed
 */
export type Tone = 'in' | 'out' | 'alert' | 'guard' | 'note'

/** The glyph for a tone. Kept beside the type so the two cannot drift. */
export const GLYPHS: Readonly<Record<Tone, string>> = Object.freeze({
  in: '↓',
  out: '↑',
  alert: '▲',
  guard: '◆',
  note: '◇',
})

export interface Kind {
  /** The headline, in the reader's words. Sentence case, no full stop. */
  readonly title: string
  readonly tone: Tone
  /**
   * What this kind of event means, for when the record's own summary repeats the title. Never a
   * fact about one record — there is no payload here to read one from.
   */
  readonly hint: string | null
  /** Where in this app the thing itself lives. Null when it lives on another product. */
  readonly to: string | null
  /** `true` for the nine types activity files as `internal`, which no person's feed can contain. */
  readonly internal?: true
}

const kind = (
  title: string,
  tone: Tone,
  hint: string | null = null,
  to: string | null = null,
  internal?: true,
): Kind => Object.freeze(internal ? { title, tone, hint, to, internal } : { title, tone, hint, to })

/* ══════════════════════ money in and out of the estate ══════════════════════ */

const DEPOSIT = {
  'deposit.confirmed': kind(
    'Deposit credited',
    'in',
    'This arrived at one of your deposit addresses and is now part of your balance.',
    '/wallet',
  ),
  'deposit.token_uncredited': kind(
    'Token arrived and was not credited',
    'alert',
    'A token landed on one of your deposit addresses that we cannot value, so it is not part of your balance. It is not lost — we hold the key — but getting it back needs a support request.',
    '/wallet',
  ),
  'deposit.address_assigned': kind(
    'Deposit address issued',
    'note',
    'A destination for one coin on one chain. It stays yours, and anything sent to it is credited to this account.',
    '/wallet',
  ),
}

const WITHDRAWAL = {
  'withdrawal.requested': kind(
    'Withdrawal requested',
    'out',
    'You asked us to send this out. It stays on the leaving list until the chain has taken it.',
    '/wallet',
  ),
  'withdrawal.completed': kind(
    'Withdrawal sent',
    'out',
    'The chain has taken this payment. Nothing further is owed on it.',
    '/wallet',
  ),
  'withdrawal.refunded': kind(
    'Withdrawal refunded',
    'in',
    'The payment did not go out, so the amount came back to your balance.',
    '/wallet',
  ),
  'withdrawal.stuck': kind(
    'Withdrawal stuck',
    'alert',
    'The reservation is held and the chain has not told us either way. This money is neither yours to spend nor gone — support can move it on.',
    '/wallet',
  ),
  'withdrawal.stuck_no_settlement': kind(
    'Withdrawal stuck',
    'alert',
    'Nothing picked this payment up to settle it. The amount is still reserved and support can move it on.',
    '/wallet',
  ),
  'withdrawal.failed_refunded': kind(
    'Withdrawal failed, amount returned',
    'in',
    'The payment could not be made and the amount is back in your balance.',
    '/wallet',
  ),
  'withdrawal.failed_held': kind(
    'Withdrawal failed, amount held',
    'alert',
    'The payment could not be made and the amount is still reserved rather than returned. Support has to release it.',
    '/wallet',
  ),
  'withdrawal.outbound_confirmed': kind(
    'Payment confirmed on chain',
    'out',
    null,
    '/wallet',
    true,
  ),
}

const TRANSFER = {
  'transfer.entry_posted': kind(
    'Ledger entry posted',
    'note',
    'A balanced entry against your account. Nothing here is ever edited — a correction arrives as a further entry.',
    '/portfolio',
  ),
  'transfer.exchange_deposit': kind(
    'Moved in from an exchange',
    'in',
    null,
    '/portfolio',
  ),
  'transfer.exchange_withdrawal': kind(
    'Moved out to an exchange',
    'out',
    null,
    '/portfolio',
  ),
}

/* ══════════════════════ what the products do with it ══════════════════════ */

const TRADING = {
  'trading.bot_created': kind('Trading bot created', 'note'),
  'trading.bot_started': kind(
    'Trading bot started',
    'note',
    'This bot is now trading with real balance.',
  ),
  'trading.bot_started_paper': kind(
    'Trading bot started on paper',
    'note',
    'Running on paper. Nothing of yours is at stake and no balance moves.',
  ),
  'trading.bot_paused': kind('Trading bot paused', 'note'),
  'trading.fill_settled': kind('Trade settled', 'note', null, '/portfolio'),
  'trading.fee_settled': kind('Trading fee charged', 'out', null, '/portfolio'),
  'trading.fee_settled_partial': kind(
    'Trading fee partly charged',
    'alert',
    'There was not enough balance to take the whole fee. The remainder is still owed.',
    '/portfolio',
  ),
  'trading.order_bought': kind('Bought', 'in', null, '/portfolio'),
  'trading.order_sold': kind('Sold', 'out', null, '/portfolio'),
}

const MARKET = {
  'market.listing_sold': kind(
    'Item sold',
    'in',
    'Escrow, the fee and every creator royalty settled as one balanced entry against this account.',
    '/portfolio',
  ),
  'market.offer_made': kind('Offer made', 'note'),
  'market.venue_booked': kind('Venue booked', 'out'),
}

const REWARD = {
  'worlds.reward_granted': kind('Reward granted', 'in', null, '/portfolio'),
  'emberkin.reward_granted': kind('Reward granted', 'in', null, '/portfolio'),
  'emberkin.achievement_unlocked': kind('Achievement unlocked', 'note'),
  'emberkin.battle_resolved': kind('Battle resolved', 'note'),
  'aetherholm.building_completed': kind('Building completed', 'note'),
  'aetherholm.research_completed': kind('Research completed', 'note'),
  'aetherholm.spire_captured': kind('Spire captured', 'note'),
}

const BILLING = {
  'billing.entitlement_granted': kind(
    'Access granted',
    'note',
    'This account can now use something it could not before.',
    '/entitlements',
  ),
  'billing.entitlement_revoked': kind(
    'Access ended',
    'note',
    'A grant on this account has come to an end.',
    '/entitlements',
  ),
  'worlds.provision_failed': kind(
    'World could not be set up',
    'alert',
    'You were charged for this and it did not come up. Support can either finish it or refund it.',
    '/entitlements',
  ),
}

/* ══════════════════════ the account itself ══════════════════════ */

const SECURITY = {
  'security.session_created': kind(
    'Signed in',
    'guard',
    'A new sign-in was recorded on this account. If it was not you, sign the other sessions out and change your password.',
    '/security',
  ),
  'security.signed_out': kind('Signed out', 'guard', null, '/security'),
  'security.session_revoked': kind(
    'Session ended',
    'guard',
    'A session was signed out from somewhere other than itself.',
    '/security',
  ),
  'security.device_added': kind(
    'New device recognised',
    'guard',
    'This account was used from a device it had not been used from before.',
    '/security',
  ),
  'security.mfa_added': kind(
    'Two-step verification added',
    'guard',
    'A second factor now stands in front of this account.',
    '/security',
  ),
  'security.mfa_removed': kind(
    'Two-step verification removed',
    'alert',
    'A second factor was taken off this account. If you did not do this, change your password now and add one back.',
    '/security',
  ),
  'security.password_reset_requested': kind(
    'Password reset requested',
    'guard',
    'Somebody asked for a reset link for this account. The link expires, and nothing changes until it is used.',
    '/security',
  ),
  'security.key_export_requested': kind(
    'Private key export requested',
    'alert',
    'An export takes a day on purpose. Cancel it from Wallet if this was not you — once a key leaves custody it cannot be put back.',
    '/wallet',
  ),
  'security.key_exported': kind(
    'Private key exported',
    'alert',
    'A private key has left our custody. That wallet is yours to protect now, and this cannot be undone.',
    '/wallet',
  ),
}

const API = {
  'api.key_issued': kind(
    'API key issued',
    'guard',
    'A key that can act as this account was created. It is shown once and never again.',
    '/settings',
  ),
  'api.key_revoked': kind('API key revoked', 'guard', 'That key no longer works.', '/settings'),
  'api.key_revoked_by_platform': kind(
    'API key revoked by CloudsForge',
    'alert',
    'We revoked this key ourselves rather than at your request. Anything using it has stopped working.',
    '/settings',
  ),
}

const WALLET = {
  'wallet.created': kind(
    'Wallet created',
    'note',
    'A managed wallet was set up for you. We hold the key until you ask to export it.',
    '/wallet',
  ),
  'wallet.link_verified': kind(
    'External wallet verified',
    'note',
    'You proved you hold the key to this address by signing a challenge with it.',
    '/wallet',
  ),
  'wallet.link_revoked': kind('External wallet disconnected', 'note', null, '/wallet'),
  'wallet.authorisation_revoked': kind(
    'Wallet authorisation revoked',
    'guard',
    'Something that was allowed to act on this wallet no longer is.',
    '/wallet',
  ),
  'wallet.sweep_completed': kind('Balance swept to custody', 'note', null, '/wallet', true),
  'wallet.reconciliation_completed': kind('Ledger reconciled', 'note', null, null, true),
}

const ACCOUNT = {
  'account.registered': kind(
    'Account created',
    'guard',
    'One sign-in, one balance and one record, shared by every CloudsForge product.',
    '/settings',
  ),
  'account.email_verification_requested': kind(
    'Verification email sent',
    'guard',
    'Follow the link in it to prove the address. Nothing changes until you do.',
    '/settings',
  ),
  'account.deleted': kind('Account deleted', 'alert'),
  'emberkin.save_started': kind('Save started', 'note'),
}

/* ══════════════════════ things made and held ══════════════════════ */

const TOKEN = {
  'token.deploy_confirmed': kind(
    'Token deployed',
    'note',
    'The contract is on chain and confirmed.',
  ),
  'token.deploy_funding_requested': kind(
    'Token deployment funding requested',
    'note',
    null,
    null,
    true,
  ),
}

const OWNERSHIP = {
  'worlds.provision_completed': kind('World ready', 'note'),
  'emberkin.cosmetic_equipped': kind('Cosmetic equipped', 'note'),
  'aetherholm.city_founded': kind('City founded', 'note'),
  'aetherholm.skerry_provisioned': kind('Skerry provisioned', 'note'),
  'aetherholm.battle_resolved': kind('Battle resolved', 'note'),
  'ownership.parcel_claimed': kind('Parcel claimed', 'note'),
  'ownership.parcel_contested': kind(
    'Parcel contested',
    'alert',
    'Somebody has challenged your claim to this parcel. It stays yours until the challenge resolves.',
  ),
  'ownership.parcel_lost': kind(
    'Parcel lost',
    'alert',
    'This parcel is no longer yours.',
  ),
  'ownership.parcel_transferred': kind('Parcel transferred', 'note'),
  'ownership.object_fired': kind('Object fired', 'note'),
  'ownership.object_anchored': kind('Object anchored on chain', 'note'),
}

const GOVERNANCE = {
  'governance.proposal_executed': kind('Proposal executed', 'note'),
  'governance.vote_cast': kind('Vote cast', 'note'),
  'governance.proposal_opened': kind('Proposal opened', 'note', null, null, true),
}

const COMMUNITY = {
  'worlds.title_registered': kind('Title registered', 'note', null, null, true),
  'emberkin.season_started': kind('Season started', 'note', null, null, true),
  'aetherholm.season_opened': kind('Season opened', 'note', null, null, true),
  'aetherholm.season_sealed': kind('Season sealed', 'note', null, null, true),
  'community.ward_opened': kind('Ward opened', 'note', null, null, true),
}

/** Every `type` `activity/src/classify.ts` can assign. 79 of them, all named. */
export const KINDS: Readonly<Record<string, Kind>> = Object.freeze({
  ...DEPOSIT,
  ...WITHDRAWAL,
  ...TRANSFER,
  ...TRADING,
  ...MARKET,
  ...REWARD,
  ...BILLING,
  ...SECURITY,
  ...API,
  ...WALLET,
  ...ACCOUNT,
  ...TOKEN,
  ...OWNERSHIP,
  ...GOVERNANCE,
  ...COMMUNITY,
})

/**
 * The fallback for a type this bundle has not been taught.
 *
 * A service shipped after this bundle can emit a type that is not in the table, and the row it
 * produces must still be readable — a blank title on a money row is worse than a vague one. The
 * category is the coarser fact activity assigns from the same frozen table, so it survives the
 * addition of a type in a way a `type` lookup does not.
 */
const BY_CATEGORY: Readonly<Record<string, Kind>> = Object.freeze({
  deposit: kind('Money arrived', 'in', null, '/wallet'),
  withdrawal: kind('Money left', 'out', null, '/wallet'),
  transfer: kind('Balance moved', 'note', null, '/portfolio'),
  // No topic produces into `conversion` yet — `activity/src/categories.ts` lists it among the
  // seven "waiting on producers". It is here anyway, because the day one arrives it must not be
  // the only one of the sixteen that renders as the bare word "Recorded".
  conversion: kind('One asset swapped for another', 'note', null, '/portfolio'),
  trading: kind('Trading', 'note', null, '/portfolio'),
  market: kind('Market', 'note'),
  reward: kind('Reward', 'in', null, '/portfolio'),
  billing: kind('Access', 'note', null, '/entitlements'),
  security: kind('Security change', 'guard', null, '/security'),
  api: kind('API access change', 'guard', null, '/settings'),
  wallet: kind('Wallet change', 'note', null, '/wallet'),
  account: kind('Account change', 'guard', null, '/settings'),
  token: kind('Token', 'note'),
  ownership: kind('Ownership', 'note'),
  governance: kind('Governance', 'note'),
  community: kind('Community', 'note'),
})

const UNKNOWN: Kind = kind('Recorded', 'note')

/** The shape to draw a record as. Never throws, never returns a blank title. */
export function kindOf(record: ActivityRecord): Kind {
  return KINDS[record.type] ?? BY_CATEGORY[record.category] ?? UNKNOWN
}

/* ══════════════════════ the four lenses over a feed ══════════════════════ */

/**
 * The groups the filter offers, and why they are these four.
 *
 * A person looking for something in their history is looking for one of four things: money,
 * whether their account is safe, what they own or have been given, or what they did in the
 * products. Fifteen categories is activity's filing system, not a reader's, and a fifteen-way
 * control is a control nobody uses.
 *
 * `all` is not in the table because it is the absence of a filter rather than a fifth group.
 */
export type Lens = 'all' | 'money' | 'security' | 'account' | 'products'

const LENS_OF: Readonly<Record<string, Exclude<Lens, 'all'>>> = Object.freeze({
  deposit: 'money',
  withdrawal: 'money',
  transfer: 'money',
  conversion: 'money',
  trading: 'money',
  market: 'money',
  reward: 'money',
  billing: 'money',
  security: 'security',
  api: 'security',
  account: 'account',
  wallet: 'account',
  ownership: 'products',
  governance: 'products',
  community: 'products',
  // The mute has to be ONE line: the checker tracks only the line immediately above, so a wrapped
  // reason silently stops muting anything. micro-activity names this category after micro-mint's
  // tokens and `products` is a lens id on this page; neither half is a credential.
  // secret-hygiene: allow micro-activity's own category name for mint records, mapped to a lens id
  token: 'products',
})

/** The four lenses, in the order they are offered. */
export const LENSES: readonly { readonly id: Lens; readonly label: string }[] = Object.freeze([
  Object.freeze({ id: 'all' as Lens, label: 'Everything' }),
  Object.freeze({ id: 'money' as Lens, label: 'Money' }),
  Object.freeze({ id: 'security' as Lens, label: 'Security' }),
  Object.freeze({ id: 'account' as Lens, label: 'Account' }),
  Object.freeze({ id: 'products' as Lens, label: 'Products' }),
])

/**
 * Whether a record belongs to a lens.
 *
 * A category this bundle does not know falls into `products` rather than out of every lens: a row
 * that no filter can reach is a row a reader can be shown the absence of and never the presence.
 */
export function inLens(record: ActivityRecord, lens: Lens): boolean {
  if (lens === 'all') return true
  return (LENS_OF[record.category] ?? 'products') === lens
}

/**
 * The line under the title, or null when there is nothing worth saying twice.
 *
 * activity authors one sentence per topic and most of them carry a fact the title cannot — an
 * amount, a counterparty, a state. Some carry nothing: `'Signed in.'` against a row already
 * titled "Signed in" is the same four words in two type sizes, and it is the exact complaint in
 * micro-org#482. Where the summary only repeats the title, the kind's standing meaning is shown
 * instead, and where there is neither, the row stands on its title alone.
 */
export function detailFor(record: ActivityRecord, shape: Kind): string | null {
  const summary = record.summary.trim()
  const bare = summary.replace(/\.$/, '').toLowerCase()
  if (summary.length > 0 && bare !== shape.title.toLowerCase()) return summary
  return shape.hint
}

/**
 * What produced a record, named the way a reader would name it.
 *
 * `record.product` is the SERVICE — `identity`, `devplatform`, `mint` — which is how the estate is
 * built rather than anything a person controls or recognises. The provenance is worth keeping: six
 * services feed this one list and knowing which said a thing is how a support conversation starts.
 * So it is kept and translated, and anything unrecognised falls through unchanged rather than
 * disappearing, because a service added tomorrow must still be attributable.
 */
const PRODUCTS: Readonly<Record<string, string>> = Object.freeze({
  identity: 'Your account',
  custody: 'Key custody',
  wallet: 'Wallet',
  settlement: 'Payments',
  ledger: 'Balance',
  billing: 'Access',
  devplatform: 'Developer platform',
  trade: 'Forge Trade',
  market: 'Forge Market',
  mint: 'Forge Create',
  worlds: 'Forge Worlds',
  emberkin: 'Emberkin',
  aetherholm: 'Aetherholm',
  tessera: 'Tessera',
  community: 'Community',
})

export const productName = (product: string): string => PRODUCTS[product] ?? product

/** Where a link out of a row goes, said as the place rather than as the path. */
const DESTINATIONS: Readonly<Record<string, string>> = Object.freeze({
  '/wallet': 'Wallet',
  '/portfolio': 'Portfolio',
  '/security': 'Security',
  '/settings': 'Settings',
  '/entitlements': 'Access',
})

export const destinationName = (to: string): string => DESTINATIONS[to] ?? to

/**
 * Does this row carry money?
 *
 * The rule micro-org#482 §3 asks for — *"rows carrying money must name the network"* — and it is
 * mechanical on purpose. `amount` is non-null exactly when activity extracted a quantity from the
 * event, so this cannot fall out of step with what is actually printed on the row.
 */
export function carriesMoney(record: ActivityRecord): boolean {
  return record.amount !== null
}
