# ZeroRecall production readiness

23 October 2026. This checklist separates technical release evidence from approval to accept public paid installations.

## Release scope

- Verify the authenticated shop's Partner API subscription, require an active price and a future finite billing/trial boundary, fail closed if verification cannot be persisted. Production bypass stays disabled. Cache access for at most 24 hours and renew due contracts hourly through a bounded background job, so rollover/cancellation does not depend on an open Admin session. Temporary provider outages retain only the existing finite cache.
- Retry merchant email failures through the immediate Firestore trigger and the weekly scheduler. Transaction leases prevent concurrent sends; accepted/delivered/bounced/blocked submissions do not resend. Freeze recipient/content for a logical notification. Brevo UUID idempotency keys include the shop, including weekly emails. Ambiguous acceptance can only resume inside a conservative 25-minute window; after that, stop for operator review rather than risk duplicates. Delivery remains authenticated-webhook evidence only.
- Preserve the five-product email preview and add a recipient-only complete CSV. The email's fragment token authorizes paged reads of all request product receipts; it is removed from the page URL, never included in anonymous status responses, and expires with the request (30 days from request creation). Retain every stored warning per matched product. CSV cells neutralize spreadsheet formulas; product links stay on the scanned shop, sources on the official Commission host.
- Include the reviewed email layout/source-evidence corrections. Preserve 24 public languages and existing confirmation/Turnstile requirements.

## Checks before rollout

Run Functions tests and lint on Node 22, Shopify tests/typecheck/lint/build on Node 24, localization generation/checks, and the marketing production build. Compile scoped overlays against both production dependency locks and run the focused email/report suite against both. Preserve each function's dependencies, existing unrelated sources, sender/secret/runtime settings and unrelated triggers. Enable immediate-event retries and set bounded weekly scheduler retries explicitly.

## External gates still open

- Shopify Partner organization 4478685 is unregistered for the App Store. Manage submission opens the registration form requiring owner business declarations and the Partner Program Agreement.
- ZeroRecall public app listing is Draft; the existing App Store URL is intentionally preserved.
- Hosted plan selection for the development shop currently shows 404. Price/plan availability and the no-charge subscription return flow are not yet verified.
- The owner approved creation of `ZeroRecall subscription verification` with only `Manage apps`. The Partner API query succeeded and returned no active subscription for the development shop. The token is stored in Google Secret Manager with secret-scoped access for the existing Cloud Run service account. Production binding is part of this release.
- An actual paid/no-charge contract → initial catalog check → alert → received email → merchant decision still needs live verification after account/plan gates are resolved. Local bypass and expired owner test access are not substitutes.

Do not label the complete paid product ready until these gates are closed with real evidence. Release results and sanitized deployment evidence are recorded under `outputs/production-readiness-2026-10-23/` locally. Do not place tokens, recipient-report links, runtime configuration dumps or signed source URLs in this document.

## Verified rollout

Code commit `c9e2e3256726531f6acf777c0949a1ed1df9476a` is pushed to `origin/main`. Cloud Run revision `safety-gate-shopify-rc9e2e32` serves 100% of traffic with the Partner secret bound and bypass disabled. Six existing email/free-scan functions are ACTIVE with their runtime settings, dependencies, secrets and unrelated triggers preserved. The new hourly billing function and the Hosting report interface are deployed. The weekly scheduler now retries failed submissions.

Validation: 51 Functions tests, 54 Shopify tests, both lints, Shopify type checking/build, marketing build and localization checks passed. Both production dependency locks passed 40 focused email/report tests; the isolated hourly billing package passed its two tests. In the production browser, the app correctly distinguishes a verified absent plan from unavailable verification. A real Cloud Scheduler invocation refreshed the owner shop's inactive contract through the Partner API without an Admin session. Its first invocation returned 403 during the fresh deployment; the intended service-account invoker binding was confirmed/reapplied, then the repeat succeeded. The function stays private.

A real completed owner-authorized public scan (297 products, seven matched products) exported all seven through two production API pages. A wrong report secret returned 403 and the anonymous status response exposed no details. The production browser prepared the CSV at desktop and 390px without horizontal overflow. The generated CSV was independently saved and parsed; the in-app browser's native file-save destination was not independently inspected. The updated report was reissued only to `info@zerorecall.online` and receipt was verified in Gmail, including the private complete-export link. This reused actual stored results; it did not rerun the scan or prove the still-blocked paid installation journey.

No paid plan, temporary access grant, merchant decision or product was fabricated or changed for these checks. The owner request only received a report access secret and truthful submission state. Public App Store registration/approval and plan availability remain prerequisites for the final subscription/installed-app journey test.
