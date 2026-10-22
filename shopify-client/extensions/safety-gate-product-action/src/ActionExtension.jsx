/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useCallback, useState } from "preact/hooks";

export default async function () {
  render(<Extension />, document.body);
}

function translate(key) {
  return shopify.i18n.translate(key);
}

function Extension() {
  const { data, close, navigation } = shopify;
  const productId = data?.selected?.[0]?.id;
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const notifyUpdate = useCallback(() => {
    try {
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("safety-gate-product-status");
        channel.postMessage({ productId, timestamp: Date.now() });
        channel.close();
      }
    } catch {
      // ignore
    }
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("safety-gate-status-updated", `${productId}:${Date.now()}`);
      }
    } catch {
      // ignore
    }
  }, [productId]);

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
        throw new Error(payload.error || translate("checkFailed"));
      }

      setResult(payload);
      notifyUpdate();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : translate("checkFailed"));
    } finally {
      setRunning(false);
    }
  }, [productId, running, notifyUpdate]);

  const hasResult = Boolean(result);
  const isMatch = result?.status?.state === "unsafe" || result?.status?.state === "needs-review";

  return (
    <s-admin-action heading={translate("name")} loading={running}>
      {hasResult ? (
        isMatch ? (
          <>
            <s-button
              slot="primary-action"
              variant="primary"
              onClick={() => {
                close();
                navigation?.navigate?.("/app/alerts?status=active");
              }}
            >
              {translate("openReview")}
            </s-button>
            <s-button slot="secondary-actions" variant="secondary" onClick={runCheck} disabled={running} loading={running}>
              {translate("again")}
            </s-button>
            <s-button slot="secondary-actions" onClick={close}>
              {translate("close")}
            </s-button>
          </>
        ) : (
          <>
            <s-button slot="primary-action" variant="primary" onClick={close}>
              {translate("done")}
            </s-button>
            <s-button slot="secondary-actions" variant="secondary" onClick={runCheck} disabled={running} loading={running}>
              {translate("again")}
            </s-button>
          </>
        )
      ) : (
        <>
          <s-button
            slot="primary-action"
            variant="primary"
            disabled={running || !productId}
            loading={running}
            onClick={runCheck}
          >
            {running ? translate("checking") : translate("runCheck")}
          </s-button>
          <s-button slot="secondary-actions" onClick={close}>{translate("close")}</s-button>
        </>
      )}
      <s-box padding="base">
        <s-stack direction="block" gap="base">
          <s-text>
            {translate("description")}
          </s-text>
          {error ? <s-text tone="critical">{error}</s-text> : null}
          {result ? <ResultDetails result={result} /> : null}
        </s-stack>
      </s-box>
    </s-admin-action>
  );
}

function ResultDetails({ result }) {
  const status = result.status || {};
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

  const stateTone = status.state === "unsafe" || status.state === "needs-review"
    ? "critical"
    : status.state === "safe" || status.state === "resolved"
      ? "success"
      : "info";

  const topReason = status.topReason || firstWarning?.reason;
  const recommendation = result.result?.recommendation;

  return (
    <s-stack direction="block" gap="tight">
      <s-stack direction="inline" gap="small" blockAlign="center">
        <s-badge tone={stateTone}>{labelForState(status.state)}</s-badge>
        {riskLevel ? <s-badge tone={status.state === "unsafe" ? "critical" : "warning"}>{`${translate("risk")}: ${riskLevel}`}</s-badge> : null}
      </s-stack>
      {status.checkedAt ? (
        <s-text tone="subdued" size="small">
          {translate("checked")}: {new Date(status.checkedAt).toLocaleString()}
        </s-text>
      ) : null}
      {topReason ? (
        <s-text>
          <strong>{translate("reason")}:</strong> {topReason}
        </s-text>
      ) : null}
      {recommendation ? (
        <details style={{ marginTop: "6px" }}>
          <summary style={{ cursor: "pointer", color: "var(--p-color-text-subdued, #616161)", fontSize: "13px", fontWeight: "500" }}>
            {translate("details")}
          </summary>
          <s-box padding="small" background="bg-surface-subdued" borderRadius="base">
            <s-text>{recommendation}</s-text>
          </s-box>
        </details>
      ) : null}
    </s-stack>
  );
}

function labelForState(state) {
  switch (state) {
    case "unsafe":
    case "needs-review":
      return translate("needsReview");
    case "safe":
      return translate("noMatch");
    case "resolved":
      return translate("resolved");
    default:
      return translate("unchecked");
  }
}
