import { useRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LocalDateTime, useHydrated } from "./LocalDateTime";
import { localizeRisk } from "./AlertBadge";
import { prepareBulkReview } from "../services/bulk-review";
import { isWaitingForSupplier, officialSource } from "../services/review-evidence";

interface Alert {
  id: string;
  productId?: string;
  productTitle: string;
  productImage?: string | null;
  productSku?: string | null;
  riskLevel: string;
  alertType?: string;
  riskDescription?: string;
  status: string;
  warningsCount: number;
  createdAt: string;
  notes?: string | null;
  [key: string]: unknown;
}

// Resolution types for resolve/dismiss actions
export type ResolutionType =
  | "match_not_confirmed"
  | "match_confirmed"
  | "verified_safe" // Product verified as safe after review
  | "removed_from_sale" // Product removed from store
  | "modified_product" // Product modified to address safety concern
  | "contacted_supplier" // Supplier has been contacted
  | "false_positive" // Match was incorrect / not relevant
  | "not_my_product" // Product doesn't match the alert
  | "other"; // Merchant records a different outcome with a required note

interface AlertTableProps {
  alerts: Alert[];
  onBulkAction?: (
    alertIds: string[],
    action: "resolve" | "dismiss",
    resolutionType?: ResolutionType,
    notes?: string,
  ) => void;
  isLoading?: boolean;
  /** Increment only after a bulk save succeeds, never when submitting. */
  bulkSaveVersion?: number;
  bulkSaveFailed?: boolean;
  modalIdPrefix?: string;
  reviewHref: (id: string) => string;
  riskLevelFilter?: string[];
  onRiskLevelChange?: (riskLevels: string[]) => void;
  // Filter props
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  statusFilter?: string[];
  onStatusChange?: (status: string) => void;
  sortBy?: string;
  sortOrder?: string;
  onSortChange?: (sortBy: string, sortOrder: string) => void;
  stats?: {
    active: number;
    waiting: number;
    resolved: number;
    dismissed: number;
    total: number;
  };
  pagination: {
    hasPrevious: boolean;
    hasNext: boolean;
    onPrevious: () => void;
    onNext: () => void;
  };
}

