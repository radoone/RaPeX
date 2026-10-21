# ZeroRecall email templates · 19 October 2026

final result: passed

## EU language follow-up

Public home/about/privacy and all four email templates now use 24 complete language catalogs. Localization checks passed for 260 web strings and 88 email strings per language, interpolation tokens, privacy links and language alternates. All 28 Functions tests and the two catalog checks passed; Functions build/lint and the public Vite build passed. The public application entry is about 84 kB before compression, with the selected locale loaded separately.

Browser verification covered 72 public page/language combinations at 390px and all 24 home-page languages at 1280px. A Dutch compound word initially forced the hero grid wider than the phone viewport; constraining grid children and allowing long translated titles to wrap resolved it. Final checks found no horizontal overflow, selected-language mismatch or header navigation overlap. A French Home → About → Privacy journey preserved the selected language; switching Privacy to Slovak updated its copy and its Home link.

All 168 email preview states (seven per language) were opened at 390px: no horizontal overflow, failed images or console errors. UI controls also switched the preview to the Greek weekly findings email. Evidence is under `outputs/localization-2026-10-19/`, including `email-browser-checks.json`, `web-sk.png` and `weekly-el.png`. The chosen ivory/forest-green layout and real raster example photo remain intact. The browser was returned to its default viewport and the public web and email preview selectors remain open.

Translations preserve original product names and stored Safety Gate/matcher data. New language catalogs are machine translations with sample editorial review; a native-language review of all text and native Gmail/Outlook testing in every language remain outstanding. Hosting and the four email functions were subsequently deployed on 19 October; see the release note below.

Localization final result: passed

## Comparison target and evidence

- Selected visual truth: `/Users/radoone/.codex/generated_images/01a1534c-501c-7411-bff0-0468dafa5374/exec-724b723a-ef97-4abc-a0d2-fd76ccc8d516.png` (first displayed concept, selected by the user).
- Source pixels: 1042 × 1509; normalized proportionally to 760 × 1101. No stretching.
- Implementation: `outputs/email-templates/alert-desktop.png`, 760 × 1346 CSS/pixel width at density 1. The screenshot captures the full email; browser viewport was 760 × 1100.
- Combined full-view evidence: `outputs/email-templates/design-comparison.png`, source and implementation aligned at the top with equal 760px widths.
- State: Slovak alert with fictional product and matching score. The implementation labels the entire preview and photograph as illustrative. Production rendering receives actual data and omits the example label.
- Mobile evidence: `outputs/email-templates/{alert,weekly,verification,report}-sk-mobile.png`, 390px CSS width, viewport 390 × 844, density 1. All fourteen preview routes were opened at this width: both languages, complete/findings/incomplete weekly states and matched/clear scan states. Each measured 390px document width, and both preview images loaded.

## Findings and comparison history

Initial full-view comparison found two P2 differences: the headline had weaker hierarchy than the selected reference, and high-risk text lacked its amber emphasis. Increased desktop heading from 40px to 44px and added semantic amber text for High/Serious risk. Regenerated examples, captured desktop and mobile again and reopened the combined comparison. Both issues are resolved.

Post-fix comparison has no actionable P0/P1/P2 findings. The reference's main hierarchy is retained: identity, warm status pill, large heading, photograph/facts, explanation, primary action, next step and caution. The reference includes decorative icons and a brand dot; the implementation intentionally omits these so essential email information does not depend on extra remote decorative assets. These are omissions, not CSS or SVG approximations. The generated sample bicycle is a real raster asset derived from the selected reference and used only in previews. Production uses a real Safety Gate image when available.

## Required fidelity surfaces

- Typography: Arial/Helvetica system fallbacks, 44px desktop/32px mobile headline, 15–16px body, 12px utility/footer copy. The concept's editorial hierarchy is retained with email-client-safe fonts. No text is rasterized.
- Spacing/layout: 600px email content column, no nested visual cards, lightweight fact row separators and padded explanation/action areas. At 390px the image/facts stack; content and fallback URLs wrap without horizontal overflow. Full implementation is taller than the concept because it adds source attribution, recipient context, more explicit instructions, and a fallback URL. This is an intentional content requirement, not a clipped layout.
- Colors: ivory `#faf9f5`, forest `#315e4b`, dark text `#1c2822`, pale sage explanations and amber caution. High/Serious risk is emphasized in amber as in the concept. The CTA is flat color for broad email support.
- Image fidelity: complete green/wood bicycle on cream matches the sample's art direction without copying an entire UI image. Photo is clearly illustrative in previews and labelled as a Safety Gate source image in real messages. Production does not contain or reference the example raster asset.
- Copy/content: both SK/EN include identity, dynamic facts, a next action, support contact and text alternative. Incomplete monitoring takes precedence over a zero-finding status. No email certifies product safety. Confirmation copy preserves the existing website confirmation step and 30-minute single-use token. Product links are restricted to the requested shop.

Focused regions were inspected in the combined image (headline, fact table, reason, CTA and footer) and full-size mobile screenshots; a separate magnified crop was unnecessary because labels and text were legible at the equal-width comparison.

## Browser verification and functional checks

Preview index navigation changed the preview iframe to the selected email. Action links and email-preference links were checked in the rendered DOM against their intended routes; fictional Shopify records and the fake confirmation token were not submitted. No preview sends email or queries the database. Browser console logs contained no errors or warnings. Viewport override was reset, and the preview index is left open as a deliverable.

