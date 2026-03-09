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

The Firebase Functions project does two jobs:

- imports Safety Gate alerts into Firestore
- exposes an API that checks a product against those alerts

Main files:
- `firebase/functions/src/index.ts`
- `firebase/functions/src/safety-gate-loader.ts`
- `firebase/functions/src/safety-gate-http.ts`
- `firebase/functions/src/safety-gate-config.ts`
- `firebase/functions/src/safety-gate-checker.ts`
- `firebase/functions/src/safety-gate-checker-retrieval.ts`
- `firebase/functions/src/safety-gate-checker-results.ts`
- `firebase/functions/src/safety-gate-checker-media.ts`
- `firebase/functions/src/safety-gate-checker.schemas.ts`
- `firebase/functions/prompts/productMatchAnalysis.prompt`

### 2. Firestore database

Firestore is the alert knowledge base.

Main collections:
- `rapex_alerts`: imported Safety Gate records
- `rapex_meta/loader_state`: loader checkpoint and run status

Imported alert documents store:
- raw Safety Gate fields
- metadata such as `recordid`, `alert_date`, `record_timestamp`
- text embeddings and sometimes image embeddings for similarity search

### 3. Shopify app

The Shopify app is the merchant-facing UI and workflow layer.

It:
- listens to Shopify product create/update webhooks
- allows manual checks from the UI
- allows bulk checking of store products
- stores merchant-facing results in Prisma/SQLite
- uses Prisma 7 config-based datasource setup, so the SQLite URL lives in `shopify-client/prisma.config.ts`, not in `shopify-client/prisma/schema.prisma`

Main files:
- `shopify-client/app/services/safety-gate-checker.server.ts`
- `shopify-client/app/db.server.ts`
- `shopify-client/prisma.config.ts`
- `shopify-client/app/routes/app._index.tsx`
- `shopify-client/app/routes/app.manual-check.tsx`
- `shopify-client/app/routes/app.alerts.tsx`
- `shopify-client/app/routes/webhooks.products.create.tsx`
- `shopify-client/app/routes/webhooks.products.update.tsx`

## Real workflow

1. A scheduled Firebase function fetches new Safety Gate data from the OpenDataSoft dataset `healthref-europe-rapex-en`.
2. Records are upserted into Firestore collection `rapex_alerts`.
3. The loader stores a checkpoint in `rapex_meta/loader_state` so later runs can do delta loading.
4. When a Shopify product is created, updated, manually checked, or bulk-checked, the Shopify app sends normalized product data to Firebase endpoint `checkProductSafetyAPI`.
5. The backend compares the product against recent/imported Safety Gate alerts, using AI plus Firestore retrieval/embeddings.
6. The Shopify app stores the outcome in Prisma models such as `SafetyAlert`, `SafetyCheck`, and `SafetySetting`.
7. The merchant sees alerts, history, and threshold settings inside the Shopify app.

## Important product behavior

- The app is not a generic Safety Gate browser. It is a checker for the merchant's own Shopify catalog.
- The core question is not "what alerts exist?" but "does this Shopify product match a dangerous product in Safety Gate?"
- Matching is similarity-based, not exact-ID matching only.
- Similarity can use product title, description, brand, model, category, and sometimes image data.
- Similarity can use product title, description, brand, model, category, and multiple product images when available.
- There is a per-shop similarity threshold in `SafetySetting`.
- If the external/API check fails, the current implementation fails open and returns a safe result so sales are not blocked.
- Safety check responses now include `analysis` metadata showing whether the check ran `text-only` or `with-image`, plus counts for product and alert images used.

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
- HTTP parsing/auth/CORS for product checks: `firebase/functions/src/safety-gate-http.ts`
- shared Firebase config/constants: `firebase/functions/src/safety-gate-config.ts`
- main product matching logic: `firebase/functions/src/safety-gate-checker.ts`
- alert retrieval and Firestore/RAG lookup: `firebase/functions/src/safety-gate-checker-retrieval.ts`
- result shaping, recommendations, and response parsing: `firebase/functions/src/safety-gate-checker-results.ts`
- image/media normalization for matcher inputs: `firebase/functions/src/safety-gate-checker-media.ts`
- Genkit prompt asset for product matching text instructions: `firebase/functions/prompts/productMatchAnalysis.prompt`
- Shopify-to-checker integration: `shopify-client/app/services/safety-gate-checker.server.ts`
- Prisma 7 datasource config and migrations path: `shopify-client/prisma.config.ts`
- Prisma runtime client and SQLite adapter wiring: `shopify-client/app/db.server.ts`
- product normalization: `shopify-client/app/services/safety-gate-checker.client.ts`
- merchant alert persistence: `shopify-client/prisma/schema.prisma`

## Maintenance rule

When the project purpose, architecture, workflow, or important conventions change, update this `AGENTS.md` too.

Typical cases when `AGENTS.md` should be updated:
- the main user-facing purpose of the repo changes
- a new important workflow is added
- a new integration becomes part of the core architecture
- naming or terminology changes in a way that could confuse other LLMs or agents

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