export function AlertTable({
  alerts,
  onBulkAction,
  isLoading = false,
  bulkSaveVersion = 0,
  bulkSaveFailed = false,
  modalIdPrefix = "alert-modal",
  reviewHref,
  riskLevelFilter = [],
  onRiskLevelChange,
  searchValue = "",
  onSearchChange,
  statusFilter = [],
  onStatusChange,
  sortBy = "created",
  sortOrder = "desc",
  onSortChange,
  stats,
  pagination,
}: AlertTableProps) {
  const { t } = useTranslation();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkOutcome, setBulkOutcome] = useState<ResolutionType | "">("");
  const [bulkNote, setBulkNote] = useState("");
  const submittedBulk = useRef(false);
  const previousBulkSaveVersion = useRef(bulkSaveVersion);
  const bulkModalId = `${modalIdPrefix}-bulk-confirmation`;
  useEffect(() => {
    if (previousBulkSaveVersion.current === bulkSaveVersion) return;
    previousBulkSaveVersion.current = bulkSaveVersion;
    if (!submittedBulk.current) return;
    submittedBulk.current = false;
    setSelectedIds([]);
    setBulkOutcome("");
    setBulkNote("");
    (document.getElementById(bulkModalId) as (HTMLElement & { hideOverlay?: () => void }) | null)?.hideOverlay?.();
  }, [bulkSaveVersion, bulkModalId]);
  // Bulk decisions must never include rows hidden by a changed filter.
  const visibleSelectedIds = selectedIds.filter((id) =>
    alerts.some((alert) => alert.id === id),
  );

  // Determine active tab
  const activeTab = statusFilter.length === 1 ? statusFilter[0] : "all";

  const toggleSelectAll = () => {
    if (visibleSelectedIds.length === alerts.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(alerts.map((a) => a.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const confirmBulkDecision = () => {
    if (!onBulkAction || !bulkOutcome || !visibleSelectedIds.length || isLoading) return;
    const decision = prepareBulkReview(alerts, selectedIds, bulkOutcome, bulkNote);
    if (!decision) return;
    submittedBulk.current = true;
    onBulkAction(decision.ids, decision.action, decision.outcome, decision.notes);
  };

  return (
    <s-section
      padding="none"
      accessibilityLabel={t("alerts.table.accessibilityLabel")}
    >
      <s-table
        accessibilityLabel={t("alerts.table.accessibilityLabel")}
        paginate={pagination.hasPrevious || pagination.hasNext}
        hasPreviousPage={pagination.hasPrevious}
        hasNextPage={pagination.hasNext}
        onpreviouspage={pagination.onPrevious}
        onnextpage={pagination.onNext}
      >
        <s-stack slot="filters" gap="small">
          <div className="review-status-filters" role="group" aria-label={t("workspace.currentFindingStatus")}>
            {[
              ["active", "status.needsReview", stats?.active],
              ["waiting_for_supplier", "workspace.waiting", stats?.waiting],
              ["all", "alerts.table.tabs.all", stats?.total],
              ["resolved", "alerts.table.tabs.resolved", stats?.resolved],
              ["dismissed", "alerts.table.tabs.dismissed", stats?.dismissed],
            ].map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                className="review-status-filter"
                aria-pressed={activeTab === value}
                onClick={() => onStatusChange?.(value === "all" ? "" : String(value))}
              >
                {t(String(label))}{typeof count === "number" ? ` (${count})` : ""}
              </button>
            ))}
          </div>

          {/* Search and sort row */}
          <div className="match-list-toolbar">
            <s-text-field
              label={t("alerts.table.searchLabel")}
              labelAccessibilityVisibility="exclusive"
              icon="search"
              placeholder={t("alerts.table.searchPlaceholder")}
              value={searchValue}
              onInput={(e: any) => onSearchChange?.(e.currentTarget.value || "")}
            />
            <s-button variant="secondary" commandFor="risk-filter-popover">
              {t("findingOverview.officialRisk")}{riskLevelFilter.length ? ` (${riskLevelFilter.length})` : ""}
            </s-button>
            <s-popover id="risk-filter-popover">
              <s-box padding="base">
                <s-choice-list
                  label={t("findingOverview.officialRisk")}
                  name="riskLevel"
                  multiple
                  onChange={(event: any) => onRiskLevelChange?.(event.currentTarget.values ?? [])}
                >
                  {Array.from(new Set(["serious", "high", "medium", "low", "other risk", ...riskLevelFilter])).map(value => (
                    <s-choice key={value} value={value} selected={riskLevelFilter.includes(value)}>
                      {localizeRisk(value, t)}
                    </s-choice>
                  ))}
                </s-choice-list>
              </s-box>
            </s-popover>
            <s-button
              variant="secondary"
              accessibilityLabel={t("alerts.table.sort")}
              commandFor="sort-actions-popover"
            >
              {t("alerts.table.sort")}
            </s-button>
            <s-popover id="sort-actions-popover">
              <s-stack gap="none">
                <s-box padding="small">
                  <s-choice-list
                    label={t("alerts.table.sortBy")}
                    labelAccessibilityVisibility="visible"
                    name="sortBy"
                    onChange={(event: any) =>
                      onSortChange?.(
                        event.currentTarget.values?.[0] || "priority",
                        sortOrder,
                      )
                    }
                  >
                    <s-choice value="priority" selected={sortBy === "priority"}>
                      {t("workspace.priority")}
                    </s-choice>
                    <s-choice value="created" selected={sortBy === "created"}>
                      {t("alerts.table.sortOptions.created")}
                    </s-choice>
                    <s-choice value="risk" selected={sortBy === "risk"}>
                      {t("alerts.table.sortOptions.risk")}
                    </s-choice>
                    <s-choice value="name" selected={sortBy === "name"}>
                      {t("alerts.table.sortOptions.name")}
                    </s-choice>
                  </s-choice-list>
                </s-box>
                {sortBy !== "priority" && <s-divider />}
                {sortBy !== "priority" && (
                  <s-box padding="small">
                    <s-choice-list
                      label={t("alerts.table.order")}
                      labelAccessibilityVisibility="visible"
                      name="sortOrder"
                      onChange={(event: any) =>
                        onSortChange?.(
                          sortBy,
                          event.currentTarget.values?.[0] || "desc",
                        )
                      }
                    >
                      <s-choice value="desc" selected={sortOrder === "desc"}>
                        {t("alerts.table.orderOptions.desc")}
                      </s-choice>
                      <s-choice value="asc" selected={sortOrder === "asc"}>
                        {t("alerts.table.orderOptions.asc")}
                      </s-choice>
                    </s-choice-list>
                  </s-box>
                )}
              </s-stack>
            </s-popover>
          </div>
        </s-stack>

        <s-table-header-row>
          <s-table-header>
            <s-checkbox
              accessibilityLabel={t("alerts.table.selectAll")}
              checked={
                visibleSelectedIds.length === alerts.length &&
                alerts.length > 0
              }
              indeterminate={
                visibleSelectedIds.length > 0 &&
                visibleSelectedIds.length < alerts.length
              }
              disabled={isLoading || alerts.length === 0}
              onChange={toggleSelectAll}
            />
          </s-table-header>
          <s-table-header listSlot="primary">
            {t("alerts.table.headers.product")}
          </s-table-header>
          <s-table-header listSlot="inline">
            {t("alerts.table.headers.status")}
          </s-table-header>
          <s-table-header listSlot="labeled">{t("redesign.aiSimilarity")}</s-table-header>
          <s-table-header listSlot="labeled">
            {t("findingOverview.officialRisk")}
          </s-table-header>
          <s-table-header listSlot="labeled">{t("redesign.safetyGateReference")}</s-table-header>
          <s-table-header listSlot="labeled">
            {t("alerts.table.headers.detected")}
          </s-table-header>
          <s-table-header>{t("alerts.table.headers.actions")}</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {alerts.length === 0 ? (
            <s-table-row>
              <s-table-cell colSpan={8}>
                <s-box padding="large">
                  <s-stack gap="small" align="center">
                    <s-text fontWeight="semibold">
                      {activeTab === "active" && stats?.active === 0 && stats?.waiting === 0
                        ? t("alerts.table.emptyAllClearTitle")
                        : t("alerts.table.emptyFilteredTitle")}
                    </s-text>
                  </s-stack>
                </s-box>
              </s-table-cell>
            </s-table-row>
          ) : (
            alerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                href={reviewHref(alert.id)}
                isSelected={visibleSelectedIds.includes(alert.id)}
                isLoading={isLoading}
                onSelect={(id) => { if (!isLoading) toggleSelect(id); }}
              />
            ))
          )}
        </s-table-body>
      </s-table>

      {visibleSelectedIds.length > 0 && onBulkAction && (
        <div className="floating-bulk-actions is-visible" role="region" aria-label={t("reviewUx.bulkTitle")}>
          <span role="status">{t("uxEnhancements.alerts.floating.selectedCount", { count: visibleSelectedIds.length })}</span>
          <s-button variant="secondary" commandFor={bulkModalId} command="--show" disabled={isLoading}>
            {t("reviewUx.bulkTitle")}
          </s-button>
        </div>
      )}
      <s-modal id={bulkModalId} heading={t("reviewUx.bulkTitle")} size="base">
        <s-stack gap="base">
          <s-text>{t("uxEnhancements.alerts.floating.selectedCount", { count: visibleSelectedIds.length })}</s-text>
          <ul className="bulk-review-products">
            {alerts.filter(alert => visibleSelectedIds.includes(alert.id)).map(alert => <li key={alert.id}>{alert.productTitle}</li>)}
          </ul>
          <s-text>{t("workspace.resultHelp")}</s-text>
          <s-select
            label={t("analysis.reviewLayout.outcomeLabel")}
            value={bulkOutcome}
            disabled={isLoading}
            onChange={(event: any) => setBulkOutcome(event.currentTarget.value)}
          >
            <s-option value="">{t("analysis.reviewLayout.chooseOutcome")}</s-option>
            <s-option value="match_not_confirmed">{t("reviewUx.insufficientEvidence")}</s-option>
            <s-option value="not_my_product">{t("reviewUx.confirmedDifferent")}</s-option>
            <s-option value="removed_from_sale">{t("resolveActions.removedFromSale")}</s-option>
            <s-option value="modified_product">{t("resolveActions.modifiedProduct")}</s-option>
          </s-select>
          <p className="admin-helper" role="status">{t(bulkOutcome ? `workspace.outcomeHelp.${bulkOutcome}` : "workspace.chooseOutcomeHelp")}</p>
          <s-text-area
            label={t("reviewUx.sharedNote")}
            value={bulkNote}
            disabled={isLoading}
            onInput={(event: any) => setBulkNote(event.currentTarget.value || "")}
          />
          {bulkSaveFailed && !isLoading && <p role="alert">{t("findingOverview.saveFailed")}</p>}
        </s-stack>
        <s-button slot="primary-action" variant="primary" disabled={!bulkOutcome || !visibleSelectedIds.length || isLoading} loading={isLoading} onClick={confirmBulkDecision}>
          {t("actions.recordDecision")}
        </s-button>
        <s-button slot="secondary-actions" variant="secondary" commandFor={bulkModalId} command="--hide" disabled={isLoading}>
          {t("common.cancel")}
        </s-button>
      </s-modal>

    </s-section>
  );
}

