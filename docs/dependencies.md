# Dependency maintenance

Updated 23–24 October 2026. Registry `latest` tags and package peer dependencies were checked directly; prereleases are excluded (the Prisma CLI's latest tag currently points to an 8.0 release candidate).

The root npm workspace owns Shopify, both extensions and Firebase CLI. Firebase Functions is intentionally installed independently because Cloud Functions builds from that directory. All shared direct dependencies use identical exact versions, checked by `npm run deps:check`. Do not add Shopify or extension lockfiles. The obsolete manifest-only `shopify-client/ra-pex` Remix scaffold was removed.

| Component | Selected version | Reason |
| --- | --- | --- |
| Node | 22.23.4 | Latest Node 22 patch at verification; matches deployed runtime major |
| npm | 12.2.1 | Reproducible local/container package manager; version-specific build-script approvals |
| React / DOM | 19.3.1 | Latest stable; removed unused deprecated Polaris React package |
| React types / DOM types | 19.3.0 | Matching React 19 declarations; custom elements augment React.JSX |
| Shopify React Router adapter | 4.0.0 | Latest stable; explicit shared Polaris 1 URL preserves existing component contract |
| App Bridge React | 4.2.14 | Latest stable |
| Shopify extensions SDK | 2026.10.0 | Both extensions target API 2026-10; app Admin API remains 2026-07 |
| Preact | 11.0.2 | Latest stable; preserve JSX import pragma |
| Genkit packages | 1.43.0 | Updated together |
| Firebase Admin / Functions | 14.5.0 / 7.4.0 | Already current |
| Firebase CLI / Shopify CLI | 15.34.1 / 4.9.4 | Pinned local tools |
| Vite / Vitest | 8.3.5 / 5.0.5 | Latest stable |
| i18next / react-i18next | 26.5.7 / 17.1.5 | Latest stable |
| TypeScript ESLint parser / plugin | 8.72.0 | Updated together |
| TypeScript | 6.0.3 | Parser supports TypeScript <6.1, so 7.0.2 is excluded |
| ESLint / @eslint/js | 9.39.5 | Import, React and a11y plugins do not support ESLint 10 |
| Prisma CLI / client / SQLite adapter | 6.19.3 | Shopify session-storage-prisma 11.0.1 requires Prisma ^6.19 |
| React Router family | 7.18.2 | Shopify adapter requires 7.x; Shopify template pins 7.18.2 because later origin validation breaks dev/proxy actions |
| Node types | 22.20.5 | Tracks production runtime APIs rather than permitting Node 26-only APIs |

The Router Vite compatibility patch remains in `patches/` and is applied by root postinstall. Shared React/DOM packages are declared at root as well to prevent incompatible peer copies from being hoisted during installation. Do not force Router 8, Prisma 7 or TypeScript 7 past upstream peer constraints.

## Security checks

Root security overrides patch GraphQL tools utilities (12.1.0; 13 removes exports still needed by Shopify codegen), deepmerge-ts, lodash and UUID; Functions overrides patch Jaeger propagation and UUID. These are tested overrides, not a blanket major-version update of the OpenTelemetry stack. Native SQLite loading and Prisma configuration/generation are included in validation.

The final 24 October audit reports 3 moderate findings at root and 51 moderate plus 2 high dependency-path findings in Functions, with zero critical findings. The high findings are one underlying Zod advisory (GHSA-mrhx-c7xc-m3w5), propagated through `@genkit-ai/core`: latest Genkit 1.43.0 requires Zod ^3.23.8 and the latest compatible Zod is 3.25.76. The advisory was updated on 23 October; earlier audit evidence had not reported this high finding. The patched default API is Zod 4.6.6+, which is incompatible with that Genkit contract; do not force it by override or claim the backend has no high findings. A supported Genkit/Zod migration remains necessary. [Upstream advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

Other remaining advisories concern upstream OpenTelemetry 1.x baggage handling and Genkit's old tedious instrumentation. Counts include propagated dependency paths, not unique defects. Upgrading all telemetry packages to 2.x/3.x by override would mix incompatible SDK/resource/exporter contracts. A coherent upstream telemetry migration remains necessary; do not describe the tree as vulnerability-free or use `npm audit fix --force`, which proposes incompatible Shopify/Prisma changes.

## Verification

Use `.nvmrc`, then root `npm ci` and standalone Functions `npm ci`. npm 12 requires the reviewed, pinned `allowScripts` entries to build Prisma, SQLite and esbuild. Inspect new package scripts before adding approvals. Managed Functions builds may use a different npm version; package sources and lockfiles remain standard npm-compatible.

Run `npm run deps:check`, Functions tests/lint, Shopify tests/types/lint/build, `npm run shopify -- app build` from `shopify-client/`, and a marketing Vite build that does not overwrite Hosting output. Root scripts tolerate extension workspaces without those scripts. Browser verification uses actual components with explicitly illustrative local data: React 19, language change, search, modal opening, required Other note and local decision callback. This is not a production merchant write or a subscription test.

Official compatibility references: [Shopify template changelog](https://github.com/Shopify/shopify-app-template-react-router/blob/main/CHANGELOG.md), [Shopify adapter changelog](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-app-react-router/CHANGELOG.md), [React 19 migration](https://react.dev/blog/2024/04/25/react-19-upgrade-guide). Registry manifests are the authority for the exact peer constraints above.

## Scoped production release

`firebase/functions/scripts/scoped-dependency-release.py` snapshots every deployed function separately, replaces only its package manifest/lockfile with the reviewed canonical Functions tree, validates compilation and preserves source hashes. Its deploy step refuses a function whose deployment changed since the snapshot. It preserves service configuration, secrets and triggers through the existing scoped release helper; use a private, fresh `ZERO_RECALL_RELEASE_DIR`. Release in small batches to respect regional Cloud Build concurrency. The original sources and configuration remain private rollback inputs.
