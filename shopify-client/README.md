# Shopify Safety Gate App

This app is the merchant-facing part of the monorepo. It checks Shopify products against the EU Safety Gate database and shows alerts when a store product appears to match a dangerous non-food product reported by European authorities.

The Firebase backend imports and indexes Safety Gate records. This Shopify app uses that backend to:

- automatically check products on create and update webhooks
- manually check selected products from the admin UI
- bulk check the full catalog
- store alert history and check history per shop
- let each shop configure a similarity threshold

## What this app is for

This is not a generic Shopify template anymore.

Its real job is:

> Compare products sold in Shopify with the Safety Gate / RAPEX dataset and warn the merchant when a product looks similar to a dangerous product alert.

## Main app flows

### Automatic monitoring

When Shopify sends `products/create` or `products/update` webhooks, the app:

1. normalizes the Shopify product into checker input
2. calls Firebase endpoint `checkProductSafetyAPI`
3. stores the result in Prisma
4. creates or updates `SafetyAlert` records when warnings are found

Relevant files:
- `app/routes/webhooks.products.create.tsx`
- `app/routes/webhooks.products.update.tsx`

### Manual product checks

The manual check page loads recent products from Shopify and lets the merchant run an on-demand check.

Relevant file:
- `app/routes/app.manual-check.tsx`

### Bulk catalog checks

The dashboard can iterate through the catalog and check products in batches.

Relevant file:
- `app/routes/app._index.tsx`

### Alert management

The app stores merchant-facing status for alerts:
- `active`
- `dismissed`
- `resolved`

Relevant file:
- `app/routes/app.alerts.tsx`

## Local data model

Prisma models used by the app:

- `Session`: Shopify session storage
- `SafetyAlert`: active/resolved/dismissed merchant alerts
- `SafetyCheck`: history of product checks
- `SafetySetting`: per-shop similarity threshold
- `WebhookError`: failed webhook processing logs

See:
- `prisma/schema.prisma`

## Important implementation details

- Product matching is similarity-based, not exact-match-only.
- The Shopify app delegates matching to Firebase Functions.
- The backend can use text similarity, product metadata, and image-aware retrieval if images are available.
- The similarity threshold can be overridden per shop in settings.
- If the backend check fails, the current server-side behavior returns a safe result to avoid blocking catalog operations.

## Required environment variables

The app expects at least:

```bash
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SCOPES=...
SHOPIFY_APP_URL=...

FIREBASE_FUNCTIONS_BASE_URL=https://europe-west1-<project-id>.cloudfunctions.net
SAFETY_GATE_API_KEY=...
SAFETY_GATE_SIMILARITY_THRESHOLD=0
```

If you are setting up the Firebase API key link, also read:
- `SAFETY_GATE_SETUP.md`

## Development

Install dependencies from the monorepo root:

```bash
npm install
```

Run the Shopify app workspace:

```bash
npm run shopify:dev
```

Or from this directory:

```bash
npm run dev
```

## Where the real project context lives

If you are an agent or another LLM, start here:

- root `AGENTS.md` for the project purpose
- `app/services/safety-gate-checker.server.ts` for Shopify-to-backend integration
- `prisma/schema.prisma` for merchant-side persistence
