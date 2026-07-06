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
      safetyAlerts: "Review Queue",
      manualCheck: "Check Product",
      evidence: "Audit Trail",
      settings: "Monitoring Settings",
    },
    common: {
      language: input.language,
      close: input.close || "Close",
      all: input.all || "All",
      unknown: input.unknown || "Unknown",
    },
    billingRedirect: {
      opening: "Opening Shopify pricing plans...",
      openPricingPlans: "Open pricing plans",
    },
    actions: {
      checkNewSafetyGateAlerts: "Check new Safety Gate alerts",
      checkOneProduct: "Check one product",
      reviewAlerts: input.reviewAlerts,
      reviewProductsNeedingAction: "Review {{count}} products needing action",
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
      reviewDecision: "Review decision",
      resolve: "Resolve",
      recordDecision: "Record decision",
      reactivate: "Reactivate",
      downloadAuditReport: "Download audit report",
      viewEvidence: "View decision history",
    },
    status: {
      needsReview: input.needsReview,
      safe: input.safe,
      notChecked: input.notChecked,
      allClear: "All clear",
      resolved: "resolved",
      dismissed: "dismissed",
      unsafe: input.unsafe || "Needs review",
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
        selectAll: "Select all visible findings",
        selectProduct: "Select finding for {{title}}",
        reviewProduct: "Review decision for {{title}}",
        viewProduct: "View recorded finding for {{title}}",
      },
    },
    evidence: {
      title: "Audit Trail",
      eyebrow: "Audit trail",
      heading: "Decision and evidence history",
      description: "Review recorded product safety decisions, notes, risk context, and supplier follow-up evidence.",
      records: "{{count}} records",
      empty: "No product safety decisions have been recorded yet.",
      alertNumber: "Safety Gate alert {{number}}",
      noNotes: "No note recorded",
      filteredRecords: "{{visible}} of {{total}} records",
      filters: {
        searchLabel: "Search audit trail",
        searchPlaceholder: "Search product, alert number, or evidence",
        statusLabel: "Decision status",
        noResults: "No audit records match these filters.",
        showMore: "Show evidence",
        showLess: "Hide evidence",
        expandForProduct: "Show full evidence for {{title}}",
        collapseForProduct: "Hide full evidence for {{title}}",
      },
      table: {
        accessibilityLabel: "Product safety evidence table",
        product: "Product",
        status: "Status",
        decision: "Decision",
        notes: "Notes / evidence",
        updated: "Updated",
      },
    },
    manualCheck: {
      title: "Check Product",
      admin: {
        manualReviewDescription: long.manualReviewDescription,
        catalogDescription: long.manualCatalogDescription,
      },
      bulk: {
        title: "Catalog coverage refresh",
        description: "Updates monitoring for {{count}} products: new or changed products get a fresh check, while unchanged products keep their evidence and are compared with new Safety Gate alerts.",
        checkAllProducts: "Refresh catalog coverage",
        checkingAll: "Refreshing catalog coverage...",
      },
      badges: {
        needsReview: "{{count}} need review",
        checks: "{{count}} checks",
      },
      overview: {
        productsNeedingReview: "Products needing review",
        noOpenReviews: "No open product decisions.",
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
          viewForProduct: "View recorded finding for {{title}}",
          checkAgainForProduct: "Check {{title}} again",
          checkSafetyForProduct: "Check safety for {{title}}",
        },
        status: {
          safe: input.safe,
          unsafe: input.unsafe || "Needs review",
          reviewed: "Reviewed",
          notChecked: input.notChecked,
        },
      },
    },
    settings: {
      title: "Monitoring Settings",
      threshold: {
        description: long.settingsThresholdDescription,
      },
    },
    settingsAdmin: {
      strictnessHint: long.settingsStrictnessHint,
      monitoringModeEyebrow: "Monitoring mode",
      advancedMatchingSettings: "Advanced matching settings",
      automationStatusEyebrow: "Automatic monitoring",
      automationStatusTitle: "Safety Gate monitoring is working for this store",
      automationStatusDescription: "Daily EU Safety Gate updates, Shopify product changes, and audit records are handled automatically.",
      valueEyebrow: "Subscription value",
      valueTitle: "What stays covered",
      valueDescription: "These capabilities are the core value merchants keep when they stay subscribed.",
      mode: {
        broad: "More matches",
        balanced: "Balanced",
        strict: "Fewer matches",
      },
      status: {
        running: "Running",
        on: "On",
        off: "Off",
        dailySafetyGateUpdates: "Daily Safety Gate updates",
        shopifyProductUpdates: "New/updated Shopify products",
        auditTrail: "Audit trail",
        emailDigest: "Email digest",
        autoQuarantine: "Priority review",
      },
      guidanceItems: {
        balancedDescription: long.settingsBalancedDescription,
      },
      automation: {
        eyebrow: "Real-time operations",
        title: "Safety automation and alerts",
        description: "Configure priority review for high-risk matches and optional Slack alerts for your team.",
        autoDraftTitle: "Prioritize serious risks",
        autoDraftDescription: "Automatically mark products for priority review when they match Safety Gate alerts with serious risk (threshold >= 95%).",
        slackTitle: "Slack webhook URL",
        slackDescription: "Receive instant Slack notifications when alerts are generated.",
      },
      exclusions: {
        eyebrow: "Filtering rules",
        title: "Exclusion rules",
        description: "Exclude specific vendors or product categories from Safety Gate checks to reduce false positives.",
        vendorsTitle: "Excluded vendors",
        vendorsDescription: "Type a vendor name and press Enter or comma to add it.",
        vendorsPlaceholder: "Vendor A, Vendor B, ...",
        typesTitle: "Excluded product types",
        typesDescription: "Type a product category or type and press Enter or comma to add it.",
        typesPlaceholder: "Gift Card, Service, ...",
      },
      plans: {
        eyebrow: "Subscription value",
        title: "Plan capabilities",
        description: "Use these tiers to explain value before enabling Shopify Billing.",
        manualTitle: "Free: manual checks",
        manualDescription: "Run checks one product at a time and see the latest product status.",
        monitorTitle: "Paid: daily monitoring and reports",
        monitorDescription: "Monitor new Safety Gate alerts against the catalog, export CSV audit reports, and keep a decision trail.",
        advancedTitle: "Advanced: automation and multilingual workflows",
        advancedDescription: "Add priority review, Slack alerts, supplier follow-up, and EU language workflows.",
      },
      valueItems: {
        dailyTitle: "Daily catalog monitoring",
        dailyDescription: "New Safety Gate alerts are checked against monitored products without the merchant starting a manual scan.",
        auditTitle: "Audit-ready evidence",
        auditDescription: "Resolved and dismissed decisions keep notes, reasons, and review history for exportable reports.",
        workflowTitle: "Shopify-native review workflow",
        workflowDescription: "Merchants review only products needing a decision, then resolve, dismiss, or follow up with suppliers.",
      },
      saveAll: "Save all settings",
    },
    dashboard: {
      admin: {
        needsReviewTitle: "Products needing review",
        activeAlertsDescription: "Products that still need a merchant decision before the queue is clear.",
        highRiskMatchesTitle: "High-risk matches",
        highRiskMatchesDescription: "Serious or high-risk Safety Gate matches to review first.",
        monitoringRunsTitle: "Monitoring checks",
        checksCompletedDescription: "Automatic and manual checks that reduce manual catalog review work.",
        lastMonitoringRunTitle: "Last monitoring run",
        lastMonitoringRunDescription: "Most recent automatic, manual, or bulk Safety Gate check.",
        auditRecordsTitle: "Audit records",
        auditRecordsDescription: "Resolved and dismissed decisions with reasons and internal notes.",
        auditReady: "Report ready",
        monitoringStatusEyebrow: "Monitoring status",
        monitoringStatusNeedsReview: "{{count}} products need merchant decisions",
        monitoringStatusAllClear: "Catalog monitoring is running",
        monitoringStatusDescription: "Safety Gate Monitor checks your catalog against new EU Safety Gate updates, highlights products needing review, and keeps evidence for audit reports.",
        productsMonitored: "Catalog monitored",
        lastSafetyGateUpdateChecked: "Last Safety Gate update checked",
        nextAutomaticCheck: "Next automatic check",
        dailyAtTime: "Daily at 03:47",
        auditReport: "Audit report",
        valueProofEyebrow: "Subscription value",
        valueProofTitle: "What Safety Gate Monitor keeps doing",
        valueProofDescription: "Show the team that the subscription is not a one-time scan: catalog coverage, checks, decisions, and read-only Shopify access stay active.",
        valueProofTitleComplete: "Your catalog is covered",
        valueProofTitleIncomplete: "{{count}} products still need initial coverage",
        valueProofDescriptionComplete: "Automatic Safety Gate monitoring is active, and every current catalog product has a recorded check.",
        valueProofDescriptionIncomplete: "Finish the initial catalog pass so new Safety Gate alerts can be compared against every current product.",
        finishCoverage: "Finish catalog coverage",
        valueMetrics: {
          productsCovered: "Products covered",
          checksRun: "Checks run",
          decisionsRecorded: "Decisions recorded",
          openDecisions: "Open decisions",
          evidenceRetained: "Decisions with evidence",
        },
        priorityQueue: "Decision queue",
        recentAlertsTitle: "Products needing merchant decision",
        recentAlertsDescription: "Review likely Safety Gate matches, record a decision, and keep evidence for audits.",
        noAlertsTitle: "No products need review",
        noAlertsDescription: "There are no open product reviews right now. Keep monitoring new Safety Gate updates to maintain coverage.",
        demoAlert: {
          badge: "Example workflow",
          sample: "What merchants see when a match appears",
          title: "Likely Safety Gate match found",
          description: "The app shows the Shopify product, the Safety Gate record, why it matched, and the action to record.",
          reason: "Compare brand, model, category, and product photos",
          action: "Resolve, dismiss, or follow up with the supplier",
          evidence: "Keep notes and export an audit report",
        },
        recommendedAction: "Recommended action: review the match and record a decision.",
      },
    },
    analysis: {
      matchesHint: long.analysisMatchesHint,
      scoreHelper: long.analysisScoreHelper,
      candidateAlerts: "Candidate alerts: {{count}}",
      decisionRecorded: "Decision recorded",
      openProductImage: "Open image for {{title}}",
      merchantRecommendation: {
        active: "Compare the product and Safety Gate images, confirm the brand or model, then record the action your store will take.",
        safe: "No store action is required now. Re-check if the product, packaging, images, or supplier changes.",
        reviewed: "This finding is closed. Verify the recorded outcome and evidence before reactivating it.",
      },
      focus: {
        recordedOutcome: "Recorded outcome: {{outcome}}",
      },
      sections: {
        whatHappened: "What happened?",
        whatHappenedRisk: "This Shopify product looks like a product already reported in Safety Gate.",
        whatHappenedSafe: "The latest check did not find a likely Safety Gate match.",
        whatHappenedReviewed: "This match has already been reviewed and recorded.",
        whyMatched: "Why it matched",
        whatToDo: "What should I do?",
      },
      supplierFollowUp: {
        copy: "Copy supplier follow-up",
        template: "Hi, we are reviewing {{product}} because it may match Safety Gate alert {{alert}} (risk: {{risk}}). Please confirm whether this is the same model/batch, provide product safety documentation, and explain any differences. Match reason: {{reason}}",
      },
      summary: {
        matchType: "Match type",
        likelySafetyGateMatch: "Likely Safety Gate match",
        noLikelyMatch: "No likely match",
        overallMatch: "Overall score",
        confidence: "Confidence",
        confidenceUnknown: "Confidence unknown",
        highConfidence: "High confidence",
        likelyMatch: "Likely match",
        reviewRecommended: "Review recommended",
        nextStep: "Next step",
        decisionRequired: "Decision required",
        decisionRecorded: "Decision recorded",
      },
      technicalDetails: {
        title: "Technical match details",
        description: "Scores and retrieval counts are kept here for deeper review. Start with product photos, brand, model, and the recommended action above.",
        show: "Show details",
        hide: "Hide details",
      },
      audit: {
        noteLabel: "Audit note",
        notePlaceholder: "Add what you checked, supplier evidence, or why this was dismissed.",
        existingNotes: "Audit notes",
      },
    },
    uxEnhancements: {
      complianceRing: {
        title: "Monitored catalog health",
        subtitle: "Share of checked products without open review items",
        scoreLabel: "Clear",
      },
      activityTimeline: {
        eyebrow: "Audit trail",
        title: "Decision and evidence history",
        description: "Recorded safety checks, product decisions, and evidence kept for audit reports.",
        noActivity: "No audit events yet. Run monitoring to start building evidence.",
      },
    },
  };
}
