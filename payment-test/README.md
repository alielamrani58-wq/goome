# Goöme · Local payment tests

**TEST ONLY. Stripe is deliberately disconnected at the user's request. No real payment, transfer or bank payout is enabled.**

This is an isolated payment pilot, separate from `web`, `driver-web`, `admin-web`, the published Goöme websites and their Supabase project. The three existing source trees were left unchanged. It reuses Goöme's visual style and provides separate passenger, driver and admin portals with synthetic identities and fixed fictional Île-de-France routes. It is not connected to real drivers or the production ride database.

## Start locally

From this directory, run `npm start`, or double-click **Start Goome payment tests.command**. Keep its window open while testing. Stop with Control-C.

- Passenger: <http://127.0.0.1:4180/>
- Driver: <http://127.0.0.1:4181/>
- Administration: <http://127.0.0.1:4182/>

Sign-in details are generated randomly on first start and saved in `.secrets/local-accounts.json`. That file has owner-only permissions. The three accounts have fixed server-owned roles. No production password, e-mail account or bank details are used. Each portal requires its own sign-in.

The local PostgreSQL database runs through PGlite and persists in `.local/postgres`. It has no network database listener or Supabase connection. Only the local server opens it. The server binds **127.0.0.1 only**, checks exact Host/Origin, has no CORS access and refuses a second process on the same database. `.local` and `.secrets` have owner-only access and are ignored by Git. Do not copy them into a deployment or a source archive. The database directory is private on disk; it is not separately encrypted by this app.

Stripe remains disconnected, so the portals show the design and account access with payment buttons disabled. There is **no runtime fake-success fallback**. Payment simulations run only in the automated tests, using a separate in-memory database.

## Optional: connect the existing Stripe sandbox later

Only do this when you decide to connect Stripe. No Stripe bank account is required to run synthetic tests.

1. Run `npm run stripe:login`. Open the official Stripe authorization link it prints. Verify the pairing code and select only **environnement de test Goöme**, account `acct_1UYizCE8YbSmnCes`. Do not select a live account.
2. Run `npm run stripe:login -- --complete` while approving the connection. The isolated CLI profile is stored in `.secrets/stripe-cli.toml`. Neither key values nor webhook payloads are printed by our scripts. The script strips any live-key fields and verifies both the test balance and the exact expected account.
3. In another terminal, run `npm run stripe:listen`. It forwards selected signed test events to `http://127.0.0.1:4189/stripe/webhook`. It does not create a public tunnel or use `--live`. Its signing secret is saved privately.
4. Restart `npm start` after the listener is ready, so the server loads the signing secret.

An existing **restricted test key** can alternatively be stored locally as `STRIPE_SECRET_KEY` in `.secrets/stripe.env`; do not paste it in chat. It needs the relevant test-only permissions for account/balance reads, Customers, Checkout Sessions, SetupIntents, PaymentIntents, Charges, Refunds, Transfers/reversals, Accounts v2 and Account Links. Do not request live access. A key alone is insufficient: the startup account/balance verification must also pass. No key was obtained during this task.

Pinned integration: Stripe Node SDK **23.1.0**, API **2026-10-28.endive**, CLI **1.55.8**. CLI commands use a named isolated profile, never the default/global profile.

## Test journey once connected

1. In the driver portal, create the **test** recipient account and complete Stripe-hosted onboarding using Stripe's official synthetic data. Do not enter real identity or bank details. Stripe may require Connect sandbox configuration before recipient creation; that has not been changed or accepted for you.
2. In the passenger portal, choose a fictional route, then open Stripe Checkout. Use only [Stripe's official test cards](https://docs.stripe.com/testing). Exercise a successful card, a declined card and 3D Secure authentication. The optional save-card checkbox is hosted by Stripe; a separate card-setup flow also requires explicit agreement.
3. After Stripe confirms authorization, the ride becomes visible to the test driver. Accept it, mark arrival, start and finish. Finishing queues capture of the **original agreed fare**.
4. Stripe confirms capture before the backend queues a separate transfer to the verified test recipient. The sample commission is 20%; the driver receives 80% in the **test Stripe balance**. This is a pilot value, not a real commission agreement. There is no bank-payout API in this app.
5. Cancel before completion to release the authorization without a fee. Abandoned unmatched requests expire after 30 minutes. An expired authorization cannot be used to start/finish a ride.
6. From the admin portal, request a full refund. If a transfer exists, it must be reversed first. Failure remains visible and retries safely; it never displays a successful refund merely because the button was clicked. Partial refunds require a future reviewed implementation.

Hosted Checkout success/cancel return URLs do not change payment state. The backend verifies Stripe state through signed webhooks and authenticated reconciliation. A saved card remains with Stripe; the Goöme server never receives a card number or CVC. Test-only mode does not replace fraud, legal, operational or live-readiness review; this pilot is intentionally unable to go live.

## Payment and recovery controls

- Startup refuses live/malformed keys, live balance responses and a different Stripe account. Every relevant Stripe object must be explicitly test mode; nested charge objects are checked too. Refunds and reversals, which have no `livemode` field, are bound to their verified test parent.
- Fixed fares and EUR originate from the server. Browser-submitted amounts/recipients are rejected. Each PaymentIntent is checked against the ride, customer, amount, currency, manual-capture setting and environment metadata.
- The backend authenticates every action and enforces ownership/role checks. Database unique indexes limit active passenger/driver rides. A single process lock plus serialized transactions/actions prevent local races.
- A durable SQL operation queue is written before Stripe actions. Retries use deterministic idempotency keys; external IDs are persisted. An ambiguous transfer blocks refunds until it is recovered. Retries stop for manual review before Stripe's 24-hour minimum idempotency retention expires.
- Authorization, capture, transfer, reversal and refund are tracked separately. No payout precedes confirmed capture or an active recipient transfer capability. Disputes stop further transfers and queue reversal of an existing transfer.
- Webhooks require the Stripe signature over the raw request, have a five-minute timestamp tolerance, reject live/connected-account events and deduplicate event IDs. Current Stripe objects are retrieved so reordered events cannot downgrade or invent payment state. Inbox entries and reconciliation survive restart.
- The SQL ledger stores only necessary references/statuses, not card payloads. The event inbox keeps event ID/type/object ID, not the raw event. Audit logs and error messages contain selected nonsecret fields; raw Stripe errors/payloads/keys are not logged.
- Browser sessions use hashed random tokens, HttpOnly/SameSite=Strict role-specific cookies, an eight-hour expiry and login throttling. Strict same-origin checks, a restrictive CSP and output escaping apply. This is HTTP on loopback for local tests only, never a remote/live deployment.

## Verification performed

Run `npm test` and `npm run check`. The suite uses isolated in-memory PostgreSQL databases and a deterministic Stripe test adapter, plus the real Stripe SDK for signature/API-parameter checks. It covers concurrency, ownership, fare tampering, signature tampering/expiry, foreign/live objects, declined/SCA/expired authorizations, cancellation, timeout recovery, single capture/transfer, reversal/refund ordering, disputes and retry-window expiry. Browser checks covered all three independent local sign-ins and disabled-payment states.

**External Stripe end-to-end tests were not run:** you chose to keep Stripe disconnected. Hosted Checkout, Connect onboarding, real sandbox API permissions and webhook forwarding remain to be verified after a future connection. Passing the local checks does not claim those external flows passed.

No production schema, published website, live Stripe setting, bank account, real payment or live payout was changed.
