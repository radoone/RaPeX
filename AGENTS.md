# Project Memory

## What this project is

This repository is a Safety Gate / RAPEX checker for Shopify merchants.

The practical goal is simple:
- take products sold in Shopify
- compare them against the EU Safety Gate database of dangerous non-food products
- create alerts when a Shopify product looks like a product already flagged in Safety Gate

If you only remember one sentence, remember this:

> This project checks whether products sold in a Shopify store appear in, or are similar to, products listed in the EU Safety Gate (formerly RAPEX) database.

## Naming

- `RAPEX` is the older name used across the codebase and Firestore collection names.
- `Safety Gate` is the current public name of the EU system.
- In practice, both names refer to the same project context in this repository.

## High-level architecture

### 1. Firebase backend

The Firebase Functions project does four jobs:

- imports Safety Gate alerts into Firestore
- exposes an API that checks a product against those alerts
- upserts merchant Shopify products (including vectors) to Firestore
- runs per-shop RAPEX delta monitoring based on checkpoints

Main files:
- `firebase/functions/src/index.ts`
- `firebase/functions/src/safety-gate-loader.ts`
- `firebase/functions/src/safety-gate-http.ts`
- `firebase/functions/src/merchant-monitoring.ts`
- `firebase/functions/src/safety-gate-config.ts`
- `firebase/functions/src/safety-gate-checker.ts`
- `firebase/functions/src/safety-gate-checker-retrieval.ts`
- `firebase/functions/src/safety-gate-checker-results.ts`
- `firebase/functions/src/safety-gate-checker-media.ts`
- `firebase/functions/src/safety-gate-checker.schemas.ts`
- `firebase/functions/prompts/productMatchAnalysis.prompt`

### 2. Firestore database

Firestore is both the RAPEX knowledge base and the merchant app datastore.

Main collections:
- `rapex_alerts`: imported Safety Gate records
- `rapex_alert_images`: per-image embedding documents for recent Safety Gate alerts, used for visual retrieval across all alert pictures
- `rapex_meta/loader_state`: loader checkpoint and run status
- `merchant_products`: per-shop Shopify product snapshots with vectors
- `merchant_alerts`: per-shop alert records for matched Shopify products
- `merchant_checks`: per-shop check history
- `merchant_settings`: per-shop settings (including similarity threshold)
- `merchant_webhook_errors`: per-shop webhook error log
- `merchant_monitor_state`: per-shop RAPEX delta monitoring checkpoint/state

Imported alert documents store:
- raw Safety Gate fields
- metadata such as `recordid`, `alert_date`, `record_timestamp`
- text embeddings and sometimes image embeddings for similarity search
- recent alerts also fan out their image embeddings into `rapex_alert_images`, so vector image recall is not limited to a single primary picture

### 3. Shopify app

The Shopify app is the merchant-facing UI and workflow layer.

It:
- listens to Shopify product create/update webhooks
- allows manual checks from the UI
- exposes Shopify Admin UI extensions on product details pages
- allows user-triggered RAPEX delta monitoring runs
- stores merchant-facing business data in Firestore
- keeps Prisma/SQLite only for Shopify auth sessions
- uses Prisma config-based datasource setup through `shopify-client/prisma.config.ts`, but because `shopify-client` currently runs on Prisma `6.19.2`, `shopify-client/prisma/schema.prisma` must still keep an inline SQLite `url` for `prisma generate` compatibility

Main files:
- `shopify-client/app/services/safety-gate-checker.server.ts`
- `shopify-client/app/services/product-safety-admin.server.ts`
- `shopify-client/app/merchant-db.server.ts`
- `shopify-client/app/firestore.server.ts`
- `shopify-client/app/db.server.ts`
- `shopify-client/prisma.config.ts`
- `shopify-client/app/routes/app._index.tsx`
- `shopify-client/app/routes/app.manual-check.tsx`
- `shopify-client/app/routes/app.alerts.tsx`
- `shopify-client/app/routes/api.product-safety-status.ts`
- `shopify-client/app/routes/api.product-safety-check.ts`
- `shopify-client/app/routes/webhooks.products.create.tsx`
- `shopify-client/app/routes/webhooks.products.update.tsx`
- `shopify-client/extensions/safety-gate-product-block/shopify.extension.toml`
- `shopify-client/extensions/safety-gate-product-action/shopify.extension.toml`

### 4. Marketing site