// Separate component for each row to handle event listeners properly
function AlertRow({
  alert,
  href,
  isSelected,
  isLoading,
  onSelect,
}: {
  alert: Alert;
  href: string;
  isSelected: boolean;
  isLoading: boolean;
  onSelect: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();

  const dateLocale = i18n.language === "en" ? "en-GB" : i18n.language;

  const createdDate = new Date(alert.createdAt);
  const [observedAt] = useState(() => Date.now());
  const hydrated = useHydrated();
  const warningsLabel = t("dashboard.recentAlerts.matchCount", {
    count: alert.warningsCount,
  });

  const alertType = alert.alertType?.trim();
  const hasAlertType = alertType && alertType.toLowerCase() !== "unknown";
  const waiting = isWaitingForSupplier(alert);
  const statusTone = alert.status === "active" ? "warning" : "neutral";
  const isSerious = /serious|high|^[12]$/i.test(alert.riskLevel);
  const riskTone = isSerious ? "critical" : "neutral";
  const source = officialSource((alert.alertDetails as { fields?: Record<string, unknown> } | null)?.fields ?? {});

  return (
    <s-table-row selected={isSelected || undefined}>
      <s-table-cell>
        <s-checkbox
          accessibilityLabel={t("alerts.table.selectProduct", {
            title: alert.productTitle,
          })}
          checked={isSelected}
          disabled={isLoading}
          onChange={() => onSelect(alert.id)}
        />
      </s-table-cell>

      {/* Product Cell - Shopify style */}
      <s-table-cell>
        <div className="review-product">
          <s-thumbnail src={alert.productImage || undefined} size="small" alt="" />
          <div className="review-product__content">
            <s-link
              className="review-product__name"
              href={href}
              accessibilityLabel={t("workspace.compareProduct", {
                title: alert.productTitle,
              })}
            >
              <span>{alert.productTitle}</span>
            </s-link>
            {alert.productSku && <s-text tone="subdued" size="small">SKU {alert.productSku}</s-text>}
            {hasAlertType && (
              <s-text tone="subdued" size="small">
                {localizeRisk(alertType, t)}
              </s-text>
            )}
          </div>
        </div>
      </s-table-cell>

      {/* Status Cell */}
      <s-table-cell>
        <s-badge tone={statusTone}>
          {alert.status === "active"
            ? waiting
              ? t("resolveActions.contactPending")
              : t("status.needsReview")
            : alert.status === "resolved"
              ? t("status.resolved")
              : t("status.dismissed")}
        </s-badge>
      </s-table-cell>

      <s-table-cell>
        {alert.matchBasis === "gtin"
          ? <s-badge>{t("barcodeMatch.label")}</s-badge>
          : typeof alert.overallSimilarity === "number"
            ? t("redesign.percent", { value: alert.overallSimilarity })
            : "—"}
      </s-table-cell>
      {/* Risk Cell */}
      <s-table-cell>
        <s-stack gap="small-100">
          <s-stack direction="inline" gap="small-100" alignItems="center">
            <s-badge tone={riskTone}>
              {localizeRisk(alert.riskLevel, t)}
            </s-badge>
          </s-stack>
          {alert.warningsCount > 1 && <s-text tone="subdued" size="small">{warningsLabel}</s-text>}
        </s-stack>
      </s-table-cell>

      <s-table-cell>
        {source.url && source.caseNumber
          ? <s-link href={source.url} target="_blank">{source.caseNumber}</s-link>
          : source.caseNumber || "—"}
      </s-table-cell>

      {/* Date Cell */}
      <s-table-cell>
        <s-text suppressHydrationWarning>
          <LocalDateTime
            value={createdDate}
            format={(date) => formatRelativeDate(date, t, dateLocale)}
          />
          {hydrated &&
            alert.status === "active" &&
            observedAt - createdDate.getTime() >= 7 * 86400000 && (
              <span className="admin-helper review-product__age">
                {t("workspace.oldest", {
                  count: Math.floor(
                    (observedAt - createdDate.getTime()) / 86400000,
                  ),
                })}
              </span>
            )}
        </s-text>
      </s-table-cell>

      {/* Actions Cell */}
      <s-table-cell>
        <s-button
          size="small"
          variant="secondary"
          accessibilityLabel={
            alert.status === "active"
              ? t("alerts.table.reviewProduct", { title: alert.productTitle })
              : t("alerts.table.viewProduct", { title: alert.productTitle })
          }
          href={href}
        >
          {t(alert.status === "active" ? "redesign.review" : "workspace.compare")}
        </s-button>
      </s-table-cell>
    </s-table-row>
  );
}

// Format date as relative (Today, Yesterday, etc.)
export function formatRelativeDate(
  date: Date | string | number,
  t: (key: "dates.today" | "dates.yesterday") => string,
  locale: string,
): string {
  const parsedDate = date instanceof Date ? date : new Date(date);
  if (isNaN(parsedDate.getTime())) {
    return "";
  }
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - parsedDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays === 0) return t("dates.today");
  if (diffDays === 1) return t("dates.yesterday");
  if (diffDays < 30) {
    const days = Math.max(0, diffDays);
    const unit = days < 7 ? "day" : "week";
    const count = unit === "day" ? days : Math.floor(days / 7);
    return new Intl.RelativeTimeFormat(locale || "en", {
      numeric: "auto",
    }).format(-count, unit);
  }
  const resolvedLocale = !locale || locale === "en" ? "en-GB" : locale;
  return parsedDate.toLocaleDateString(resolvedLocale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
