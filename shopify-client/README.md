# Shopify Safety Gate App

This is the merchant-facing Shopify app for the Safety Gate / RAPEX checker. It helps Shopify merchants find products in their own catalog that may match dangerous non-food products reported in the EU Safety Gate database.

The Firebase backend imports and indexes Safety Gate records. This app turns that backend into Shopify Admin workflows:

- automatic checks on product create/update webhooks
- manual checks for selected products
- bulk catalog checks
- alert queue review, resolve, and dismiss actions
- per-shop similarity threshold settings
- product detail Admin extensions for inline safety status and check actions

The public Shopify configuration currently uses `read_products`. High-risk automation creates alerts and priority-review activity entries, but it does not mutate Shopify product status. Reintroduce `write_products` only if product status changes are restored and reviewed for App Store scope justification.

## Product Scope

The app is built around one merchant question:

> Does this Shopify product look like a product that has already been flagged in EU Safety Gate?

It is not a generic Safety Gate search UI, marketplace scraper, or full compliance rules engine.

## User Workflow

The Shopify Admin flow should stay close to familiar merchant behavior:

1. Review the alert queue.
2. Open the alert detail.
3. Compare the Shopify product against the Safety Gate alert.
4. Decide whether to resolve, dismiss, or re-check.
5. Keep history and status visible for auditability.

UI should be clear for merchants who already understand Shopify Admin menus. Prefer direct operational labels such as "Alerts", "Manual check", "Settings", "Resolve", and "Dismiss" over internal terminology.

## Main Routes

- `app/routes/app._index.tsx`: dashboard summary, monitoring actions, bulk checks
- `app/routes/app.manual-check.tsx`: Shopify product search and on-demand checks
- `app/routes/app.alerts.tsx`: alert list, filters, sorting, detail review, bulk actions
- `app/routes/app.settings.tsx`: per-shop similarity threshold
- `app/routes/api.product-safety-status.ts`: product extension status API
- `app/routes/api.product-safety-check.ts`: product extension check API
- `app/routes/webhooks.products.create.tsx`: product create webhook
- `app/routes/webhooks.products.update.tsx`: product update webhook

## Components

Important reusable UI pieces:

- `app/components/AlertTable.tsx`
- `app/components/AlertDetailModal.tsx`
- `app/components/AlertFilters.tsx`
- `app/components/AlertActions.tsx`
- `app/components/StatusBadge.tsx`
- `app/components/RiskMeter.tsx`
- `app/components/LanguageSwitcher.tsx`

The UI uses Shopify Polaris Web Components. Their custom elements use the `s-` prefix, for example `s-page`, `s-section`, `s-button`, and `s-badge`.

## Localization

Localization is initialized in:

- `app/i18n.ts`

Translation resources live in:

- `app/locales/`

Current structure:

- `en.ts`: full English translation
- `sk.ts`: full Slovak translation
- `core-locale.ts`: shared locale builder for additional EU languages
- `languages.ts`: supported language list
- one file per additional EU official language, for example `de.ts`, `fr.ts`, `pl.ts`, `it.ts`, `ro.ts`

Additional EU locale files include:

- short labels for navigation, actions, badges, and table states
- longer merchant-facing guidance under the `long` block

Do not hardcode merchant-facing strings in routes, components, loaders, or actions. Add translation keys to the locale files and use `useTranslation()`.

## Data Layer

Merchant-facing business data is stored in Firestore through:

- `app/merchant-db.server.ts`
- `app/firestore.server.ts`

Important Firestore-backed data:

- merchant alerts
- merchant check history
- merchant settings
- merchant product snapshots
- webhook error logs

Prisma is used for Shopify auth sessions only:

- `app/db.server.ts`
- `prisma/schema.prisma`

Because this app currently runs Prisma `6.19.3`, `prisma/schema.prisma` still needs an inline SQLite `url` even though `prisma.config.ts` also defines the datasource URL.

## Checker Integration

Shopify-to-Firebase integration lives in:

- `app/services/safety-gate-checker.server.ts`
- `app/services/safety-gate-checker.client.ts`
- `app/services/product-safety-admin.server.ts`

Important behavior:

- Matching is similarity-based, not exact ID matching.
- Product input includes title, description, vendor/brand, product type/category, tags, variants, and images where available.
- Current checker responses distinguish `overallSimilarity` from `imageSimilarity`.
- UI code should use `overallSimilarity` for final match scoring.
- Each shop can configure its own similarity threshold.
- Failed checks should surface clear retryable errors through route `ErrorBoundary` components.

## Required Environment Variables

Typical app variables:

```bash
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SCOPES=...
SHOPIFY_APP_URL=...
SHOPIFY_BILLING_TEST=true
SHOPIFY_APP_HANDLE=safety-gate-monitor-eu
FIREBASE_FUNCTIONS_BASE_URL=https://europe-west1-<project-id>.cloudfunctions.net
SAFETY_GATE_API_KEY=...
SAFETY_GATE_SIMILARITY_THRESHOLD=0
```

The app requires an active Shopify App Pricing subscription before merchants can use the embedded app UI. Pricing, trial days, public/private plans, and the test plan are configured in the Shopify Partner Dashboard, not in this codebase. Keep `SHOPIFY_BILLING_TEST=true` for development stores and private test plans; set it to `false` before real App Store billing. `SHOPIFY_APP_HANDLE` must match the app handle in Shopify.

For local Firebase Admin credentials, use the project-specific setup expected by `app/firestore.server.ts`.

## Development

Install dependencies from the monorepo root:

```bash
npm install
```

Run the Shopify app from the root:

```bash
npm run shopify:dev
```

Or from this directory:

```bash
npm run dev
```

## Validation

Before pushing changes in this app, run:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

The lint command may print a Remix ESLint deprecation warning. Treat TypeScript errors, lint errors, and build failures as blockers.

## Deployment

Use the Shopify CLI commands from this directory:

```bash
npm run config:link
npm run deploy
```

## Files To Check First

For future maintainers and agents:

- `../AGENTS.md`: project memory and conventions
- `app/routes/app.alerts.tsx`: alert workflow
- `app/routes/app.manual-check.tsx`: manual product check workflow
- `app/services/safety-gate-checker.server.ts`: Firebase checker calls
- `app/merchant-db.server.ts`: Firestore merchant data adapter
- `app/locales/index.ts`: locale resource assembly
- `app/locales/en.ts`: complete translation key reference
