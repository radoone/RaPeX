import type { Config } from "@react-router/dev/config";
import { readFileSync } from "node:fs";

// Cloud Run terminates HTTPS before the Node server. Trust only the configured
// public app host for UI actions; resource routes still authenticate via Shopify.
// Router serializes this at build time, when runtime env is not yet available.
const configuredUrl = process.env.SHOPIFY_APP_URL ||
  readFileSync(new URL("./shopify.app.toml", import.meta.url), "utf8")
    .match(/^application_url\s*=\s*"([^"]+)"/m)?.[1];
if (!configuredUrl) throw new Error("The public Shopify application URL is required");
const actionHost = new URL(configuredUrl).host;

export default {
  allowedActionOrigins: [actionHost],
  future: {
    v8_middleware: false,
    v8_splitRouteModules: true,
    v8_viteEnvironmentApi: true,
    v8_passThroughRequests: true,
    v8_trailingSlashAwareDataRequests: true,
  },
} satisfies Config;
