# Free scan protection

The public home, about and privacy pages support all 24 official EU languages. Canonical translations live in `localization/catalogs/`; run `npm run localization:build` and `npm run localization:check` from the repository root after edits. The selector preserves language across pages and in free-scan requests. See `localization/README.md` for email localization, sources and verification. The internal scanner is not translated by this change.

The production Turnstile site key is retained in `marketing-site/.env.production` so ordinary marketing builds keep the widget enabled. This is a public key, safe for browser code. The matching private key stays in Google Secret Manager. The existing Managed widget now permits `zerorecall.online` as well as its prior hostnames. The form still fails closed if configuration or verification is unavailable.

1. Create a Turnstile **managed** widget for the marketing site's production hostname in Cloudflare. Restrict its allowed hostnames to the real site. The widget action is `free_scan`.
2. Provide its public site key as `VITE_TURNSTILE_SITE_KEY` when running `npm run marketing:build`. Never use Cloudflare's dummy test site key for a production build.
3. Set the private key as the Firebase Functions secret `TURNSTILE_SECRET_KEY` (`firebase functions:secrets:set TURNSTILE_SECRET_KEY`). Do not put it in this repository or in Vite variables.
4. Set `MARKETING_SITE_URL` for the confirmation email link if the public site moves away from `https://zerorecall.online`. The value must use HTTPS and the same hostname configured in Turnstile. Keep the existing Brevo sender configuration available to `freeScanRequestAPI`.
5. For initial setup, deploy the free-scan backend before enabling the form. For website-only releases, deploy Firebase Hosting only and preserve the `/api/free-scan` function rewrite. Verify real email confirmation, store preflight, asynchronous scanning and result email before announcing the complete flow as operational.

Local Vite development uses Cloudflare's official dummy site key. The Firebase emulator may use the matching dummy secret; deployed Functions reject that secret. A Vite-only preview has no `/api/free-scan` backend, so it cannot complete a scan.

Requests are limited to one per store and email per 24 hours, one per IP per hour, 50 requests per UTC day, and 20 confirmed scans per UTC day. These budgets are intentionally conservative for the free public service. A request must be confirmed within 30 minutes; an unconfirmed request never runs the costly scanner.

Confirmed requests scan the entire available public catalog, 50 products per durable Cloud Task, until an empty page is returned. There is no total product ceiling. The report is submitted only after all pages complete; failures retry and cannot be reported as an all-clear. Existing request/day limits stay in force. Copy in all 24 languages describes the full public catalog. Private, unpublished and inaccessible products are excluded.

Owner notifications: `notifyFreeScanOwner` sends an internal Slovak request notice to `FREE_SCAN_OWNER_EMAIL` (production: `radoone@gmail.com`) on creation of a valid free-scan request, before customer email confirmation. It includes the shop, applicant email and request time, and never includes a confirmation token/hash. Its independent retrying trigger does not block the visitor’s confirmation email or scan.


## Marketing entry points (22 October 2026)

