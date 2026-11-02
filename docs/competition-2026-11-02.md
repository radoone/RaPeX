# ZeroRecall competitive review — 2 November 2026

This comparison uses the official public listings read on 2 November 2026. Listed capabilities are vendor claims, not measured competitor accuracy or operational verification. ZeroRecall implementation observations are grounded in the current repository and the owner's live test-store exercise. The fifteen identity regression pairs are a separate functional check, not evidence that ZeroRecall is more accurate than a competitor.

| Area | Public competitor evidence | ZeroRecall position / opportunity |
| --- | --- | --- |
| Recall identity and explanations | Recall Watch calls only barcode or brand/model matches recalls, labels weaker matches for checking, and names the matched field/value | GTIN-first variant evidence already exists; stricter identity rules are being released. Add one compact evidence view of matching AND conflicting fields and keep uncertain identity clearly separate from a confirmed identifier |
| Catalog matchability | Recall Watch advertises a readiness score with reasons a product cannot be matched; Alnage identifies missing safety fields | Our catalog coverage counts imported/checked/current products. Add per-product ability-to-match diagnostics: missing/invalid EAN, absent brand/model, poor/no photos. Checked coverage alone does not establish that a product is identifiable |
| Public GPSR product data | Alnage and Conformica publish manufacturer/Responsible Person/importer details and translated warnings on storefront product pages | ZeroRecall is focused on recall detection/review. It lacks this public product-safety data publishing workflow; consider a separate scoped feature after detection quality and launch readiness |
| Evidence documents and incidents | Alnage advertises a document vault, ten-year retention tracking and incident logs | Existing findings/decision events/CSV exports are useful; add supplier documents, batch/lot evidence, retention policy and structured incident/notification records. A new vault needs its own storage/access/retention design, not a claim that current exports provide it |
| Marketplace integrations | Alnage advertises compliance files for ten EU marketplaces | Our integration is Shopify-focused. Marketplace exports are a later expansion, not part of the current release |
| Regional recall sources | Recall Watch offers CPSC and paid FDA/Safety Gate coverage | ZeroRecall uses EU Safety Gate. US feeds would broaden reach, with separate schemas/coverage/matching validation; lower priority while the positioning remains EU non-food safety |
| Automation | Recall Watch lists Shopify Flow and one-click hide with a record | ZeroRecall has durable automatic checks, email alerts and merchant review. Flow integration and dedicated response/notification steps would help. Product-status mutation is intentionally excluded under current `read_products`; do not silently expand scopes |
| Differentiation | The reviewed listings do not describe our exact image-vector/Gemini workflow | Image-based matching without a supplied barcode, multi-photo comparison and source evidence are credible product strengths. The absence of a feature in a listing does not prove a competitor cannot do it |
| Price and market proof | All three reviewed Shopify apps display zero reviews; Recall Watch and Alnage advertise free plans; Conformica's App Store listing currently says Free | ZeroRecall's public marketing price is EUR 9.90/store/month. Low price and EU-language support alone are insufficient differentiation. Do not infer adoption, reliability or competitor quality from a listing or promise price leadership |

Recommended order:

1. Finish/validate identity matching and EAN-first behavior; then independently label a held-out sample, including retrieval misses, hard negatives and normal store products. Measure false positives and false negatives separately.
2. Add actionable catalog matchability diagnostics and explicit match/conflict/unknown evidence. These improve monitoring quality before a merchant ever gets an alert.
3. Add batch/supplier/document evidence and structured follow-through within the existing review workflow.
4. Evaluate a storefront GPSR information block and supplier-document vault as a defined product expansion.
5. Add other agencies/marketplaces/Flow according to actual merchant demand.

Existing strengths include durable catalog/monitoring jobs, current product-version handling, validated per-variant GTIN matches, visual/text recall, all-history Safety Gate retrieval, multi-photo comparison, immutable decisions and CSV audit evidence. Language selection and recurring monitoring are strengths but are also advertised by competitors; they are not established unique advantages. Actual relative precision, recall, speed and support quality remain unmeasured.

Sources:

- Recall Watch: <https://apps.shopify.com/recall-watch-product-safety> — exact/weak match separation, evidence fields, matchability, CPSC/FDA/Safety Gate, Shopify Flow, response trail and public plans.
- Alnage: <https://apps.shopify.com/gpsr-compliance-hub> — storefront GPSR data, marketplace exports, recall alerts, document vault and missing-field scanner.
- Conformica: <https://apps.shopify.com/conformica-gpsr> — product-page safety information in 24 EU languages, nightly Safety Gate monitoring, Responsible Person/importer fields and hazard pictograms.
- Reach Insight: <https://reachinsight.app/safety-gate-alerts> — both Shopify and WooCommerce editions explicitly labelled Planned; do not count them as currently shipped integrations.
