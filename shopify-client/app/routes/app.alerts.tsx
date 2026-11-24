import { useState, useCallback, useEffect, useRef } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  Link,
  useLoaderData,
  useLocation,
  useFetcher,
  useNavigate,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import { data as json } from "react-router";
import { useTranslation } from "react-i18next";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";
import { withOfficialReferences } from "../services/review-evidence.server";
import { isWaitingForSupplier } from "../services/review-evidence";
import { compareReviewPriority } from "../services/review-priority";
import { AlertTable, AlertDetailModal } from "../components";

// Historic findings store either the normalized severity or the original Safety Gate label.
const riskFilterAliases = new Map([
  ["serious", ["Serious", "serious risk", "Serious risk", "1"]],
  ["high", ["High", "high risk", "High risk", "2"]],
  ["medium", ["Medium", "medium risk", "Medium risk", "3"]],
  ["low", ["Low", "low risk", "Low risk", "4"]],
  ["other risk", ["Other risk", "Other Risk"]],
]);

export const headers = boundary.headers;

export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const openAlertId = url.searchParams.get("open") || null;
  const page = Math.max(
    1,
    Number.parseInt(url.searchParams.get("page") || "1") || 1,
  );
  const pageSize = 25;
  const offset = (page - 1) * pageSize;

  const showAllRecords = url.searchParams.get("view") === "all";
  const statusFilters = showAllRecords ? [] : url.searchParams.getAll("status");
  if (!showAllRecords && statusFilters.length === 0) {
    statusFilters.push("active");
  }
  const riskLevelFilters = url.searchParams.getAll("riskLevel");
  const search = url.searchParams.get("search") || undefined;
  const sortByParam = url.searchParams.get("sortBy") || "priority";
  const priorityOrder = sortByParam === "priority";
  const sortOrderParam: "asc" | "desc" =
    url.searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
  const sortField =
    sortByParam === "name"
      ? "productTitle"
      : sortByParam === "risk"
        ? "riskLevel"
        : "createdAt";
  const orderBy = { [sortField]: sortOrderParam };

  const whereClause: any = { shop: session.shop };
  const waitingOnly = statusFilters.includes("waiting_for_supplier");
  if (waitingOnly) whereClause.status = "active";
  else if (statusFilters.length > 0)
    whereClause.status =
      statusFilters.length === 1 ? statusFilters[0] : { in: statusFilters };
  const riskValues = [...new Set(riskLevelFilters.flatMap(value => [value, ...(riskFilterAliases.get(value) ?? [])]))];
  if (riskValues.length) whereClause.riskLevel = riskValues.length === 1 ? riskValues[0] : { in: riskValues };
  if (search) whereClause.productTitle = { contains: search };

  const reviewOnly = statusFilters.length === 1 && statusFilters[0] === "active";
  const filterReviewState = reviewOnly || waitingOnly;
  const paginateInMemory = filterReviewState || priorityOrder;
  const includesEntireActiveQueue = filterReviewState && !search && riskLevelFilters.length === 0;
  const [
    queriedAlerts,
    queriedCount,
    shopActiveFindings,
    resolvedCount,
    dismissedCount,
  ] = await Promise.all([
    db.safetyAlert.findMany({
      where: whereClause,
      ...(priorityOrder ? {} : { orderBy }),
      ...(paginateInMemory ? {} : { skip: offset, take: pageSize }),
    }),
    filterReviewState ? null : db.safetyAlert.count({ where: whereClause }),
    includesEntireActiveQueue ? null : db.safetyAlert.findMany({
      where: { shop: session.shop, status: "active" },
      select: { id: true, status: true, reviewState: true, resolutionType: true, createdAt: true, riskLevel: true, checkResult: true },
    }),
    db.safetyAlert.count({ where: { shop: session.shop, status: "resolved" } }),
    db.safetyAlert.count({ where: { shop: session.shop, status: "dismissed" } }),
  ]);
  const activeFindings = shopActiveFindings ?? queriedAlerts;
  const needsReview = activeFindings.filter(alert => !isWaitingForSupplier(alert));
  const waitingCount = activeFindings.length - needsReview.length;
  const filteredAlerts = filterReviewState
    ? queriedAlerts.filter(alert => isWaitingForSupplier(alert) === waitingOnly)
    : queriedAlerts;
  if (priorityOrder) filteredAlerts.sort(compareReviewPriority);

  const totalCount = queriedCount ?? filteredAlerts.length;
  const totalPages = Math.ceil(totalCount / pageSize);
  const currentPage = paginateInMemory ? Math.min(page, Math.max(1, totalPages)) : page;
  const start = (currentPage - 1) * pageSize;
  const rawAlerts = await withOfficialReferences(
    paginateInMemory ? filteredAlerts.slice(start, start + pageSize) : filteredAlerts,
  );
  const visibleCount = rawAlerts.length;
  if (openAlertId && !rawAlerts.some((alert) => alert.id === openAlertId)) {
    const owned = await db.safetyAlert.findMany({
      where: { shop: session.shop, id: openAlertId },
      take: 1,
    });
    rawAlerts.push(...(await withOfficialReferences(owned)));
  }

  const productIds = rawAlerts
    .map((a: any) => a.productId)
    .filter(Boolean)
    .map((id: string) =>
      id.startsWith("gid://shopify/Product/")
        ? id
        : `gid://shopify/Product/${id}`,
    );

  const productImages: Record<string, string | null> = {};
  const productBrands: Record<string, string | null> = {};
  const productSkus: Record<string, string> = {};
  if (productIds.length > 0) {
    try {
      const response = await admin.graphql(
        `#graphql
        query getProductImages($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              vendor
              featuredImage { url }
              variants(first: 2) { nodes { sku } }
            }
          }
        }`,
        { variables: { ids: productIds } },
      );
      const { data } = await response.json();
      data?.nodes?.forEach((node: any) => {
        if (node?.id) {
          const numericId = node.id.replace("gid://shopify/Product/", "");
          productImages[numericId] = node.featuredImage?.url || null;
          productImages[node.id] = node.featuredImage?.url || null;
          productBrands[numericId] = node.vendor || null;
          productBrands[node.id] = node.vendor || null;
          if (node.variants?.nodes?.length === 1 && node.variants.nodes[0].sku) {
            productSkus[node.id] = productSkus[numericId] = node.variants.nodes[0].sku;
          }
        }
      });
    } catch (error) {
      console.error("Error fetching product images:", error);
    }
  }

  const alerts = rawAlerts.map((alert: any) => {
    let alertType = "Unknown",
      riskDescription = "",
      alertDetails = null,
      riskLevelFromResult = null,
      overallSimilarity = null;
    let matchBasis = "similarity";
    try {
      const checkResult = JSON.parse(alert.checkResult);
      const warnings = Array.isArray(checkResult?.warnings)
        ? checkResult.warnings
        : [];
      if (warnings.length > 0) {
        const first = warnings[0];
        matchBasis = first.matchBasis || "similarity";
        overallSimilarity = matchBasis === "gtin" ? null : first.overallSimilarity ?? null;
        alertType =
          first.alertType ||
          first.alertDetails?.fields?.alert_type ||
          "Unknown";
        riskDescription =
          first.riskLegalProvision ||
          first.alertDetails?.fields?.risk_legal_provision ||
          "";
        alertDetails = first.alertDetails || null;
        // Extract risk level from checkResult (more reliable than DB field for older records)
        riskLevelFromResult =
          first.alertDetails?.fields?.level ||
          first.alertDetails?.fields?.alert_level ||
          first.alertDetails?.fields?.risk_level ||
          first.riskLevel ||
          null;
      }
    } catch {
      // Ignore malformed legacy check payloads and fall back to stored alert fields.
    }
    // Prefer riskLevel from checkResult, fallback to DB field
    const effectiveRiskLevel =
      riskLevelFromResult ||
      (alert.riskLevel !== "unknown" ? alert.riskLevel : null) ||
      "Unknown";
    return {
      ...alert,
      alertType,
      riskDescription,
      alertDetails,
      overallSimilarity,
      matchBasis,
      riskLevel: String(effectiveRiskLevel),
      brand: productBrands[alert.productId] || alert.brand || null,
      productSku: productSkus[alert.productId] || null,
      productImage:
        productImages[alert.productId] ||
        productImages[`gid://shopify/Product/${alert.productId}`] ||
        null,
    };
  });
  const decisionHistory = openAlertId
    ? await db.safetyAlert.listDecisionEvents({
        shop: session.shop,
        alertId: openAlertId,
        take: 10,
      })
    : [];

  return json({
    alerts: alerts.slice(0, visibleCount),
    linkedAlert: alerts[visibleCount] ?? null,
    decisionHistory,
    nextReviewAlertId: (needsReview.sort(compareReviewPriority)[0]?.id as string | undefined) ?? null,
    pagination: {
      currentPage,
      totalPages,
      totalCount,
      hasNext: currentPage < totalPages,
      hasPrevious: currentPage > 1,
    },
    filters: {
      status: statusFilters,
      riskLevel: riskLevelFilters,
      search,
      sortBy: sortByParam,
      sortOrder: sortOrderParam,
      showAllRecords,
      openAlertId,
    },
    stats: {
      active: needsReview.length,
      waiting: waitingCount,
      resolved: resolvedCount,
      dismissed: dismissedCount,
      total: activeFindings.length + resolvedCount + dismissedCount,
    },
    shop: session.shop,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action") as string;
  const alertId = formData.get("alertId") as string;
  const alertIdsJson = formData.get("alertIds") as string;
  const resolutionType = formData.get("resolutionType") as string | null;
  const notes = (formData.get("notes") as string | null)?.trim() || undefined;

  if (
    (action === "resolve" || action === "dismiss") &&
    resolutionType === "other" &&
    !notes
  ) {
    return json(
      { success: false, error: "A note is required for the other outcome" },
      { status: 400 },
    );
  }

  if (resolutionType === "match_confirmed" && (action !== "resolve" || alertIdsJson || !notes)) {
    return json({ success: false, error: "Confirm one finding and include evidence" }, { status: 400 });
  }

  if (action !== "resolve" && action !== "dismiss" && action !== "reactivate") {
    return json({ success: false, error: "Invalid action" }, { status: 400 });
  }

  let ids: string[];
  try {
    ids = alertIdsJson ? (JSON.parse(alertIdsJson) as string[]) : [alertId];
  } catch {
    return json(
      { success: false, error: "Invalid alert selection" },
      { status: 400 },
    );
  }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    return json(
      { success: false, error: "Invalid alert selection" },
      { status: 400 },
    );
  }

  try {
    await db.safetyAlert.recordDecisions({
      shop: session.shop,
      alertIds: ids,
      action,
      actorId: session.id,
      resolutionType,
      notes,
    });
  } catch (error) {
    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not save alert decision",
      },
      { status: 400 },
    );
  }
  return json({
    success: true,
    reviewedAlertId: !alertIdsJson && action !== "reactivate" ? ids[0] : null,
  });
};