There is also a standalone marketing landing page in:
- `marketing-site/`

It is intentionally separate from the embedded Shopify app so sales/marketing pages
can be worked on without changing Shopify auth or app routes.

## Real workflow

1. A scheduled Firebase function fetches new Safety Gate data from the OpenDataSoft dataset `healthref-europe-rapex-en`.
2. Records are upserted into Firestore collection `rapex_alerts`.
3. For alerts within the recent embedding window (currently 6 months), the loader also writes per-image vector docs into `rapex_alert_images` so every alert picture can participate in image similarity retrieval.
4. The loader stores a checkpoint in `rapex_meta/loader_state` so later runs can do delta loading.
5. When a Shopify product is created, updated, manually checked, or bulk-checked, the Shopify app sends normalized product data to Firebase endpoint `checkProductSafetyAPI`.
6. The backend compares the product against recent/imported Safety Gate alerts, using AI plus Firestore retrieval/embeddings.
7. The Shopify app upserts checked Shopify products to Firestore `merchant_products` through Firebase endpoint `upsertMerchantProductAPI`.
8. Merchant-facing alerts/checks/settings are stored in Firestore (`merchant_alerts`, `merchant_checks`, `merchant_settings`).
9. Shopify Admin product detail extensions show the latest Safety Gate state inline and can trigger a fresh check from the product page.
10. Daily monitoring defaults to "since last check", while manual/user-triggered monitoring can also run against explicit recent windows such as the last 7 days by passing `monitoringMode` / `days` to the Firebase monitoring API.
11. Monitoring compares only RAPEX records newer than the chosen checkpoint/window in `merchant_monitor_state`, then uses vector retrieval over `merchant_products` to shortlist likely merchant products before running the expensive final matcher.
12. Prisma remains only for Shopify sessions.

## Important product behavior

- The app is not a generic Safety Gate browser. It is a checker for the merchant's own Shopify catalog.
- The core question is not "what alerts exist?" but "does this Shopify product match a dangerous product in Safety Gate?"
- Matching is similarity-based, not exact-ID matching only.
- Similarity can use product title, description, brand, model, category, and sometimes image data.
- Similarity can use product title, description, brand, model, category, and multiple product images when available.
- Merchant product checks now persist per-shop Shopify products into `merchant_products` early enough that repeated checks can reuse cached `vector_text` / `vector_image` instead of always re-embedding the product, as long as the same `shop`, `productId`, and `sourceUpdatedAt` are provided.
- Recent alert image retrieval now uses `rapex_alert_images` so all alert pictures can be embedded and searched; legacy `rapex_alerts.vector_image` remains a fallback during rollout/backfill.
- Safety check responses now distinguish between `overallSimilarity` (final review score) and `imageSimilarity` (visual packaging similarity).
- Candidate alert retrieval and merchant product monitoring use Cosine Distance threshold pre-filtering (`textDistance <= 0.38` and `imageDistance <= 0.35` in `safety-gate-config.ts`) to immediately classify products as safe, bypassing the expensive Gemini LLM matcher when no high-similarity vector matches are found.
- The product matching Gemini prompt (`firebase/functions/prompts/productMatchAnalysis.prompt`) uses specific heuristics to ensure accurate results: exact brand & model matches are scored 90+, explicit brand or model mismatches are rejected as non-matches, unknown/unbranded alerts are matched based on visual and category similarity, and generic broad category-only matches are discarded to minimize false positives.
- The old single `similarity` score is no longer part of the current checker response contract; use `overallSimilarity` in backend and UI code.
- There is a per-shop similarity threshold in Firestore collection `merchant_settings`.
- If the external/API check fails, the app now uses a robust **ErrorBoundary** system to inform the merchant and allow retry, rather than silently failing open with a "safe" result.
- The UI uses **Shopify Polaris Web Components** (with `s-` prefix) to ensure a native look and feel within the Shopify Admin.
- The Shopify app UI should follow a Shopify Admin merchant workflow: **review match → compare product → choose action → keep an audit trail**. Prefer clear merchant actions such as "Needs review", "Check one product", "Review alerts", "Resolve", and "Dismiss" over internal implementation language such as "active", "unsafe", "candidate alerts", or raw monitoring modes.
- The **Alert Table** supports **Bulk Actions** (Resolve/Dismiss) for efficient management of multiple findings.
- High-risk alerts ("Serious" or "High") are visually prioritized in the UI with critical color coding and borders.
- The **Alert Detail Modal** should prioritize merchant decision-making first: show the Shopify product, the likely Safety Gate match, why it matched, and the recommended action before exposing deeper technical scoring/debug details.
- Manual checks now include **Skeleton loading states** and product search so merchants can find a specific Shopify product instead of scanning a fixed recent-products list.
- The dashboard primary action should describe the actual monitoring behavior. "Check all products" implies a full catalog scan; use clearer wording when the action checks new Safety Gate alerts or runs delta monitoring.
- The merchant UI exposes language selection for the 24 official EU languages: English, Bulgarian, Czech, Danish, German, Greek, Spanish, Estonian, Finnish, French, Irish, Croatian, Hungarian, Italian, Lithuanian, Latvian, Maltese, Dutch, Polish, Portuguese, Romanian, Slovak, Slovenian, and Swedish.

