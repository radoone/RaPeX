# All-image Safety Gate monitoring

24 October 2026: automatic merchant monitoring and initial catalog audits now load every available current Safety Gate picture vector from `rapex_alert_images`. The manual delta API uses the same implementation. Product-to-Safety-Gate retrieval already searched that collection.

`loadMonitoringImages` fetches picture vectors in groups of 30 source alert IDs, for both publication-date and correction-journal candidates. It filters obsolete picture URLs and deduplicates repeated URLs. The initial release retained an existing primary vector as a fallback; the subsequent owner-authorized [shared-only storage migration](alert-image-storage.md) removes that fallback and the inline copies. Embeddings are not regenerated.

For each alert, the tenant-scoped product shortlist combines text recall and recall for every available picture vector. Each query retains the existing distance threshold and expansion/saturation safeguards. Product IDs are deduplicated before AI, and product/source pairs remain deduplicated through the existing finding identity. A failed image query makes the page incomplete; it cannot advance the checkpoint or record a successful clean check.

The source photos that retrieved each product are ranked by vector distance and prioritized in that product's transient matcher evidence. Stored official facts are not reordered or overwritten. Official thumbnail provenance is respected when an oversized/unavailable original was embedded through its actual Commission thumbnail. Matcher cache signatures now include the source-image order/content, preventing reuse of an earlier primary-only analysis for different picture evidence.

Vector recall has no primary-photo-only or fixed-picture-count cap. Gemini remains targeted and bounded: the existing media preparation uses up to two pictures per source and four source pictures per request, with retrieval-matched photos first. This release does not claim that Gemini directly inspects every source photo in one call. Unavailable official photos without an embedding remain unavailable; their source text remains eligible.

## Verification

- Functions build/lint passed; 83 Functions tests passed for the frozen release. After a concurrent matcher optimization was committed separately, test dependency injection was made compatible with both media-loading signatures and all 87 current-worktree Functions tests passed.
- Regression tests cover a seventh-picture-only candidate, duplicate merging, expanded secondary recall, unavailable/obsolete pictures, legacy fallback, thumbnail provenance, batched reads and failures, matched media reaching the real prompt-preparation function, and image-sensitive cache signatures.
- A read-only live control loaded 119 actual picture vectors across 30 official records. A synthetic product matching a secondary source picture had primary-image distance 0.6054 (outside the 0.35 threshold): primary-only recall returned zero products; all-image recall returned one. No merchant fixture, entitlement, finding or email was created.

Private evidence and production rollback snapshots are under `outputs/all-images-monitoring-2026-10-24/`. The scoped release overlays only `merchant-monitoring`, `monitoring-images` and `safety-gate-checker` on the existing source/dependency lock of `merchantMonitoringTask`, `merchantCatalogAuditTask` and `runMerchantDeltaMonitoringAPI`. Both previously deployed owning modules matched the prior canonical source before overlay. Builds against all three preserved production lockfiles passed. Final deployment state and preserved runtime/secret/trigger settings are recorded in `release/verification.json`.

All three functions are verified ACTIVE: `merchantmonitoringtask-00009-zev`, `merchantcatalogaudittask-00008-wug`, and `runmerchantdeltamonitoringapi-00026-dis`. The workspace matcher changed while the original deployment was being dispatched. Its source-hash guard correctly stopped the third upload. The manual API was subsequently released from the same validated immutable bundle as the two workers, after checking that its remote source/update time still matched the original snapshot. The unrelated parallel-matcher changes remain in the workspace and were not folded into this frozen release.

A real subscribed merchant end-to-end journey is separate from the read-only control; production billing was not bypassed for this release.
