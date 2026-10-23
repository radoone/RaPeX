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

- The public marketing brand is **ZeroRecall**, with canonical URL `https://zerorecall.online`; Safety Gate remains the name of the official EU data source.
- The Shopify app local display brand is **ZeroRecall** too. Keep the existing technical app handle `safety-gate-monitor-eu` and client ID so installed-app URLs, billing links and email deep links stay valid. On 20 October 2026, Shopify release `zerorecall-api-2026-07-20261020` upgraded both product extensions to supported API `2026-07` and completed the public rename; the ZeroRecall Shopify sidebar and heading were browser-verified. The release used scoped sources under `outputs/shopify-api-release-2026-10-20/source`: committed extension logic plus the supported SDK/config and explicit Preact JSX pragma, preserving other uncommitted extension UX changes locally. The hosted web app and Firebase backend were not redeployed.
- Marketing sources live in `marketing-site/`; build with `npm run marketing:build` and deploy only Firebase Hosting for website-only releases. The Firebase site ID remains `rapex-99a2c`.
- ZeroRecall application email uses the authenticated Brevo sender `info@zerorecall.online` (`BREVO_SENDER_EMAIL`) with `BREVO_SENDER_NAME=ZeroRecall`. Cloudflare Email Routing forwards incoming `info@` mail to `radoone@gmail.com`; keep Cloudflare MX/SPF and Brevo DKIM records together. Public marketing contact links use `info@zerorecall.online`, including localized privacy and About pages. Custom-domain DNS and HTTPS provisioning must be verified separately from a successful Hosting deployment.

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
- runs first-time full-catalog imports and all-history Safety Gate audits through durable Cloud Tasks

Main files:
- `firebase/functions/src/index.ts`
- `firebase/functions/src/safety-gate-loader.ts`
- `firebase/functions/src/safety-gate-http.ts`
- `firebase/functions/src/merchant-monitoring.ts`
- `firebase/functions/src/merchant-catalog-audit.ts`
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
- `rapex_alert_images`: per-image embedding documents for recent Safety Gate alerts (lightweight, stores only image metadata + vector without duplicated alert fields)
- `rapex_meta/loader_state`: loader checkpoint and run status
- `merchant_match_cache`: short-lived cache for AI match determinations with a 30-day Firestore TTL (`expireAt`)
- `merchants`: tenant root documents storing per-shop settings and monitor state
- `merchants/{shop}/products`: per-shop Shopify product snapshots with vector embeddings
- `merchants/{shop}/alerts`: per-shop alert records for matched Shopify products
- `merchants/{shop}/alerts/{alertId}/decision_events`: immutable merchant decisions with actor, timestamp, outcome, and workflow state
- `merchants/{shop}/checks`: per-shop check history with a 90-day Firestore TTL (`expireAt`)
- `merchants/{shop}/activity_logs`: per-shop activity audit trail
- `merchants/{shop}/webhook_errors`: per-shop webhook error log
- `shopify_sessions`: private Shopify OAuth sessions when the hosted Firestore session adapter is enabled; uninstall and `shop/redact` webhooks must delete these documents

Imported alert documents store:
- raw Safety Gate fields
- metadata such as `recordid`, `alert_date`, `record_timestamp`
- text embeddings and sometimes image embeddings for similarity search
- recent alerts also fan out their image embeddings into `rapex_alert_images`, so vector image recall is not limited to a single primary picture

### 3. Shopify app

The Shopify app is the merchant-facing UI and workflow layer.

It:
- listens to Shopify product create/update/delete webhooks and queues durable processing in Firebase
- allows manual checks from the UI
- exposes Shopify Admin UI extensions on product details pages
- allows user-triggered RAPEX delta monitoring runs
- stores merchant-facing business data in Firestore
- keeps Prisma/SQLite for local Shopify auth sessions and supports a server-only Firestore session adapter (`SHOPIFY_SESSION_STORAGE=firestore`) for hosted multi-instance runtimes and task workers
- runs on React Router 7 through `@shopify/shopify-app-react-router`
- uses Prisma config-based datasource setup through `shopify-client/prisma.config.ts`, but because `shopify-client` currently runs on Prisma `6.19.3`, `shopify-client/prisma/schema.prisma` must still keep an inline SQLite `url` for `prisma generate` compatibility

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
- `shopify-client/app/routes/webhooks.products.delete.tsx`
- `shopify-client/extensions/safety-gate-product-block/shopify.extension.toml`
- `shopify-client/extensions/safety-gate-product-action/shopify.extension.toml`

### 4. Marketing site

There is also a standalone marketing landing page in:
- `marketing-site/`

It is intentionally separate from the embedded Shopify app so sales/marketing pages
can be worked on without changing Shopify auth or app routes.

## Real workflow

