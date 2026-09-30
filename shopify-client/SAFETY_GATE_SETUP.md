# Shopify-to-Firebase integration setup

The Shopify app calls Firebase Functions over HTTPS for product checks, merchant product upserts, catalog audit starts, monitoring runs, and Shopify product lifecycle events. Server-to-server requests use `SAFETY_GATE_API_KEY`. Product create/update/delete webhooks are verified by Shopify in the app first; the app then submits work to Firebase. Firebase Cloud Tasks perform product matching after the Shopify webhook request returns.

## Required configuration

Create one high-entropy API key for each environment. Store it in Firebase Secret Manager as the `SAFETY_GATE_API_KEY` Functions secret and in the Shopify app host's Secret Manager under the same runtime variable name. Do not use `firebase functions:config:set`; the deployed functions declare this credential as a Secret Manager secret.

Set the Firebase secret using the Firebase CLI:

```sh
cd firebase/functions
firebase functions:secrets:set SAFETY_GATE_API_KEY --project <project-id>
```

Configure these server-side Shopify app values in the host's secret/environment configuration:

```text
FIREBASE_FUNCTIONS_BASE_URL=https://europe-west1-<project-id>.cloudfunctions.net
SAFETY_GATE_API_KEY=<same environment-specific secret value>
SHOPIFY_SESSION_STORAGE=firestore
```

The hosted app service account needs access to the private `shopify_sessions` collection. Firebase workers also need Firestore access and `roles/cloudtasks.enqueuer` for task creation. Do not put API keys or Shopify offline access tokens in source control, public task documents, URLs, or browser code.

## Shopify events and background work

The app's stable public HTTPS URL must be configured in the Shopify app settings for OAuth and webhook delivery. After a Shopify product webhook definition changes, open/authenticate the app once so `ensureShopifyWebhooksRegistered` registers the current subscriptions. Firebase queue workers then continue independently of the merchant's browser or open Admin page.

- `products/create` and `products/update` enqueue a version-keyed Safety Gate check and require a current monitoring entitlement.
- `products/delete` enqueues cleanup even if the entitlement has ended. Product and alert records are marked deleted; checks, decisions, and audit history remain.
- `merchantCatalogAuditTask` performs the initial catalog import in 100-product pages and checks indexed Safety Gate alerts in 500-alert pages.
- `merchantMonitoringTask` processes per-shop Safety Gate delta runs.

Configure Shopify App Pricing separately in the Partner Dashboard. A production billing check requires `SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_TOKEN`, and `SHOPIFY_APP_GID`, with the Partner token stored as a secret. The current development setup does not have these values or a verified plan, so it cannot prove paid entitlement or an end-to-end paid monitoring run. Do not turn on the local bypass in production.

## Validation

From `firebase/functions/`, run:

```sh
npm run lint
npm test
```

From `shopify-client/`, run:

```sh
npx tsc --noEmit
npm run lint
npm run build
npm test
```

An unsigned POST to a protected Firebase ingress should return HTTP 401. A full runtime smoke test must use an authenticated dev shop, verify Shopify webhook registration, observe a task through `queued` to `completed` or a retry state, and confirm the merchant's product/check/alert state. A healthy HTTP endpoint or successful build alone does not establish that the queue flow completed.
