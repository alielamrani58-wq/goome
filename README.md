# Goöme

The complete source for Goöme's Île-de-France ride-booking pilot: separate passenger, driver and administration websites, a shared domain package, SQL setup/verification scripts, bundled maps and an isolated local payment test app.

The three main portals use Supabase Auth, PostgreSQL and Realtime. The payment test app has its own local PostgreSQL database and synthetic accounts. **Stripe remains disconnected. No live payment or payout is enabled.**

## Repository layout

| Folder | Purpose |
| --- | --- |
| [`web/`](web/) | Passenger website, booking, quotes, live ride status and map |
| [`driver-web/`](driver-web/) | Driver website, availability, GPS and ride lifecycle |
| [`admin-web/`](admin-web/) | Administration, driver approval and trip monitoring |
| [`packages/domain/`](packages/domain/) | Shared ride domain logic and tests |
| [`payment-test/`](payment-test/) | Isolated passenger/driver/admin payment pilot and security tests |

Each portal includes its application code, pinned dependency lockfile, visual assets, font licences, database scripts and deployment configuration. The two map-enabled portals include their Île-de-France map tile packs; the original country-wide archive is not required.

The source was consolidated from the existing app folders without changing the published deployments. [`SOURCE_SNAPSHOT.json`](SOURCE_SNAPSHOT.json) records the original portal revisions. This repository starts with a clean history; unrelated deployment histories and temporary development exports are not included.

## Requirements

- Node.js 24 or newer and npm.
- A Supabase project for the three main portals. Existing project configuration is supplied locally or through the deployment's environment settings.
- Stripe is optional and disabled by default; the isolated payment pilot runs locally without it.

## Install and run the main portals

```sh
npm ci
npm --prefix web ci
npm --prefix driver-web ci
npm --prefix admin-web ci
```

Copy each portal's `.env.example` into an ignored `.dev.vars` file in the same directory. Fill in your own Supabase URL and publishable key. Keep each portal's `GOOME_SITE_ROLE` value as supplied. Never use a service-role key in the browser.

Only the passenger server needs `GOOME_QUOTE_SECRET`. Quote signing requires the same value in the private database configuration; the driver/admin servers should not receive it. Existing deployment environment values and database contents were intentionally excluded from this repository.

Run each portal in a separate terminal:

```sh
npm run dev:passenger   # http://localhost:5173
npm run dev:driver      # http://localhost:5174
npm run dev:admin       # http://localhost:5175
```

The main portals share one Supabase database. Each requires its own sign-in. Configure Supabase's allowed email return URLs for the origins you use, including the separate deployed origins. Administrator access requires a verified email in the private admin allowlist; it cannot be selected at public signup.

Main portal payments are currently collected in the car. The local card-payment prototype is independent and does not change the published portals' payment behavior.

## Database scripts

Each main portal carries the same `database/` scripts. They are copies of the same shared schema, not three separate databases.

- `bootstrap.sql`: core profiles, drivers, trips, guarded booking operations and row access rules.
- `figma-pages.sql`: supporting account, planned ride and driver-document features.
- `verify.sql` and `verify-figma-pages.sql`: transactional checks that roll back their synthetic test data.

**The selected existing Supabase project is already configured. Do not replay bootstrap scripts against it.** For a new project, review the SQL, deployment settings, private admin allowlist and quote-secret configuration first. Never commit a real database export or user records.

## Local payment pilot

```sh
npm --prefix payment-test ci
npm run dev:payments
```

- Passenger: <http://127.0.0.1:4180/>
- Driver: <http://127.0.0.1:4181/>
- Admin: <http://127.0.0.1:4182/>

The first start generates new random local account passwords and a private local database. Neither is included in Git. Stripe actions stay disabled until an explicit future test-account connection is configured and verified.

Read [`payment-test/README.md`](payment-test/README.md) for payment controls, test scenarios and the optional future Stripe connection. Only test keys and the selected Goöme test account are accepted. The payment test app has no live mode switch or bank-payout endpoint.

## Checks

```sh
npm test
npm run test:payments
npm run check:payments
npm --prefix web run typecheck
npm --prefix driver-web run typecheck
npm --prefix admin-web run typecheck
```

The payment test suite covers duplicate requests, authorization/capture separation, access checks, live-key rejection, signed webhooks, cancellations, refunds, transfer recovery and disputes. External Stripe Checkout/onboarding tests remain pending because Stripe is deliberately disconnected.

## Deployment and security

The existing portals were built for Sites/Cloudflare Workers with Vinext. Each portal preserves its own `.openai/hosting.json` identity; publishing is a separate action from pushing this repository. Do not replace one portal's hosting identity with another's or expose private environment values in hosting metadata.

Only source, public assets, configuration templates and verification code belong here. `.env`, `.dev.vars`, `.secrets`, local databases, dependency directories, generated builds and cached credentials are excluded. Map/font attributions and licences are retained. The app is a pilot; email delivery, real-device location, real driver operations and live payment readiness require their own validation before a public service launch.
