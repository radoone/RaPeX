import { useRef, useEffect, useState } from "react";
import { useNavigate } from "@remix-run/react";

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

interface AlertTableProps {
  alerts: Alert[];
  onViewDetails: (alert: Alert) => void;
  onDismiss?: (alertId: string) => void;
  onResolve?: (alertId: string) => void;
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
  const [sortBy, setSortBy] = useState<string>("created");
  const [sortOrder, setSortOrder] = useState<string>("desc");

  // Determine active tab
  const activeTab = statusFilter.length === 1 ? statusFilter[0] : "all";

  return (
    <s-section padding="none" accessibilityLabel="Safety alerts table">
      <s-table>
        {/* Filters slot - like Shopify Index Table */}
        <s-stack slot="filters" gap="small">
          {/* Tabs for status */}
          <s-stack direction="inline" gap="none">
            <s-button
              variant={activeTab === "all" ? "secondary" : "tertiary"}
              size="small"
              onClick={() => onStatusChange?.("")}
            >
              All {stats ? `(${stats.total})` : ""}
            </s-button>
            <s-button
              variant={activeTab === "active" ? "secondary" : "tertiary"}
              size="small"
              onClick={() => onStatusChange?.("active")}
            >
              Active {stats?.active ? `(${stats.active})` : ""}
            </s-button>
            <s-button
              variant={activeTab === "resolved" ? "secondary" : "tertiary"}
              size="small"
              onClick={() => onStatusChange?.("resolved")}
            >
              Resolved {stats?.resolved ? `(${stats.resolved})` : ""}
            </s-button>
            <s-button
              variant={activeTab === "dismissed" ? "secondary" : "tertiary"}
              size="small"
              onClick={() => onStatusChange?.("dismissed")}
            >
              Dismissed {stats?.dismissed ? `(${stats.dismissed})` : ""}
            </s-button>
          </s-stack>

          {/* Search and sort row */}
          <s-grid gap="small-200" gridTemplateColumns="1fr auto">
            <s-text-field
              label="Search alerts"
              labelAccessibilityVisibility="exclusive"
              icon="search"
              placeholder="Search by product name..."
              value={searchValue}
              onInput={(e: any) => onSearchChange?.(e.currentTarget.value || "")}
            />
            <s-button
              variant="secondary"
              accessibilityLabel="Sort"
              commandFor="sort-actions-popover"
            >
              Sort
            </s-button>
            <s-popover id="sort-actions-popover">
              <s-stack gap="none">
                <s-box padding="small">
                  <s-choice-list label="Sort by" name="sortBy">
                    <s-choice value="created" selected={sortBy === "created"} onClick={() => setSortBy("created")}>
                      Date detected
                    </s-choice>
                    <s-choice value="risk" selected={sortBy === "risk"} onClick={() => setSortBy("risk")}>
                      Risk level
                    </s-choice>
                    <s-choice value="name" selected={sortBy === "name"} onClick={() => setSortBy("name")}>
                      Product name
                    </s-choice>
                  </s-choice-list>
                </s-box>
                <s-divider />
                <s-box padding="small">
                  <s-choice-list label="Order" name="sortOrder">
                    <s-choice value="desc" selected={sortOrder === "desc"} onClick={() => setSortOrder("desc")}>
                      Newest first
                    </s-choice>
                    <s-choice value="asc" selected={sortOrder === "asc"} onClick={() => setSortOrder("asc")}>
                      Oldest first
                    </s-choice>
                  </s-choice-list>
                </s-box>
              </s-stack>
            </s-popover>
          </s-grid>
        </s-stack>

        <s-table-header-row>
          <s-table-header listSlot="primary">Product</s-table-header>
          <s-table-header listSlot="inline">Status</s-table-header>
          <s-table-header listSlot="labeled">Risk</s-table-header>
          <s-table-header listSlot="labeled">Detected</s-table-header>
          <s-table-header>Actions</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {alerts.length === 0 ? (
            <s-table-row>
              <s-table-cell colSpan={5}>
                <s-box padding="large">
                  <s-stack gap="small" align="center">
                    <s-text tone="subdued">No alerts matching your filters</s-text>
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
  onDismiss?: (alertId: string) => void;
  onResolve?: (alertId: string) => void;
  onReactivate?: (alertId: string) => void;
  isLoading: boolean;
  showProductLink: boolean;
  modalId: string;
}) {
  const viewBtnRef = useRef<HTMLElement>(null);
  const dismissBtnRef = useRef<HTMLElement>(null);
  const resolveBtnRef = useRef<HTMLElement>(null);
  const reactivateBtnRef = useRef<HTMLElement>(null);

  // View button handler
  useEffect(() => {
    const btn = viewBtnRef.current;
    if (!btn) return;
    const handleClick = () => onViewDetails(alert);
    btn.addEventListener('click', handleClick);
    return () => btn.removeEventListener('click', handleClick);
  }, [alert, onViewDetails]);

  // Dismiss button handler
  useEffect(() => {
    const btn = dismissBtnRef.current;
    if (!btn) return;
    const handleClick = () => onDismiss?.(alert.id);
    btn.addEventListener('click', handleClick);
    return () => btn.removeEventListener('click', handleClick);
  }, [alert.id, onDismiss]);

  // Resolve button handler
  useEffect(() => {
    const btn = resolveBtnRef.current;
    if (!btn) return;
    const handleClick = () => onResolve?.(alert.id);
    btn.addEventListener('click', handleClick);
    return () => btn.removeEventListener('click', handleClick);
  }, [alert.id, onResolve]);

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
  const warningsLabel = `${alert.warningsCount} ${alert.warningsCount === 1 ? "match" : "matches"}`;

  // Badge tones
  const statusTone = alert.status === 'active' ? 'critical' : alert.status === 'resolved' ? 'success' : 'neutral';
  const riskTone = alert.riskLevel?.toLowerCase().includes('serious') ? 'critical' 
    : alert.riskLevel?.toLowerCase().includes('high') ? 'warning' : 'info';

  const checkboxId = `alert-checkbox-${alert.id}`;

  return (
    <s-table-row clickDelegate={checkboxId}>
      {/* Product Cell - Shopify style */}
      <s-table-cell>
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-checkbox id={checkboxId} />
          {alert.productImage ? (
            <s-clickable
              href={showProductLink && adminProductId ? `shopify:admin/products/${adminProductId}` : undefined}
              accessibilityLabel={`${alert.productTitle} thumbnail`}
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
          {alert.status.charAt(0).toUpperCase() + alert.status.slice(1)}
        </s-badge>
      </s-table-cell>

      {/* Risk Cell */}
      <s-table-cell>
        <s-stack gap="small-100">
          <s-badge tone={riskTone}>
            {alert.riskLevel || 'Unknown'}
          </s-badge>
          <s-text tone="subdued" size="small">{warningsLabel}</s-text>
        </s-stack>
      </s-table-cell>

      {/* Date Cell */}
      <s-table-cell>
        <s-text suppressHydrationWarning>
          {formatRelativeDate(createdDate)}
        </s-text>
      </s-table-cell>

      {/* Actions Cell */}
      <s-table-cell>
        <s-stack direction="inline" gap="small-200">
          <s-button 
            ref={viewBtnRef}
            size="small" 
            variant="tertiary"
            commandFor={modalId}
            command="--show"
          >
            View
          </s-button>
          {alert.status === 'active' && (
            <s-button 
              ref={resolveBtnRef} 
              size="small" 
              variant="primary" 
              loading={isLoading || undefined}
            >
              Resolve
            </s-button>
          )}
        </s-stack>
      </s-table-cell>
    </s-table-row>
  );
}

// Format date as relative (Today, Yesterday, etc.)
function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString("en-GB");
}
