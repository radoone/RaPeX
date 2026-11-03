# Recovering missed Shopify product webhooks

Daily catalog reconciliation runs at **02:17 Europe/Bratislava**, independently of an open Shopify Admin session. It uses the private offline Shopify session and the existing `read_products` scope. It does not mutate Shopify products or require `write_products`.

Two new functions own this work: scheduler `dailyMerchantCatalogReconciliation` and durable task worker `merchantCatalogReconciliationTask`. Only the existing `shopifyProductChangeTask` needs an application-code update alongside them. The scoped release script preserves each deployed source/dependency lock and replaces only reviewed lifecycle functions; new functions use an isolated index with exactly their two exports. No frontend, website or unrelated function release is required.

## Inventory comparison

1. For an entitled shop with a completed initial catalog audit, enumerate Shopify product **IDs and updatedAt only**, in stable ID order, 100 per page. Compare with field-masked Firestore product versions. Unchanged products enqueue no check and incur no embedding/model work.
2. Enqueue new/changed products through the existing product worker. It fetches authoritative title, descriptions, pictures and all variant barcodes before the normal cached embeddings → vector shortlist → targeted AI pipeline. A product that changed again gets a new version-keyed recovery task; stale data cannot be analyzed as current.
3. Page through the stored catalog, 100 documents at a time. Batch-check product identities with Shopify GraphQL `nodes(ids:)`. Only an **explicit null at the expected position in a successful, complete response** establishes absence. GraphQL errors, throttling, missing data, missing nodes, invalid identities and HTTP failures fail the page for retry. A missing item in the earlier paginated enumeration is never enough to delete it.
4. Queue confirmed deletions through the product worker. A deletion marker blocks delayed older updates, removes vectors/GTINs from search, and marks findings `productDeleted`. Keep checks, finding decisions, immutable decision events and audit history.

An unentitled installation still receives lifecycle deletion cleanup; it cannot enqueue new product analysis. An incomplete initial audit retains ownership of bulk imports/batch embeddings: reconciliation performs existence cleanup only until the initial audit completes. This job does not replace the initial full-history Safety Gate audit or a merchant subscription.

## Recovery and concurrency

Run state lives under `merchants/{shop}/catalog_reconciliation_runs/{runId}`; the root points to its current run. Task payloads contain only shop/run/installation/page identities. Every page first saves an immutable prepared list of product IDs, operations and versions. It advances its cursor only after durable repair dispatch succeeds. Stable run/version task IDs deduplicate replay; a separate recovery identity allows an exhausted old webhook job to be repaired. An enqueue failure after cursor commit is repaired by the old page's retry, which dispatches the current continuation without rolling progress back.

Each page has a token-fenced 22-minute lease and a 20-minute task deadline, four bounded repair dispatches, eight attempts and bounded backoff. Sibling dispatches settle before releasing a failed page. Installation identity, retirement, current run and lease tokens guard writes; uninstall/GDPR deletion or reinstall prevents stale workers from repopulating tenant data. Scheduler retries repair missed dispatch. Unfinished runs older than 20 hours can be abandoned on the next day's reservation; their root run fence stops late writes.

Deletion first commits a tombstone, then marks findings in resumable batches of 200. A retry with the same deletion version resumes after a partial failure; `deletionCleanupCompletedAt` records completion. Every batch rechecks installation and deletion version so a newer product update stops old cleanup. No review decision is overwritten. Older legacy tombstones without this completion marker are also eligible for reconciliation cleanup.

Catalog run completion means inventory comparison and repair **dispatch**, not completed safety analysis or proof that a product is safe. `upsertRepairsPlanned` and `deletionRepairsPlanned` count planned operations; entitlement changes or supersession can suppress actual dispatch. Product checks and job states remain the evidence for completed analysis. The root `catalogInventoryComparedAt` has the same limited meaning.

## Cost and retention

Each daily pass uses approximately one masked product metadata read during discovery and one during verification, plus Shopify requests in batches of 100. For 100 shops × 100 stored unchanged products, this is roughly **20,000 product document reads/day**, plus tenant/run/page bookkeeping. Shopify Admin API calls are throttled API work, not Vertex model charges. No product vectors are downloaded by reconciliation. Changed/new products incur the existing embedding and matching costs separately. First audits continue to use their batch-vectorized import.

Run documents expire through Firestore TTL on `expireAt` after 90 days; TTL deletion is asynchronous. Disable indexing for `prepared` and `expireAt`. Deploy these **two field configurations only**, preserving existing unrelated TTL/index policies. The runtime service account needs Cloud Tasks enqueue access; task invocation stays authenticated. Tokens and signed release snapshots must never appear in task payloads, public responses, logs or this document.

## Validation

190 backend tests pass, including incomplete/error responses, ordered pagination, unchanged versions, exhausted-job recovery identities, authoritative product hydration before model work, cursor continuation failures, persisted page replay, lease/installation fences, unentitled cleanup, initial-audit isolation, and interrupted deletion of 501 findings while retaining decisions/checks/history. Functions lint and the backend production build pass.

## Production verification — 3 November 2026

The product worker update and both new functions are deployed and ACTIVE. The scoped worker check preserved its runtime environment, secret bindings, service account, timeouts, memory, instance limits and triggers. The new queue is RUNNING with four concurrent dispatches and eight attempts; the daily 02:17 Europe/Bratislava schedule is ENABLED. New function invocation requires IAM authentication.

An owner-shop run enumerated 84 actual Shopify products and verified 85 stored documents, including one clearly labelled indexed-only synthetic missing-product fixture. Shopify returned absence for that fixture; its real queued deletion task committed the tombstone and cleanup marker and completed successfully. The fixture product document was then removed. No Shopify product was deleted, and no safety check, finding, decision or email was fabricated. The internal completed job remains labelled as a test fixture.

The fixture deletion waited behind product-analysis work in the shared queue. Its existing Cloud Task was explicitly dispatched with `runTask` to complete the correctness test without waiting for that backlog. This proves authenticated dispatch and deletion behavior; it does not measure ordinary queue latency. The nightly cleanup can wait behind product analyses. Prepared inventory pages and installation/version guards continue to apply.

Sanitized results and private source/runtime snapshots are in ignored `outputs/catalog-reconciliation-2026-11-03/backend/`, including `verification.json`, `new-functions-verification.json` and `live-owner-verification.json`. Do not publish runtime dumps, task bodies, tokens or signed source URLs. A manual Scheduler invocation completed with HTTP 200 according to its AttemptFinished log, separately verifying the scheduled HTTP authentication path. Run TTL is ACTIVE and both targeted index exemptions are applied.
