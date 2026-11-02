# Evaluating matcher quality

The evaluator reports observed precision, recall and false-positive rate for independently labelled product–Safety Gate pairs. It does not run retrieval or the matcher and must not be treated as a quality measurement until real labels and predictions are supplied.

Create a JSON array with a stable, non-sensitive pair `id`, a human-reviewed boolean `label`, and boolean predictions by mode. Use `null` for failures or unavailable predictions; never turn errors into negative predictions. For example, the shape is `[{"id":"pair-id","label":true,"predictions":{"text":true,"image":null,"combined":true}}]`. This is a schema illustration, not a measured example.

Run `node firebase/functions/scripts/evaluate-labelled-matches.mjs pairs.json report.json`. The report is aggregate only and will not overwrite an existing file. Pair data and reports should be stored outside the repository when they contain merchant information.

Select and independently label positives and hard negatives before running predictions. Include missing identifiers, similar-looking but different models, different brands, multiple variants and poor images. Record how pairs were sampled, label provenance, dataset version, model and retrieval configuration, and date. Include cases missed by retrieval, not only candidates that the current system already found, or recall will be biased upward. Separate a tuning set from a held-out evaluation set. Compare modes on the same eligible pairs and report unavailable counts; differences in coverage make aggregate scores non-comparable. Human review is required for ambiguous cases.

The report includes both per-mode coverage and a `commonCohort` containing only pairs with a boolean prediction in every mode. Use that cohort for direct mode comparisons. Zero denominators produce `null`, never fabricated perfect scores. Empty shared coverage is reported as zero pairs. Mode names use lowercase letters, digits, underscores or hyphens and begin with a letter. Surrounding whitespace does not make duplicate pair IDs distinct.
