type CoreLocaleInput = {
  dashboard: string;
  alertsLabel: string;
  manual: string;
  settings: string;
  language: string;
  reviewAlerts: string;
  search: string;
  clear: string;
  needsReview: string;
  safe: string;
  notChecked: string;
  alertsTitle: string;
  findProduct: string;
  all?: string;
  unknown?: string;
  close?: string;
  unsafe?: string;
  long?: {
    dashboardRecentAlertsDescription: string;
    dashboardNoAlertsDescription: string;
    alertsQueueDescription: string;
    manualReviewDescription: string;
    manualCatalogDescription: string;
    settingsThresholdDescription: string;
    settingsStrictnessHint: string;
    settingsBalancedDescription: string;
    analysisMatchesHint: string;
    analysisScoreHelper: string;
  };
};

export function buildCoreLocale(input: CoreLocaleInput) {
  const long = input.long || {
    dashboardRecentAlertsDescription: "Most recent flagged products from your store, ordered so merchants can act quickly.",
    dashboardNoAlertsDescription: "Your alerts list will appear here after the first unsafe product match is detected.",
    alertsQueueDescription: "Keep the table focused on decisions: filter by status, search product names, and resolve matches directly from one place.",
    manualReviewDescription: "Pick any product from your latest catalog updates and run a targeted Safety Gate check on demand.",
    manualCatalogDescription: "Products are sorted by latest Shopify updates so merchants can re-check recent changes first.",
    settingsThresholdDescription: "The similarity threshold determines how closely a product must match a Safety Gate alert. Higher values mean stricter matching with fewer false positives. Lower values catch more potential matches but may include false positives.",
    settingsStrictnessHint: "40-60% is broader scanning. 70-85% is stricter and usually produces fewer false positives.",
    settingsBalancedDescription: "Use around 65-70% for a practical mix of recall and precision for most Shopify catalogs.",
    analysisMatchesHint: "Start with the top match card below and confirm visual packaging first, then model and brand details.",
    analysisScoreHelper: "Overall match is the final review score. Image match reflects packaging similarity only.",
  };

  return {
    nav: {
      dashboard: input.dashboard,
      safetyAlerts: input.alertsLabel,
      manualCheck: input.manual,
      settings: input.settings,
    },
    common: {
      language: input.language,
      close: input.close || "Close",
      all: input.all || "All",
      unknown: input.unknown || "Unknown",
    },
    actions: {
      checkNewSafetyGateAlerts: "Check new Safety Gate alerts",
      checkOneProduct: "Check one product",
      reviewAlerts: input.reviewAlerts,
      search: input.search,
      clear: input.clear,
      viewAlerts: input.reviewAlerts,
      manualCheck: input.manual,
      settings: input.settings,
      retry: "Retry",
      previous: "Previous",
      next: "Next",
      view: "View",
      viewDetails: "View details",
      resolve: "Resolve",
      reactivate: "Reactivate",
    },
    status: {
      needsReview: input.needsReview,
      safe: input.safe,
      notChecked: input.notChecked,
      allClear: "All clear",
      resolved: "resolved",
      dismissed: "dismissed",
      unsafe: input.unsafe || "Unsafe",
      updated: "Updated",
    },
    alerts: {
      title: input.alertsTitle,
      admin: {
        queueDescription: long.alertsQueueDescription,
      },
      table: {
        searchLabel: input.alertsTitle,
        searchPlaceholder: "Search by product name...",
        sort: "Sort",
        tabs: {
          all: input.all || "All",
          active: "Active",
          resolved: "Resolved",
          dismissed: "Dismissed",
        },
        headers: {
          product: "Product",
          status: "Status",
          risk: "Risk",
          detected: "Detected",
          actions: "Actions",
        },
        empty: "No alerts matching your filters",
      },
    },
    manualCheck: {
      title: input.manual,
      admin: {
        manualReviewDescription: long.manualReviewDescription,
        catalogDescription: long.manualCatalogDescription,
      },
      catalogue: {
        searchLabel: input.findProduct,
        searchPlaceholder: "Search by title, SKU, vendor, or type",
        columns: {
          product: "Product",
          status: "Status",
          action: "Action",
        },
        actions: {
          checkAgain: "Check again",
          checkSafety: "Check safety",
        },
        status: {
          safe: input.safe,
          unsafe: input.unsafe || "Unsafe",
          notChecked: input.notChecked,
        },
      },
    },
    settings: {
      title: input.settings,
      threshold: {
        description: long.settingsThresholdDescription,
      },
    },
    settingsAdmin: {
      strictnessHint: long.settingsStrictnessHint,
      guidanceItems: {
        balancedDescription: long.settingsBalancedDescription,
      },
    },
    dashboard: {
      admin: {
        recentAlertsDescription: long.dashboardRecentAlertsDescription,
        noAlertsDescription: long.dashboardNoAlertsDescription,
      },
    },
    analysis: {
      matchesHint: long.analysisMatchesHint,
      scoreHelper: long.analysisScoreHelper,
    },
  };
}
