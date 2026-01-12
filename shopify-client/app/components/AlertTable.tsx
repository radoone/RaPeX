import { useRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface Alert {
  id: string;
  productId?: string;
  productTitle: string;
  productImage?: string | null;
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
  | 'verified_safe'      // Product verified as safe after review
  | 'removed_from_sale'  // Product removed from store
  | 'modified_product'   // Product modified to address safety concern
  | 'contacted_supplier' // Supplier has been contacted
  | 'false_positive'     // Match was incorrect / not relevant
  | 'not_my_product';    // Product doesn't match the alert

interface AlertTableProps {
  alerts: Alert[];
  onViewDetails: (alert: Alert) => void;
  onDismiss?: (alertId: string, resolutionType?: ResolutionType) => void;
  onResolve?: (alertId: string, resolutionType?: ResolutionType) => void;
  onReactivate?: (alertId: string) => void;
  isLoading?: boolean;
  showProductLink?: boolean;
  modalIdPrefix?: string;
  // Filter props
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  statusFilter?: string[];
  onStatusChange?: (status: string) => void;
  stats?: { active: number; resolved: number; dismissed: number; total: number };
}

export function AlertTable({
  alerts,
  onViewDetails,
  onDismiss,
  onResolve,
  onReactivate,
  isLoading = false,
  showProductLink = false,
  modalIdPrefix = "alert-modal",
  searchValue = "",
  onSearchChange,
  statusFilter = [],
  onStatusChange,
  stats,
}: AlertTableProps) {
  const { t } = useTranslation();
  const [sortBy, setSortBy] = useState<string>("created");
  const [sortOrder, setSortOrder] = useState<string>("desc");

  // Determine active tab
  const activeTab = statusFilter.length === 1 ? statusFilter[0] : "all";

  return (
    <s-section padding="none" accessibilityLabel={t('alerts.table.accessibilityLabel')}>
      {/* Filters above table */}
      <s-stack gap="small" style={{ paddingBottom: 'var(--s-space-base)' }}>
        {/* Tabs for status */}
        <s-stack direction="inline" gap="none">
          <s-button
            variant={activeTab === "all" ? "secondary" : "tertiary"}
            size="small"
            onClick={() => onStatusChange?.("")}
          >
            {t('alerts.table.tabs.all')} {stats ? `(${stats.total})` : ""}
          </s-button>
          <s-button
            variant={activeTab === "active" ? "secondary" : "tertiary"}
            size="small"
            onClick={() => onStatusChange?.("active")}
          >
            {t('alerts.table.tabs.active')} {stats?.active ? `(${stats.active})` : ""}
          </s-button>
          <s-button
            variant={activeTab === "resolved" ? "secondary" : "tertiary"}
            size="small"
            onClick={() => onStatusChange?.("resolved")}
          >
            {t('alerts.table.tabs.resolved')} {stats?.resolved ? `(${stats.resolved})` : ""}
          </s-button>
          <s-button
            variant={activeTab === "dismissed" ? "secondary" : "tertiary"}
            size="small"
            onClick={() => onStatusChange?.("dismissed")}
          >
            {t('alerts.table.tabs.dismissed')} {stats?.dismissed ? `(${stats.dismissed})` : ""}
          </s-button>
        </s-stack>

        {/* Search and sort row */}
        <s-grid gap="small-200" gridTemplateColumns="1fr auto">
          <s-text-field
            label={t('alerts.table.searchLabel')}
            labelAccessibilityVisibility="exclusive"
            icon="search"
            placeholder={t('alerts.table.searchPlaceholder')}
            value={searchValue}
            onInput={(e: any) => onSearchChange?.(e.currentTarget.value || "")}
          />
          <s-button
            variant="secondary"
            accessibilityLabel={t('alerts.table.sort')}
            commandFor="sort-actions-popover"
          >
            {t('alerts.table.sort')}
          </s-button>
          <s-popover id="sort-actions-popover">
            <s-stack gap="none">
              <s-box padding="small">
                <s-choice-list label={t('alerts.table.sortBy')} name="sortBy">
                  <s-choice value="created" selected={sortBy === "created"} onClick={() => setSortBy("created")}>
                    {t('alerts.table.sortOptions.created')}
                  </s-choice>
                  <s-choice value="risk" selected={sortBy === "risk"} onClick={() => setSortBy("risk")}>
                    {t('alerts.table.sortOptions.risk')}
                  </s-choice>
                  <s-choice value="name" selected={sortBy === "name"} onClick={() => setSortBy("name")}>
                    {t('alerts.table.sortOptions.name')}
                  </s-choice>
                </s-choice-list>
              </s-box>
              <s-divider />
              <s-box padding="small">
                <s-choice-list label={t('alerts.table.order')} name="sortOrder">
                  <s-choice value="desc" selected={sortOrder === "desc"} onClick={() => setSortOrder("desc")}>
                    {t('alerts.table.orderOptions.desc')}
                  </s-choice>
                  <s-choice value="asc" selected={sortOrder === "asc"} onClick={() => setSortOrder("asc")}>
                    {t('alerts.table.orderOptions.asc')}
                  </s-choice>
                </s-choice-list>
              </s-box>
            </s-stack>
          </s-popover>
        </s-grid>
      </s-stack>

      <s-table>
        <s-table-header-row>
          <s-table-header listSlot="primary">{t('alerts.table.headers.product')}</s-table-header>
          <s-table-header listSlot="inline">{t('alerts.table.headers.status')}</s-table-header>
          <s-table-header listSlot="labeled">{t('alerts.table.headers.risk')}</s-table-header>
          <s-table-header listSlot="labeled">{t('alerts.table.headers.detected')}</s-table-header>
          <s-table-header>{t('alerts.table.headers.actions')}</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {alerts.length === 0 ? (
            <s-table-row>
              <s-table-cell colSpan={5}>
                <s-box padding="large">
                  <s-stack gap="small" align="center">
                    <s-text tone="subdued">{t('alerts.table.empty')}</s-text>
                  </s-stack>
                </s-box>
              </s-table-cell>
            </s-table-row>
          ) : (
            alerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                onViewDetails={onViewDetails}
                onDismiss={onDismiss}
                onResolve={onResolve}
                onReactivate={onReactivate}
                isLoading={isLoading}
                showProductLink={showProductLink}
                modalId={`${modalIdPrefix}-${alert.id}`}
              />
            ))
          )}
        </s-table-body>
      </s-table>
    </s-section>
  );
}