## Technical Standards & Lessons Learned

- **Dependency Management:** Prefer internal types (e.g., `app/types/product.ts`) over heavy external libraries (like `@shopify/hydrogen`) just for type definitions to avoid version conflicts with Remix/Vite.
- **UI Framework:** The `s-` prefix is mandatory for Polaris Web Components as they are registered as Custom Elements. Do not attempt to remove them.
- **Error Handling:** In a Remix-based Shopify app, use `useRouteError` and `isRouteErrorResponse` in per-route `ErrorBoundary` components to handle API failures gracefully without breaking the entire Admin UI.
- **i18n:** All merchant-facing strings, including error messages, status labels, modal headings, table labels, and bulk action labels, must be localized through `shopify-client/app/locales/`. `shopify-client/app/i18n.ts` should stay as the small i18next initialization file. The language selector exposes the 24 official EU languages via `EU_LANGUAGES` in `shopify-client/app/locales/languages.ts`; English and Slovak are the most complete locales, while other EU languages may provide core workflow translations with English fallback for longer explanatory text.
- **Translation coverage:** When adding or changing primary merchant workflow text, update at least `shopify-client/app/locales/en.ts` and `shopify-client/app/locales/sk.ts` fully, then add/update the per-language core workflow locale files for the other EU languages in `shopify-client/app/locales/{bg,cs,da,de,el,es,et,fi,fr,ga,hr,hu,it,lt,lv,mt,nl,pl,pt,ro,sl,sv}.ts`. Those per-language files include both short UI labels and a `long` block for longer merchant-facing explanatory copy used by dashboard cards, alert queues, manual checks, settings, and match analysis. Do not hardcode merchant-facing English in React components or Shopify UI extensions unless the string is developer-only/debug-only.
- **Validation:** Before handing off Shopify client changes, run `npx tsc --noEmit`, `npm run lint`, and `npm run build` from `shopify-client/`. ESLint intentionally ignores generated `extensions/*/dist/**` bundles.
- **Firestore adapter:** `shopify-client/app/merchant-db.server.ts` is a Firestore-backed Prisma-like adapter, not Prisma itself. If app routes use Prisma-style methods such as `updateMany`, they must exist on this adapter. Always scope merchant alert mutations by `shop` as well as alert/product id.
- **Package compatibility:** Do not blindly upgrade the Shopify client to React 19, Prisma 7, Vite 8, TypeScript 6, or ESLint 10 until the Shopify/Remix peer dependencies allow it. As of the latest package update, Remix 2.17.x and Polaris 13.x expect React 18, Remix dev supports Vite 5/6 and TypeScript 5, `@shopify/shopify-app-session-storage-prisma@9` expects Prisma `^6.19`, and `@remix-run/eslint-config` expects ESLint 8. Firebase Functions can use TypeScript 6, but `eslint-plugin-import@2.32.0` still limits Functions ESLint to 9.x.
- **Node/native modules:** Use the repo `.nvmrc` Node version for installs and Shopify development. `better-sqlite3` is a native dependency used by Prisma SQLite sessions; if it is installed under a different Node ABI than the `shopify app dev` process, Shopify auth fails with a `NODE_MODULE_VERSION` mismatch. Fix locally with `PATH=/Users/radoone/.nvm/versions/node/v24.14.1/bin:$PATH npm rebuild better-sqlite3` from `shopify-client/`, then run `npm run setup`.
- **Prisma Compatibility:** In `shopify-client`, the installed Prisma version is currently `6.19.3`, so `prisma generate` still requires an inline `url` in `shopify-client/prisma/schema.prisma` even though `shopify-client/prisma.config.ts` also defines the datasource URL. The Better SQLite adapter export name is `PrismaBetterSQLite3`, not `PrismaBetterSqlite3`.
- **Shopify app config:** Webhook definitions in `shopify-client/app/shopify.server.ts` should use `DeliveryMethod.Http` from `@shopify/shopify-app-remix/server`; do not use the string `"http"`. Do not add unsupported future flags such as `removeRest`.

