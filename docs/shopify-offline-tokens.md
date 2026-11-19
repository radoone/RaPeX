# Shopify offline tokens and App Store billing

11 November 2026. The token change is scoped to OAuth session storage and the three workers that read the Admin API: product-change processing, initial catalog import, and catalog reconciliation. It does not enqueue scans, change matcher policy, or alter billing entitlements.

## Token lifecycle

The embedded app requests expiring offline tokens through Shopify's `expiringOfflineAccessTokens` flag. Hosted web requests and workers use the canonical `shopify_sessions/offline_{shop}` document. Both access and refresh credentials are encrypted with the existing session encryption key derivation. Expiry timestamps survive Firestore serialization.

`firebase/functions/src/shopify-offline-session.ts` provides shared migration and refresh logic. It migrates legacy sessions when next loaded and refreshes expiring credentials ten minutes before expiry, including while Shopify Admin is closed. A Firestore lease coordinates workers and web instances. Network work runs outside the transaction; the final write requires the same lease and previous token, and cannot recreate a deleted session. Failed or ambiguous exchanges keep the lease until its timeout and fail closed. No provider response bodies or credentials are logged. An expired refresh credential requires reauthorization.

Hosted catalog-session validation checks the canonical session without rewriting it. Local Prisma/SQLite session storage was removed on 19 November 2026 after a local SQLite session rotated an offline token independently and invalidated the shared Firestore refresh credential with HTTP 401; both local dev and hosted Cloud Run now use `FirestoreSessionStorage` unconditionally. Additionally, `ensureOfflineSession` classifies permanent OAuth/rotation failures (HTTP 400/401/403 and expired refresh credentials) as `ShopifyOfflineReauthError`: workers still fail closed, while `FirestoreSessionStorage.loadSession` returns `undefined` on permanent reauth errors so Shopify's embedded token-exchange flow can transparently mint a fresh offline session instead of returning HTTP 500.

Workers require the public `SHOPIFY_API_KEY` and secret `SHOPIFY_API_SECRET`, in addition to the existing session encryption secret. The release grants the existing worker identity access to this one secret and preserves its other runtime configuration, limits and task triggers. Existing installation-specific owner test access is unchanged.

## Validation and release evidence

Private source snapshots, original locks, build results, operations and sanitized verification records are under `outputs/shopify-offline-tokens-2026-11-11/`. The deployment helper patches each worker's deployed session readers and retains its existing matcher, catalog and onboarding implementation. The web application is built from the source archive of the currently serving 6 November revision with only the reviewed OAuth/session overlay.

Focused tests cover legacy migration, encrypted credentials, normal reuse, expired-token refresh, concurrent callers, deleted sessions, malformed provider responses, expired refresh credentials and invalid domains. The backend suite passed 228 tests. The broader local Shopify suite passed 111 tests and retained one pre-existing translation-manifest hash failure; the same hash mismatch exists in the archived deployed source, outside this change. The archived source's full test suite additionally needs compiled backend test helpers; the scoped session/billing tests and TypeScript/build checks are verified separately.

## Billing state

The production app uses Shopify App Pricing with development bypass disabled. The Partner API returned HTTP 200 and `activeSubscription: null` for all four installed development stores. This is a verified absence of a contract, not an API failure or proof that a paid install works.

The real beta-store pricing page opens but says “No plans are available for your store”. The Partner account still requires App Store registration; the public listing is Draft. Registration and an available eligible public/private test plan must be completed before testing plan approval and return to the app. Do not substitute owner test access for a real subscription or claim the paid installation journey is verified.

References: [Shopify migration guide](https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens), [App Store registration](https://shopify.dev/docs/apps/launch/distribution/revenue-share).

## Live migration verification

All four existing offline sessions (the three beta stores and RozlicnyTovar) were migrated to expiring credentials. Each migrated token completed a read-only Admin GraphQL query with the expected shop identity. Beta 01 also completed a real refresh-token exchange followed by another successful identity query. All four sessions now store encrypted refresh credentials and finite access/refresh expiry timestamps. The three worker revisions are ACTIVE: `shopifyproductchangetask-00023-nar`, `merchantcatalogaudittask-00025-yed`, and `merchantcatalogreconciliationtask-00002-wig`. No product scans, product writes, notifications or billing contracts were created by this verification.

The web revision `safety-gate-shopify-offline-20261111` now serves 100% of production traffic. Its runtime specification matches the prior revision except for the image. Preview and live `/auth/login` returned HTTP 200; the temporary preview tag was removed. The real embedded Beta 01 dashboard loaded after migration and correctly showed monitoring paused without an active plan, with an Upgrade/Open pricing action. No ERROR-level entries were present for the new web revision at the release check. Shopify's historical token warning may remain until its own usage detection updates; finite stored token expiries and successful real migration/refresh are the verification evidence.

Credential migration invalidates the previous non-expiring token. Rollback must retain expiring-token support and the canonical stored credential pair; never restore the old token document or reset merchant baselines to roll back a web change.
