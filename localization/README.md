# ZeroRecall EU localization

The public home, about and privacy pages and all four application email types support the 24 official EU languages. The internal lead scanner is excluded from this change. Existing Shopify merchant UI locales are unchanged.

## Sources and maintenance

- `languages.json`: shared codes and native language names, aligned with the Shopify app's EU language selector.
- `catalogs/{code}.json`: canonical web and email copy. Edit these files rather than generated copies.
- `authorities.json`: representative national product-safety authority links, with source URLs and verification date. Language does not select legal jurisdiction; the page also links to the Commission's complete authority directory.
- `provenance.json`: generation/review metadata for the added languages. EN/SK were existing copy. The other 22 catalogs were translated using Gemini 2.5 Flash and checked for key completeness, placeholders, links and example terminology. A native-speaker review of every language has not been performed.

Run from the repository root:

```sh
npm run localization:build
npm run localization:check
```

The deterministic build writes `marketing-site/locales/{code}.json` and `firebase/functions/src/email-locales.ts`. It has no network access and makes no model calls. Regenerate after editing canonical catalogs. Translation files preserve `{{value0}}`, `{{checked}}` and other interpolation tokens exactly, along with HTML links and numerical limits.

## Behavior

The public language selector uses native names. Initial selection uses `?lang=`, saved preference and browser language, with English fallback. Only the selected language is loaded in addition to the bundled English fallback. Page title, description, navigation, form states and privacy copy update together. Internal page links keep `lang`; changing language preserves the verification-token hash. All public pages declare 24 language alternates.

The free-scan request stores the normalized supported language rather than reducing it to EN/SK. Its confirmation and report use that language. Merchant alert and weekly summary emails continue to use the shop's `notificationLanguage`. Regional codes normalize to the supported base language, and unsupported input falls back to English. HTML `lang`, dates, subjects, actions, preferences, risk labels and review states are localized. Product names, identifiers, imported Safety Gate details and persisted matcher explanations retain their original source text; these factual fields are not rewritten by a translation model during delivery.

Generate illustrative email previews after a Functions build:

```sh
cd firebase/functions
npm run build
node scripts/render-email-previews.mjs
```

This produces 168 previews (seven states × 24 languages), with language and template selectors at `outputs/email-templates/index.html`. Preview product data, images and tokens are fictional and must never substitute for actual delivery data. Preview generation never sends email.

## Verification, 19 October 2026

- Two catalog tests check all keys, interpolations, privacy links, generated copies and public-page language alternates.
- All 28 Functions tests pass, including rendering all four email types in every language, safe escaping and confirmation-token preservation. Functions TypeScript and ESLint pass.
- The public Vite production build passes. Lazy loading keeps the 24 catalogs out of a single initial JavaScript chunk.
- Browser checks cover 72 public page/language combinations at 390px and 24 home-page languages at 1280px. No remaining horizontal overflow, language mismatch or navigation overlap. The Dutch hero initially overflowed on a long compound word; constrained grid children and wrapping fix it.
- All 168 email states were browser-rendered at 390px with no horizontal overflow, failed images or console errors. This is not native Gmail/Outlook coverage in all languages.

## Regulatory references

The localized regulatory context references [GPSR 2023/988](https://eur-lex.europa.eu/eli/reg/2023/988/oj), its Article 37 recall remedies, and the [Commission's national authority directory](https://single-market-economy.ec.europa.eu/single-market/goods/building-blocks/market-surveillance/organisation_en). Authority mappings were checked against the Commission's October 2026 country directory and the official BAuA, NKFH and ASAE portals where needed. National sanctions vary by jurisdiction and product; the translation does not invent universal fines or refund deadlines. The Commission's [market surveillance overview](https://single-market-economy.ec.europa.eu/single-market/goods/building-blocks/market-surveillance_en) provides the national penalty-notification reference; it is not a single GPSR penalty schedule.

Hosting and all four email functions were deployed on 19 October 2026. The production home page was checked in all 24 languages, and French home/about/privacy navigation preserved the selected language. Email deployment overlaid only the five email/free-scan modules onto each function’s existing production source archive; existing package locks, unrelated backend code, runtime environment, secret bindings and event triggers were retained. The production-source overlay also passed its 20 tests with the deployed dependency lock. See `outputs/localization-release-2026-10-19/` for sanitized evidence. This does not prove a live merchant trigger, scheduler or complete free-scan delivery. The free-scan form remains unavailable until a production Turnstile site key is supplied to its build.