export function ErrorBoundary() {
  const error = useRouteError();
  const { t } = useTranslation();

  if (isRouteErrorResponse(error) && error.status === 200) return boundary.error(error);

  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : t("common.unknown");

  return (
    <s-page suppressHydrationWarning heading={t("redesign.potentialMatches")}>

      <div className="admin-stack" style={{ marginTop: "var(--s-space-400)" }}>
        <s-banner tone="critical" heading={t("errors.pageLoadFailed")}>
          <s-text>{title}</s-text>
          <div style={{ marginTop: "var(--s-space-200)" }}>
            <s-button
              onClick={() => window.location.reload()}
              suppressHydrationWarning
            >
              {t("actions.retry")}
            </s-button>
          </div>
        </s-banner>
      </div>
    </s-page>
  );
}

export default function AlertsPage() {
  const { alerts, linkedAlert, decisionHistory, nextReviewAlertId: nextAlertId, pagination, filters, stats, shop } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const location = useLocation();
  const queueParams = new URLSearchParams();
  const locationParams = new URLSearchParams(location.search);
  for (const key of ["view", "status", "search", "riskLevel", "sortBy", "sortOrder", "page"]) {
    for (const value of locationParams.getAll(key)) queueParams.append(key, value);
  }
  const queueHref = queueParams.size ? `/app/alerts?${queueParams}` : "/app/alerts";
  const reviewHref = (id: string) => {
    const params = new URLSearchParams(queueParams);
    params.set("open", id);
    return `/app/alerts?${params}`;
  };
  const selectedAlert = alerts.find(alert => alert.id === filters.openAlertId) ?? linkedAlert;
  const { t } = useTranslation();
  const shopify = useAppBridge();

  const bulkRequest = useRef(false);
  const [bulkSaveVersion, setBulkSaveVersion] = useState(0);
  const [bulkSaveFailed, setBulkSaveFailed] = useState(false);
  const [submittedReview, setSubmittedReview] = useState<{ alertId: string; locationKey: string } | null>(null);
  const reviewReceipt = fetcher.state === "idle" && fetcher.data && "reviewedAlertId" in fetcher.data && fetcher.data.reviewedAlertId
    ? fetcher.data
    : null;
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(searchTimeout.current), [location.key]);
  const [searchValue, setSearchValue] = useState(filters.search || "");
  const [statusFilter, setStatusFilter] = useState<string[]>(
    filters.status || [],
  );
  const [riskLevelFilter, setRiskLevelFilter] = useState<string[]>(
    filters.riskLevel || [],
  );

  const applyFilters = useCallback(
    (overrides?: {
      search?: string;
      status?: string[];
      riskLevel?: string[];
      page?: number;
      sortBy?: string;
      sortOrder?: string;
    }) => {
      clearTimeout(searchTimeout.current);
      const params = new URLSearchParams();
      const s = (overrides?.search ?? searchValue).trim();
      if (s) params.set("search", s);

      // Status filters
      const statusVal =
        overrides && Object.prototype.hasOwnProperty.call(overrides, "status")
          ? overrides.status
          : statusFilter;
      statusVal?.forEach((v) => params.append("status", v));
      if (statusVal?.length === 0) params.set("view", "all");

      // Risk level filters
      const riskVal =
        overrides &&
        Object.prototype.hasOwnProperty.call(overrides, "riskLevel")
          ? overrides.riskLevel
          : riskLevelFilter;
      riskVal?.forEach((v) => params.append("riskLevel", v));

      const sortBy = overrides?.sortBy ?? filters.sortBy;
      const sortOrder = overrides?.sortOrder ?? filters.sortOrder;
      if (sortBy && sortBy !== "priority") params.set("sortBy", sortBy);
      if (sortOrder && sortOrder !== "desc") params.set("sortOrder", sortOrder);
      const p = overrides?.page ?? 1;
      if (p > 1) params.set("page", p.toString());
      const queryString = params.toString();
      navigate(queryString ? `/app/alerts?${queryString}` : "/app/alerts");
    },
    [
      filters.sortBy,
      filters.sortOrder,
      searchValue,
      statusFilter,
      riskLevelFilter,
      navigate,
    ],
  );

  const handleAlertAction = useCallback(
    (
      alertId: string,
      action: string,
      resolutionType?: string,
      notes?: string,
    ) => {
      setSubmittedReview({ alertId, locationKey: location.key });
      fetcher.submit(
        {
          action,
          alertId,
          resolutionType: resolutionType || "",
          notes: notes || "",
        },
        { method: "POST" },
      );
    },
    [fetcher, location.key],
  );

  const handleBulkAction = useCallback(
    (alertIds: string[], action: string, resolutionType?: string, notes?: string) => {
      bulkRequest.current = true;
      setBulkSaveFailed(false);
      setSubmittedReview(null);
      fetcher.submit(
        {
          action,
          alertIds: JSON.stringify(alertIds),
          resolutionType: resolutionType || "",
          notes: notes || "",
        },
        { method: "POST" },
      );
    },
    [fetcher],
  );

  useEffect(() => {
    setSearchValue(filters.search || "");
    setStatusFilter(filters.status || []);
    setRiskLevelFilter(filters.riskLevel || []);
  }, [filters]);

  useEffect(() => {
    if (bulkRequest.current && fetcher.state === "idle" && fetcher.data) {
      bulkRequest.current = false;
      if (fetcher.data.success) setBulkSaveVersion(version => version + 1);
      else setBulkSaveFailed(true);
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (reviewReceipt?.reviewedAlertId) {
      document.getElementById("decision-saved")?.focus();
    } else if (fetcher.state === "idle" && fetcher.data?.success) {
      shopify.toast.show(t("alerts.toasts.updated"));
    }
  }, [fetcher.data, fetcher.state, reviewReceipt, shopify, t]);

  const needsDecision = stats.active > 0;
  const hasOpenFindings = needsDecision || stats.waiting > 0;
  const queueTone = hasOpenFindings ? "warning" : "success";
  const queueHeading = needsDecision
    ? t("dashboard.admin.status.reviewNeeded.title", { count: stats.active })
    : stats.waiting > 0
      ? `${t("workspace.waiting")} (${stats.waiting})`
      : t("dashboard.admin.status.noActionNeeded.title");

  if (filters.openAlertId) {
    const submittedHere = submittedReview?.locationKey === location.key && submittedReview.alertId === selectedAlert?.id;
    const decisionSaved = submittedHere && reviewReceipt?.reviewedAlertId === selectedAlert?.id && Boolean(reviewReceipt);
    const decisionFailed = submittedHere && fetcher.state === "idle" && fetcher.data?.success === false;
    const destination = selectedAlert && (
      isWaitingForSupplier(selectedAlert)
        ? { status: "waiting_for_supplier", label: "workspace.waiting" }
        : selectedAlert.status === "resolved"
          ? { status: "resolved", label: "alerts.table.tabs.resolved" }
          : selectedAlert.status === "dismissed"
            ? { status: "dismissed", label: "alerts.table.tabs.dismissed" }
            : null
    );
    const destinationLabel = destination && t(destination.label);
    return (
      <s-page inlineSize="large" heading={t("redesign.matchReview")}>
        <Link to={queueHref} className="review-queue-link">{t("redesign.potentialMatches")}</Link>
        {decisionSaved && (
          <div id="decision-saved" tabIndex={-1} role="status">
            <s-banner tone="success" heading={t("analysis.decisionRecorded")}>
              {destination && destinationLabel && (
                <s-stack gap="small">
                  <s-text>{t("decisionDestination", { status: destinationLabel })}</s-text>
                  <Link to={`/app/alerts?status=${destination.status}`} className="review-queue-link">
                    {t("viewDecisionDestination", { status: destinationLabel })}
                  </Link>
                </s-stack>
              )}
            </s-banner>
          </div>
        )}
        {decisionFailed && selectedAlert?.status !== "active" && (
          <s-banner tone="critical" heading={t("findingOverview.saveFailed")} />
        )}
        {selectedAlert ? (
          <AlertDetailModal
            key={selectedAlert.id}
            inline
            alert={{ ...selectedAlert, shop: selectedAlert.shop || shop }}
            decisionHistory={decisionHistory}
            modalId={`alert-detail-${selectedAlert.id}`}
            onDismiss={(id, outcome, notes) => handleAlertAction(id, "dismiss", outcome, notes)}
            onResolve={(id, outcome, notes) => handleAlertAction(id, "resolve", outcome, notes)}
            onReactivate={id => handleAlertAction(id, "reactivate")}
            decisionSaveFailed={decisionFailed}
            isLoading={fetcher.state !== "idle"}
          />
        ) : (
          <s-banner tone="warning" heading={t("errors.pageLoadFailed")}>
            <Link to={queueHref} className="review-queue-link">{t("redesign.potentialMatches")}</Link>
          </s-banner>
        )}
      </s-page>
    );
  }

  return (
    <s-page inlineSize="large" className="page-shell" suppressHydrationWarning heading={t("redesign.potentialMatches")}>
      {!hasOpenFindings && (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() => navigate("/app/manual-check")}
        >
          {t("nav.catalogCoverage")}
        </s-button>
      )}
      <s-button
        slot="secondary-actions"
        variant="secondary"
        onClick={() => navigate("/app/audit-report")}
        suppressHydrationWarning
      >
        {t("workspace.reportTitle")}
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        onClick={() => navigate("/app/evidence")}
        suppressHydrationWarning
      >
        {t("actions.viewEvidence")}
      </s-button>

      <div className="admin-stack">
        <div id="decision-saved" tabIndex={-1}>
          <s-banner tone={queueTone} heading={queueHeading}>
            {!hasOpenFindings && reviewReceipt && <s-text>{t("analysis.decisionRecorded")}</s-text>}
            {hasOpenFindings && (reviewReceipt || nextAlertId) && (
              <div className="review-queue-summary">
                {(reviewReceipt || stats.waiting > 0) && (
                  <s-stack gap="small-200">
                    {reviewReceipt && <s-text>{t("analysis.decisionRecorded")}</s-text>}
                    {needsDecision && stats.waiting > 0 && (
                      <s-text>{t("workspace.waiting")} ({stats.waiting})</s-text>
                    )}
                  </s-stack>
                )}
                {nextAlertId && (
                  <s-button
                    variant="primary"
                    href={reviewHref(nextAlertId)}
                    disabled={fetcher.state !== "idle"}
                  >
                    {t("catalogOverview.reviewNext")}
                  </s-button>
                )}
              </div>
            )}
          </s-banner>
        </div>

        <AlertTable
          alerts={alerts}
          onBulkAction={handleBulkAction}
          isLoading={fetcher.state !== "idle"}
          bulkSaveVersion={bulkSaveVersion}
          bulkSaveFailed={bulkSaveFailed}
          modalIdPrefix="alert-detail"
          reviewHref={reviewHref}
          searchValue={searchValue}
          onSearchChange={(value) => {
            setSearchValue(value);
            clearTimeout(searchTimeout.current);
            searchTimeout.current = setTimeout(() => applyFilters({ search: value }), 300);
          }}
          statusFilter={statusFilter}
          riskLevelFilter={riskLevelFilter}
          onRiskLevelChange={riskLevel => {
            setRiskLevelFilter(riskLevel);
            applyFilters({ riskLevel });
          }}
          onStatusChange={(status) => {
            const newFilter = status ? [status] : [];
            setStatusFilter(newFilter);
            setRiskLevelFilter([]);
            applyFilters({ status: newFilter, riskLevel: [] });
          }}
          sortBy={filters.sortBy}
          sortOrder={filters.sortOrder}
          onSortChange={(sortBy, sortOrder) =>
            applyFilters({ sortBy, sortOrder })
          }
          stats={stats}
          pagination={{
            hasNext: pagination.hasNext,
            hasPrevious: pagination.hasPrevious,
            onPrevious: () => applyFilters({ page: pagination.currentPage - 1 }),
            onNext: () => applyFilters({ page: pagination.currentPage + 1 }),
          }}
        />
      </div>

    </s-page>
  );
}
