import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigation, Form } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSimilarityThresholdForShop } from "../services/safety-gate-checker.server";
import { SafetyGatePortal } from "../components";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const current = await getSimilarityThresholdForShop(session.shop);
  const envDefault = Number(process.env.SAFETY_GATE_SIMILARITY_THRESHOLD || "0");

  return json({
    similarityThreshold: current,
    envDefault: Number.isFinite(envDefault) ? envDefault : 0,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const threshold = Number(formData.get("similarityThreshold"));
  const safeValue = Number.isFinite(threshold) && threshold >= 0 ? Math.round(threshold) : 0;

  await db.safetySetting.upsert({
    where: { shop: session.shop },
    update: { similarityThreshold: safeValue },
    create: { shop: session.shop, similarityThreshold: safeValue },
  });

  return redirect("/app/settings");
};

export default function Settings() {
  const { similarityThreshold, envDefault } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [value, setValue] = useState(similarityThreshold.toString());
  const isSubmitting = navigation.state === "submitting" || navigation.state === "loading";

  return (
    <s-page>
      {/* Main content */}
      <s-section heading="Settings">
        <s-text tone="subdued">Configure thresholds and preferences for Safety Gate monitoring.</s-text>
      </s-section>

      <s-section heading="Similarity Threshold">
        <s-stack gap="base">
          <s-banner tone="info" heading="How this works">
            <s-text>
              The similarity threshold determines how closely a product must match a Safety Gate alert. 
              Higher values (e.g., 80%) mean stricter matching with fewer false positives. 
              Lower values (e.g., 40%) catch more potential matches but may include false positives.
            </s-text>
          </s-banner>

          <Form method="post">
            <s-stack gap="base">
              <s-text>
                Current environment default: <strong>{envDefault}%</strong>
              </s-text>

              <s-number-field
                label="Similarity threshold (%)"
                name="similarityThreshold"
                min="0"
                max="100"
                value={value}
                onChange={(e: any) => setValue(e.currentTarget.value)}
              />

              <s-stack direction="inline" gap="small">
                <s-button type="submit" variant="primary" loading={isSubmitting || undefined}>
                  Save
                </s-button>
                <s-button type="button" variant="tertiary" onClick={() => setValue(envDefault.toString())}>
                  Reset to default
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>

      <s-section heading="Monitoring">
        <s-grid gap="base" gridTemplateColumns="1fr 1fr">
          <s-section>
            <s-stack gap="small">
              <s-text fontWeight="bold">Automatic checking</s-text>
              <s-text tone="subdued">Products are automatically checked when created or updated via webhooks.</s-text>
              <s-badge tone="success">Enabled</s-badge>
            </s-stack>
          </s-section>

          <s-section>
            <s-stack gap="small">
              <s-text fontWeight="bold">Manual checks</s-text>
              <s-text tone="subdued">Run on-demand safety checks for any product in your catalog.</s-text>
              <s-button variant="secondary" size="small" href="/app/manual-check">Go to Manual Check</s-button>
            </s-stack>
          </s-section>
        </s-grid>
      </s-section>

      {/* Aside sidebar */}
      <div slot="aside">
        <s-section heading="Navigation">
          <s-stack gap="small">
            <s-button variant="secondary" href="/app">Dashboard</s-button>
            <s-button variant="secondary" href="/app/alerts">View alerts</s-button>
            <s-button variant="secondary" href="/app/manual-check">Manual check</s-button>
          </s-stack>
        </s-section>

        <SafetyGatePortal />
      </div>
    </s-page>
  );
}
