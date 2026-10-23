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
