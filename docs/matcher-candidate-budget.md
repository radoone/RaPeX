# Bounded vector candidates for product checks

The current-state product check retrieves a wider text/image pool, then independently selects at most three text hits and three image hits. A source found by both routes occupies one final slot. All merchant photos share this budget; another photo does not create another allowance. Ranking uses the actual distance within each modality, with source ID as a deterministic tie breaker. Text and image distances are not compared against each other.

The existing cosine-distance thresholds remain text ≤ 0.38 and image ≤ 0.35. These are retrieval thresholds, not calibrated probabilities of product identity. Candidates without a finite distance fail the check instead of becoming a successful empty result. Exact validated GTIN hits remain outside the vector budget and are evaluated without the language model; affected variant and batch still need review.

There is no brand/model equality filter in candidate selection. Translated or rebranded products retain an independent image route. For visual identity with different local codes, the matcher requires comparable photos of the specific source, image score ≥ 90, at least two distinct reported visual details, and no reported physical contradiction. The server validates this evidence structure; it cannot independently prove that details asserted by the model are correct. Generic resemblance and overlapping identifier fragments are insufficient.

The merchant/source photo limits and official danger, measures, risk type and risk level in the comparison prompt are preserved. The final finding is enriched from the authoritative source, so the official hazard description remains available even when the model returns only a concise identity explanation. A source hazard must never be presented as an observed defect in the merchant's product.

The budget applies to global current-state product retrieval, including the shared public scanner path. It does not truncate the stream of new source/product pairs in journal delta monitoring. Already checked pairs remain cached. Matcher policy version 7 invalidates earlier full-check and pair results on subsequent explicit checks; it does not erase historical findings, merchant decisions or completed baselines, or enqueue a catalog replay.

The provider receives an enum of the actual source IDs for each batch of at most four candidates. Output length is bounded by the number of distinct candidates (up to twelve in the generic contract). A live diagnostic rejected four candidate IDs with a twelve-result bound and accepted the identical fields with a four-result bound. Score, reason, visual-evidence and authoritative-ID constraints remain in place.

## Verification

The frozen [22-pair regression fixture](../firebase/functions/test/fixtures/matcher-retrieval-22.json) extends the earlier tuning cases with the three beta false positives, beta positives without official case-number markers, and a synthetic local relisting of a photographed product. The relisting changes the name, brand and model code; it is a controlled transformation, not evidence of a real shared manufacturer or affected batch. Labels were fixed before predictions. This is a regression/tuning set, not an independent accuracy benchmark.

Live preparation used 18 distinct product inputs, exact-GTIN lookup, one batch of 16 text embeddings, and actual Firestore text/image KNN queries. No target source was injected. The wider pool contained 229 pairs; the selected pool contained 66, including two exact identifier pairs. Every labelled positive and unresolved-model target survived selection. Negative targets absent from selection test retrieval, not the model's ability to reject them.

Private raw retrieval, model responses, provider usage and the rejected-schema run are retained under `outputs/matcher-fix-2026-11-06/`. They contain no merchant identity in the test requests; the test does not write merchant products, findings or decisions and does not send email. Build and all 227 backend tests passed after the schema correction.

The corrected live run passed 22/22 labelled pairs with zero unavailable final results. All 21 provider calls used the primary `gemini-3.1-flash-lite`; fallback-model accuracy was not tested. The three original beta false warnings were absent. Six of the eleven negative targets were absent from the selected shortlist, rather than rejected by the model. Other returned sources include additional reports of the fixture's own product/model; these were inspected separately and are not extra prelabelled test successes.

For the 17 inputs shared with the earlier 21-pair run, candidate pairs fell from 210 to 60 (71.4% fewer). Observed provider attempts fell from 55 to 19 and successful-request input tokens from 484,949 to 167,623 (65.4% fewer); the earlier run included one failed image attempt. The new 18th relisted input adds two calls, bringing the full run to 21 calls and 187,527 input tokens. These are measured test-run differences, not a production cost forecast. The failed schema experiment is retained separately and excluded from the corrected-run counts.

Any top-k budget can omit a true match below its cutoff. A larger independently labelled set should measure retrieval recall separately from AI precision before a production accuracy claim. These regression tests do not imply stored beta-finding cleanup.

## Production release — 9 November 2026

The owner authorized production deployment. All seven direct matcher consumers are ACTIVE with unchanged runtime configuration, secret bindings, triggers, dependency locks and model selection:

| Function | Verified revision |
| --- | --- |
| `checkProductSafetyAPI` | `checkproductsafetyapi-00072-vov` |
| `shopifyProductChangeTask` | `shopifyproductchangetask-00022-xuq` |
| `merchantMonitoringTask` | `merchantmonitoringtask-00025-dok` |
| `runMerchantDeltaMonitoringAPI` | `runmerchantdeltamonitoringapi-00041-gel` |
| `merchantCatalogAuditTask` | `merchantcatalogaudittask-00024-zos` |
| `scanPublicShopifyStoreAPI` | `scanpublicshopifystoreapi-00030-top` |
| `freeScanCatalogTask` | `freescancatalogtask-00019-faf` |

`scripts/scoped-matcher-budget-release.py` snapshots each function's own deployed source and overlays matcher/evidence/cache-policy files only. Existing per-consumer onboarding and pair-cache adoption flows are preserved with scoped declaration patches. All seven bundles compiled against their production lockfiles; applicable staged tests passed (31 manual-check, 31 catalog-audit, 20 public-scanner tests). The scanner intentionally lacks a merchant-monitoring module required by the broader merchant coverage test file; that incompatible test was not used as a scanner release gate.

Six stateless requests to the deployed endpoint passed: the three original beta negatives, exact photographed model, renamed/rebranded photographed product and exact GTIN. Non-GTIN requests considered at most six candidates; photo controls used photos and retained official risk context. No merchant identity was sent, so this smoke did not create merchant checks/findings or emails. It does not prove a complete background-task/email workflow. Private source snapshots, final source diffs, configuration verification and responses are in `outputs/matcher-production-2026-11-09/`.

No catalog replay, cache deletion, baseline reset or historical finding/decision change was performed. Existing vectors and current-policy pair/full results are reused. Earlier-policy results are reconsidered on a subsequent requested check; they are not automatically certified under the corrected policy. Staged tests verify that repeated unchanged checks reuse results without invoking the matcher.
