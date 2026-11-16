# Goöme — Figma implementation

Design source: [Goöme / Écrans](https://www.figma.com/design/LeRtBOmxdtIuMEkWsOM4Kg/Go%C3%B6me?node-id=85-735).

The Écrans page contains 46 screen families at seven viewport sizes. Implementation uses the detailed desktop frames and the corresponding 390 px mobile frames, with responsive layouts between them. Outfit, Figtree, the supplied Goöme wordmark and the exported Pepicons Print assets are served locally. Original SVG exports retain their intrinsic dimensions; the shared icon wrapper scales them proportionally to their design slot.

## Structure

- `components/ride-app.tsx`: accounts, live trip state, location, quotes, portal boundaries and navigation.
- `components/ride-panels.tsx`: passenger booking/search/vehicle choice/options; driver availability and requests; live trip, receipt and activity views.
- `components/account-pages.tsx`: account/profile editing, saved places, payment information, promotions, notification preferences, trusted contacts, help, settings, credits, planned trips, driver revenue and vehicle/documents.
- `components/portal-ui.tsx`: Figma assets, wordmark, avatars, list rows, controls, modals and common page patterns.
- `components/auth-screen.tsx`: Figma authentication layout connected to the existing email/password flow.
- `components/admin-dashboard.tsx`: administration using the same design tokens, including private document review. The Figma file does not include a dedicated administration screen set.
- `app/globals.css`: Figma colors, type, spacing, panels, lists and responsive bottom sheets.
- `lib/figma-assets.json`: local asset paths, original dimensions and source frame references.

URLs use `?page=...` for the account and supporting pages. The passenger, driver and administration sites keep their separate portal configuration, hostnames and permissions.

## Pilot adaptations

- Authentication remains verified email/password. SMS, Apple and Google sign-in are not enabled or simulated.
- Payment remains in the vehicle. Card entry, Stripe, Apple Pay, bank authentication, automatic tips and referral credit are not enabled or simulated.
- Vehicle categories remain the existing backend categories: Berline, Confort and Van. No electric vehicle availability is claimed.
- The live vector map and real routes remain interactive. Figma's static map image, sample vehicles, demand multipliers, names, ratings and balances are not used as live data.
- Pickup uses the assigned driver's name and plate; the pilot does not yet use the Figma pickup PIN flow.
- A planned trip saves a departure plan, which the passenger confirms at departure for a fresh price and available driver. It is not an automatically dispatched reservation. This is stated in the interface.
- Revenue is computed from the returned completed trips, with real payment confirmations. There are no automatic commissions or transfers.
- The existing passenger rating API is retained. Driver ratings of passengers and written feedback are not yet enabled.
- Notifications and ride sharing use the actual capabilities available in an open browser. Background SMS/push, automatic emergency-location transmission and continuous background GPS are not claimed.

## Database and verification

`database/figma-pages.sql` adds checked account, saved-place, contact, plan and document APIs. Driver documents use a private storage bucket with owner/admin access and a 5 MiB PDF/JPEG/PNG limit. Metadata is read through checked RPCs; the new tables have row security and no direct authenticated table access. Upload/replacement requires a fresh driver review and cannot interrupt an active trip.

Run the transactional checks in `database/verify.sql` and `database/verify-figma-pages.sql` against the configured Supabase project. They roll back all synthetic identities and records. The checks cover ride progression, prices, payment confirmation, ownership, invalid inputs, account persistence, plans, private document access and admin review. Browser checks cover real address search, three signed prices, route display, registration entry, page navigation, mobile layout, asset loading and proportions.

The SQL file describes the already-applied additive schema change; do not rerun it over the existing tables. Preserve existing users, records, Supabase credentials and each site's hosting identity.

## Credits

Pepicons Print by CyCraft, CC BY 4.0. Outfit and Figtree, SIL Open Font License (bundled under `public/fonts`). Map data © OpenStreetMap contributors, rendered with Protomaps. The in-app credits page links the icon and map licenses.