1. The primary loader (`safety-gate-weekly-loader.ts` via `dailyRapexDeltaLoader`) fetches weekly reports directly from the European Commission's official Safety Gate XML feed (`ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/...`), which publishes every Friday. (OpenDataSoft was used for historical backfill but retired for ongoing delta syncs to eliminate 1-month lag).
2. Records are upserted into Firestore collection `rapex_alerts` using official `ec.europa.eu` schema fields (`caseNumber`, `brand`, `name`, `product`, `type_numberOfModel`, `category`, `danger`, `measures`, `description`, `level`, `riskType`, `notifyingCountry`, `countryOfOrigin`, `batchNumber`, `barcode`, `pictures`, `url`) while maintaining legacy aliases (`alert_number`, `product_brand`, `product_category`, etc.) for seamless backward compatibility.
3. Every alert picture is embedded via Vertex AI multimodal embeddings (`vertexai/multimodalembedding@001`) into `rapex_alert_images`, and text is embedded into `rapex_alerts.vector_text`, allowing vector retrieval over 100% of the entire database without arbitrary date cutoff limits.
4. The loader stores a checkpoint in `rapex_meta/loader_state` (`last_report_year`, `last_report_week`, `last_alert_date`) so subsequent runs only process newly published weekly reports.
5. Manual and bulk product checks send normalized product data to Firebase endpoint `checkProductSafetyAPI`. Shopify create/update webhooks enqueue version-keyed background checks through `startShopifyProductChangeAPI`; delete webhooks enqueue lifecycle cleanup through the same authenticated ingress.
6. The backend compares the product against recent/imported Safety Gate alerts, using AI plus Firestore retrieval/embeddings.
7. The Shopify app upserts checked Shopify products to Firestore `merchants/{shop}/products` through Firebase endpoint `upsertMerchantProductAPI`.
8. Merchant-facing alerts/checks/settings are stored in Firestore under tenant documents (`merchants/{shop}` and subcollections `alerts`, `checks`, `activity_logs`, `webhook_errors`).
9. Shopify Admin product detail extensions show the latest Safety Gate state inline and can trigger a fresh check from the product page.
10. The public Shopify app configuration currently uses `read_products`; high-risk automation creates merchant alerts and priority-review activity entries, but does not mutate Shopify product status. Do not reintroduce `write_products` unless product status updates are intentionally restored and justified for Shopify App Store review.
11. Shopify App Pricing is mandatory in the Shopify app UI: pricing, trial days, public/private plans, and test plans are configured in the Shopify Partner Dashboard. Production subscription checks use Partner API `activeSubscription` with `SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_TOKEN`, `SHOPIFY_APP_GID`, and the shop GID fetched from Admin GraphQL. Store the Partner token in the host's secret manager; grant only the required Manage apps permission. `SHOPIFY_BILLING_MODE=legacy` is an explicit compatibility path only for a confirmed legacy app. The app redirects merchants without a verified active plan to `https://admin.shopify.com/store/:store_handle/charges/:app_handle/pricing_plans`; set `SHOPIFY_APP_HANDLE` in the Shopify app environment and in Firebase only when Firebase email links are enabled. A local bypass is enabled only when `NODE_ENV !== "production"` and `SHOPIFY_BILLING_BYPASS` is not `false`; never rely on it for production or App Store review. Verified entitlement is cached on the merchant root with its plan, verification time, and billing-period end, and scheduled monitoring plus product create/update checks fail closed when it is absent or expired. Product deletion cleanup always runs so stale products do not remain after entitlement ends.
12. Daily monitoring defaults to "since last check", while manual/user-triggered monitoring can also run against explicit recent windows such as the last 7 days by passing `monitoringMode` / `days` to the Firebase monitoring API.
13. Monitoring compares only RAPEX records newer than the chosen checkpoint/window in `merchants/{shop}.monitorState`, queries registered tenants directly from `merchants`, then uses vector retrieval over `merchants/{shop}/products` to shortlist likely merchant products before running the Gemini 2.5 Flash matcher. Daily per-shop runs enqueue `merchantMonitoringTask` through Firebase Task Queue and persist run status/progress in `merchants/{shop}/monitoring_runs/{runId}`; retries use a stable run ID and stable check document IDs so replay does not duplicate checks. The Firebase runtime service account needs `roles/cloudtasks.enqueuer` to schedule the queue.
14. The Shopify dashboard reads only the current shop's latest documents from `merchants/{shop}/monitoring_runs`, shows a bounded status/progress summary, and never exposes backend error text. Missing or unreadable run history must not break the rest of the dashboard.
15. Product create/update/delete webhooks enqueue Firebase Cloud Tasks through the authenticated ingress; webhook requests never perform model work inline. Create/update ingress and workers require a current entitlement. Product deletion is lifecycle cleanup and remains enqueueable after entitlement ends: mark the product and its alerts as deleted while retaining checks, decisions, and audit history. Delayed update tasks at or before the recorded deletion version must not resurrect a product; a newer version may reactivate it. These webhook and scheduled flows work while Shopify Admin is closed, provided the app has a stable, publicly reachable host and Shopify has registered the subscriptions. Product create/update tasks use stable version-keyed task IDs. Shopify delivery must receive a retryable error when enqueueing fails. Newly imported or updated Safety Gate alerts trigger merchant delta tasks after the scheduled XML load succeeds. Missing-product catalog reconciliation for a missed delete webhook is not implemented yet.
16. The first dashboard audit is enqueued to `merchantCatalogAuditTask`. Each retryable task imports one Shopify page (up to 100 products), reuses unchanged Firestore embeddings, batches text embeddings in groups of 50, and advances the cursor only after the whole page is persisted. It then checks all indexed Safety Gate history in 500-alert pages, using the merchant monitoring vector shortlist before Gemini. Run state and safe progress counts live under `merchants/{shop}/initial_catalog_runs/{runId}` and on the merchant root; task payloads never include access tokens. The app mirrors its offline Shopify session into private `shopify_sessions` when starting the job, and uninstall / `shop/redact` delete that copy. Product import does not set `lastCheckedAt` or count as a completed safety check.
17. Prisma remains only for Shopify sessions.

## ZeroRecall domain and application email

### Ownership and traffic flow

- Domain registration stays at Websupport. Authoritative DNS is hosted by Cloudflare using `arturo.ns.cloudflare.com` and `tessa.ns.cloudflare.com`.
- `https://zerorecall.online` serves Firebase Hosting site `rapex-99a2c`. Its root A record is `199.36.158.100`; root TXT is `hosting-site=rapex-99a2c`. Keep the old Websupport root A/AAAA records removed. HTTP redirects to HTTPS.
- `www.zerorecall.online` has a DNS-only CNAME to `rapex-99a2c.web.app` and a Firebase custom-domain redirect to `zerorecall.online`. Its certificate provisioning is separate from the root domain; verify its current TLS status before claiming it works.
- Incoming email: `info@zerorecall.online` → Cloudflare Email Routing → `radoone@gmail.com`. The `info@` routing rule is enabled and the destination is verified. Catch-all is disabled.
- Outgoing application email: Firebase Functions → Brevo transactional API → recipient. The verified Brevo sender is `ZeroRecall <info@zerorecall.online>` (sender ID `2`). This does not configure Gmail's “Send as” feature. Replies to `info@` follow the Cloudflare incoming route.

### DNS records for email

Keep Cloudflare's incoming-mail records and Brevo's outgoing authentication records together. They serve different purposes. Do not restore Websupport MX records, proxy DKIM CNAMEs, create a second SPF record, or weaken DMARC to `p=none` merely because a provider example uses it.

