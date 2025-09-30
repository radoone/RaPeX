import { Filters, ChoiceList } from "@shopify/polaris";

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
  const filters = [
    {
      key: 'status',
      label: 'Status',
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={[
            { label: 'Active', value: 'active' },
            { label: 'Dismissed', value: 'dismissed' },
            { label: 'Resolved', value: 'resolved' },
          ]}
          selected={statusFilter}
          onChange={onStatusFilterChange}
          allowMultiple
        />
      ),
      shortcut: true,
    },
    {
      key: 'riskLevel',
      label: 'Risk Level',
      filter: (
        <ChoiceList
          title="Risk Level"
          titleHidden
          choices={[
            { label: 'Serious', value: 'serious' },
            { label: 'High', value: 'high' },
            { label: 'Medium', value: 'medium' },
            { label: 'Low', value: 'low' },
          ]}
          selected={riskLevelFilter}
          onChange={onRiskLevelFilterChange}
          allowMultiple
        />
      ),
    },
  ];

  return (
    <Filters
      queryValue={searchValue}
      queryPlaceholder="Search by product name..."
      filters={filters}
      appliedFilters={appliedFilters}
      onQueryChange={onSearchChange}
      onQueryClear={() => onSearchChange('')}
      onClearAll={onClearFilters}
    />
  );
}
