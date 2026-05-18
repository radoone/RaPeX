# Safety Gate / RAPEX Shopify Checker

This monorepo contains a Firebase backend and a Shopify app for checking merchant products against the EU Safety Gate database, formerly known as RAPEX.

The product goal is:

> Detect when a product sold in a Shopify store appears in, or is similar to, a dangerous non-food product reported in EU Safety Gate.

The app is not a generic Safety Gate browser and not a broad compliance rules engine. It is a merchant workflow for product safety monitoring inside Shopify Admin.

## What It Does

1. Imports EU Safety Gate alerts from OpenDataSoft into Firestore.
2. Stores alert metadata, raw fields, text embeddings, and recent image embeddings.
3. Checks Shopify products against imported Safety Gate alerts.
4. Uses product title, description, brand, model, category, and images where available.
5. Persists merchant product snapshots, check history, settings, and alert states in Firestore.
6. Shows merchant-facing safety workflows inside Shopify Admin.
7. Supports automatic webhooks, manual checks, bulk checks, and per-shop delta monitoring.

## Repository Layout

```text
rapex/
├── firebase/
│   ├── functions/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── safety-gate-loader.ts
│   │   │   ├── safety-gate-http.ts
│   │   │   ├── safety-gate-checker.ts
│   │   │   ├── safety-gate-checker-retrieval.ts
│   │   │   ├── safety-gate-checker-results.ts
│   │   │   ├── safety-gate-checker-media.ts
│   │   │   └── merchant-monitoring.ts
│   │   └── prompts/
│   ├── firebase.json
│   ├── firestore.indexes.json
│   └── firestore.rules
├── shopify-client/
│   ├── app/
│   │   ├── components/
│   │   ├── locales/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── merchant-db.server.ts
│   │   ├── firestore.server.ts
│   │   └── i18n.ts
│   ├── extensions/
│   ├── prisma/
│   └── package.json
├── marketing-site/
├── AGENTS.md
└── package.json
```

## Firebase Backend

The Firebase Functions project is responsible for importing, indexing, checking, and monitoring Safety Gate data.

Main responsibilities:

- scheduled Safety Gate delta import
- manual import and backfill operations
- product safety check HTTP API
- merchant product upsert API
- per-shop RAPEX delta monitoring
- Firestore vector retrieval for text and image similarity

Important files:

- `firebase/functions/src/index.ts`
- `firebase/functions/src/safety-gate-loader.ts`
- `firebase/functions/src/safety-gate-http.ts`
- `firebase/functions/src/safety-gate-checker.ts`
- `firebase/functions/src/safety-gate-checker-retrieval.ts`
- `firebase/functions/src/safety-gate-checker-results.ts`
- `firebase/functions/src/safety-gate-checker-media.ts`
- `firebase/functions/src/merchant-monitoring.ts`
- `firebase/functions/prompts/productMatchAnalysis.prompt`

## Firestore Collections

Core backend collections:

- `rapex_alerts`: imported Safety Gate alert records
- `rapex_alert_images`: per-image embeddings for recent Safety Gate alerts
- `rapex_meta/loader_state`: loader checkpoint and run status
- `merchant_products`: per-shop Shopify product snapshots and vectors
- `merchant_alerts`: merchant-facing safety alerts
- `merchant_checks`: check history
- `merchant_settings`: per-shop settings such as similarity threshold
- `merchant_webhook_errors`: webhook error logs
- `merchant_monitor_state`: per-shop monitoring checkpoints

## Shopify App

The Shopify app is the merchant-facing workflow layer. It uses Shopify Admin conventions and Polaris Web Components with the `s-` custom element prefix.

Main flows:

- Dashboard summary of alert state and monitoring actions
- Manual product search and safety check
- Alert queue with filtering, sorting, detail modal, and bulk actions
- Settings for per-shop similarity threshold
- Product create/update webhook checks
- Shopify Admin product detail extensions for inline safety status/actions

Important files:

- `shopify-client/app/routes/app._index.tsx`
- `shopify-client/app/routes/app.manual-check.tsx`
- `shopify-client/app/routes/app.alerts.tsx`
- `shopify-client/app/routes/app.settings.tsx`
- `shopify-client/app/components/AlertTable.tsx`
- `shopify-client/app/components/AlertDetailModal.tsx`
- `shopify-client/app/components/StatusBadge.tsx`
- `shopify-client/app/services/safety-gate-checker.server.ts`
- `shopify-client/app/services/safety-gate-checker.client.ts`
- `shopify-client/app/services/product-safety-admin.server.ts`
- `shopify-client/app/merchant-db.server.ts`

## Localization

Merchant-facing text is localized through `shopify-client/app/i18n.ts` and locale modules under `shopify-client/app/locales/`.

Current structure:

- `en.ts` and `sk.ts`: full translations
- `core-locale.ts`: shared locale shape for additional languages
- `languages.ts`: supported EU language metadata
- one file per additional EU official language, for example `de.ts`, `fr.ts`, `pl.ts`, `it.ts`

The non-English/non-Slovak locale files include both short UI labels and longer merchant-facing copy under the `long` translation block. When adding new UI text, do not hardcode merchant-facing strings in routes or components. Add translation keys instead.

## Data Source

Primary external dataset:

- EU Safety Gate / RAPEX OpenDataSoft dataset: `healthref-europe-rapex-en`
- API: `https://public.opendatasoft.com/api/records/1.0/search`

Safety Gate is the current public name. RAPEX is the older name and still appears in code, Firestore collection names, and operational terminology.

## Requirements

- Node.js 22 for Firebase Functions
- Node.js 21+ for the Shopify app
- npm workspaces
- Firebase CLI
- Shopify CLI
- Firebase project with Firestore and Functions enabled
- Google AI / Gemini credentials used by the checker
- Safety Gate API key used between Shopify and Firebase

## Setup

Install dependencies from the repository root:

```bash
npm install
```

Configure Firebase:

```bash
firebase login
firebase use <project-id>
```

Configure required secrets and environment variables according to the Firebase and Shopify app environments.

Common Shopify variables:

```bash
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SCOPES=...
SHOPIFY_APP_URL=...
FIREBASE_FUNCTIONS_BASE_URL=https://europe-west1-<project-id>.cloudfunctions.net
SAFETY_GATE_API_KEY=...
SAFETY_GATE_SIMILARITY_THRESHOLD=0
```

Common Firebase secrets:

```bash
GOOGLE_API_KEY=...
SAFETY_GATE_API_KEY=...
```

## Development Commands

From the repository root:

```bash
npm run shopify:dev
npm run firebase:deploy
npm run marketing:dev
npm run build
npm run lint
```

From `shopify-client/`:

```bash
npm run dev
npm run build
npm run lint
npx tsc --noEmit
```

From `firebase/functions/`:

```bash
npm run build
npm run lint
npm run serve
npm run deploy
```

## Validation

Before pushing Shopify client changes, run:

```bash
cd shopify-client
npx tsc --noEmit
npm run lint
npm run build
```

Before deploying Firebase Functions, run:

```bash
cd firebase/functions
npm run lint
npm run build
```

## Important Implementation Notes

- Product matching is similarity-based, not exact-ID matching only.
- The current checker response uses `overallSimilarity`; do not reintroduce old UI assumptions around a single `similarity` score.
- Recent Safety Gate image search uses `rapex_alert_images`; legacy `rapex_alerts.vector_image` remains a fallback.
- Shopify merchant data lives in Firestore collections, not in Prisma business tables.
- Prisma in `shopify-client` is for Shopify session storage only.
- `shopify-client/prisma/schema.prisma` must keep an inline SQLite `url` while the app is on Prisma `6.19.2`.
- The Better SQLite adapter export is `PrismaBetterSQLite3`.
- Shopify webhook registration uses `DeliveryMethod.Http`.
- Polaris Web Components use the `s-` prefix and should not be replaced with non-prefixed elements.
- Route-level `ErrorBoundary` components should show actionable merchant messages instead of silently returning a safe result on failed checks.

## More Context

`AGENTS.md` is the operational source of truth for future agents and maintainers. Update it when project purpose, architecture, workflow, conventions, or important debugging lessons change.