- Home explains possible product matches and offers both a free one-off check and Shopify installation. Keep the existing App Store URL while the listing is prepared; its public availability is separate from website readiness.
- `/?lang=sk` is the general introduction; `/?lang=sk#free-scan` opens the single request form; `/?lang=sk#pricing` explains ongoing monitoring with installation as its main action. Use the recipient's supported language in outreach links. No outreach messages are sent by this website change.
- `#example` is the hero's clearly labelled illustrative product comparison. It must never be presented as a finding for the visitor's own store.
- Public contact on home/about/privacy is `info@zerorecall.online`. Website copy and contact updates live in canonical web catalogs; email catalog content is unchanged.
- Domain guidance points visitors to Settings → Domains in Shopify Admin, following the [Shopify domain documentation](https://help.shopify.com/en/manual/domains). The server still accepts only public `*.myshopify.com` catalogs.
- The widget uses Cloudflare's documented [compact size](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/) to fit 320px screens. This changes its presentation, not verification or production keys. Request errors are scrolled into view after submission; widget initialization errors do not scroll the initial page.

For conversion measurement, compare weekly counts of confirmed free-scan requests and completed scans in the existing `free_scan_requests` data with Shopify Partner installation counts. The website change adds no visitor analytics service or unimplemented attribution claims. A completed request/report acceptance does not prove inbox delivery; use actual receipt for the complete flow check.

Local implementation QA and screenshots: `outputs/marketing-conversion-2026-10-22/`. The complete production form → received confirmation → confirmed request → full catalog scan → received report path was verified with an owner-authorized public catalog on 22 October 2026. Test-store details and inbox screenshots remain local. A Vite preview has no production `/api/free-scan` rewrite and cannot complete that test.

Website-only releases use a clean copy of the public Vite build, excluding `leads.html` and old Hosting assets. Preserve the existing production function rewrite; do not redeploy Functions or Shopify for a marketing release. Source changes are pushed separately from release evidence. The 22 October release is prepared under `outputs/marketing-release-2026-10-22/`.

## AI matching walkthrough (2 November 2026)

The homepage explains identifier-first matching and AI comparison of product details/photos when identifiers are incomplete. The three-step walkthrough at `#match-example` is illustrative, not a live result or a real recalled product. It uses the existing project illustration and a code-rendered review record, with no merchant screenshots or private data. Tabs support click, next-step buttons, ArrowLeft/ArrowRight and Home/End. A possible match remains subject to merchant verification of the model and batch.

All 24 canonical web catalogs include the new copy; email catalogs are unchanged. EN/SK were authored directly and the other 22 additions were translated with Gemini 2.5 Flash; provenance records the review limits. Localization checks and the production build pass. Playwright/CDP browser QA (Browser plugin not available) covered every locale and all three steps at 390px, plus 768px/1440px, next-step navigation, keyboard controls, language switching and both in-page CTAs. The external Turnstile frame emits CSP/debug messages locally; no first-party page exceptions occurred. This website QA does not repeat the email-confirmation/scan/report backend lifecycle.

Release files use a clean copy of `marketing-site/dist`, exclude `leads.html` and preserve `/api/free-scan` and the production Turnstile key. Deploy Firebase Hosting only. Local release hashes live in `outputs/marketing-ai-release-2026-11-02/manifest.json`; browser evidence is kept outside committed source.

## Real Shopify screenshots and merchant functions (2 November 2026)

`#inside-shopify` shows two current screenshots from the owner's test store: the review modal for the MXM China lighter fixture linked to official alert A12/1086/18, and catalog coverage/product search. Captures are cropped to app content and losslessly encoded as WebP; product names, counts, results and UI states are unchanged. No review decisions or safety checks were submitted for capture. Store identity, Shopify account chrome and the owner-only testing entitlement banner are outside the crops. Captions explicitly identify test data and the English interface. Image and caption links open the full-resolution capture in a new tab; a homepage link makes the gallery discoverable.

`#features` describes nine implemented merchant capabilities: first catalog/history audit, background monitoring, identifier/text/photo matching, individual/product-page checks, review outcomes/supplier waiting, bulk decisions, email preferences and summaries, audit history/CSV export, and 24 EU interface languages. It distinguishes the installed subscription from the one-off public scan and states that recording a decision does not change Shopify product status. These are feature descriptions, not a relative accuracy or regulatory certification claim.

All 24 web locales have the additions; email copy is unchanged. Localization checks/build pass. Playwright/CDP QA covers both images and all nine features in every locale at 390px, 768px/1440px layout, the hero-to-gallery link, full-resolution image opening and live language switching. No first-party page errors; external Turnstile frame diagnostics are retained in local QA evidence. This does not repeat the backend scan/email lifecycle. Clean Hosting-only release files are under `outputs/marketing-screenshots-release-2026-11-03/`.

## Email example and installation journey (3 November 2026)

`#email-alert` explains new-finding emails, editable preferences and no-new-findings weekly summaries. The email is an illustrative HTML composition based on the alert message, using an existing fictional product illustration, not a screenshot of a delivered message. Five labels/instructions reuse the canonical localized email strings. No risk score, real recipient, confirmation token or customer evidence is invented. The button opens `#match-example`; the adjacent note distinguishes this from authenticated links in real emails. This change sends no email and does not change production email templates.

`#after-install` explains installation/plan/product-read access, background catalog import and history audit, merchant review, and subsequent monitoring. It distinguishes possible matches, no matches and incomplete work without treating an import or no-match result as a safety certificate. It also states the intended non-food merchant audience and includes a clearly illustrative supplier-verification scenario. A new FAQ answer explains the limits of a possible match and merchant obligations.

All additions are in the 24 canonical web catalogs; email source remains unchanged. Localization checks and the production build pass. Playwright/CDP QA covers 24 languages at 390px plus 768px/1440px, image loading, four steps, email-to-walkthrough navigation, mouse/keyboard disclosure, locale switching with open state preserved, and the installation CTA URL. Screenshots were visually inspected on desktop/mobile. No first-party errors were observed; external Turnstile diagnostics are retained in local evidence. Actual app installation/billing and the email/scan lifecycle were not repeated by website QA. Clean Hosting-only release hashes are under `outputs/marketing-journey-release-2026-11-03/`.

3 November follow-up: the owner requested model-only verification wording on the marketing website. Thirteen web strings now omit batch/lot verification, including the illustrative email instruction, walkthrough, supplier example and FAQ. This is a marketing-copy change only; actual checker behavior, source facts, real app screenshots and transactional email templates are unchanged. Localization checks/build and EN/SK desktop/mobile browser checks pass. Clean Hosting-only release files are under `outputs/marketing-model-release-2026-11-03/`.
