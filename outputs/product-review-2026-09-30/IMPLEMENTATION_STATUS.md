# Implementation status — 30 September 2026

The local worktree contains the first reliability, access, billing-adapter, export, email-preference, and copy-cleanup tranche, plus durable retries for scheduled per-shop monitoring. On 30 September 2026, only the Firebase monitoring worker, daily enqueue function, and manual monitoring API were deployed to `rapex-99a2c`; email functions were deliberately excluded. Shopify client changes remain local and are not deployed.

## Implemented locally

- Firestore delta monitoring now omits an invalid cursor for legacy checkpoints without a document ID, then resumes with an inclusive and idempotent replay. New checkpoints use alert date, timestamp, and document ID. Regression tests cover the legacy and complete cursor tuples.
- Monitoring failures stay separate from individual product checks. Catalog coverage copy counts saved check results instead of claiming products are protected. The manual-check view hides raw Firestore internals and keeps a critical monitoring status visible until a successful run.
- Shopify subscription verification defaults to Shopify App Pricing's Partner API `activeSubscription` query. Billing API access failures fail closed for new scans and show a retry state instead of redirecting the merchant to purchase a plan. Plan, verification time, entitlement, and billing-period end are saved on the merchant root.
- Past findings, decisions, audit history/export, and settings remain accessible after plan cancellation. New scan routes, product webhooks, scheduled monitoring, and weekly summaries require a current entitlement. The development bypass is labelled as a preview and is never counted as a verified paid plan.
- CSV export now uses an authenticated resource route and retrieves all result pages. The first free catalog scan uses a Firestore transaction reservation to prevent concurrent starts and only consumes the allowance after completion.
- Email preferences distinguish immediate findings from weekly summaries while migrating the existing `emailNotifications` value. Immediate alert emails use a Shopify Admin app deep link with `open`; weekly summaries include findings and report incomplete monitoring honestly. Weekly summaries stop when cached entitlement expires.
- “Contacted supplier” remains an open review item and is labelled as waiting for the supplier; it is not marked resolved.
- Dashboard/catalog wording no longer equates saved checks with a safety guarantee.
- Daily monitoring now enqueues one Cloud Task per entitled shop instead of processing every shop serially in the scheduler invocation. Each shop/day has a deterministic run ID and task ID, run state and progress are persisted under `merchants/{shop}/monitoring_runs`, and worker retries reuse deterministic check IDs. The worker rechecks subscription entitlement before it performs model work.
- Dashboard and catalog coverage now count a saved check only when it matches the current Shopify product version. New check records persist `sourceUpdatedAt`; legacy check records count only when their `checkedAt` is no earlier than the current product update. Product snapshots and embeddings alone no longer inflate the dashboard coverage count.

## Required before billing or production claims

- The Shopify Partner Dashboard plan was not created or inspected. The development environment has no Partner API organization ID, Partner API token, or app GID configured. Configure a €9.90 monthly plan (if that is the approved amount/currency), its welcome link, and a private test plan in the Partner Dashboard; configure `SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_TOKEN`, and `SHOPIFY_APP_GID` in the hosting secret manager, and verify the exact plan amount and currency there.
- Set `SHOPIFY_APP_HANDLE=safety-gate-monitor-eu` in the production Shopify app and Firebase Functions environments. The local Functions environment was updated only for development.
- A successful authenticated monitoring run has not yet cleared the old failed state in this shop. The running Admin view still contains the result of the previous Firestore 500. It needs a new catalog-monitoring run after the server uses these changes.
- The initial catalog scan still runs in the Shopify app process and is capped at 300 products. Full-catalog pagination, version freshness across the entire catalog, deletion reconciliation, and merchant-facing monitoring-run history remain to be implemented.
- The scheduled Task Queue worker is deployed and its queue is `RUNNING`; a real task has not yet been enqueued and observed through `queued → completed/retried`. The queue run ledger is not surfaced in the merchant UI yet. The initial Shopify catalog import still runs in the app process and is capped at 300; it needs its own durable paged worker before large catalogs can be claimed as fully audited.
- Immediate and weekly email content currently has complete English and Slovak templates; other EU-selected email languages still fall back to English. Bounded email retries, delivery-status/settings view, safe test email, and provider reconciliation remain outstanding.
- `contacted_supplier` is kept open using the existing `active` status. The dedicated `waiting_for_supplier` state and immutable decision-event migration remain outstanding.
- Marketing listing URL/legal/support publication, analytics, cost verification for 100/1,000/5,000 products, final extension smoke tests, and production release remain outstanding.

## Local validation

- Shopify client: `npx tsc --noEmit`, `npm run lint`, and `npm run build` pass after the current-product-version coverage change; 4 focused helper cases pass.
- Firebase Functions: `npm run build`, `npm run lint`, and `npm test` pass, including two new cursor regression tests.
- Shopify Admin UI was inspected in the open dev preview before the latest Shopify package update. After that update, Shopify CLI connected successfully but the embedded app iframe remained on Loading/about:blank; a post-update UI smoke test remains outstanding. The old monitoring failure in the dev shop was not replaced by a successful run.
- Firebase Functions: `npm test` passes 15/15, `npm run lint`, `npm run build`, and workspace `git diff --check` pass. The monitoring functions are deployed to the Firebase development project, but no real Cloud Task has been processed as an integration test.