## Data source

Primary external source:
- EU Safety Gate data exposed through OpenDataSoft dataset `healthref-europe-rapex-en`

Relevant facts:
- this is the EU rapid alert system for dangerous non-food products
- the codebase still uses `rapex` in names for historical reasons

## Source of truth inside the repo

When explaining or changing behavior, prefer these files as the source of truth:

- ingestion and API surface: `firebase/functions/src/index.ts`
- loader internals and OpenDataSoft fetch flow: `firebase/functions/src/safety-gate-loader.ts`
- recent embedding backfill trigger: `firebase/functions/src/index.ts`
- HTTP parsing/auth/CORS for product checks: `firebase/functions/src/safety-gate-http.ts`
- merchant product upsert + delta monitoring: `firebase/functions/src/merchant-monitoring.ts`
- shared Firebase config/constants: `firebase/functions/src/safety-gate-config.ts`
- main product matching logic: `firebase/functions/src/safety-gate-checker.ts`
- alert retrieval and Firestore/RAG lookup: `firebase/functions/src/safety-gate-checker-retrieval.ts`
- result shaping, recommendations, and response parsing: `firebase/functions/src/safety-gate-checker-results.ts`
- image/media normalization for matcher inputs: `firebase/functions/src/safety-gate-checker-media.ts`
- Genkit prompt asset for product matching text instructions: `firebase/functions/prompts/productMatchAnalysis.prompt`
- Shopify-to-checker integration: `shopify-client/app/services/safety-gate-checker.server.ts`
- Shopify Firestore business data adapter: `shopify-client/app/merchant-db.server.ts`
- Shopify Firestore Admin init: `shopify-client/app/firestore.server.ts`
- Prisma datasource config and migrations path: `shopify-client/prisma.config.ts`
- Prisma runtime client and SQLite adapter wiring (sessions only): `shopify-client/app/db.server.ts`
- product normalization: `shopify-client/app/services/safety-gate-checker.client.ts`
- Prisma schema: `shopify-client/prisma/schema.prisma` (contains only `Session` in current architecture)

## Maintenance rule

When the project purpose, architecture, workflow, or important conventions change, update this `AGENTS.md` too.

## Commit convention

Use Conventional Commits for all repository commits. The format is:

```text
type(scope): short imperative summary
```

Preferred types:
- `feat`: user-visible feature or workflow addition
- `fix`: bug fix or behavioral correction
- `docs`: documentation-only change
- `chore`: dependency, tooling, lockfile, or repository maintenance
- `refactor`: internal code change without intended behavior change
- `test`: test-only change

Use a concrete scope such as `shopify-client`, `firebase`, `i18n`, `deps`, `ui`, `marketing`, `repo`, or `agents`. Examples:
- `feat(shopify-client): improve alert review workflow`
- `fix(firebase): normalize axios content type headers`
- `chore(deps): update project dependencies`

Also update `AGENTS.md` whenever you learn something project-specific that is both important and likely to be reused in future work, even if it came from debugging rather than planned feature work.

Typical cases when `AGENTS.md` should be updated:
- the main user-facing purpose of the repo changes
- a new important workflow is added
- a new integration becomes part of the core architecture
- naming or terminology changes in a way that could confuse other LLMs or agents
- a debugging session reveals a non-obvious project rule, compatibility constraint, or implementation detail that future agents are likely to hit again

## What to avoid misunderstanding

- This is not a store compliance rules engine for all regulations.
- This is not a marketplace scraper.
- This is not only an AI chatbot over Safety Gate data.
- This is not only a Firestore data loader.

Those pieces exist, but the user-facing purpose is:

Shopify product safety monitoring against the EU Safety Gate / RAPEX database.

## Short summary for other LLMs

Use this summary if you need a compact mental model:

"`rapex` is a monorepo where Firebase imports EU Safety Gate alerts into Firestore, and a Shopify app checks merchant products against that dataset, then records and displays product safety alerts."
