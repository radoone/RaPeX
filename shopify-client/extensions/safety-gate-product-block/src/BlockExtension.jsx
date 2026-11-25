/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

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
      const token = await shopify.auth?.idToken?.();
      const response = await fetch(
        `/api/product-safety-status?productId=${encodeURIComponent(productId)}`,
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(translate("loadFailed"));
      }

      if (!isCancelled?.()) {
        setStatus(payload);
      }
    } catch {
      if (!isCancelled?.()) {
        setError(translate("loadFailed"));
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

  const reviewHref = !error && status?.alertId
    ? `app:/alerts?open=${encodeURIComponent(status.alertId)}`
    : !error && status?.reviewUrl
      ? status.reviewUrl
      : null;

  return (
    <s-admin-block title={translate("name")}>
      <s-box padding="base">
        <s-stack direction="block" gap="base">
          {error ? (
            <s-banner tone="warning">{error}</s-banner>
          ) : status ? (
            <>
              <StatusBadge status={status} />
              <StatusDetails status={status} />
            </>
          ) : <s-text>{translate("loading")}</s-text>}
          <s-stack direction="inline" gap="base">
            {reviewHref ? (
              <s-button
                variant="primary"
                href={reviewHref}
                target={status?.alertId ? undefined : "_blank"}
              >
                {translate("openReview")}
              </s-button>
            ) : null}
            <s-button disabled={!productId} onClick={() => navigation.navigate(`extension:${ACTION_HANDLE}`)}>
              {translate(status?.checkedAt ? "again" : "runCheck")}
            </s-button>
          </s-stack>
        </s-stack>
      </s-box>
    </s-admin-block>
  );
}

function StatusBadge({ status }) {
  const tone = status.state === "resolved"
    ? "success"
    : status.state === "safe" || status.state === "unchecked"
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
      {status.state === "safe" ? <s-text>{translate("noMatchHelp")}</s-text> : null}
      {status.topReason ? <s-paragraph lineClamp={2}>{translate("reason")}: {status.topReason}</s-paragraph> : null}
      {status.riskLevel ? <s-text>{translate("risk")}: {status.riskLevel}</s-text> : null}
    </s-stack>
  );
}

function labelForState(state) {
  switch (state) {
    case "unsafe":
      return translate("needsReview");
    case "changed":
      return translate("changed");
    case "waiting-for-supplier":
      return translate("waiting");
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
