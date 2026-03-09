# RaPeX Changelog

Recent entries below are based on the GitHub history of [`radoone/RaPeX`](https://github.com/radoone/RaPeX).

## 2026.01.12
- [`98f79f0`](https://github.com/radoone/RaPeX/commit/98f79f0) Refactor dashboard and manual check UI, upgrade alert actions icons
- [`84a5e1d`](https://github.com/radoone/RaPeX/commit/84a5e1d) feat: implement i18n, refactor UI, and update Firebase functions

## 2025.12.08
- [`650a209`](https://github.com/radoone/RaPeX/commit/650a209) chore: Update dependencies and improve safety gate checker functionality
- [`f823771`](https://github.com/radoone/RaPeX/commit/f823771) Migrate to Polaris web components

## 2025.12.04
- [`2c6faf8`](https://github.com/radoone/RaPeX/commit/2c6faf8) fix: type annotate products fetch in bulk check
- [`3b75f04`](https://github.com/radoone/RaPeX/commit/3b75f04) fix: import bulk check helpers statically to avoid undefined function
- [`8a54321`](https://github.com/radoone/RaPeX/commit/8a54321) chore: log per-product errors during bulk check
- [`238cd27`](https://github.com/radoone/RaPeX/commit/238cd27) fix: Add missing SafetySetting migration SQL file
- [`dd86e3d`](https://github.com/radoone/RaPeX/commit/dd86e3d) feat: Improve bulk check with progress, summary, and skip already checked
- [`0752188`](https://github.com/radoone/RaPeX/commit/0752188) fix: drop unsupported case-insensitive mode in alerts search
- [`169a830`](https://github.com/radoone/RaPeX/commit/169a830) feat: Use proper table for product details in WarningCard
- [`7c6de35`](https://github.com/radoone/RaPeX/commit/7c6de35) feat: Redesign Safety Alert Details modal for better clarity
- [`a3a6c50`](https://github.com/radoone/RaPeX/commit/a3a6c50) chore: Polish Safety Alert details layout
- [`af3c23b`](https://github.com/radoone/RaPeX/commit/af3c23b) fix: Load all stylesheets inline to eliminate hydration mismatch
- [`87a3188`](https://github.com/radoone/RaPeX/commit/87a3188) fix: Move CDN links from links() to head to fix hydration mismatch

## 2025.07.07
- [#1103](https://github.com/Shopify/shopify-app-template-remix/pull/1086) Remove deprecated .npmrc config values

## 2025.06.12
- [#1075](https://github.com/Shopify/shopify-app-template-remix/pull/1075) Add Shopify MCP to [VSCode configs](https://code.visualstudio.com/docs/copilot/chat/mcp-servers#_enable-mcp-support-in-vs-code)

## 2025.06.12
-[#1082](https://github.com/Shopify/shopify-app-template-remix/pull/1082) Remove local Shopify CLI from the template. Developers should use the Shopify CLI [installed globally](https://shopify.dev/docs/api/shopify-cli#installation).
## 2025.03.18
-[#998](https://github.com/Shopify/shopify-app-template-remix/pull/998) Update to Vite 6

## 2025.03.01
- [#982](https://github.com/Shopify/shopify-app-template-remix/pull/982) Add Shopify Dev Assistant extension to the VSCode extension recommendations

## 2025.01.31
- [#952](https://github.com/Shopify/shopify-app-template-remix/pull/952) Update to Shopify App API v2025-01

## 2025.01.23

- [#923](https://github.com/Shopify/shopify-app-template-remix/pull/923) Update `@shopify/shopify-app-session-storage-prisma` to v6.0.0

## 2025.01.8

- [#923](https://github.com/Shopify/shopify-app-template-remix/pull/923) Enable GraphQL autocomplete for Javascript

## 2024.12.19

- [#904](https://github.com/Shopify/shopify-app-template-remix/pull/904) bump `@shopify/app-bridge-react` to latest
-
## 2024.12.18

- [875](https://github.com/Shopify/shopify-app-template-remix/pull/875) Add Scopes Update Webhook
## 2024.12.05

- [#910](https://github.com/Shopify/shopify-app-template-remix/pull/910) Install `openssl` in Docker image to fix Prisma (see [#25817](https://github.com/prisma/prisma/issues/25817#issuecomment-2538544254))
- [#907](https://github.com/Shopify/shopify-app-template-remix/pull/907) Move `@remix-run/fs-routes` to `dependencies` to fix Docker image build
- [#899](https://github.com/Shopify/shopify-app-template-remix/pull/899) Disable v3_singleFetch flag
- [#898](https://github.com/Shopify/shopify-app-template-remix/pull/898) Enable the `removeRest` future flag so new apps aren't tempted to use the REST Admin API.

## 2024.12.04

- [#891](https://github.com/Shopify/shopify-app-template-remix/pull/891) Enable remix future flags.

## 2024.11.26
- [888](https://github.com/Shopify/shopify-app-template-remix/pull/888) Update restResources version to 2024-10

## 2024.11.06

- [881](https://github.com/Shopify/shopify-app-template-remix/pull/881) Update to the productCreate mutation to use the new ProductCreateInput type

## 2024.10.29

- [876](https://github.com/Shopify/shopify-app-template-remix/pull/876) Update shopify-app-remix to v3.4.0 and shopify-app-session-storage-prisma to v5.1.5

## 2024.10.02

- [863](https://github.com/Shopify/shopify-app-template-remix/pull/863) Update to Shopify App API v2024-10 and shopify-app-remix v3.3.2

## 2024.09.18

- [850](https://github.com/Shopify/shopify-app-template-remix/pull/850) Removed "~" import alias

## 2024.09.17

- [842](https://github.com/Shopify/shopify-app-template-remix/pull/842) Move webhook processing to individual routes

## 2024.08.19

Replaced deprecated `productVariantUpdate` with `productVariantsBulkUpdate`

## v2024.08.06

Allow `SHOP_REDACT` webhook to process without admin context

## v2024.07.16

Started tracking changes and releases using calver
