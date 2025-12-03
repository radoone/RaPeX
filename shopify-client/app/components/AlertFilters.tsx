import { useState } from "react";

interface AppliedFilter {
  key: string;
  label: string;
  onRemove: () => void;
}

interface AlertFiltersProps {
  searchValue: string;
  statusFilter: string[];
  riskLevelFilter: string[];
  appliedFilters: AppliedFilter[];
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: string[]) => void;
  onRiskLevelFilterChange: (value: string[]) => void;
  onClearFilters: () => void;
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
] as const;

const RISK_OPTIONS = [
  { value: 'serious', label: 'Serious' },
  { value: 'high', label: 'High' },
  { value: 'other risk', label: 'Other' },
  { value: 'low', label: 'Low' },
] as const;

export function AlertFilters({
  searchValue,
  statusFilter,
  riskLevelFilter,
  appliedFilters,
  onSearchChange,
  onStatusFilterChange,
  onRiskLevelFilterChange,
  onClearFilters,
}: AlertFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleStatus = (status: string) => {
    onStatusFilterChange(
      statusFilter.includes(status)
        ? statusFilter.filter(s => s !== status)
        : [...statusFilter, status]
    );
  };

  const toggleRisk = (risk: string) => {
    onRiskLevelFilterChange(
      riskLevelFilter.includes(risk)
        ? riskLevelFilter.filter(r => r !== risk)
        : [...riskLevelFilter, risk]
    );
  };

  const hasFilters = appliedFilters.length > 0 || searchValue;
  const activeFiltersCount = statusFilter.length + riskLevelFilter.length;

  return (
    <s-stack gap="small">
      {/* Search row with filter toggle */}
      <s-stack direction="inline" gap="small" blockAlign="center" wrap>
        <div style={{ minWidth: '200px', flex: 1, maxWidth: '280px' }}>
          <s-search-field
            label="Search"
            labelHidden
            placeholder="Search alerts..."
            value={searchValue}
            onInput={(e: any) => onSearchChange(e.currentTarget.value || '')}
            size="small"
          />
        </div>
        
        <s-button 
          variant="tertiary" 
          size="small" 
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? "Hide filters" : "Filters"}
          {activeFiltersCount > 0 && !isExpanded && ` (${activeFiltersCount})`}
        </s-button>

        {hasFilters && (
          <s-button variant="tertiary" size="small" onClick={onClearFilters}>
            Clear all
          </s-button>
        )}
      </s-stack>

      {/* Expandable filter options */}
      {isExpanded && (
        <s-box
          padding="small"
          borderRadius="base"
          background="bg-surface-secondary"
        >
          <s-stack direction="inline" gap="large" blockAlign="center" wrap>
            {/* Status chips */}
            <s-stack direction="inline" gap="small" blockAlign="center">
              <s-text tone="subdued" size="small">Status:</s-text>
              {STATUS_OPTIONS.map((status) => (
                <s-clickable-chip
                  key={status.value}
                  selected={statusFilter.includes(status.value) || undefined}
                  onClick={() => toggleStatus(status.value)}
                >
                  {status.label}
                </s-clickable-chip>
              ))}
            </s-stack>

            {/* Risk chips */}
            <s-stack direction="inline" gap="small" blockAlign="center">
              <s-text tone="subdued" size="small">Risk:</s-text>
              {RISK_OPTIONS.map((risk) => (
                <s-clickable-chip
                  key={risk.value}
                  selected={riskLevelFilter.includes(risk.value) || undefined}
                  onClick={() => toggleRisk(risk.value)}
                >
                  {risk.label}
                </s-clickable-chip>
              ))}
            </s-stack>
          </s-stack>
        </s-box>
      )}

      {/* Applied filters pills - always visible when there are filters */}
      {appliedFilters.length > 0 && !isExpanded && (
        <s-stack direction="inline" gap="small" wrap>
          {appliedFilters.map((filter) => (
            <s-chip key={filter.key} onDismiss={filter.onRemove}>
              {filter.label}
            </s-chip>
          ))}
        </s-stack>
      )}
    </s-stack>
  );
}