TypeScript build, Functions ESLint and 25 tests passed, including HTML escaping, unsafe image/action URLs, preserving confirmation links, same-shop report links, canonical Safety Gate fields and incomplete-monitoring semantics.

## Implementation checklist and limits

- [x] Four renderers integrated with existing Brevo send paths.
- [x] HTML, text alternatives and bilingual states rendered.
- [x] Desktop reference comparison and mobile checks complete.
- [x] Source documentation and reproducible previews added.
- [x] Deploy only the intended email/free-scan modules; all four production email functions are ACTIVE.
- [ ] Verify actual Gmail/Outlook rendering and live trigger delivery after deployment.

Follow-up polish: native email-client dark-mode behavior and older Outlook rendering have not been tested. Browser verification does not prove these clients match pixel for pixel. This does not block the local template handoff.

## Weekly findings follow-up

The user requested images in weekly emails when findings exist. Added a bounded list in the same established visual system, with product/record names, optional source-labelled Safety Gate thumbnail, risk, similarity, reason, current review state and a link for each finding. Production selects up to five unique entries from tenant-scoped new/active queries, prioritising new findings. No-image entries keep their text and action. SK/EN copy and plain-text detail links are covered by tests. Resolved entries are explicitly marked reviewed rather than actionable.

Evidence: `outputs/email-templates/weekly-findings-desktop.png` at 760px and `outputs/email-templates/weekly-findings-mobile.png` at 390px, both browser-rendered full-page screenshots at density 1. Mobile measured document width 390px with the image loaded and both individual detail links present. Preview navigation worked and browser warnings/errors were empty. Inspected both captures directly: same ivory/green typography and table-based email construction; mobile image and text stack without clipping. The initial follow-up capture showed untranslated High/Serious risk labels in the Slovak example; localized these labels and regenerated the previews before final capture. Missing-photo and resolved states are shown alongside the illustrated finding. No remaining actionable P0/P1/P2 issues. Functions build/lint and all 27 backend tests pass. Production deployment and native email-client verification remain outstanding.

final result: passed

## Production release, 19 October 2026

Hosting deploy succeeded for Firebase site `rapex-99a2c`. The custom-domain home page loaded all 24 languages with correct title/heading/lang and no horizontal overflow; French Home → About → Privacy preserved language. The screenshot and check ledger are in `outputs/localization-release-2026-10-19/`. Four function source updates completed ACTIVE with unchanged environment, secrets and triggers. Each release retained its production source/package lock and changed only the five email modules (excluding deployment-local environment files from the upload). A second configuration-only update supplies the hosted app’s verified handle to merchant emails. Production-overlay tests passed 20/20, repository tests 28/28, localization checks 2/2, build/lint passed. This verifies deployment and web rendering; no new recipient email was sent and live merchant/scheduler/free-scan flows were not exercised.

## Full public catalog follow-up

Scope text in all 24 web/email catalogs now covers the entire available public catalog. The backend processes 50-product pages through durable Cloud Tasks and transactionally persists its cursor and per-product receipts. A 10,051-product fixture completed across 202 nonempty pages plus an empty terminal page. Regression tests cover committed-page replay, failed enqueue recovery, overlapping product IDs, fetch/model failures, repeated pagination, empty catalogs, invalid cursors and report retries. All 35 repository Functions tests, 27 production-overlay tests and two locale checks pass. Functions lint and marketing production build pass. No real shop’s complete catalog or recipient email has been exercised in this change. Turnstile remains the existing public-form activation prerequisite.

Production evidence: the new worker and both updated free-scan functions are ACTIVE; intake retry is enabled and the Cloud Tasks queue is RUNNING. An authenticated task for a nonexistent request completed with HTTP 204, without scanning products or sending mail. A malformed smoke-test task was rejected and removed. TTL for request/product receipts is ACTIVE. The live page was checked in all 24 languages without horizontal overflow. See `outputs/full-catalog-release-2026-10-19/`. The public form still shows its existing unavailable state pending a real Turnstile key.

## Turnstile activation / owner notice, 21 October 2026

The existing Cloudflare Managed widget was updated to allow the canonical domain. Its secret matches production version 1; the secret was neither rotated nor copied into frontend configuration. Tracked `.env.production` keeps the public site key present in ordinary marketing builds. Hosting deployment and the separate `notifyFreeScanOwner` function deployment completed. The function is ACTIVE with retry enabled and `FREE_SCAN_OWNER_EMAIL=radoone@gmail.com`. The form renders on the live site; submit is gated on the verification callback. Existing 35 Functions regression tests plus three new owner-mail tests pass, as do Functions lint and the marketing build.

The automated Chrome challenge returned Cloudflare 300030 (generic challenge failure / bot detection). A manual browser submission was requested; public form acceptance and the confirmation/scan/report journey must not be claimed verified before that happens. A separate one-day-TTL, notification-only production test record uses a non-queue status and has no confirmation token, so it can exercise only the internal owner notice. Delivery evidence is recorded separately.

Owner-notice production test: the synthetic notification-only request reached `ownerNotification.status=accepted` with a provider message ID. Brevo then reported `delivered` on 21 October 2026. This proves the separate creation-trigger → Brevo → owner mailbox delivery path; it does not prove a human Turnstile submission or a full catalog scan. Evidence: `outputs/turnstile-owner-release-2026-10-21/owner-notice-test.json`.