// Separate component for each row to handle event listeners properly
function AlertRow({
  alert,
  onViewDetails,
  onDismiss,
  onResolve,
  onReactivate,
  isLoading,
  showProductLink,
  modalId,
}: {
  alert: Alert;
  onViewDetails: (alert: Alert) => void;
  onDismiss?: (alertId: string, resolutionType?: ResolutionType) => void;
  onResolve?: (alertId: string, resolutionType?: ResolutionType) => void;
  onReactivate?: (alertId: string) => void;
  isLoading: boolean;
  showProductLink: boolean;
  modalId: string;
}) {
  const { t, i18n } = useTranslation();
  const viewBtnRef = useRef<HTMLElement>(null);
  const reactivateBtnRef = useRef<HTMLElement>(null);

  // Refs for resolve action buttons
  const verifiedSafeBtnRef = useRef<HTMLElement>(null);
  const removedFromSaleBtnRef = useRef<HTMLElement>(null);
  const modifiedProductBtnRef = useRef<HTMLElement>(null);
  const contactedSupplierBtnRef = useRef<HTMLElement>(null);

  // Refs for dismiss action buttons
  const falsePositiveBtnRef = useRef<HTMLElement>(null);
  const notMyProductBtnRef = useRef<HTMLElement>(null);

  const dateLocale = i18n.language === 'sk' ? 'sk-SK' : 'en-GB';
  const menuId = `resolve-menu-${alert.id}`;

  // View button handler
  useEffect(() => {
    const btn = viewBtnRef.current;
    if (!btn) return;
    const handleClick = () => onViewDetails(alert);
    btn.addEventListener('click', handleClick);
    return () => btn.removeEventListener('click', handleClick);
  }, [alert, onViewDetails]);

  // Resolve action handlers
  useEffect(() => {
    const handlers = [
      { ref: verifiedSafeBtnRef, type: 'verified_safe' as ResolutionType, action: onResolve },
      { ref: removedFromSaleBtnRef, type: 'removed_from_sale' as ResolutionType, action: onResolve },
      { ref: modifiedProductBtnRef, type: 'modified_product' as ResolutionType, action: onResolve },
      { ref: contactedSupplierBtnRef, type: 'contacted_supplier' as ResolutionType, action: onResolve },
      { ref: falsePositiveBtnRef, type: 'false_positive' as ResolutionType, action: onDismiss },
      { ref: notMyProductBtnRef, type: 'not_my_product' as ResolutionType, action: onDismiss },
    ];

    const cleanups: (() => void)[] = [];

    handlers.forEach(({ ref, type, action }) => {
      const btn = ref.current;
      if (!btn) return;
      const handleClick = () => action?.(alert.id, type);
      btn.addEventListener('click', handleClick);
      cleanups.push(() => btn.removeEventListener('click', handleClick));
    });

    return () => cleanups.forEach(cleanup => cleanup());
  }, [alert.id, onResolve, onDismiss]);

  // Reactivate button handler
  useEffect(() => {
    const btn = reactivateBtnRef.current;
    if (!btn) return;
    const handleClick = () => onReactivate?.(alert.id);
    btn.addEventListener('click', handleClick);
    return () => btn.removeEventListener('click', handleClick);
  }, [alert.id, onReactivate]);

  const adminProductId = alert.productId?.replace('gid://shopify/Product/', '') || '';
  const createdDate = new Date(alert.createdAt);
  const warningsLabel = t('dashboard.recentAlerts.matchCount', { count: alert.warningsCount });

  // Badge tones
  const statusTone = alert.status === 'active' ? 'critical' : alert.status === 'resolved' ? 'success' : 'neutral';
  const riskTone = alert.riskLevel?.toLowerCase().includes('serious') ? 'critical'
    : alert.riskLevel?.toLowerCase().includes('high') ? 'warning' : 'info';

  return (
    <s-table-row>
      {/* Product Cell - Shopify style */}
      <s-table-cell>
        <s-stack direction="inline" gap="small" alignItems="center">
          {alert.productImage ? (
            <s-clickable
              href={showProductLink && adminProductId ? `shopify:admin/products/${adminProductId}` : undefined}
              accessibilityLabel={t('alerts.table.thumbnailLabel', { title: alert.productTitle })}
              border="base"
              borderRadius="base"
              overflow="hidden"
              inlineSize="40px"
              blockSize="40px"
            >
              <s-image
                objectFit="cover"
                src={alert.productImage}
              />
            </s-clickable>
          ) : (
            <s-box
              background="bg-surface-secondary"
              borderRadius="base"
              inlineSize="40px"
              blockSize="40px"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <s-text tone="subdued" size="small">📦</s-text>
            </s-box>
          )}
          <s-stack gap="small-100">
            {showProductLink && adminProductId ? (
              <s-link href={`shopify:admin/products/${adminProductId}`}>
                {alert.productTitle}
              </s-link>
            ) : (
              <s-text fontWeight="semibold">{alert.productTitle}</s-text>
            )}
            {alert.alertType && (
              <s-text tone="subdued" size="small">{alert.alertType}</s-text>
            )}
          </s-stack>
        </s-stack>
      </s-table-cell>

      {/* Status Cell */}
      <s-table-cell>
        <s-badge tone={statusTone}>
          {alert.status === 'active'
            ? t('status.needsReview')
            : alert.status === 'resolved'
              ? t('status.resolved')
              : t('status.dismissed')}
        </s-badge>
      </s-table-cell>

      {/* Risk Cell */}
      <s-table-cell>
        <s-stack gap="small-100">
          <s-badge tone={riskTone}>
            {alert.riskLevel || t('common.unknown')}
          </s-badge>
          <s-text tone="subdued" size="small">{warningsLabel}</s-text>
        </s-stack>
      </s-table-cell>

      {/* Date Cell */}
      <s-table-cell>
        <s-text suppressHydrationWarning>
          {formatRelativeDate(createdDate, t, dateLocale)}
        </s-text>
      </s-table-cell>

      {/* Actions Cell */}
      <s-table-cell>
        <s-stack direction="inline" gap="small-200">
          <s-button
            ref={viewBtnRef}
            size="small"
            variant="secondary"
            commandFor={modalId}
            command="--show"
          >
            {t('actions.view')}
          </s-button>
          {alert.status === 'active' && (
            <>
              <s-button
                size="small"
                variant="primary"
                commandFor={menuId}
                loading={isLoading || undefined}
              >
                {t('actions.resolve')} ▾
              </s-button>
              <s-menu id={menuId} accessibilityLabel={t('resolveActions.menuLabel')}>
                <s-section heading={t('resolveActions.actionTaken')}>
                  <s-button ref={verifiedSafeBtnRef} icon="checkmark">
                    {t('resolveActions.verifiedSafe')}
                  </s-button>
                  <s-button ref={removedFromSaleBtnRef} icon="delete">
                    {t('resolveActions.removedFromSale')}
                  </s-button>
                  <s-button ref={modifiedProductBtnRef} icon="edit">
                    {t('resolveActions.modifiedProduct')}
                  </s-button>
                  <s-button ref={contactedSupplierBtnRef} icon="email">
                    {t('resolveActions.contactedSupplier')}
                  </s-button>
                </s-section>
                <s-section heading={t('resolveActions.noActionNeeded')}>
                  <s-button ref={falsePositiveBtnRef}>
                    {t('resolveActions.falsePositive')}
                  </s-button>
                  <s-button ref={notMyProductBtnRef}>
                    {t('resolveActions.notMyProduct')}
                  </s-button>
                </s-section>
              </s-menu>
            </>
          )}
          {(alert.status === 'dismissed' || alert.status === 'resolved') && (
            <s-button
              ref={reactivateBtnRef}
              size="small"
              variant="tertiary"
              loading={isLoading || undefined}
              icon="undo"
            >
              {t('actions.reactivate')}
            </s-button>
          )}
        </s-stack>
      </s-table-cell>
    </s-table-row>
  );
}

// Format date as relative (Today, Yesterday, etc.)
export function formatRelativeDate(
  date: Date,
  t: (key: string, options?: Record<string, any>) => string,
  locale: string
): string {
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return t('dates.today');
  if (diffDays === 1) return t('dates.yesterday');
  if (diffDays < 7) return t('dates.daysAgo', { count: diffDays });
  if (diffDays < 30) return t('dates.weeksAgo', { count: Math.floor(diffDays / 7) });
  return date.toLocaleDateString(locale);
}
