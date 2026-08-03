# cloudsforge-hub-web

[![ci](https://github.com/cloudsforge-online/micro-hub-web/actions/workflows/ci.yml/badge.svg)](https://github.com/cloudsforge-online/micro-hub-web/actions/workflows/ci.yml)
![node](https://img.shields.io/badge/node-%3E%3D22-5FA04E?logo=node.js&logoColor=white)
![typescript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![module](https://img.shields.io/badge/module-ESM-F7DF1E?logo=javascript&logoColor=black)
![tests](https://img.shields.io/badge/tests-in--process%20DOM-6E56CF)

**Forge Hub** — the CloudsForge control centre. Dashboard, portfolio, wallet, activity, security,
settings and entitlements, in one signed-in surface.

Per `docs/ecosystem/03-repository-responsibilities.md` §1 this repository owns the surface that
absorbs the Nimbus `/account` page and the game's wallet screens: the wallet stops being something
you visit inside a product, and becomes a page inside the place you already are.

It is a **static bundle**. There is no server here, no rendering process and nothing in the image
but nginx and hashed files.

---

## The three rules this app is built on

**1. Nothing in the bundle knows which environment it is in.** Every host is resolved in the
browser from `window.location.hostname`, on every call, through `cloudsforgeHosts()` in
`@cloudsforge/ui`. There is no `.env`, no `VITE_` variable, no `define` in the Vite config and no
build argument that reaches the bundle. One image serves localhost, a preview deployment, staging
and production, which is what makes promotion *promotion* rather than a rebuild — otherwise the
artefact that reaches production is not the artefact that passed CI.
`test/no-build-time-config.test.ts` greps the whole source tree and fails the build if it comes
back.

**2. A degraded page is a normal page.** hub-api composes eleven tiles from seven services and
answers a 200 with holes rather than a 500 — one slow upstream costs one tile, not the page. That
property is only worth anything if the client draws the holes, so every panel carries the tile's
own `status`, `reason` and cache age, and the page banner names what is not current. **A client
that renders a failure state because one tile is unavailable throws away hub-api's entire design**,
and its seven degradation tests with it.

**3. A missing number is missing, never zero.** `wallet/src/pricingclient.ts`: "an asset absent
from it means 'no usable price' rather than zero. A zero would be a valuation, and a valuation of
zero is a lie about a holding that exists." A holding with no usable quote renders its amount and
*no value*, with pricing's own reason beside it. The portfolio total is suppressed entirely when
nothing could be priced — hub-api sends `totalUsd: "0"` in that case, truthfully, because zero is
the sum of an empty set, and printing it would tell a user whose portfolio is intact that it is
worth nothing. `lib/portfolio.ts` is the single guard, and `test/portfolio.test.ts` is the pin.

---

## What it talks to

| Service | How | What for |
| --- | --- | --- |
| **hub-api** | same origin in production, `http://localhost:3010` under `pnpm dev` | every page |
| **identity** (Nimbus) | always cross-origin, `hosts().nimbus` | tokens, refresh, `/auth/me`, the session list, MFA factors |
| **Lantern** | `hosts().lantern` | browser error and page-load ingest, unauthenticated |
| **wallet** | always cross-origin, `hosts().pay` | withdrawals and deposit addresses — the Send and Receive forms |
| **custody** | always cross-origin, `hosts().keyvault` | the key export ceremony |

Forge Hub is also **the estate's sign-in surface**: `@cloudsforge/ui`'s `signin` registry row
resolves to `<hub>/account`, so `signInRedirect()` in all thirteen frontends lands on
`/account/login` here. See "The sign-in surface" below.

### Two things `micro-deploy` has to add before Send, Receive and Export work in a browser

Both are recorded here because this bundle cannot work around either, and neither is visible from
inside this repository.

1. **`pay.<apex>` and `vault.<apex>` need gateway routers.** There is none for either in
   `deploy/gateway/dynamic/`. The routers that exist for `micro-wallet` are on the API host
   (`public-api.yml:118-124`).
2. **Those routers need the `cf-cors` middleware, and the API host's routers deliberately do not
   have it** — "The API host is not a browser origin for a first-party app… so it gets the
   security headers without the app CORS allowlist" (`public-api.yml:66-69`). A first-party
   browser calling `api.<apex>` would be refused by CORS with nothing logged server-side, which is
   the failure mode `policy.yml` already records twice: "an allowlist that omits an origin fails
   closed and silently."

`hosts().keyvault` is pinned to custody in the registry and checked by
`ui/packages/ui/src/surfaces.test.ts:196`. `hosts().pay` is **not** pinned, because `micro-wallet`
binds the service-template default `PORT=4000` and is separated from its neighbours by compose —
so there is no distinctive port to pin it against, and the registry's 4003 is an allocation rather
than a fact. `emberkin-web` already resolves the billing half of the payments API through the same
row.

### The five hub-api routes, and the five only

Every one was read off `hub-api/src/server.ts` and the line is cited in `src/lib/hub.ts`. This is
not ceremony: `wallet/src/pricingclient.ts` calls `GET /v1/quotes`, which pricing has never served
— the rate board is `GET /rates` — and the mistake typechecks perfectly on both sides.
`test/hub.test.ts` asserts the method, path and query of every request this bundle can make, and
fails if it ever produces a path outside the two route tables.

| Route | Used by | Note |
| --- | --- | --- |
| `GET /v1/dashboard` | Overview, Wallet, Security, Access | eleven tiles, one call |
| `GET /v1/portfolio` | Portfolio | body is `{ portfolio: <tile> }`, not a bare tile |
| `GET /v1/activity` | Activity | **not** a `Tile<T>` — a flat page with `status` beside `records` |
| `GET /v1/search` | the ⌘K field in the bar | per-group degradation, honestly `truncated` |
| `GET /v1/next-actions` | (available; the Overview reads them from the dashboard) | |

The Wallet, Security and Access pages read `/v1/dashboard` because **hub-api serves no wallet,
security or entitlements route** — those are tiles of the composed response. That costs nothing:
hub-api caches the wallet registry for 60s and the rest per upstream, keyed per user.

### What is called on identity directly, and why

The session list (`GET /sessions`), a single revoke (`DELETE /sessions/:id`) and sign-out-
everywhere (`DELETE /sessions`) are not composed by hub-api at all — identity guards them with
`authenticateUser`, which refuses a service token, so no credential hub-api could hold would reach
them. Proxying them would also flatten the audit trail: identity records a revoke against the
presenting session, and a BFF in the middle makes every sign-out in the estate look like it came
from hub-api.

### The sign-in surface

`/account/login`, `/account/register` and `/account/logout` are **the estate's**, not Forge Hub's.
`signInRedirect()` in `@cloudsforge/ui` sends every signed-out visitor of all thirteen frontends
here, and until they existed it sent them to `account.<apex>` — a hostname no repository in the
estate serves. identity binds the port behind it and renders no HTML at all; its own
`server.test.ts:890` asserts that `/`, `/portal` and `/dashboard` 404. docs/ecosystem/22 §8.1
records it as the catalogue's largest blocker, with 86 of 318 browser scenarios starting at a
sign-in that had no page.

Hub took it because it is the only bundle that could today: it is deployed, its nginx already
serves `/account/*`, and `hub.cloudsforge.online` is on the gateway CORS allowlist — which matters,
because the form POSTs credentials to `nimbus.<apex>` cross-origin and `account.cloudsforge.online`
is not on that list.

- Sign-in is `POST /auth/login`, then `POST /auth/mfa` when identity answers `mfaRequired`.
- A **same-origin** return address is a full navigation back into this bundle. A **cross-origin**
  one gets a hand-off code from `POST /auth/handoff`, carried in the fragment and redeemed by
  `consumeAuthCallback()` at the far end.
- `?return=` is attacker-controllable and is **not** validated against a list here. identity
  refuses to mint a code for an origin off `IDENTITY_HANDOFF_ORIGINS`, and that refusal is shown
  as a refusal rather than being turned into a redirect to the dashboard.
- **`IDENTITY_HANDOFF_ORIGINS` must name every frontend origin**, or SSO from that surface stops
  at "CloudsForge will not hand a session to …". It is empty in `identity/.env.example:65`.
- Nothing on these pages holds a credential rule. identity answers a refusal with a `fields`
  array; the form renders those sentences and clears nothing else.

`src/lib/routes.ts` declares them as `PUBLIC_ROUTES` with a stated reason each, and
`test/routes.test.ts` reads that list: an ungated `<Route>` that is not on it fails the build, and
so does a listed one that is gated.

---

## Running it

```bash
pnpm install          # @cloudsforge/ui resolves through link:../ui/packages/ui
pnpm dev              # http://localhost:5180
pnpm typecheck
pnpm test
pnpm build            # -> dist/
```

`pnpm dev` expects hub-api on `http://localhost:3010` and identity on `http://localhost:4001` —
the surface registry's dev ports, resolved at runtime like everything else. Nothing needs to be
configured for that to happen, and nothing *can* be: see rule 1.

The image:

```bash
docker build -t hub-web --build-context uipkg=../ui --build-arg RELEASE=$(git rev-parse HEAD) .
docker run --rm -p 8080:8080 hub-web
```

`--build-context uipkg` mirrors the `link:` specifier in `package.json` and disappears the day
`@cloudsforge/ui` is published. `RELEASE` is stamped into the `cf-release` meta tag that
`src/lib/obs.ts` reads, so an error report names the deploy that produced it. It is an *identity*,
not a configuration.

### There is no `.env.example`, and that is the point

This app has no runtime configuration to place in one. Adding the file would also fail
`test/no-build-time-config.test.ts`, which asserts that no `.env*` file exists in the repository at
all — a `.env.example` is where a `.env` comes from. The four hostnames the app uses come from the
surface registry, and the only per-deployment value in the image is the release sha, which is a
build argument that names the artefact rather than telling it where it is running.

---

## Layout

```
src/
  lib/
    hosts.ts       which surface this is, and where its API is — resolved at runtime
    api.ts         tokens, ONE refresh at a time, one error shape         (from web-template)
    auth.tsx       session context and the route gate                     (from web-template)
    obs.ts         browser error ingest: never throws, batches, bounded   (from web-template)
    resource.ts    one fetch, four states                                 (from web-template)
    hub.ts         hub-api's routes and response types, each citing its source line
    tile.ts        the three tile statuses, and how a panel talks about them
    portfolio.ts   the never-invent-a-number guard
    feed.ts        the activity cursor walk, as a pure reducer
    settled.ts     two independent reads, neither able to take the other down
    format.ts      decimal strings to text, without ever going through a float
    routes.ts      the address list the router, the nav and nginx are all checked against
  components/
    shell.tsx      the company bar, the sub-nav, the ⌘K field
    states.tsx     loading / empty / failed / forbidden                   (from web-template)
    tile.tsx       a panel that tells the truth about the tile inside it
  pages/           overview, portfolio, wallet, activity, security, entitlements, settings,
                   search, not-found
```

Six files are carried from `web-template` and are deliberately unchanged, except for one fix noted
below — they are the layer that has actually been run against Nimbus.

### The router, the navigation and nginx

Three files describe this app's addresses: `src/lib/routes.ts` (the declaration, which the
sub-navigation is derived from), `src/app.tsx` (what renders where) and `nginx.conf` (which
addresses are served the shell at all). The third is not optional: **nginx enumerates the real
routes and answers 404 for everything else**, then serves the app shell through
`error_page 404 /index.html` so the reader gets a real page *and* an honest status. The estate's
current site returns 200 for every address in existence, so its "page not found" screen is served
as a success — indexed by crawlers, called healthy by monitors, and a deploy that drops a route
looks exactly like one that did not.

The cost is that a route added to the router and not to nginx works perfectly under `pnpm dev` and
404s on the first hard refresh in production. `test/routes.test.ts` reads all three files and fails
the build when they disagree, because "remember to update nginx.conf" is not a mechanism.

`/account/*` and `/billing/*` are routed even though they are not in the navigation: they are the
destinations hub-api's "needs you" cards link into (`/account/security`,
`/account/restrictions/<id>`, `/billing/subscriptions/<id>`). Every card "carries a verb and a
destination", and a destination that 404s is a worry with no outlet.

---

## Tests

```bash
pnpm test        # node --import tsx --test test/*.test.ts — 174 tests
```

`node:test` only. No Jest, no Vitest, no React Testing Library and **no jsdom**: jsdom is a second
browser implementation to keep current, it disagrees with real ones in exactly the places that
matter, and a test that renders a component in it proves the component renders in jsdom. What is
tested is the layer where a mistake costs something — the four globals it touches are stubbed in
`test/browser-stubs.ts`.

| File | What it pins |
| --- | --- |
| `api.test.ts` | ten concurrent 401s cause **one** refresh; the SSO code leaves the address bar **before** the exchange is sent |
| `errors.test.ts` | the estate's nested `{error:{code,message,requestId}}` envelope — see the fix below |
| `hub.test.ts` | every request's method, path and query, against hub-api's and identity's real route tables |
| `portfolio.test.ts` | a portfolio with no usable price renders **no** total, not `$0.00` |
| `format.test.ts` | an 18-decimal amount survives formatting intact; fractions are **cut**, never rounded |
| `feed.test.ts` | duplicate records, an echoed cursor, an unavailable page, an empty-but-not-final page |
| `tile.test.ts` | an `unavailable` tile's empty array is never rendered as an answer |
| `settled.test.ts` | one dead source costs one panel, not the page |
| `routes.test.ts` | the router, the navigation and nginx.conf agree |
| `hosts.test.ts` | one image serves every environment |
| `obs.test.ts` | the reporter's queue bound and envelope |
| `no-build-time-config.test.ts` | rule 1, as a grep over every source file |

---

## Found while building this

Both are recorded rather than worked around, in the spirit of hub-api's own gap list.

1. **`src/lib/api.ts` read the error envelope as flat, and the estate's is nested.** Every service
   answers a failure with `{ "error": { "code", "message", "requestId" } }` —
   `hub-api/src/server.ts:589`, `identity/src/server.ts:1431`, `service-template/src/server.ts:342`.
   The web template's client read `data.error` as a *string* and assigned it straight into the
   message, so against any real service every server-side failure would have rendered on screen as
   `[object Object]`, with the message, the code and the request id all present in the response and
   all discarded — and the request id is the one string a user can quote that finds their request
   across every service at once. Fixed here in `readErrorBody()`, which accepts both shapes and is
   pinned by `test/errors.test.ts`. **The same defect is still in `web-template/src/lib/api.ts`**
   and in every frontend instantiated from it.

2. **`web-template`'s CI rule "The SPA fallback keeps its 404" fails on its own `nginx.conf`.** The
   step greps for `try_files $uri /index.html`, and the config file's header *quotes* that
   directive in the comment explaining why it is forbidden. The grep matches the warning. This
   repository's copy strips comment lines first, and `test/routes.test.ts` does the same.

### Gaps: things Forge Hub should show and cannot

Each is named on screen by a `NotComposed` panel rather than omitted, for the reason hub-api gives
about its own notifications tile: "a client given no tile at all shows nothing and nobody notices
the feature is missing."

1. **Transfers and conversions.** Wallet serves `POST /v1/transfers` and `POST /v1/conversions`,
   both idempotency-keyed. Nothing in the estate LISTS either afterwards, so a form for them could
   submit and the result would then vanish; `POST /v1/transfers` is also addressed by a `toUserId`
   that no route resolves a handle to.
2. **Connecting an external wallet.** `POST /v1/wallets` issues a challenge nonce and
   `POST /v1/wallets/verify` takes the signature over it. The step between the two is the owner
   signing with their own key, and this bundle has no signer — no extension bridge, no hardware
   transport, no dependency that provides one. A field asking a user to paste a signature is not
   that journey.
3. **The withdrawal fee, before confirmation.** 05:269 requires it. `micro-wallet` quotes the fee
   inside `POST /v1/withdrawals` and serves no route that quotes one, so the Send confirmation
   says the fee is not yet known and the receipt states it. A figure computed here would be
   invented.
4. **Policy `deny` / `challenge` / `review` on a withdrawal.** The withdrawal path consults no
   policy service today, so there is no decision for a screen to render.
5. **MFA enrolment.** identity serves six MFA routes; nothing renders them, so the Security page
   states whether a factor exists and cannot add one — which also means the key-export ceremony
   can be blocked by a gate the user has no screen to satisfy.
6. **A QR code on the receive screen.** No QR dependency in the bundle, and a hand-rolled encoder
   in the screen that produces a payment destination is a worse risk than the address in full.
7. **Notification preferences.** `notify` serves `GET`/`PUT /preferences`, but `notify` has no
   entry in the surface registry, so `cloudsforgeHosts()` cannot produce a URL for it — and it is
   not one of hub-api's seven upstreams either, which is why the `notifications` tile is
   permanently `unavailable`. A registry entry and one upstream client fix both.
8. **A device inventory.** Identity records a device per session and this app shows the browser and
   OS family on each, but there is no route that lists devices in their own right, so a device you
   are no longer signed in on cannot be shown or forgotten.
9. **A portfolio time series.** hub-api serves a point-in-time valuation and no history, so there
   is no area chart on the Portfolio page. Inventing a series from one reading would be a chart of
   a number the estate has never recorded.
10. **Per-record detail views.** hub-api's cards deep-link to `/wallet/deposits/<id>` and
   `/billing/subscriptions/<id>`. Those addresses resolve to the list that contains the record,
   which is honest but not what the link promises.

## Untested

The parts that need a real browser: the `window` listeners in `src/lib/obs.ts`, the ⌘K key binding,
and React rendering itself. They are listed rather than approximated in jsdom.

---

## Provenance

The code in this repository was written by **Claude Opus 5** and **Claude Fable 5**, assets
generated with **FLUX 2 Pro**, under human direction and review.
