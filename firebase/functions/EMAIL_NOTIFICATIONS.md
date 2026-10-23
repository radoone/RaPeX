# Brevo email notifications

Safety Gate alert email is sent only by Firebase Functions, and only for merchants with a current monitoring entitlement:

- `sendImmediateSafetyGateAlertEmail` runs when a new merchant alert document is created.
- `weeklyClearSafetyGateSummary` runs every Monday at 08:00 in `Europe/Bratislava` and sends to entitled merchants who have enabled the summary, whether or not new alerts occurred. It reports new and open findings. If monitoring was incomplete, the message states that explicitly and does not claim the store is clear.
- `brevoEmailWebhook` records delivery, bounce, and blocked events.

## Required configuration

Create and verify a dedicated sending domain in Brevo. Publish the SPF and DKIM records supplied by Brevo and publish a DMARC policy for the domain.

Set the two Firebase secrets:

```sh
firebase functions:secrets:set BREVO_API_KEY
firebase functions:secrets:set BREVO_WEBHOOK_SECRET
```

Set these non-secret runtime environment variables for the Functions deployment (for example in `firebase/functions/.env.rapex-99a2c`):

```text
BREVO_SENDER_EMAIL=info@zerorecall.online
BREVO_SENDER_NAME=ZeroRecall
SHOPIFY_APP_HANDLE=safety-gate-monitor-eu
MARKETING_SITE_URL=https://zerorecall.online
```

`BREVO_SENDER_EMAIL` must be a sender address verified in Brevo, on a domain with Brevo's SPF and DKIM records published. Do not put the API key or webhook bearer secret in this environment file; configure both as Firebase secrets instead. The app handle is used to create authenticated Shopify Admin links in messages.

In Brevo, create one transactional webhook for `delivered`, `hardBounce`, `softBounce`, `invalid`, `blocked`, and `error`. Point it to the deployed `brevoEmailWebhook` URL and configure bearer authorization using the same value as `BREVO_WEBHOOK_SECRET`.

Do not place Brevo credentials in a checked-in `.env` file. Use Brevo sandbox mode or a dedicated test recipient before enabling production delivery.

## ZeroRecall sender

The verified Brevo sender is `ZeroRecall <info@zerorecall.online>`. Incoming mail is forwarded by Cloudflare Email Routing to `radoone@gmail.com`; Brevo authenticates outgoing mail with the `brevo1._domainkey` and `brevo2._domainkey` CNAME records. Keep these records DNS-only. Retain the existing Cloudflare MX/SPF records and the DMARC policy; do not replace them with a second SPF record.

