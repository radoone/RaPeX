import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useCallback, useState } from "preact/hooks";

export default async function () {
  render(<Extension />, document.body);
}

function Extension() {
  const { data, close } = shopify;
  const productId = data.selected[0].id;
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const runCheck = useCallback(async () => {
    try {
      setRunning(true);
      setError("");

      const response = await fetch("/api/product-safety-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ productId }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Safety Gate check failed");
      }

      setResult(payload);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Safety Gate check failed");
    } finally {
      setRunning(false);
    }
  }, [productId]);

  return (
    <s-admin-action heading="Run Safety Gate check">
      <s-button
        slot="primaryAction"
        variant="primary"
        disabled={running}
        loading={running}
        onClick={runCheck}
      >
        {running ? "Checking..." : "Run check"}
      </s-button>
      <s-button slot="secondaryActions" onClick={close}>
        Close
      </s-button>

      <s-box padding="base">
        <s-stack direction="block" gap="base">
          <s-text>
            Run the Safety Gate checker against the current Shopify product and store the latest result.
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

  return (
    <s-stack direction="block" gap="tight">
      <s-text>
        Outcome: <strong>{status.state === "unsafe" ? "Warning detected" : "No likely match detected"}</strong>
      </s-text>
      {status.checkedAt ? (
        <s-text>Checked at: {new Date(status.checkedAt).toLocaleString()}</s-text>
      ) : null}
      {firstWarning?.alertType ? <s-text>Alert type: {firstWarning.alertType}</s-text> : null}
      {firstWarning?.riskLevel ? <s-text>Risk level: {firstWarning.riskLevel}</s-text> : null}
      {typeof firstWarning?.overallSimilarity === "number" ? (
        <s-text>Similarity: {Math.round(firstWarning.overallSimilarity)}%</s-text>
      ) : null}
      {result.result?.recommendation ? <s-text>{result.result.recommendation}</s-text> : null}
    </s-stack>
  );
}
