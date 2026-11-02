# ZeroRecall hosted test-store QA — 2 November 2026

The owner authorized testing in `rozlicnytovar.myshopify.com`, including ACTIVE products, real notification emails, test-finding decisions, deployment and necessary breaking changes before public launch. This uses deployed infrastructure; it is not evidence of a public or App Store launch.

## Product fixtures and actual results

Exactly 40 clearly labelled `ZeroRecall TEST` products were created and activated. Shopify independently returned all 40 as `ACTIVE`. The store contains 64 products in total; this exercise does not claim a fresh audit of all 24 unrelated existing products. The browser still reported 18 catalog products needing a current check. The positive fixtures use ten genuine Safety Gate source records; the ToyRock record was also checked on the official EU website in the browser. The source photographs and identifiers are actual record data. Controls are synthetic household products without copied recall identifiers or photographs. No products were created through an expanded Shopify app scope: the signed-in shop owner's Admin session was used.

At the final 21:49 UTC audit, the latest durable jobs for all 40 fixtures had completed, with no remaining fixture job errors:

| Group | Products checked | Expected source found | Other result |
| --- | ---: | ---: | --- |
| Validated GTIN | 10 | 10 | Every expected warning has `matchBasis: gtin` and variant evidence |
| Text AI | 10 | 10 | Actual brand/name/description; no barcode or photograph |
| Image AI | 10 | 10 | Actual brand and photograph; generic title/description, no barcode or supplied model |
| Negative controls | 10 | — | No findings for any control |

The image group initially found 9 of 10 expected records. Midex was retrieved by both text and image, but deduplication discarded its much stronger image distance. It therefore fell behind other candidates and its photograph missed the bounded model image input. The fix merges the strongest visual evidence, prioritizes the matched current photograph and preserves the candidate/image/model limits. A real description-only Shopify update retriggered this fixture; its subsequent completed job found the expected Midex source. Match-cache reliability version 5 excludes results produced before this fix.

These are controlled functional fixtures, not an independently labelled accuracy benchmark. There were 43 product/source findings across the 30 positive products, including 13 additional similarity warnings. One secondary Happy Star warning was reviewed and dismissed: the official battery-powered gun model `228-45, MPI03466` differed from the fixture's dart-gun model `MPB63237`. Its exact barcode finding was preserved. Other secondary OEM/category suggestions still need individual review; these results do not establish 100% precision or general recall. Use `docs/matcher-evaluation.md` with independent labels before making quality claims.

## Browser and workflow checks

- The live embedded app loaded from its stable Cloud Run host with the installation-bound owner access banner. No subscription was fabricated. The grant has no expiry and remains enabled until the owner explicitly requests revocation.
- The GTIN review showed the exact-match badge, Shopify brand, matching code, affected variant, official case and source link. Exact compatibility scores were not displayed as measured image similarity.
- A real product-row manual-check request returned a successful result with exact barcode evidence. It exposed a result-modal readiness race and stale-state handling on repeat checks; the deployed fix opens the result through the shared Polaris-ready helper and resets the previous result before another request. A subsequent actual SOULET row check returned HTTP 200 and visibly opened the exact result with canonical GTIN and affected variant evidence.
- The deployed no-match result visibly opened on desktop and on a 393-pixel mobile viewport, including a second check of the same product. Both requests succeeded. The dialog contained the actual product and no-match message, with no invented source comparison or Reactivate control. These UI requests reused a real saved AI result; the uncached measurements are reported separately.
- Desktop and 393-pixel mobile review screenshots were captured. The mobile iframe body measured 366 pixels wide with no horizontal overflow. The response guide opened using the keyboard.
- Three new test findings exercised `waiting_for_supplier`, `resolved` with the `other` outcome, and `dismissed` with a false-positive review. Other required a note before the button enabled. Firestore contained the immutable decision events, actor and test notes; waiting retained `status: active`. No supplier was contacted and no unrelated existing finding was changed.
- A browser-initiated CSV download included the canonical GTIN, variant ID/title and decision notes. The audit page separated current monitoring/import status from finding filters and correctly displayed unavailable historical import counts.

## Operational fixes

A real manual negative-control check exceeded the synchronous API deadline. The app displayed a failed check rather than inventing a clean result. Logs showed the model reproducing whole source documents, including an extremely long invented image URL, because the prompt used the full enriched warning schema. The new model-only response contract contains only candidate ID, bounded scores and a bounded reason; the server still supplies all source and variant evidence from its database. A genuinely uncached run against the same coffee-mug product and 12 candidates returned zero warnings in 15.2 seconds. Additional uncached checks retained the expected ToyRock text match (12 candidates, 16.3 seconds) and Midex image match (12 candidates, 34.4 seconds). The final deployed API also completed an authenticated, uncached request for this control with HTTP 200, 12 candidates and no warnings in 14.2 seconds. These observations are not latency guarantees; the completed 40-fixture jobs above precede this model-contract update, with these three targeted uncached controls and the live API request validating the new output contract. The no-match manual dialog also has a dedicated result state instead of showing an empty Safety Gate comparison or implying a reviewed finding.

