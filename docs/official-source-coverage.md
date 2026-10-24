# Official Safety Gate coverage reconciliation, 23–24 October 2026

The owner requested a full official-source backfill from **2005** onward, including vectors, and authorized deletion of duplicate source documents. This maintenance does not invoke merchant matching or send emails.

## Authoritative inventory

The Commission's [weekly XML list](https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en) supplies 1,121 reports, 2005 through 2026 week 42. All XML files were downloaded and SHA-256 checksummed. They contain 47,397 distinct official numeric notification IDs.

The independent public report API was enumerated completely: **5,764 pages, 47,405 distinct notification IDs**. The JSON inventory includes every XML ID and eight additional records omitted by seven XML exports. Their actual official JSON details supplement the manifest; no record is invented from annual statistics. Six of these eight were missing from Firestore; two already existed.

The union has **47,405 records**. Use the official numeric ID in the Commission detail URL as identity: two historical case numbers each refer to two distinct official notifications. Never deduplicate solely by case number. Annual statistical totals are not a substitute for enumerating currently published source identities.

Before maintenance, `rapex_alerts` contained 33,482 documents but 5,234 were duplicates of the same official reference. The XML comparison found 19,246 missing sources, plus six missing JSON-only sources. The complete import therefore adds **19,252** source documents. Ninety-five distinct pre-existing historical references outside the current public report inventory are retained; they are not counted as proof of current public coverage.

## Text verification

Every one of the 47,405 canonical official records was read back from Firestore. All text fields are native `VectorValue` values with exactly 1,536 finite coordinates and a nonzero vector. Missing or invalid vectors: **zero**.

Independent Firestore cosine nearest-neighbour controls using actual source vectors retrieved their own canonical record for 2005, 2009, 2014, 2020 and 2026. This verifies indexing/retrievability of representative history, not model matching accuracy.

## Deduplication and images

Duplicate source documents are backed up as gzip-compressed Firestore typed-field payloads before deletion, with update-time deletion preconditions. Sources referenced by the immutable change journal retain their IDs. Technical source references in mutable test findings/checks are repointed without changing their evidence or finding IDs; immutable decision events are never rewritten. Existing image vectors move to the retained source before the old source is removed. Separate backup subdirectories preserve resumability.

The official union lists **103,022 image URLs**. Image backfill uses the existing pinned `multimodalembedding@001` model with 1,408 coordinates; it never substitutes a text vector for an unavailable photo. Regional pacing follows the project's inspected quota (European regions 120 requests/minute, American regions 600). A same-image probe across the initial eleven regions produced compatible vectors, with cosine similarity above 0.999999999.

Final native readback verified **103,016 image vectors**, each with 1,408 finite, nonzero coordinates and the correct parent/source-image identity. The other **six official photos cannot be retrieved**: the Commission returns HTTP 500 for both the original photo and its official thumbnail, independently rechecked on 24 October. Their source records/text vectors remain present. Full coverage of the 103,022 listed photo URLs is therefore impossible from the available source bytes; coverage of retrievable photos is complete.

Nine vectors use the Commission's actual thumbnail of the same photo: eight originals exceeded the 5 MB transport cap, and one original returned HTTP 500 while its thumbnail remained accessible. `embeddingSourceUrl` records this provenance. No placeholder or generated image was substituted. Image KNN controls for 2005, 2015, 2020 and 2026 each retrieved their own source image.

All **5,234 duplicate source documents were deleted**; all 5,234 original typed documents were independently verified in 53 gzip backup files. Source reference groups now contain no duplicates. All 19,255 change-journal entries refer to existing sources, and no image refers to a removed duplicate. Three mutable test/result documents were repointed across the maintenance passes; a subsequent read-only audit found zero stale or missing references, including public report receipts. No immutable decision event was modified.

On 24 October the live official report list still contained the same 1,121 report URLs and identical parsed metadata, with week 42/2026 latest. This report proves coverage of that published inventory, not unpublished records or future additions. The database retains 47,500 source documents overall: the 47,405 independently enumerated current official records plus the 95 distinct historical references described above.

## Evidence and repeatable tools

Private local evidence lives in `outputs/official-coverage-2026-10-23/`, which is gitignored. It includes the XML snapshot/checksums, independent API page inventory, exact missing-ID lists, text-vector validation, KNN controls, batch progress, image failures and gzip deletion backups. Credentials are never written to these artifacts.

Run from `firebase/functions/`, with authorized Google Cloud credentials and the existing compiled functions modules available:

```sh
python3 scripts/collect-official-history.py /absolute/evidence-directory --api-identities
python3 scripts/supplement-official-history.py /absolute/evidence-directory
node scripts/reconcile-official-history.mjs text /absolute/evidence-directory
node scripts/verify-official-text-vectors.mjs /absolute/evidence-directory
node scripts/reconcile-official-history.mjs images /absolute/evidence-directory
node scripts/verify-official-image-vectors.mjs /absolute/evidence-directory
node scripts/reconcile-official-history.mjs verify /absolute/evidence-directory
```

Collection caches an immutable official snapshot; use a new directory for a new audit. Text embeddings are processed in batches of 50 and cached locally before atomic source/journal writes. Source writes reread documents transactionally, so ambiguous accepted writes can safely resume. The import does not advance the daily loader's checkpoint.

The image audit reads actual native fields rather than treating a vector inequality as sufficient evidence. After a retry, `verify-official-image-vectors.mjs --resume` reads back only the previously missing documents. An isolated APFS copy of the runtime under the private evidence folder avoided concurrent dependency installations changing a running maintenance process.

`deduplicate-official-sources.mjs` is a separate, owner-authorized destructive maintenance operation, tied to the saved pre-maintenance inventory and protected-source lists. It must not be run as a generic scanner or against a new inventory without a corresponding review and backup plan.
