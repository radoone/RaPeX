import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

const ACTION_HANDLE = "safety-gate-product-action";

export default async function () {
  render(<Extension />, document.body);
}

function Extension() {
  const { data, navigation } = shopify;
  const productId = data.selected[0].id;
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async function loadStatus() {
      try {
        setError("");
        const response = await fetch(
          `/api/product-safety-status?productId=${encodeURIComponent(productId)}`,
        );
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Failed to load Safety Gate status");
        }

        if (!cancelled) {
          setStatus(payload);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load Safety Gate status");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [productId]);

  const summary = useMemo(() => {
    if (error) {
      return "Safety Gate status is unavailable right now.";
    }

    if (!status) {
      return "Loading Safety Gate status...";
    }

    return status.statusMessage;
  }, [error, status]);

  return (
    <s-admin-block title="Safety Gate">
      <s-box padding="base">
        <s-stack direction="block" gap="base">
          <s-text>{summary}</s-text>
          {status ? <StatusDetails status={status} /> : null}
          {error ? <s-text tone="critical">{error}</s-text> : null}
          <s-button onClick={() => navigation.navigate(`extension:${ACTION_HANDLE}`)}>
            Run Safety Gate check
          </s-button>
        </s-stack>
      </s-box>
    </s-admin-block>
  );
}

function StatusDetails({ status }) {
  return (
    <s-stack direction="block" gap="tight">
      <s-text>
        Current state: <strong>{labelForState(status.state)}</strong>
      </s-text>
      {status.checkedAt ? (
        <s-text>Last checked: {new Date(status.checkedAt).toLocaleString()}</s-text>
      ) : null}
      {status.alertType ? <s-text>Alert type: {status.alertType}</s-text> : null}
      {status.riskLevel ? <s-text>Risk level: {status.riskLevel}</s-text> : null}
      {status.overallSimilarity !== null ? (
        <s-text>Similarity: {Math.round(status.overallSimilarity)}%</s-text>
      ) : null}
      {status.recommendation ? <s-text>{status.recommendation}</s-text> : null}
    </s-stack>
  );
}

function labelForState(state) {
  switch (state) {
    case "unsafe":
      return "Warning";
    case "safe":
      return "Safe";
    case "resolved":
      return "Resolved";
    case "needs-review":
      return "Needs review";
    default:
      return "Not checked";
  }
}