A separate code review found that a successful empty shortlist from cached vectors triggered redundant fresh embedding/retrieval. Cached retrieval now returns `null` only when reusable vectors are absent; an empty successful KNN result completes normally, still unioning exact barcode hits. Provider failures continue to propagate. Regression coverage checks both the no-hit path and fail-closed behavior. The coffee-mug control actually had 12 shortlist candidates, so this empty-result optimization was not the cause of that observed timeout.

The product worker initially could not decrypt the private Shopify session because its `SAFETY_GATE_API_KEY` binding was missing. Only that runtime secret-binding list was patched, preserving existing bindings, code and resources. The canonical function declaration now contains the binding. Encrypted sessions remain private; tokens never enter task payloads.

Shopify advanced 27 product versions after their initial creation webhook, without a matching current-version task. Those fixtures were first reconciled from authoritative Shopify data using one batch text-vector import and authenticated durable ingress. No checks or findings were fabricated. The subsequent worker fix fetches current title, description, images and all variant identifiers and durably schedules a newer version before superseding the old job. Recovery preserves entitlement, installation, retirement, deletion and newer-snapshot fences; enqueue failures remain retryable. REST offsets, UTC and fractional-second representations now compare as the same product version. New ingress/recovery tasks use canonical UTC timestamps, avoiding duplicate identities for equivalent versions. Catalog coverage and vector reuse recognize equivalent timestamps without rewriting historical data. A live replay of the captured stale Midex snapshot proved the deployed recovery: the original job became `superseded`, recorded its recovery job ID and canonical `2026-11-02T21:14:07.000Z` version, and that child completed normally. All 40 latest fixture jobs then completed; the 43 product/source findings and existing decisions remained unchanged.

The source GTIN migration scanned 47,568 alerts and updated 11,691 derived indexes without conflicts. Merchant indexing scanned 24 existing snapshots, refreshed 22 and skipped two version conflicts. These index migrations were not historical safety scans and did not send emails.

Brevo had no registered transactional delivery webhook. Authenticated webhook `2654949` now targets the deployed handler using the existing Secret Manager binding. At the workflow audit, 38 new test emails were callback-confirmed delivered and five earlier test emails remained accepted. Earlier accepted messages were not retroactively marked delivered. The weekly scheduler and marketing free-scan workflow were not exercised by this test.

## Release, validation and private evidence

Feature and fix commits include `e95b937`, `95fab9b`, `dd561da`, `46ebab3`, `42417d2`, `cca676e`, `1aa148b`, `f183a8c`, `5461f9d`, `3f030d6`, `b9bfbef` and `7bc3065`. Backend releases use each deployed function's source and lockfile with scoped overlays; app releases preserve the existing Linux runtime and dependencies. Existing environment, secret bindings, limits and timeouts are checked independently. Cloud Run revision `safety-gate-shopify-checks-3f030d6` was staged without traffic; its runtime specification matched the prior deployed configuration after excluding only the image, and its preview login returned HTTP 200. It then received 100% traffic, and the temporary preview tag was removed. The version-recovery ingress remains `startshopifyproductchangeapi-00009-pal`. The later bounded-model release updates the checker, product worker, monitoring worker/API, catalog-audit worker and public scanner/API worker with their own preserved production lockfiles and the same verified prompt/schema overlay. No Shopify scope/extension release or database backup/PITR enablement was required.

Final bounded-model backend revisions, all ACTIVE with verified preserved configuration:

- `checkProductSafetyAPI`: `checkproductsafetyapi-00066-kur`
- `shopifyProductChangeTask`: `shopifyproductchangetask-00015-mel`
- `merchantMonitoringTask`: `merchantmonitoringtask-00015-gav`
- `runMerchantDeltaMonitoringAPI`: `runmerchantdeltamonitoringapi-00031-tox`
- `merchantCatalogAuditTask`: `merchantcatalogaudittask-00013-nik`
- `scanPublicShopifyStoreAPI`: `scanpublicshopifystoreapi-00024-det`
- `freeScanCatalogTask`: `freescancatalogtask-00013-guj`


Validation: 130 backend tests, 98 Shopify tests, Functions/app builds, TypeScript checks and affected-file lint. Recovery tests cover equivalent timestamps/task identities, current authoritative data, queue retry, installation/entitlement/retirement/deletion boundaries and newer-product fences. Those failure boundaries are unit-tested; they are not claims of live uninstall or deletion drills.

Private evidence and rollback/configuration snapshots remain in `outputs/gtin-release-2026-11-02/`, including the 40-product manifest, latest-job results, workflow/email audit, downloaded CSV and screenshots. Do not commit these private artifacts or credentials. Keep the products and the explicitly authorized owner grant available for subsequent testing.
