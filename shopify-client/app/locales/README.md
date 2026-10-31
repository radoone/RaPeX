# Merchant interface translations

English copy is the source in `en.ts`, the English builder/workspace copy and the normalized resources in `index.ts`. `complete/*.json` supplies the entire interface for the other EU languages; Slovak is an overlay on its existing translation. The selected catalog loads before the interface changes language. Each language is a separate browser chunk; builds and email delivery never call a translation service.

`complete/manifest.json` records the English source hash, language coverage, plural additions and generation provenance. The complete-locale tests check every source key and interpolation token with fallback disabled, every locale's plural categories, and source freshness. Keep original Shopify data, Safety Gate facts, identifiers and decision notes unchanged.

For intentional copy maintenance, export a snapshot of `localizedResources` with the project's existing `tsx` runtime, then run `node scripts/complete-merchant-locales.mjs /absolute/path/to/source-copy.json` from `shopify-client` (optional third argument: comma-separated language codes). This explicit maintenance command uses the project's Vertex AI Gemini 2.5 Flash and ADC. It sends static public interface copy only, validates structured results, and reuses a source-keyed cache under `outputs/merchant-locales/translation-cache`. It never logs credentials. Run all merchant checks afterwards.

These catalogs have automated structural checks and selected rendered-language checks; a native-speaker review has not been performed for every language. Public website/email translations remain separately canonical in root `localization/catalogs/`.
