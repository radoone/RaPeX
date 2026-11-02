# Exact variant barcode matching

Implemented in local source; deployment and production migration are separate operations.

## Behavior

The checker validates GTIN-8, UPC-A, EAN-13 and GTIN-14 check digits and normalizes equivalent representations to 14 digits. Invalid, incomplete and all-zero codes are ignored. SKU, title and model values are never treated as barcodes. An exact code match is a reason to review the variant, model and affected batch; it does not establish that every variant or batch is recalled.

Shopify product inputs carry `barcodes: [{ barcode, variantId?, variantTitle? }]`. Manual checks reload the authoritative product on the server and traverse the variant connection. Catalog tasks import every variant using bounded pagination; the first nested variant page is deliberately small to keep the 100-product query within Shopify query-cost limits. Version changes, API errors, missing or repeated cursors fail the check/import rather than silently truncate it. REST webhook payloads are marked incomplete: ingress mirrors the private offline session and queues work, and the worker loads all variant barcodes. Tokens stay outside task payloads. A task whose live product version has changed is superseded.

Merchant products store normalized variant evidence, `gtins` and `barcodeVersion: 1`. Every upsert refreshes these fields even when embeddings are reused; removing barcodes clears the derived index. Deletion clears barcode and vector retrieval fields while preserving findings and decision history.

Manual checks and the public scanner union indexed exact Safety Gate results with the existing vector shortlist. Monitoring unions exact merchant-product hits with vector results within the current shop. Array queries use at most 30 codes and paginate all results. Exact candidates bypass distance thresholds; they do not expand Gemini work. A validated exact warning is produced deterministically. Other shortlisted candidates still receive the normal matcher analysis, and failures remain incomplete checks. Missing barcodes retain the existing similarity path. The public scanner still uses batch embeddings and KNN prefiltering, and can only compare barcodes actually present in the public catalog.

Warnings carry `matchBasis: "gtin"` and `identifierMatches`, including the original merchant code, matching source code, canonical GTIN and affected variant identity. Similarity warnings carry `matchBasis: "similarity"`; absent legacy metadata retains the old display. Exact warnings retain `overallSimilarity: 100` only for API compatibility and prioritization; this is not an AI measurement, safety probability or image score. They omit image/text scores and weights, survive merchant similarity thresholds, and show a translated exact-match label instead of a percentage. The modal includes variant evidence; audit CSV appends this evidence. Merchant email suppresses the compatibility percentage. Match-cache reliability version 4 includes barcode changes on both sides.

## Release and existing data

1. Build and deploy a reviewed backend and Shopify release together. Existing unrelated local changes must not be deployed accidentally. No additional Shopify write/customer/order scope is needed.
2. Run `node scripts/backfill-alert-gtins.mjs` from `firebase/functions/` for the existing source index; review its aggregate dry-run report, then use `--apply`. This updates only derived `gtins`, with update-time preconditions. It does not run the matcher or send email.
3. For each installed shop, run `node scripts/refresh-merchant-barcodes.mjs --shop=example.myshopify.com` and review the aggregate dry run before `--apply`. The script uses the existing private offline session and updates only the barcode fields of live, unchanged product snapshots. Version conflicts must be handled through a current product import/check. It does not create products, reset an initial scan, re-embed, change findings or send email.
4. Source backfill and merchant indexing do not retroactively replay historical Safety Gate alerts. A separately scheduled all-history audit is needed to evaluate newly indexed identifiers against past alerts. Do not describe a completed index refresh as a completed safety check.
5. Verify in a real entitled shop: a match on a variant beyond the first page; UPC/EAN equivalence; barcode removal; new-alert delta monitoring; a received alert email; localized modal and downloaded CSV. Local tests are not production evidence.

Single-field `gtins` array indexing must remain enabled on `rapex_alerts` and merchant `products`. Required index/query failures propagate; they must never become an all-clear result.

## Validation

Backend regression coverage includes checksum/equivalence, variant provenance, exact recall outside KNN, source pagination, tenant/deletion boundaries, coexistence with model candidates, failure propagation, HTTP ingestion and cache invalidation. Shopify coverage includes REST/GraphQL mapping, complete variant pagination, version changes, exact-evidence presentation and export. Complete-catalog tests validate the added copy for all 24 EU languages.
