# Shared-only Safety Gate image vectors

24 October 2026: the owner authorized removing the primary-picture vector copies from `rapex_alerts`. The canonical image vectors remain in `rapex_alert_images`; merchant/product vectors are a different dataset and remain unchanged.

## Storage and reader changes

Monitoring now loads vectors exclusively from the shared image collection, for every current picture. Publication-date and correction-journal candidates no longer read `rapex_alerts.vector_image`. The legacy primary fallback has been removed from `selectMonitoringImages`.

Both the official weekly loader and legacy/historical/backfill loader paths stop writing inline picture vectors. Weekly ingestion also deletes an existing inline field on update. The historical document type no longer exposes that field. The canonical history-reconciliation tool likewise writes only shared image vectors, so maintenance cannot recreate the removed copies.

Manual product checks already query the shared image collection. Cached Shopify-product image vectors are tenant product vectors, not source duplicates; they are preserved.

## Preflight and release

The live preflight found 41,964 inline copies, 47,500 source documents and 103,131 shared image documents. All sources with a copy had shared pictures. Six retained source snapshots still referenced older primary-picture URLs. Their current official photo sets were independently checked against the Commission's public detail API and the saved official inventory, and every current picture already had a shared vector. Only those picture-reference fields were aligned, with a source revision and change-journal event; publication dates, text vectors and merchant evidence were preserved.

Functions build, lint and 89 tests passed. Tests cover removal of the inline fallback, all-photo recall and no-regeneration in weekly/historical document writers. The scoped release updates eight readers/writers while preserving each function's deployed dependency lock, unrelated source and runtime/secret/trigger settings:

- `merchantMonitoringTask`, `merchantCatalogAuditTask`, `runMerchantDeltaMonitoringAPI`
- `dailyRapexDeltaLoader`, `manualSafetyGateWeeklyLoader`
- `manualRapexLoader`, `backfillRecentRapexEmbeddings`, `backfillHistoricalRapexAlerts`

## Data cleanup

`scripts/remove-alert-image-copies.mjs <evidence-directory> apply` requires successful verification of all eight deployments and photo-reference alignment. It updates only the `vector_image` field in `rapex_alerts`. It never deletes source documents, shared image documents, text embeddings or product vectors. A final count comparison verifies these invariants. The old source-only vector index is removed after the field cleanup; shared-image/product indexes remain.

Private evidence, deployment snapshots and final results live under `outputs/remove-primary-vectors-2026-10-24/`. `cleanup-result.json` records actual removed-copy counts and raw bytes; index storage reclaim is asynchronous and is not included in the raw-vector estimate. No scheduled backup or PITR setting is enabled by this operation.

## Completed production verification

All eight functions are ACTIVE with their original runtime/secret/trigger settings preserved. The cleanup removed **41,964 inline vectors** and **six obsolete source-only image-vector indexes**. Remaining inline vectors and source-only image-vector indexes: **zero**. Raw vector payload removed: **472,682,496 bytes (0.4402 GiB)**, excluding index and field overhead.

Before/after invariants: **47,500 source documents**, **47,500 source text vectors**, and **103,131 shared image documents**, all unchanged. The six official photo-reference corrections completed before deletion. The post-cleanup read-only control again hydrated 119 shared vectors across 30 sources and found the secondary-photo-only test candidate without any inline vector dependency. No merchant finding, entitlement or email was created by verification.
