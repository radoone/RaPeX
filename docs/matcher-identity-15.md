# Identity matching regression — 15 pairs

The owner requested stricter matching and fifteen reviewable test pairs on 2 November 2026. The fixed dataset is [matcher-identity-15.json](../firebase/functions/test/fixtures/matcher-identity-15.json). It contains public official Safety Gate fields/photos and authored product inputs, without merchant IDs or access credentials. Labels were fixed by assistant review of the official records before predictions; this is a tuning/regression set, not independently held-out accuracy evidence. The missing-identifier product is explicitly an authored transformation of an actual photographed product.

| Pair | Product and candidate | Expected result |
| --- | --- | --- |
| 01 | Akyga AK-ND-07, equivalent EAN-13/GTIN-14 on two variants | Identifier match; retain both variants |
| 02 | MXM P10-X08 versus its 2021 report | Same model |
| 03 | MXM P10-X08 versus its 2013 report | Same model |
| 04 | Extralink JKD-512COM, validated EAN on two variants | Identifier match; retain both variants |
| 05 | ZK ZK-9110 and its official report, no supplied barcode | Same model |
| 06 | BIBS photographed strap with brand/model omitted from listing | Distinctive visual identity |
| 07 | Akyga AK-ND-07 versus AK-ND-44 | No match |
| 08 | Fixed-connector AK-ND-07 versus universal AK-NU-05 | No match |
| 09 | SPRINGOS CL4133, 138 LEDs versus CL4104, 300 LEDs | No match |
| 10 | BIBS textile strap versus silicone chains | No match |
| 11 | Self Destruction AY7115222 versus H2 Hitting AY7061222 | No match |
| 12 | Extralink JKD-512COM versus Xblitz DT3-1 | No match |
| 13 | MXM P10-X08 versus Yomin ST8333K54 | No match |
| 14 | ZK ZK-9110 versus CP, different length/components | No match |
| 15 | LexusLance LK-003 versus LK-003-A004, unresolved batch | Uncertain warning |

The production order remains validated GTIN lookup first, then text/image vector shortlisting, then targeted AI assessment of non-GTIN candidates. Exact GTIN findings precede similarity findings and keep variant evidence even when descriptions/models conflict; they still require review of recall batch applicability. The preparation harness can avoid embeddings for a group already identified by GTIN. Production retains its other shortlisted candidates so an exact hit does not discard additional relevant reports.

The prompt requires identity evidence before considering the reported hazard. Generic category, shared risks and speculative OEM relationships are insufficient. Explicit incompatible models are rejected by the server even if a model returns a high visual score. Model punctuation/case/spacing is normalized; model lists are supported. A model prefix remains uncertain. Missing identifiers are not invented from a title/category. Visual scoring/identity requires an actual compared photograph of the specific candidate, not just images of other candidates.

`identityAssessment` distinguishes `identifier`, `same_model`, `distinctive_visual` and `uncertain`. Uncertain warnings include an explicit request to verify model/submodel/batch in the reason shown by the existing review UI. If the model omits a candidate with an explicitly shared brand and related model prefix, server rules retain an uncertain `model_family` warning. Its score of 70 is a review priority, with no invented image/text measurements. Missing/different brands do not create this fallback. Uncertain warnings survive merchant similarity thresholds in manual, background and scanner flows. These are evidence classes, not probabilities or physical-inventory certifications. Reliability cache version 6 prevents reuse of previous broad judgments; saved merchant evidence and decisions are not rewritten or automatically resolved.

From `firebase/functions`, after `npm run build`, run:

```sh
node scripts/verify-identity-pairs.mjs prepare test/fixtures/matcher-identity-15.json /tmp/identity-retrieval.json
node scripts/verify-identity-pairs.mjs predict /tmp/identity-retrieval.json /tmp/identity-predictions.json
node scripts/verify-identity-pairs.mjs api /tmp/identity-retrieval.json /tmp/identity-live.json
```

`prepare` performs identifier lookups, one batch of unique text embeddings and bounded image embedding/KNN against the actual database before any model work. `predict` judges the resulting shortlist, never an injected labelled source. `api` calls the actual authenticated deployed checker with each unique product input; the endpoint independently performs its normal GTIN/vector retrieval. It requires `SAFETY_GATE_API_KEY` from a private runtime environment, never a command-line literal. This is a small fixed API regression exercise, not a bulk catalog scanner. Two model calls/product groups run at most concurrently; provider failures are unavailable results, never negative predictions. Evidence outputs must be new files and retain retrieval misses separately from AI decisions.

Release `scripts/scoped-identity-release.py` snapshots each of seven deployed matcher consumers, overlays only reviewed identity modules/prompt, builds against each preserved production lockfile and checks configuration after deployment. It does not deploy the Shopify host, email functions, billing, extensions or marketing site.

Consumer sources differ by deployed function. The release patches only the three threshold predicates in each function's own monitoring/scanner source, preserving its other lifecycle/scanner logic; patch input/output hashes are recorded. The hosted app has a separate small release to retain uncertain warnings above its similarity threshold.

Initial runs passed 13/15 and then 14/15. They exposed omitted source descriptions/dimensions, classification of identifiers read only from photographs, and omission of a related respirator submodel. Labels and product inputs stayed fixed. The final pre-deployment run passed 15/15 with no unavailable predictions: two identifier pairs, four AI-positive pairs, eight negatives and one uncertain pair. Thirteen target pairs reached the real prepared shortlist; two negatives were filtered by retrieval, so those two are not evidence of AI rejection. Preparation used one batch of nine unique text embeddings and bounded image embedding/search. All 140 backend tests and 102 hosted-app tests passed, together with app/Functions builds and affected-source lint. Live release verification is recorded separately after deployment.
