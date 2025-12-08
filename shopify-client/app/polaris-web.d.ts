// Minimal JSX typings for Polaris web components used in the app.
// https://shopify.dev/docs/api/app-home/using-polaris-components
declare namespace JSX {
  interface IntrinsicElements {
    // Layout components
    "s-page": any;
    "s-section": any;
    "s-stack": any;
    "s-grid": any;
    "s-box": any;

    // Typography
    "s-text": any;
    "s-heading": any;
    "s-paragraph": any;

    // Feedback indicators
    "s-badge": any;
    "s-banner": any;
    "s-progress-bar": any;
    "s-skeleton-text": any;
    "s-skeleton-display-text": any;
    "s-skeleton-body-text": any;
    "s-spinner": any;

    // Actions
    "s-button": any;
    "s-button-group": any;
    "s-link": any;
    "s-menu": any;

    // Forms
    "s-text-field": any;
    "s-number-field": any;
    "s-search-field": any;
    "s-select": any;
    "s-option": any;
    "s-choice-list": any;
    "s-choice": any;
    "s-checkbox": any;
    "s-radio": any;
    "s-text-area": any;
    "s-password-field": any;

    // Lists and tables
    "s-resource-list": any;
    "s-resource-item": any;
    "s-table": any;
    "s-table-header": any;
    "s-table-header-row": any;
    "s-table-body": any;
    "s-table-row": any;
    "s-table-cell": any;
    "s-data-table": any;
    "s-index-table": any;

    // Navigation
    "s-tabs": any;
    "s-tab": any;
    "s-pagination": any;

    // Overlays
    "s-modal": any;
    "s-popover": any;
    "s-tooltip": any;

    // Images and media
    "s-thumbnail": any;
    "s-avatar": any;
    "s-icon": any;

    // Tags and filters
    "s-tag": any;
    "s-filters": any;
    "s-chip": any;
    "s-clickable-chip": any;

    // Interactive
    "s-clickable": any;
    "s-image": any;

    // States
    "s-empty-state": any;
    "s-loading": any;

    // Other
    "s-divider": any;
    "s-card": any;
    "s-callout-card": any;
    "s-query-container": any;
  }
}
