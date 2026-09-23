/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useCallback, useState } from "preact/hooks";

export default async function () {
  render(<Extension />, document.body);
}

function Extension() {
  const { data, close } = shopify;
  const productId = data?.selected?.[0]?.id;
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const runCheck = useCallback(async () => {
    if (!productId || running) return;

    try {
      setRunning(true);
      setError("");

      const response = await fetch("/api/product-safety-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Product safety check failed");
      }

      setResult(payload);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Product safety check failed");
    } finally {
      setRunning(false);
    }
  }, [productId, running]);

  return (
    <s-admin-action heading="Run Safety Gate check" loading={running}>
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={running || !productId}
        loading={running}
        onClick={runCheck}
      >
        {running ? "Checking..." : "Run check"}
      </s-button>
      <s-button slot="secondary-actions" onClick={close}>Close</s-button>
      <s-box padding="base">
        <s-stack direction="block" gap="base">
          <s-text>
            Check this Shopify product against recent EU Safety Gate records and store the decision history.
          </s-text>
          {error ? <s-text tone="critical">{error}</s-text> : null}
          {result ? <ResultDetails result={result} /> : null}
        </s-stack>
      </s-box>
    </s-admin-action>
  );
}

function ResultDetails({ result }) {
  const status = result.status;
  const firstWarning = result.result?.warnings?.[0];
  const riskLevel = [
    status.riskLevel,
    firstWarning?.riskLevel,
    firstWarning?.alertDetails?.fields?.level,
    firstWarning?.alertDetails?.fields?.alert_level,
    firstWarning?.alertDetails?.fields?.risk_level,
  ].find((value) => {
    if (typeof value !== "string" || !value.trim()) return false;
    return !["unknown", "not specified", "n/a"].includes(value.trim().toLowerCase());
  });

  return (
    <s-stack direction="block" gap="tight">
      <s-text>{`Outcome: ${labelForState(status.state)}`}</s-text>
      {status.checkedAt ? <s-text>Checked at: {new Date(status.checkedAt).toLocaleString()}</s-text> : null}
      {status.topReason || firstWarning?.reason ? (
        <s-text>Top reason: {status.topReason || firstWarning.reason}</s-text>
      ) : null}
      {riskLevel ? <s-text>Risk level: {riskLevel}</s-text> : null}
      {result.result?.recommendation ? <s-text>{result.result.recommendation}</s-text> : null}
    </s-stack>
  );
}

function labelForState(state) {
  switch (state) {
    case "unsafe":
    case "needs-review":
      return "Needs review";
    case "safe":
      return "No likely match detected";
    case "resolved":
      return "Decision recorded";
    default:
      return "Not checked";
  }
}
