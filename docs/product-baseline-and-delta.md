# Current product coverage and incremental monitoring

Deployed and checked with production AI on 3 November 2026. After the isolated QA test, the owner explicitly authorized resuming the real test store and real notification emails. The fresh 84-product audit completed and regular delta monitoring is restored, without reviving the cancelled historical chain.

## Contract

A new/version-changed Shopify product performs global GTIN and vector retrieval against the current indexed Safety Gate database. Only the selected candidates reach the existing matcher. This is a global indexed search, not an exhaustive AI comparison of every possible product/source pair. Preserve the existing shortlist limits, thresholds, GTIN priority and failure behavior.

`withProductSafetyCoverage` records successful per-product coverage under `merchants/{shop}/product_safety_coverage/{productId}`. It stores the product fingerprint/version, installation identity, a result snapshot and a native Firestore `coveredThrough` timestamp captured **before** retrieval. The same small coverage marker is mirrored on the stored product. A server read time prevents a source committed during model analysis from being skipped by the next delta. A transaction lease prevents concurrent full checks of the same product. Errors, deleted/version-changed products and retired/replaced installations cannot publish successful coverage.

If the product and installation are unchanged and the change journal has nothing after that timestamp, a repeated full-check request returns the stored result without vector retrieval or AI. New source changes permit fresh global retrieval for an explicitly requested product check; completed pairs remain reusable. Background monitoring uses only the incremental journal, not a repeated global product query.

`merchants/{shop}/product_match_results` retains positive **and negative** outcomes for a product/source pair. Its key includes the product ID and fingerprint plus canonical source facts and pictures. Source revision timestamps and picture priority do not invalidate the pair. Actual product/source content changes do. These pair results and coverage have no TTL; the old 30-day batch cache remains an optional acceleration and its successful hits populate the durable pair cache. Pair writes are product-version and captured-installation fenced. Bump the fingerprint/cache algorithm version when changing matcher semantics.

## Initial catalog audit

The import still batches text embeddings in groups of 50 and reuses current product vectors. At the import-to-monitor transition, the durable audit records a server `baselineAt`. Monitoring then pages through **four product documents** at a time in document-ID order, with at most two product checks concurrently. Each product searches the whole current source index. Its successful coverage and stable check/finding IDs survive page retry. Counters describe products checked and shortlisted candidate comparisons, not the entire database size.

Only successful audit completion publishes `monitoringBaselineAt` on the merchant root. It clears an obsolete journal cursor, while retaining decisions, existing findings and check history. Zero-product imports and failed audits do not publish a successful baseline.

## Background delta

Normal monitoring starts at the newer of the successful merchant baseline and its consumed native timestamp/document-ID change cursor. It reads `rapex_changes` only; it does not also page through historical publication dates. Historical imports before the baseline are excluded. Corrections to an old publication committed after the baseline are still eligible, so a publication-date filter cannot hide a real correction.

Before matching, exclude changes already covered by that product's matching fingerprint/installation and full-check timestamp. This also prevents late products in a long initial audit from redoing changes that their own current-state check already included. Successful pages commit native seconds/nanoseconds plus document ID; ISO strings alone lose timestamp precision. Technical journal entries may still require retrieval, but an unchanged completed pair needs no additional AI call.

Explicit history/date-window requests stay separate from the regular delta. Scheduled jobs skip tenants without a new successful baseline; a direct delta request without one fails explicitly rather than replaying the entire historical journal. Cancelled monitoring, product and initial-audit tasks remain terminal.

## Rollout and stopped production

At approximately 20:26 Bratislava on 3 November, all five checking queues were paused/purged, checking/import/weekly-summary schedulers paused and the project's Vertex AI API disabled. The active monitoring run ended and was marked cancelled. Do not resume any of these without a new owner instruction. Details and original configuration snapshots are in private `outputs/alert-spend-investigation-2026-11-03/`.

`scripts/scoped-product-coverage-release.py` deployed seven consumers: `checkProductSafetyAPI`, `shopifyProductChangeTask`, `merchantCatalogAuditTask`, `merchantMonitoringTask`, `runMerchantDeltaMonitoringAPI`, `dailyMerchantDeltaMonitoring` and `dailyRapexDeltaLoader`. A follow-up release changes the task/API delta report metadata from bootstrap/history to delta/since-last-check when a baseline exists without a publication-date checkpoint. Private bundles, original source/configuration snapshots, preserved-lock builds, operation IDs and active revisions are in `outputs/product-baseline-2026-11-03/backend` and `backend-delta-status`. All runtime environment, secrets, service identities, memory, timeouts, instance caps and triggers were verified preserved. Three index exemptions from `firebase/firestore.indexes.json` were applied. The deployment did not resume queues or schedulers.

Existing catalogs have no trustworthy new coverage marker. Do not infer one from `lastCheckedAt` or set a baseline to now without completing the first current-state audit. Old in-progress audit monitor pages lack `baselineAt` and must be deliberately cancelled/restarted with a new run; they must not be silently resumed. For the owner's stopped store, reserve a new initial catalog audit through the authenticated app when the owner authorizes checks again, then let successful completion publish the delta baseline. Review any queued webhook jobs before resuming the purged queues.

