/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

const ACTION_HANDLE = "safety-gate-product-action";

export default async function () {
  render(<Extension />, document.body);
}

function translate(key) {
  return shopify.i18n.translate(key);
}

function Extension() {
  const { data, navigation } = shopify;
  const productId = data?.selected?.[0]?.id;
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async (isCancelled) => {
    try {
      if (!productId) return;
      setError("");
      const response = await fetch(
        `/api/product-safety-status?productId=${encodeURIComponent(productId)}`,
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || translate("loadFailed"));
      }

      if (!isCancelled?.()) {
        setStatus(payload);
      }
    } catch (loadError) {
      if (!isCancelled?.()) {
        setError(loadError instanceof Error ? loadError.message : translate("loadFailed"));
      }
    }
  }, [productId]);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    loadStatus(isCancelled);

    let channel;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel("safety-gate-product-status");
        channel.onmessage = (event) => {
          if (!event?.data?.productId || event.data.productId === productId) {
            loadStatus(isCancelled);
          }
        };
      }
    } catch {
      // ignore
    }

    const handleStorage = (event) => {
      if (event.key === "safety-gate-status-updated") {
        loadStatus(isCancelled);
      }
    };
    globalThis.addEventListener?.("storage", handleStorage);

    const handleFocus = () => {
      loadStatus(isCancelled);
    };
    globalThis.addEventListener?.("focus", handleFocus);

    return () => {
      cancelled = true;
      if (channel) {
        channel.close();
      }
      globalThis.removeEventListener?.("storage", handleStorage);
      globalThis.removeEventListener?.("focus", handleFocus);
    };
  }, [productId, loadStatus]);

  const summary = useMemo(() => {
    if (error) {
      return translate("unavailable");
    }

    if (!status) {
      return translate("loading");
    }

    return labelForState(status.state);
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
            <s-button disabled={!productId} onClick={() => navigation.navigate(`extension:${ACTION_HANDLE}`)}>
              {translate("runCheck")}
            </s-button>
            {status?.alertId ? (
              <s-button variant="secondary" onClick={() => navigation.navigate("/app/alerts?status=active")}>
                {translate("openReview")}
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
        <s-text>{translate("checked")}: {new Date(status.checkedAt).toLocaleString()}</s-text>
      ) : null}
      {status.topReason ? <s-paragraph lineClamp={2}>{translate("reason")}: {status.topReason}</s-paragraph> : null}
      {status.riskLevel ? <s-text>{translate("risk")}: {status.riskLevel}</s-text> : null}
    </s-stack>
  );
}

function labelForState(state) {
  switch (state) {
    case "unsafe":
      return translate("needsReview");
    case "safe":
      return translate("noMatch");
    case "resolved":
      return translate("resolved");
    case "needs-review":
      return translate("needsReview");
    default:
      return translate("unchecked");
  }
}
