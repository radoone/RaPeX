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
      return "Safety Gate monitoring is unavailable right now.";
    }

    if (!status) {
      return "Loading product safety status...";
    }

    return status.statusMessage;
  }, [error, status]);

  return (
    <s-admin-block title="Safety Gate">
      <s-box padding="base">
        <s-stack direction="block" gap="base">
          {status ? <StatusBadge status={status} /> : null}
          <s-text>{summary}</s-text>
          {status ? <StatusDetails status={status} /> : null}
          {error ? <s-text tone="critical">{error}</s-text> : null}
          <s-stack direction="inline" gap="base">
            <s-button onClick={() => navigation.navigate(`extension:${ACTION_HANDLE}`)}>
              Run check
            </s-button>
            {status?.alertId ? (
              <s-button variant="secondary" onClick={() => navigation.navigate("/app/alerts?status=active")}>
                Open review
              </s-button>
            ) : null}
          </s-stack>
        </s-stack>
      </s-box>
    </s-admin-block>
  );
}

function StatusBadge({ status }) {
  const tone = status.state === "unsafe"
    ? "critical"
    : status.state === "safe" || status.state === "resolved"
      ? "success"
      : status.state === "unchecked"
        ? "info"
        : "warning";

  return <s-badge tone={tone}>{labelForState(status.state)}</s-badge>;
}

function StatusDetails({ status }) {
  return (
    <s-stack direction="block" gap="tight">
      {status.checkedAt ? (
        <s-text>Last checked: {new Date(status.checkedAt).toLocaleString()}</s-text>
      ) : null}
      {status.topReason ? <s-text>Top reason: {status.topReason}</s-text> : null}
      {status.riskLevel ? <s-text>Risk level: {status.riskLevel}</s-text> : null}
      {status.recommendation ? <s-text>{status.recommendation}</s-text> : null}
    </s-stack>
  );
}

function labelForState(state) {
  switch (state) {
    case "unsafe":
      return "Needs review";
    case "safe":
      return "No likely match";
    case "resolved":
      return "Resolved";
    case "needs-review":
      return "Needs review";
    default:
      return "Not checked";
  }
}
