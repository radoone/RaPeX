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
