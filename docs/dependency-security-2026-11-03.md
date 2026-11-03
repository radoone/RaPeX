# Dependency security maintenance — 3 November 2026

Compatible security fixes:

- Functions: `follow-redirects` 1.16.2 fixes sensitive custom headers surviving an origin-changing redirect when `sensitiveHeaders` comes from another JavaScript realm.
- Both install roots: `glob` 14.0.2 and modern (`>=9`) `minimatch` branches at 11.0.1.
- React Router fs-routes 7.18.2 needs the version-specific patch under `patches/`: minimatch 11 removed the `makeRe` export. The patch uses a `Minimatch` instance for ignored-route patterns. Root postinstall applies it, including in the production Docker build.
- `scripts/check-dependencies.mjs` validates the version-qualified override without applying it to legacy minimatch branches.

Use Node 22.23.4 and npm 12.2.1. The root lock controls Shopify/workspaces; Functions has a separate deployment lock.

## Verification

After a clean lock refresh, `npm audit --omit=dev` reports:

| Install root | Before | After |
| --- | --- | --- |
| Root / Shopify | 10 moderate | 0 |
| Firebase Functions | 57 moderate, 3 high | 51 moderate, 2 high |

Root audit including development tools retains seven moderate dependency-path findings in Firebase CLI, legacy minimatch, archiving and OpenTelemetry dependencies. Counts are advisory snapshots, not distinct exploitable application defects.

Validation passed: 174 backend tests, 102 Shopify tests, Shopify typecheck/lint/production build, Functions lint and dependency consistency checks. A new regression test verifies cross-realm sensitive-header stripping with real local HTTP redirects; another exercises glob selection and cancellation. Each of the 24 live backend bundles was independently installed and compiled against its own patched lock before deployment.

## Remaining upstream exceptions

Genkit 1.43.0 requires Zod `^3.23.8`; its latest compatible release is 3.25.76. The Zod advisory GHSA-mrhx-c7xc-m3w5 is repaired only in Zod 4.6.6. The two high Functions dependency paths are Zod and its Genkit consumer. Do not force Zod 4 behind the Zod 3 contract. Reassess when Genkit supports a repaired version, or plan an explicit replacement/migration with schema and matcher verification.

The remaining Functions moderate findings belong to Genkit's OpenTelemetry 1.x dependency graph. A coherent supported telemetry migration is needed; forcing a mixture of SDK major versions is not a compatible security update. Legacy minimatch 3/5/6 callers retain their existing API; the override intentionally selects only modern branches. Never use `npm audit fix --force` or suppress these findings to claim a clean audit.

## Scoped deployment

`firebase/functions/scripts/scoped-security-dependency-release.py` supports `prepare`, `validate`, `deploy [names...]`, and `check`. Unlike the older canonical-manifest helper, it preserves each function's deployed direct dependencies, scripts, engines and application sources. It adds only applicable overrides and updates that function's lock. Private snapshots and release evidence live in ignored `outputs/dependency-security-2026-11-03/`; they can contain runtime configuration and must never be published.

The helper checks source hashes before deployment, rejects concurrent function update-time drift and verifies environment, secret bindings, service account, timeout, memory, instance limit and event trigger after deployment. Batch deployment avoids regional build concurrency limits. Shopify uses an isolated archive of the hosted application's matching source plus dependency inputs, a staged Cloud Run revision and login smoke check before traffic promotion. No Shopify extensions, scopes, pricing policy, AI model/prompt, merchant data or marketing site change is part of this release.