Tests cover cache regrouping, negative results, errors and retry, concurrent full checks, product/installation changes, sources committed during matching, bounded initial product pages, baseline publication, historical backlog exclusion and old-source corrections after the baseline. They use local I/O substitutes and make no model calls.

## Production evidence

All 203 local tests passed. The controlled live test used a temporary private QA tenant with an exact copy of `ZeroRecall TEST — AI-IMAGE 08` and its stored current vectors. It did not change the owner's catalog, original findings, decisions or monitoring checkpoint. Email preferences were off and the QA tenant had no monitoring entitlement, so no notification was sent.

| Check | Measured duration | Model responses | Evidence |
| --- | ---: | ---: | --- |
| First global-index retrieval and match | 47.25 s | 2 | 17 shortlisted candidates; 17 durable pair results and successful coverage |
| Unchanged repeat | 1.55 s | 0 | Exact stored result, original coverage completion timestamp, explicit coverage-hit log |
| Known-pair journal change | 6.50 s | 0 | Exactly one source/product, explicit pair-hit log, cursor advanced |
| Next run without changes | 1.21 s | 0 | Zero sources and products |
| Unseen-pair journal change | 12.89 s | 1 | Exactly one source/product; exactly one additional persistent pair result |
| Final run without changes | 1.12 s | 0 | Zero sources and products |

The deltas were controlled journal entries pointing to existing real official records, including an eligible prior owner-shop source outside the first shortlist. No public RAPEX document was inserted or modified. Only this one-product QA catalog received a baseline after its real successful full check. The source facts and source vectors came from production; these were not synthetic matcher responses. Logs tie the model/cache events to the deployed revisions and execution IDs. Allow ±250 ms when correlating server timestamps with client request windows.

The QA merchant subtree, temporary journal entries and its legacy batch-cache rows were deleted afterwards. Private evidence is in `outputs/product-baseline-2026-11-03/live/`, including request results and log verification. Timing is one controlled sample, not a throughput guarantee for every product/catalog. Three successful model responses were observed; an exact monetary charge has not been obtained from Billing.

The final deployed revisions are `merchantmonitoringtask-00023-fay` and `runmerchantdeltamonitoringapi-00039-gah`; a subsequent live request returned `mode: delta`, `strategy: since-last-check` and zero work while Vertex remained disabled. The final audit at 19:58 UTC confirms no QA tenant/journal/cache residue, all five queues empty, and zero new real-store findings or email notifications since the stop. Runtime/queue/scheduler/index snapshots are retained in `operational-verification.json` and `final-audit.json` in the private evidence directory.

The isolated QA proves the deployed product-check/cache/delta path. The separately authorized real-store resumption below verifies the catalog migration and workers; the initial-audit page/state transitions are also covered by local tests.

## Authorized real-store resumption

At approximately 21:06 Bratislava on 3 November, the owner authorized checks and actual email notifications again. Vertex AI, initial-audit/lifecycle queues, source imports, reconciliation and the weekly summary scheduler were restored. Fresh run `baseline-c1101d33-1e25-4408-b1ab-e4c9bf87d8e2` imported all 84 Shopify products. The cancelled historical monitoring chain remains terminal. The audit completed at 20:29:07 UTC after about 21m48s of worker execution. All 84 coverage documents and 1,029 pair results were stored. One invalid candidate-ID model response on the final page was rejected; the page recovered on its second attempt without redoing completed product coverage. Regular delta queue/scheduler were then restored. Both subsequent real-store delta API calls returned `mode: delta`, `strategy: since-last-check`, zero sources/products/findings and `hasMore: false`; the second request took approximately 2.5 seconds. All five checking queues are RUNNING, all four previously paused source-import/check/reconciliation/summary schedulers ENABLED, and Vertex AI ENABLED. These immediate manual delta calls verify checkpoint behavior; they do not assert that a future scheduled run or a future genuine source delta has already occurred. Private progress, cache verification and delivery evidence are in `outputs/resumed-monitoring-2026-11-03/`.

An unchanged real-store product repeat returned HTTP 200 in 8.907 seconds with the exact stored result/check timestamp, unchanged coverage completion and unchanged pair count. A first genuinely new finding produced one immediate email whose notification audit reached `delivered` through the delivery webhook. This is delivery evidence from Brevo, not a claim of a Gmail inbox inspection.

### Vector lookup latency observed during resumption

Three read-only client measurements using actual stored owner-shop vectors and production query limits (12 text / 6 image results) took 2.46–2.57 seconds for text and 2.91–3.38 seconds for images from the owner's laptop. A separate Firestore Query Explain analysis isolated server execution at **1.992521 seconds for text** and **2.005535 seconds for images** on one real product. Text used the 1536-dimensional vector index and scanned 47,568 vector entries (12 documents, 488 read operations); images used the 1408-dimensional index and scanned 103,364 vector entries (6 documents, 1,040 read operations). These are measured flat-index searches, not millisecond ANN performance. Vector index-entry reads are material; do not describe each KNN as merely the 12/6 returned document reads. Measurements are in `vector-timing.json` and `vector-explain.json` in the resumption evidence directory. They are samples, not an all-product latency distribution. No AI calls or data mutations were made for this measurement.