Set `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, and `MARKETING_SITE_URL` for `freeScanRequestAPI`, `processFreeScanRequestJob`, `sendImmediateSafetyGateAlertEmail`, and `weeklyClearSafetyGateSummary`. Store the same non-secret values in the untracked deployment-local `.env.rapex-99a2c` file for subsequent Firebase CLI deploys. Domain authentication and a verified sender do not by themselves prove production delivery; verify receipt of a test message.

## ZeroRecall email templates

`src/email-templates.ts` owns pure HTML and plain-text renderers for four transactional messages: merchant match alert, weekly summary, free-scan confirmation and free-scan result. `email-notifications.ts` and `free-scan.ts` use these renderers in their existing Brevo requests. Both sending paths use the configured sender name (default `ZeroRecall`) and Reply-To sender address. No template rendering sends mail or changes notification lifecycle state.

The visual target is the first ZeroRecall email concept selected on 19 October 2026: warm ivory, forest-green CTA, large editorial headline, product facts, explanation and next action. Layout uses presentation tables, inline styles, Arial/Helvetica fallbacks, an Outlook fixed-width conditional wrapper and a mobile stacking enhancement. Every message includes a subject, preheader, text alternative, support contact and fallback action URL. Merchant emails link to authenticated Shopify email preferences; one-off scan emails explain why the recipient received them.

- Alerts include the merchant product, official Safety Gate product, risk, available similarity score and matcher reason. Canonical fields (`name`, `product`, `level`, `caseNumber`, `type_numberOfModel`, `riskType`, `pictures`) are preferred with legacy aliases retained. An optional image is explicitly labelled as originating from the Safety Gate record. Without an image the facts occupy the full width. Never substitute the illustrative preview bicycle for a real product photograph.
- Weekly summaries report catalog products, checks, new Safety Gate records, new findings, open findings and last successful run. They distinguish incomplete monitoring from no new findings and never certify product safety. Counts and monitoring eligibility are provided by the existing scheduler; the renderer does not run checks.
- When findings exist, weekly messages also show up to five individual findings, prioritising new ones and filling remaining slots with older open findings. The scheduler reads at most five recent and five active alert documents from that merchant's own subcollection, deduplicates them, and preserves resolved/dismissed/waiting-for-supplier states. Each entry includes the Shopify product title, Safety Gate product, available Safety Gate photograph with source attribution, risk, available similarity, reason and authenticated detail link. Missing/unsafe image URLs omit only the image. The text alternative retains finding details and links.
- Confirmation messages explain the 100-product limit, single-use 30-minute link, next step on the website, and how to ignore an unsolicited request. The existing confirmation URL and token are preserved.
- Scan results show the actual checked-product and match counts, up to five product links restricted to the requested shop, available alert references, the official Safety Gate portal and the difference between a one-off scan and ongoing monitoring.

Email copy supports all 24 official EU languages. Merchant messages use `notificationLanguage`; free-scan confirmation and reports use the request's normalized locale. Unsupported locales fall back to English, while regional tags normalize to a supported base language. Canonical translations live in `localization/catalogs/`; run `npm run localization:build` from the repository root to regenerate the web JSON and `src/email-locales.ts`. See `localization/README.md`. Product names, identifiers, source details and stored matcher explanations remain in their original language. HTML escapes dynamic fields; action and image URLs require HTTPS. Images are optional and email clients can block them. Plain text preserves essential facts and actions.

To regenerate local examples after building Functions:

```sh
cd firebase/functions
npm run build
node scripts/render-email-previews.mjs /absolute/path/to/illustrative-product.png
```

The image argument is needed only to seed the optional local preview asset. Later regenerations can omit it. Generated examples are in `outputs/email-templates/` with a browsable `index.html`, 24 languages and seven weekly/scan result states (168 examples). They contain conspicuously fictional data and a nonfunctional confirmation token. Keep them out of production email payloads. The generator does not send mail or access Firestore.

Validation on 19 October: TypeScript build, Functions ESLint, 25 backend tests, and browser inspection of 14 examples at 390px with no horizontal overflow or console warnings/errors. The alert was also compared at 760px against the selected concept. See the root `design-qa.md`. This is browser rendering evidence, not a Gmail/Outlook delivery or full production workflow test. All four email functions were deployed on 19 October with the localized templates. Only the five email/free-scan modules were overlaid onto each existing production archive; dependencies, unrelated backend code, runtime configuration, secrets and triggers were preserved. The production overlay passed 20 tests; the repository passed 28. Merchant-email app links use the verified `SHOPIFY_APP_HANDLE=safety-gate-monitor-eu`. Actual trigger and scheduler delivery still requires separate verification. See `localization/README.md` and the sanitized release evidence.

## Full public catalog report

A confirmed free scan is paged through `freeScanCatalogTask` rather than one 540-second Firestore invocation. Each task checks up to 50 public products with the existing batched embeddings, persistent vector cache, KNN shortlist and targeted matcher. The request stores a transactional cursor, counts and per-product receipts. It enters `reporting` only after fetching an empty terminal page, then `completed` only after Brevo accepts the report. Retries repair the next-task enqueue and do not count a product twice. The email describes the entire available public catalog and previews five matched products; all matches have request product receipts. Provider idempotency remains bounded by Brevo’s policy, so acceptance is distinct from webhook-confirmed inbox delivery.

## Free-scan owner notices

`notifyFreeScanOwner` listens only for creation of `free_scan_requests/{requestId}`. The configured owner (`FREE_SCAN_OWNER_EMAIL=radoone@gmail.com`) receives an internal Slovak message with domain, applicant email and Bratislava request time. This is a request receipt, not proof of confirmation or a finished scan. The renderer escapes applicant data and excludes all confirmation tokens and hashes. `ownerNotification` on the same request stores a transactional lease and provider acceptance/message ID. Accepted requests are deduplicated; a temporary failure is retried independently of the visitor workflow. Brevo acceptance and provider duplicate acknowledgement are never labelled delivered. Existing merchant notification audit remains webhook-only.

## Reliable submissions and recipient exports (23 October release)

Merchant notification failures now throw to the retrying Firestore event or weekly scheduler. Each logical shop/notification has an atomic lease, immutable recipient/content for retries and a tenant-specific UUID in Brevo's documented `headers.idempotencyKey` field. Accepted and terminal delivery states never resend. Known rejections can retry up to eight submissions; uncertain acceptance is retried only within 25 minutes, below Brevo's 30-minute key retention. An exhausted or uncertain notification stays failed with a safe failure code for operator review. Never label provider acceptance or a duplicate-key acknowledgement delivered. Preserve webhook terminal states when saving a late acceptance or failure.

New free-scan reports link to `#report=…` on the public site. The fragment is removed after capture; the browser POSTs it to `/api/free-scan` to read at most 200 product receipts per page. Only completed, unexpired requests with the separate report secret are readable. The status GET stays counts-only. All matched products and their stored warnings reach CSV, with safe same-shop/official links and spreadsheet formula neutralization. The report shares the request's 30-day expiry; it does not extend retention. Requests created before this release are not automatically mailed again or granted a report token.

See `docs/production-readiness.md` at the repository root for rollout boundaries and external Shopify launch gates.
