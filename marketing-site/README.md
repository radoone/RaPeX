# Free scan protection

The public free-scan form deliberately fails closed until a production Cloudflare Turnstile widget is configured.

1. Create a Turnstile **managed** widget for the marketing site's production hostname in Cloudflare. Restrict its allowed hostnames to the real site. The widget action is `free_scan`.
2. Provide its public site key as `VITE_TURNSTILE_SITE_KEY` when running `npm run marketing:build`. Never use Cloudflare's dummy test site key for a production build.
3. Set the private key as the Firebase Functions secret `TURNSTILE_SECRET_KEY` (`firebase functions:secrets:set TURNSTILE_SECRET_KEY`). Do not put it in this repository or in Vite variables.
4. Set `MARKETING_SITE_URL` for the confirmation email link if the public site moves away from `https://rapex-99a2c.web.app`. The value must use HTTPS and the same hostname configured in Turnstile. Keep the existing Brevo sender configuration available to `freeScanRequestAPI`.
5. Build and deploy the hosting site and Firebase Functions together. Verify a real email confirmation, rejection of a reused link, store preflight, asynchronous scan, and result email before announcing the form as live.

Local Vite development uses Cloudflare's official dummy site key. The Firebase emulator may use the matching dummy secret; deployed Functions reject that secret. A Vite-only preview has no `/api/free-scan` backend, so it cannot complete a scan.

Requests are limited to one per store and email per 24 hours, one per IP per hour, 50 requests per UTC day, and 20 confirmed scans per UTC day. These budgets are intentionally conservative for the free public service. A request must be confirmed within 30 minutes; an unconfirmed request never runs the costly scanner.