| Type | Name | Value / purpose |
| --- | --- | --- |
| MX | `@` | Cloudflare-managed `route1.mx.cloudflare.net` (43), `route2.mx.cloudflare.net` (72), `route3.mx.cloudflare.net` (62) |
| TXT | `@` | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| TXT | `cf2024-1._domainkey` | Cloudflare-managed DKIM public key; retain it |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine` |
| TXT | `@` | Brevo ownership code supplied in Brevo's domain settings; retain it |
| CNAME | `brevo1._domainkey` | `b1.zerorecall-online.dkim.brevo.com` — DNS only |
| CNAME | `brevo2._domainkey` | `b2.zerorecall-online.dkim.brevo.com` — DNS only |

Brevo verified `zerorecall.online` and both DKIM records on 19 October 2026. Brevo uses its own envelope/return-path domain for the shared sending pool; the visible From domain authenticates through aligned DKIM. Do not add another root SPF record to match the visible From address.

### Firebase runtime configuration

The following non-secret values are set on all four production functions in project `rapex-99a2c`, region `europe-west1`:

```text
BREVO_SENDER_EMAIL=info@zerorecall.online
BREVO_SENDER_NAME=ZeroRecall
MARKETING_SITE_URL=https://zerorecall.online
```

- `freeScanRequestAPI`: free-scan confirmation email.
- `processFreeScanRequestJob`: free-scan report email.
- `sendImmediateSafetyGateAlertEmail`: newly created merchant alert email.
- `weeklyClearSafetyGateSummary`: scheduled merchant summary email.

The 19 October change updated only `serviceConfig.environmentVariables` through the Cloud Functions v2 API with an explicit update mask, merging existing environment variables. It preserved deployed code and secret bindings, and all four update operations completed successfully. Do not redeploy unrelated uncommitted backend changes to change an email sender.

A local `firebase/functions/.env.rapex-99a2c` contains the same three non-secret values for subsequent Firebase CLI deployments. Keep this deployment-local file untracked; do not assume it is ignored without checking. Existing `BREVO_API_KEY` and `BREVO_WEBHOOK_SECRET` remain in Google Secret Manager. Never commit, print, or put their values in browser-facing/Vite configuration. Merchant delivery audit state is still updated only by the authenticated Brevo webhook; a test API response must not fabricate merchant notification records.

Relevant implementation: `firebase/functions/src/email-notifications.ts`, `firebase/functions/src/free-scan.ts`, function bindings in `firebase/functions/src/index.ts`, and operational notes in `firebase/functions/EMAIL_NOTIFICATIONS.md`. The visible sender name in the free-scan source was still hardcoded as `Safety Gate Monitor` at this configuration-only change; its From email uses `BREVO_SENDER_EMAIL`. Merchant notifications read `BREVO_SENDER_NAME`.

The subsequent 19 October email-template implementation moves alert, weekly-summary, free-scan confirmation and scan-report content into the pure renderers in `firebase/functions/src/email-templates.ts`. All four support Slovak/English HTML and plain text, the chosen ivory/forest-green design, real dynamic facts and clear next actions. Both send paths now read `BREVO_SENDER_NAME` (default `ZeroRecall`) and set Reply-To. Optional alert imagery is from the actual Safety Gate record, never the fictional preview asset. Generate examples with `firebase/functions/scripts/render-email-previews.mjs` after building Functions; the output under `outputs/email-templates/` is explicitly illustrative and never sends mail. Keep incomplete-monitoring and no-new-findings states distinct, preserve confirmation tokens, and restrict free-scan product links to the requested shop. See `EMAIL_NOTIFICATIONS.md` and the root `design-qa.md` for validation and deployment limits. The email templates and EU localization were deployed on 19 October 2026; see the scoped-release note below.

Weekly email previews include up to five individual findings with actual Safety Gate images when available, matcher reasons, current decision states and authenticated detail links. Fetch at most five new and five active alert documents from the current merchant's own subcollection, deduplicate and prioritise new entries; older open findings can still appear during a week with zero new findings. Never label a resolved/dismissed finding as needing review, and never insert the fictional preview photograph into real messages.

Public ZeroRecall home/about/privacy pages and all four email types now have local-source support for the 24 official EU languages. `localization/catalogs/{code}.json` is canonical; run root `npm run localization:build` and `npm run localization:check` after changes. Generated outputs are `marketing-site/locales/*.json` and `firebase/functions/src/email-locales.ts`. The website lazy-loads the selected language, preserves `lang` across public pages and passes it to free-scan requests. `normalizeEmailLanguage` accepts supported base/regional locales and falls back to English. Merchant email still follows `notificationLanguage`. Do not translate product identifiers or rewrite stored source/matcher facts during delivery. The internal scanner is excluded. See `localization/README.md` for provenance, authority references, tests and the distinction between local source readiness and production deployment.

### Verification and limits of the evidence

- A transactional test sent through the same Brevo API integration from `ZeroRecall <info@zerorecall.online>` was received in the destination Gmail inbox on 19 October 2026. Gmail headers showed `spf=pass`, `dkim=pass` for `zerorecall.online`, and `dmarc=pass`. Brevo reported `delivered` for both authorized test recipients.
- A separate incoming test to `info@zerorecall.online` was recorded as `Forwarded` to `radoone@gmail.com` by Cloudflare. Testing a forwarding alias from its own destination Gmail account may suppress a separate inbox copy; use another sending address for a clean incoming-mail test.
- These checks prove the sender integration and routing configuration. They do not prove a complete merchant-alert trigger, weekly scheduler, or free-scan confirmation/worker/report flow. The marketing free-scan form still needs a production Turnstile site key in its build; do not claim it is operational merely because email delivery works.

## Important product behavior

- The app is not a generic Safety Gate browser. It is a checker for the merchant's own Shopify catalog.
- The core question is not "what alerts exist?" but "does this Shopify product match a dangerous product in Safety Gate?"
- Matching is similarity-based, not exact-ID matching only.
- Similarity can use product title, description, brand, model, category, and sometimes image data.
- Similarity can use product title, description, brand, model, category, and multiple product images when available.
- Merchant product checks persist per-shop Shopify products into `merchants/{shop}/products` early enough that repeated checks can reuse cached `vector_text` / `vector_image` instead of always re-embedding the product, as long as the same `shop`, `productId`, and `sourceUpdatedAt` are provided.
- Recent alert image retrieval now uses `rapex_alert_images` so all alert pictures can be embedded and searched; legacy `rapex_alerts.vector_image` remains a fallback during rollout/backfill.
- Safety check responses now distinguish between `overallSimilarity` (final review score) and `imageSimilarity` (visual packaging similarity).
- Candidate alert retrieval and merchant product monitoring use Cosine Distance threshold pre-filtering (`textDistance <= 0.38` and `imageDistance <= 0.35` in `safety-gate-config.ts`) to immediately classify products as safe, bypassing the expensive Gemini LLM matcher when no high-similarity vector matches are found.
- **Batch Vectorization for Store Scanning & Large Catalogs:** Whenever scanning public Shopify store sortiments or performing bulk catalog audits, **ALWAYS use batch vectorization (`embedTexts` in batches of 50–100) and fast Firestore KNN vector search (`retrieveAlertsForVector`)** to pre-filter candidate alerts before invoking Gemini LLM models. Never run isolated per-item LLM checks in a loop over large product catalogs. Multimodal LLM analysis (Gemini 2.5 Flash `checkProductAgainstAlerts`) must strictly serve as a targeted arbiter only on the shortlist of candidate pairs that passed the vector similarity threshold.
- **Store Scanner Embedding Persistence:** The store scanner persists all vectorized products into Firestore subcollection `rapex_leads/{domain}/products/{productId}` with `vector_text: FieldValue.vector(...)`. On subsequent scans or re-runs of the same domain, existing embeddings are batch-loaded directly from Firestore and reused with zero Vertex AI embedding cost and minimal latency.
- **Lead Generation & Public Store Scanner Isolation:** The public store scanner (`firebase/functions/src/public-store-scanner.ts` / `scanPublicShopifyStoreAPI`) and its Firestore collection `rapex_leads` are internal prospecting and lead-generation tools for the app owner. They run exclusively on Firebase (Cloud Functions + Firestore / Firebase Hosting) and must never be exposed in the merchant-facing Shopify Admin app menu (`shopify-client`).
- The product matching Gemini prompt (`firebase/functions/prompts/productMatchAnalysis.prompt`) uses specific heuristics to ensure accurate results: exact brand & model matches are scored 90+, explicit brand or model mismatches are rejected as non-matches, unknown/unbranded alerts are matched based on visual and category similarity, and generic broad category-only matches are discarded to minimize false positives.
- The old single `similarity` score is no longer part of the current checker response contract; use `overallSimilarity` in backend and UI code.
- There is a per-shop similarity threshold in Firestore collection `merchant_settings`.
- If the external/API check fails, the app now uses a robust **ErrorBoundary** system to inform the merchant and allow retry, rather than silently failing open with a "safe" result.
- The UI uses **Shopify Polaris Web Components** (with `s-` prefix) to ensure a native look and feel within the Shopify Admin.
- The Shopify app UI should follow a Shopify Admin merchant workflow: **review match → compare product → choose action → keep an audit trail**. Prefer clear merchant actions such as "Needs review", "Check one product", "Review alerts", "Resolve", and "Dismiss" over internal implementation language such as "active", "unsafe", "candidate alerts", or raw monitoring modes.
- "Needs review" is reserved for active unresolved merchant decisions across the dashboard, Review Queue, and manual product checks. Historical resolved/dismissed matches must be labelled as reviewed history, not counted as current flagged products. Cached catalog refresh actions should describe the merchant outcome (for example, "Refresh catalog coverage") instead of implying every unchanged product is rechecked from scratch.
- The **Alert Table** supports **Bulk Actions** (Resolve/Dismiss) for efficient management of multiple findings.
- Merchant alert decisions are written transactionally to the alert and an immutable `decision_events` subcollection. The Alert Detail modal shows the ten latest events. `reviewState` distinguishes `needs_review`, `waiting_for_supplier`, `resolved`, and `dismissed`; `waiting_for_supplier` remains an open alert (`status: active`) so existing open-alert queries continue to include it. Legacy `contacted_supplier` alerts are normalized to `waiting_for_supplier` when read.
- When `SHOPIFY_SESSION_STORAGE=firestore`, `shopify_sessions` contains Shopify OAuth access tokens and must remain server-only. GDPR `shop/redact` and uninstall handlers delete sessions through the configured `sessionStorage` adapter. Failed merchant-data deletion must return a retryable webhook error and never acknowledge completion.
- High-risk alerts ("Serious" or "High") are visually prioritized in the UI with critical color coding and borders.
- The **Alert Detail Modal** should prioritize merchant decision-making first: show the Shopify product, the likely Safety Gate match, why it matched, and the recommended action before exposing deeper technical scoring/debug details.
- The review outcome **Other** requires a non-empty audit note. Enforce this in the modal and in both Review Queue and manual-check server actions; show the outcome in decision history and audit reports.
- Manual checks now include **Skeleton loading states** and product search so merchants can find a specific Shopify product instead of scanning a fixed recent-products list.
- The dashboard primary action should describe the actual monitoring behavior. "Check all products" implies a full catalog scan; use clearer wording when the action checks new Safety Gate alerts or runs delta monitoring.
- The Shopify app should sell its value inside the product UI: onboarding is value-first, dashboard shows subscription proof metrics, and empty alert queues show a demo Safety Gate match workflow so new merchants understand the paid outcome before real alerts exist.
- Slack notifications and webhook inputs are completely removed from the app and backend (without backward compatibility shims) to keep the app focused exclusively on Shopify-native review workflows and compliance audit trails.
- The merchant UI exposes language selection for the 24 official EU languages: English, Bulgarian, Czech, Danish, German, Greek, Spanish, Estonian, Finnish, French, Irish, Croatian, Hungarian, Italian, Lithuanian, Latvian, Maltese, Dutch, Polish, Portuguese, Romanian, Slovak, Slovenian, and Swedish.
- Merchant safety email is sent through Brevo from Firebase only. A newly created `merchants/{shop}/alerts/{alertId}` document triggers one immediate email; updates do not resend it. A Monday 08:00 `Europe/Bratislava` job sends an all-clear summary only when the preceding seven-day window contains no new merchant alert.
- Merchant email preferences live on `merchants/{shop}` as `emailNotifications`, `immediateAlertEmails`, `weeklySummaryEmails`, `notificationEmail`, `notificationLanguage`, and `notificationEmailSource`. Legacy `emailNotifications` migrates to both new preferences. They default to enabled with the Shopify contact email when the authenticated app can retrieve it, and remain editable/disableable in Settings. Delivery lifecycle is stored in `merchants/{shop}/email_notifications`; Brevo delivery webhooks, authenticated with a bearer secret, are the only source that marks an email delivered in the audit trail. Immediate and weekly email sends require a current cached monitoring entitlement.
- On first dashboard visit, begin the catalog import and full Safety Gate monitoring automatically when coverage is incomplete. While it runs, show only the progress state; after it completes, show either the action queue or an all-clear status. Do not mark an initial scan as consumed when Shopify returns zero catalog products, so a later visit can retry it.
- The first catalog audit runs as a Firebase Cloud Task rather than fire-and-forget work in the Shopify request process. Keep its import and alert cursors durable and idempotent, show progress from Firestore, and mark the free scan consumed only after a non-empty catalog has completed all-history monitoring. If Shopify returns zero products, leave the free scan available for a later retry.
- The marketing-site free scan accepts only public `*.myshopify.com` domains through the Firebase Hosting `/api/free-scan` rewrite. `freeScanRequestAPI` requires a server-verified Cloudflare Turnstile token, rate limits by IP/domain/email plus a global daily budget, and sends a single-use 30-minute email confirmation link through Brevo. A confirmed request is preflighted for a nonempty public JSON catalog before its Firestore `free_scan_requests` status changes to `queued`; `processFreeScanRequestJob` triggers on that status update, scans the entire available public catalog through durable `freeScanCatalogTask` pages using the shared scanner engine, then submits a report through Brevo. The page polls status while open, but email delivery is the primary result path. Never enable Cloudflare's test keys in production, and do not claim a scan succeeded before the worker finishes or Brevo accepts the report. This one-off free scan is separate from the installed app's ongoing monitoring and Monday all-clear emails.
- Free scan request records expire after 30 days; free-scan rate-limit records expire after 2 days. Public scan lead documents and product snapshots/search vectors expire 90 days after the latest scan. Merchant check history and AI match cache expire after 90 and 30 days respectively. These Firestore TTL policies use `expireAt`; deletion can occur after, not exactly at, the expiration timestamp. Merchant alerts, decisions, and audit history remain until the store's Shopify `shop/redact` purge runs after uninstall.

## Technical Standards & Lessons Learned

- **Audit CSV downloads:** File downloads must bypass React Router data navigation. Keep CSV responses in an authenticated resource route and trigger a real download; navigating a page loader to a CSV response can leave `useLoaderData` without `records` and crash the report. Verify the actual downloaded file in the embedded Shopify flow, not only report preview.
- **Coverage semantics:** A merchant product snapshot, `sourceUpdatedAt`, or embedding proves catalog registration, not completed Safety Gate retrieval. Count a saved Safety Gate result as coverage only for the current Shopify product version: persist the checked product's `sourceUpdatedAt` on new check records; for legacy records without it, count only when `checkedAt` is at or after the current Shopify `updatedAt`. Keep imported/monitored products distinct from completed checks and possible matches, and use the same state semantics in dashboard totals, catalog rows, filters, and emails.
- **Monitoring cursor compatibility:** Firestore queries ordered by alert date, record timestamp, and `FieldPath.documentId()` must never call `startAfter` with an empty document ID. Legacy monitor checkpoints may have a timestamp without `lastRapexAlertDocId`; resume them with an inclusive boundary and idempotent deduplication. Verify the actual delta run: local catalog refresh can fail with a query-boundary HTTP 500 while the UI still displays full protection.
- **Billing preview evidence:** Local billing bypass is not proof of an active Shopify subscription. Verify the hosted pricing page and subscription return flow with bypass disabled; a correctly shaped pricing URL can still return Shopify 404 if the app/plan is unavailable for the test store.

- **Dependency Management:** Prefer internal types (e.g., `app/types/product.ts`) over heavy external libraries (like `@shopify/hydrogen`) just for type definitions to avoid version conflicts with React Router/Vite.
- **UI Framework:** The `s-` prefix is mandatory for Polaris Web Components as they are registered as Custom Elements. Do not attempt to remove them.
- **Preact UI extensions:** Every `.jsx` file built with `@shopify/ui-extensions/preact` must begin with `/** @jsxImportSource preact */`. Without the JSX import source pragma, the extension can fail inside Shopify's remote DOM worker with `Cannot add property __, object is not extensible`, leaving Admin action modals blank or stuck.
- **Error Handling:** In the React Router-based Shopify app, use `useRouteError` and `isRouteErrorResponse` in per-route `ErrorBoundary` components to handle API failures gracefully without breaking the entire Admin UI.
- **i18n:** All merchant-facing strings, including error messages, status labels, modal headings, table labels, and bulk action labels, must be localized through `shopify-client/app/locales/`. `shopify-client/app/i18n.ts` should stay as the small i18next initialization file. The language selector exposes the 24 official EU languages via `EU_LANGUAGES` in `shopify-client/app/locales/languages.ts`; English and Slovak are the most complete locales, while other EU languages may provide core workflow translations with English fallback for longer explanatory text.
- **Translation coverage:** When adding or changing primary merchant workflow text, update at least `shopify-client/app/locales/en.ts` and `shopify-client/app/locales/sk.ts` fully, then add/update the per-language core workflow locale files for the other EU languages in `shopify-client/app/locales/{bg,cs,da,de,el,es,et,fi,fr,ga,hr,hu,it,lt,lv,mt,nl,pl,pt,ro,sl,sv}.ts`. Those per-language files include both short UI labels and a `long` block for longer merchant-facing explanatory copy used by dashboard cards, alert queues, manual checks, settings, and match analysis. Do not hardcode merchant-facing English in React components or Shopify UI extensions unless the string is developer-only/debug-only.
- **Country-Specific Regulatory & Legal Localization:** Whenever adding or expanding marketing pages or locale resources for additional EU countries/languages (e.g. Czech Republic, Germany, France, Poland, etc.):
  - **Always look up and reference the specific national market surveillance authority** for that country (e.g., 🇸🇰 SOI for Slovakia, 🇨🇿 ČOI for Czechia, 🇩🇪 BAuA / Gewerbeaufsicht for Germany, 🇫🇷 DGCCRF for France, 🇵🇱 UOKiK / Inspekcja Handlowa for Poland, etc.).
  - **Identify specific national sanctions and recall refund rules** under that country's consumer protection laws and GPSR enforcement framework (e.g., local currency/euro fine ceilings, mandatory customer reimbursement timelines).
  - **Provide direct authoritative links** to both the EU GPSR (Regulation EU 2023/988 on EUR-Lex) and the local national inspection/market surveillance portal.
- **Validation:** Before handing off Shopify client changes, run `npx tsc --noEmit`, `npm run lint`, and `npm run build` from `shopify-client/`. ESLint intentionally ignores generated `extensions/*/dist/**` bundles.
- **Firestore adapter:** `shopify-client/app/merchant-db.server.ts` is a Firestore-backed Prisma-like adapter, not Prisma itself. If app routes use Prisma-style methods such as `updateMany`, they must exist on this adapter. Always scope merchant alert mutations by `shop` as well as alert/product id.
- **Package compatibility:** The Shopify client uses `@shopify/shopify-app-react-router@3` with React Router 7.x and React 18. Pin the React Router family at `7.18.2`: `7.18.3` tightened action-origin validation and breaks POST actions in Shopify dev and TLS-terminating proxy setups. Do not upgrade to React Router 8 or React 19 until Shopify's app package supports that peer set. `@shopify/shopify-app-session-storage-prisma@11` expects Prisma `^6.19`, so keep `shopify-client` on Prisma 6.x unless that peer changes. Shopify app React Router v3 requires Node 22 or newer and Shopify API v15; its v3 breaking change removes `eventId` and `resourceId` from Events webhook contexts, so do not read these fields if Events webhooks are introduced. `@react-router/dev@7.18.2` passes Vite's deprecated `envFile: false` in its internal compilers; `patches/@react-router+dev+7.18.2.patch` converts it to `envDir: false`, and the root `postinstall` applies that patch with `patch-package`. Keep this patch while the app stays on Router 7.18.2/Vite 8. Shopify client ESLint uses flat config with ESLint 9.x because `eslint-plugin-import@2.32.0` does not support ESLint 10.
- **React Router future flags:** Shopify client opts in to the React Router v8 future flags while staying on v7. When `v8_passThroughRequests` is enabled, route path/query decisions should use the loader/action `url` argument for normalized URLs; `request.url` may include Router data-request suffixes.
- **Firebase TypeScript library:** Firebase Functions deploys to Node 22 and uses `Array.at`; keep the `ES2022` TypeScript library enabled even while emitted JavaScript targets ES2021. `firebase/functions/package.json` pins its engine to Node 22, so use Node 22 for that package's install, checks, and deploys; the root `.nvmrc` targets Shopify development separately.
- **Hosted Shopify app:** The stable embedded app and product-webhook receiver run as Cloud Run service `safety-gate-shopify` in `europe-west1`, built from the repository root `Dockerfile` so the root React Router patch is applied. Keep Node 22, `SHOPIFY_SESSION_STORAGE=firestore`, a writable temporary `DATABASE_URL` for Prisma adapter initialization, and the stable Cloud Run URL synchronized with the Shopify app config's application and redirect URLs. Store Shopify API secret and Firebase API keys in Secret Manager; never copy `.env` files into the image. Shopify Partner billing credentials are still required for production entitlement verification.
- **Node/native modules:** Use the repo `.nvmrc` Node version for installs and Shopify development. `better-sqlite3` is a native dependency used by Prisma SQLite sessions; if it is installed under a different Node ABI than the `shopify app dev` process, Shopify auth fails with a `NODE_MODULE_VERSION` mismatch. Fix locally with `PATH=/Users/radoone/.nvm/versions/node/v24.14.1/bin:$PATH npm rebuild better-sqlite3` from `shopify-client/`, then run `npm run setup`.
- **macOS native rebuilds:** If rebuilding `better-sqlite3` fails with `fatal error: 'climits' file not found` even though Command Line Tools are installed, the SDK C++ headers may not be on clang's default include path. Use `SDK=$(xcrun --show-sdk-path); CPLUS_INCLUDE_PATH="$SDK/usr/include/c++/v1:$SDK/usr/include" LIBRARY_PATH="$SDK/usr/lib" PATH=/Users/radoone/.nvm/versions/node/v24.14.1/bin:$PATH npm rebuild better-sqlite3` from `shopify-client/`, then run `npm run setup`.
- **Prisma Compatibility:** In `shopify-client`, the installed Prisma version is currently `6.19.3`, so `prisma generate` still requires an inline `url` in `shopify-client/prisma/schema.prisma` even though `shopify-client/prisma.config.ts` also defines the datasource URL. The Better SQLite adapter export name is `PrismaBetterSQLite3`, not `PrismaBetterSqlite3`.
- **Shopify app config:** Webhook definitions in `shopify-client/app/shopify.server.ts` should use `DeliveryMethod.Http` from `@shopify/shopify-app-react-router/server`; do not use the string `"http"`. Do not add unsupported future flags such as `removeRest` or old Remix-only embedded auth flags.

## Data source

Primary external source:
- European Commission official weekly Safety Gate XML feed for ongoing ingestion
- OpenDataSoft dataset `healthref-europe-rapex-en` for historical backfill only

Relevant facts:
- this is the EU rapid alert system for dangerous non-food products
- the codebase still uses `rapex` in names for historical reasons

## Source of truth inside the repo

When explaining or changing behavior, prefer these files as the source of truth:

- ingestion and API surface: `firebase/functions/src/index.ts`
- weekly XML ingestion and loader internals: `firebase/functions/src/safety-gate-weekly-loader.ts` and `firebase/functions/src/safety-gate-loader.ts`
- recent embedding backfill trigger: `firebase/functions/src/index.ts`
- HTTP parsing/auth/CORS for product checks: `firebase/functions/src/safety-gate-http.ts`
- merchant product upsert + delta monitoring: `firebase/functions/src/merchant-monitoring.ts`
- delayed product-event ordering guard: `firebase/functions/src/product-lifecycle.ts`
- durable first catalog audit: `firebase/functions/src/merchant-catalog-audit.ts`
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

## EU localization release, 19 October 2026

Firebase Hosting and the four email functions are deployed with all 24 languages. Because production backend sources differed from the repository, release archives were based on each function’s existing deployed source and replaced only `email-notifications`, `email-templates`, `email-localization`, `email-locales` and `free-scan` TypeScript/compiled modules. Cloud Functions v2 updates used the explicit `buildConfig.source` mask; package locks, unrelated code, triggers and runtime settings were preserved. The overlay passed 20 tests against the production dependency lock; repository Functions tests passed 28 tests. The two merchant-email functions also receive `SHOPIFY_APP_HANDLE=safety-gate-monitor-eu`, verified against the hosted app and Shopify configuration. Future CLI releases must preserve this value along with sender settings and secrets. The public production selector was verified in all 24 languages, with French navigation across all three pages. Full live email-trigger/scheduler and free-scan flows remain separate verification boundaries; the public free-scan form is still unavailable without a production Turnstile build key. Sanitized deployment evidence is in `outputs/localization-release-2026-10-19/`.

## Full public catalog scans

Free marketing scans now traverse the entire available public Shopify catalog, with no 100-product or 10,000-product ceiling. Confirmation/rate limits remain in `free-scan.ts`. `processFreeScanRequestJob` only enqueues a stable request/page task and retries enqueue failures. `freeScanCatalogTask` processes 50-product pages through the existing batch-embedding/cache → KNN → targeted matcher engine exported as `scanPublicCatalogProducts`; it never invokes isolated model checks for every product. Root `nextPage`, cumulative counts, `catalogComplete`, and per-product receipts under `free_scan_requests/{id}/products` are committed transactionally. A retry after a committed page repairs the continuation enqueue without repeating counts. Receipt `expireAt` follows the request's 30-day expiry; shared lead/product vectors retain their 90-day expiry. Completion requires an actual empty catalog page, successful checks for every fetched unseen product, and Brevo report acceptance. Fetch/embedding/matcher failures never count as clear or completed. Reports preview up to five findings while counts cover the full catalog; request product receipts retain matched-product references. The internal protected scanner keeps its existing explicit limits and stays separate from the public flow.

The queue permits two concurrent tasks, eight attempts and a 30-minute dispatch deadline. Payloads contain only request ID and page index, never email addresses, confirmation secrets or API keys. The runtime service account needs Cloud Tasks enqueue permission; task invocation remains authenticated. Public form availability still depends on a real Turnstile build key; deploying the full-catalog worker does not configure that key.


## Temporary owner E2E access, 20 October 2026

The owner explicitly authorized testing the full flow without a paid subscription. Only `merchants/rozlicnytovar.myshopify.com` has a temporary cached access grant (`planHandle=temporary-owner-e2e-test`, `testAccessGrant.paidSubscription=false`) expiring **21 October 2026 at 07:07:49 UTC / 09:07:49 Europe/Bratislava**. It is not proof of a Shopify subscription; `billingVerifiedAt` was not fabricated. Backend entitlement guards enforce `subscriptionValidUntil`. Original fields and a guarded rollback script are under `outputs/e2e-test-2026-10-20/`; do not extend access or apply it to other merchants without owner authorization.

Draft product `12362851549448` (MOXY / ZeroRecall E2E TEST) triggered the real Shopify create webhook, Cloud Task, matcher (98% overall, 100% image), alert `y9FElVwv7Pqhzh0JwRfy`, and automatic immediate email. Gmail inbox receipt was verified at 09:10; notification audit status was `accepted`, not webhook-confirmed `delivered`. The product remains draft and the finding remains needs review for owner workflow testing.

## Turnstile activation and owner notices, 21 October 2026

The existing Managed Cloudflare widget now allows `zerorecall.online` in addition to its earlier hosts. The matching production `TURNSTILE_SECRET_KEY` version 1 was verified against the widget without rotation. The public site key is retained in tracked `marketing-site/.env.production`; it is public browser configuration, not a secret. Production builds must retain it. Submit stays disabled until the widget callback supplies verification and is disabled again on expiry/reset. Cloudflare's test keys remain prohibited in production.

`notifyFreeScanOwner` is a separate retrying Firestore creation trigger for valid `free_scan_requests/{requestId}` documents. It sends to `FREE_SCAN_OWNER_EMAIL=radoone@gmail.com` from the existing authenticated ZeroRecall sender, including domain, applicant email and request time in Slovak. It reports receipt of a request before customer confirmation, not a completed scan. A transaction lease plus accepted-state check and provider idempotency key avoid normal duplicate sends; a failed owner notice retries independently of the visitor's confirmation/scan. The request's `ownerNotification` contains acceptance/message ID, never a fabricated delivered state. Confirmation tokens and hashes must never appear in owner mail. No Shopify application or other existing Functions code was redeployed for this addition.

The owner-notification-only production fixture was accepted by the new trigger and Brevo reported it delivered on 21 October. The public form was rendered with the real site key; automated Chrome verification returned Cloudflare 300030 and requires manual browser verification. Do not claim an accepted public request or complete confirmation/scan/report journey from the independent owner-mail test. See `outputs/turnstile-owner-release-2026-10-21/`.


## Marketing conversion paths, 22 October 2026

The marketing home page keeps two visible entry points: a primary one-off free catalog check (`#free-scan`) and a secondary outlined Shopify installation button. Installation also remains prominent in the navigation (including mobile), in the paid monitoring section (`#pricing`), and at the final CTA. Preserve `https://apps.shopify.com/safety-gate-checker` while its listing is being prepared; do not hide installation merely because the listing is not yet public. `#example` now targets the single illustrative comparison in the hero. Keep one request form and its existing confirmation, Turnstile and status API behavior. The widget uses the supported compact size so the form fits narrow screens. Only errors after a visitor attempts a request scroll into view; background widget failures must not jump away from the hero.

Public contact is `info@zerorecall.online`, and the author is identified as Radovan Stas, founder of ZeroRecall. The free check is distinct from the paid Shopify application's ongoing monitoring and decision history. Legal detail is expandable and retains official country/EU links. Canonical web translations remain in `localization/catalogs/`; regenerating web catalogs must not change email copy for a marketing-only release. The implementation and browser QA are recorded locally under `outputs/marketing-conversion-2026-10-22/`. The complete request/confirmation/catalog/report path was verified against the unchanged production service using an owner-authorized public catalog. Hosting-only release artifacts are prepared under `outputs/marketing-release-2026-10-22/`; verify production after deployment.

## Consolidated source review, 22 October 2026

Keep all deployable email/localization and durable free-scan sources tracked, including generated `email-locales.ts`; private browser evidence, deployment archives and runtime `.env.*` files stay local. The marketing release `bb77539` is deployed and the public form completed a real 297-product catalog scan through a received report. The App Store listing remains unpublished; preserve the existing installation URL.

Identifier comparisons in the merchant review modal require full equality after trimming/case normalization. A model prefix or partial barcode is not an identifier match, and Shopify product type is a category, not a model. Missing identifiers remain unspecified. Production Firestore credential failures must throw rather than return an empty alert queue or pretend a write succeeded. CSV exports authenticate the shop and neutralize formula-leading merchant text.

Shopify extensions use `shopify.i18n.translate` with English/Slovak locale resources and the supported `2026-07` API. Use guarded `globalThis` event listeners in the extension sandbox, not unguarded `window`. A report retry may treat a provider-confirmed duplicate idempotency key as already submitted; it must never infer delivered status from acceptance.

Direct review links must wait for `customElements.whenDefined("s-modal")` and open the overlay once. Never combine `showOverlay()` with a command-trigger click or a timed second open: the command can toggle it closed again. Cancel pending opens on effect cleanup and depend on the alert ID rather than a newly created alert object. Production browser verification found this issue after following the dashboard review link; manual opening worked. The correction has regression coverage in `test/review-modal.test.ts`.

## Email review working changes, 23 October 2026

The local email review keeps bounded official source evidence in `compactScanPreview` for future free-scan reports: actual case number, model, source URL and matcher reason. Do not present internal record UUIDs as public Safety Gate references or invent a public record URL. Renderer links to official records require an HTTPS European Commission host; product links require the exact requested shop origin. Public site links preserve the email language and the report's monitoring CTA targets `#pricing`. Official risk values may include the suffix `risk` (for example `Serious risk`), so localize and highlight both short and full values. Mobile alert source photos are bounded to 180px. These review corrections were prepared locally before the production-readiness implementation; evidence and original findings are in `outputs/email-review-2026-10-23/REVIEW.md`.

The email review originally found that the shared merchant notification send path wrote `failed` on an error but rejects every existing notification ID as a duplicate, so failed immediate/weekly sends cannot resume through a replay. Free-scan reports also preview at most five matches without a recipient-accessible complete result list. Preserve the short preview, but implement a complete authorized result export separately; do not expose detailed findings through the anonymous status endpoint. The subsequent production-readiness implementation below addresses these issues separately from the renderer review.


## Merchant workflow clarity, 23 October 2026

Catalog coverage, filters and rows use the same current-product-version predicate through `catalog-state.ts`. A changed product may still have an open finding; display those independent facts separately. Never attach a shop-wide open-alert badge or raw activity text to the last product check. Historical successful runs do not imply a current monitoring entitlement; development bypass, unverified billing, expired access and queued/failed runs have explicit states. Do not promise a next completed check using a hardcoded clock time.

The review UI can fill missing official references from the actual imported `rapex_alerts` record without mutating saved matcher facts or merchant decisions. Validate public case-number shape and HTTPS Commission links; internal hashes and arbitrary URLs are not public references. Shopify vendor is not evidence of brand equality. New `match_not_confirmed` outcomes remain distinct from historical `verified_safe` outcomes.

Decision history reads immutable tenant-scoped decision events, separately from finding snapshots. Report preview and CSV share the same detected-date/status filters. The CSV includes current findings and every stored decision event for the selected findings; retain formula neutralization and authenticated resource downloads. Preview limits must be visible and must not truncate the full export. Legacy exclusion rules apply to manual client checks only; show their actual scope and affected-product preview, not a claim that background monitoring applies them.

## Production readiness changes, 23 October 2026

Merchant email retries must use transactional leases, frozen recipient/content, safe terminal states and a tenant-specific UUID in Brevo `headers.idempotencyKey` (not the old `Idempotency-Key` spelling). Immediate event retries and weekly scheduler retry configuration are separate deployment settings. Brevo's key retention is 30 minutes; ambiguous acceptance must stop for operator review after 25 minutes rather than resend outside that window. Known rejections may retry within the attempt budget. Free-scan report submission has its own durable lease/acceptance state so a task retry cannot resend a previously accepted report.

The full free-scan export uses a separate random report secret delivered only in the recipient email's fragment link. The frontend removes the fragment from history and POSTs it for 200-receipt pages; the anonymous status GET remains counts-only. Only completed, unexpired requests authorize the export. Receipt data preserves all stored product warnings; email previews stay bounded to five products/one warning. Keep CSV formula neutralization and exact Shopify/Commission URL allowlists. Existing completed requests are not automatically remailed.

Production billing must validate the returned shop identity, explicitly active prices and a future finite cycle/trial expiry, and must fail closed on entitlement-persistence errors. The current Partner organization is unregistered for the App Store and the public listing is Draft; the hosted pricing page is 404. The owner subsequently authorized client `ZeroRecall subscription verification` with only `Manage apps`; the Partner API returned a verified null subscription for the development shop. Its token is stored in Secret Manager with secret-scoped runtime access. App Store registration, plans and a real subscription return remain external launch gates; never bypass production billing. See `docs/production-readiness.md`.

The app records the authenticated `shopifyShopId`, actual `subscriptionPeriodEnd`, and `billingRefreshAfter` with verified managed contracts. `subscriptionValidUntil` is a finite access cache capped at 24 hours. `refreshShopifyBillingEntitlements` renews up to 100 oldest-due tenants hourly in groups of five via the Partner API, with its token bound from Secret Manager. Null/expired contracts revoke cached access; failures defer the tenant and retain only the finite prior cache. No Shopify Admin session is needed for renewal.

The readiness source release is `c9e2e32`: Cloud Run, six scoped email/free-scan functions, Hosting, and the new hourly billing function are deployed. Verify the custom scheduler identity's `roles/run.invoker` on the billing service; a successful function creation alone did not prove execution (the first manual invocation returned 403, and the repeat succeeded after confirming/reapplying the intended binding). Never make the function public to resolve that failure. The real owner contract refresh succeeded with a verified null contract, and the complete seven-product export and reissued recipient email were verified. The remaining paid journey is blocked by App Store registration/plan availability, not by absent Partner API credentials. See `docs/production-readiness.md` for evidence boundaries.

## Firebase correctness hardening, 23 October 2026

Technical failures are incomplete checks, never clean matches: required vector retrieval, model unavailability/malformed output and text embedding failures throw. Reliability cache version 2 excludes old ambiguous results. KNN recall expands until the similarity threshold is exhausted; a saturated 1,000-result boundary fails explicitly pending partitioned retrieval. AI processes every selected candidate in batches of 12.

Both manual and background findings use the same transactional product/source key (`finding_` + SHA-256 of product ID, NUL, Safety Gate alert ID). Preserve original evidence, merchant decisions and legacy findings; technical rechecks no longer auto-resolve them. Manual decision modals show the exact finding being changed. Product deletion creates a versioned tombstone even before import, removes vectors and fences late writes. Before recursive deletion, mark the installation retired; all worker/import/run writes must respect retirement and the captured installation identity. Imports require an existing merchant. Merchant vector reuse requires `embeddingVersion: 2` and matching source version.

Weekly imports use content hashes and an atomic `rapex_changes` journal with server commit timestamps so corrections to older publications are monitored independently of publication-date cursors. Checkpoints retain full timestamp/document-ID tuples. History/windowed audit checkpoints are scoped separately. Daily/manual overflow pages continue through durable tasks and incomplete pages do not report overall success. Keep batch vectorization and targeted AI.

Operational safeguards and release/rollback instructions are in `docs/firebase-operations.md`. The hourly read-only health scheduler uses its dedicated `safety-gate-backend-health` service account; maintain private invocation and viewer-only database access. Keep PITR, database deletion protection, daily/weekly backups and operations alerting configured. A successful scheduled backup configuration, recovery request or alert-policy creation is not evidence of a completed backup, verified restore or received incident email. Preserve those evidence distinctions.
