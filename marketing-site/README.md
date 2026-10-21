# Free scan protection

The public home, about and privacy pages support all 24 official EU languages. Canonical translations live in `localization/catalogs/`; run `npm run localization:build` and `npm run localization:check` from the repository root after edits. The selector preserves language across pages and in free-scan requests. See `localization/README.md` for email localization, sources and verification. The internal scanner is not translated by this change.

The production Turnstile site key is retained in `marketing-site/.env.production` so ordinary marketing builds keep the widget enabled. This is a public key, safe for browser code. The matching private key stays in Google Secret Manager. The existing Managed widget now permits `zerorecall.online` as well as its prior hostnames. The form still fails closed if configuration or verification is unavailable.

1. Create a Turnstile **managed** widget for the marketing site's production hostname in Cloudflare. Restrict its allowed hostnames to the real site. The widget action is `free_scan`.
2. Provide its public site key as `VITE_TURNSTILE_SITE_KEY` when running `npm run marketing:build`. Never use Cloudflare's dummy test site key for a production build.
3. Set the private key as the Firebase Functions secret `TURNSTILE_SECRET_KEY` (`firebase functions:secrets:set TURNSTILE_SECRET_KEY`). Do not put it in this repository or in Vite variables.
4. Set `MARKETING_SITE_URL` for the confirmation email link if the public site moves away from `https://zerorecall.online`. The value must use HTTPS and the same hostname configured in Turnstile. Keep the existing Brevo sender configuration available to `freeScanRequestAPI`.
5. Build and deploy the hosting site and Firebase Functions together. Verify a real email confirmation, rejection of a reused link, store preflight, asynchronous scan, and result email before announcing the form as live.

Local Vite development uses Cloudflare's official dummy site key. The Firebase emulator may use the matching dummy secret; deployed Functions reject that secret. A Vite-only preview has no `/api/free-scan` backend, so it cannot complete a scan.

Requests are limited to one per store and email per 24 hours, one per IP per hour, 50 requests per UTC day, and 20 confirmed scans per UTC day. These budgets are intentionally conservative for the free public service. A request must be confirmed within 30 minutes; an unconfirmed request never runs the costly scanner.

Confirmed requests scan the entire available public catalog, 50 products per durable Cloud Task, until an empty page is returned. There is no total product ceiling. The report is submitted only after all pages complete; failures retry and cannot be reported as an all-clear. Existing request/day limits stay in force. Copy in all 24 languages describes the full public catalog. Private, unpublished and inaccessible products are excluded.

Owner notifications: `notifyFreeScanOwner` sends an internal Slovak request notice to `FREE_SCAN_OWNER_EMAIL` (production: `radoone@gmail.com`) on creation of a valid free-scan request, before customer email confirmation. It includes the shop, applicant email and request time, and never includes a confirmation token/hash. Its independent retrying trigger does not block the visitor’s confirmation email or scan.
