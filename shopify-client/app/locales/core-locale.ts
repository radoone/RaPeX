type CoreLocaleInput = {
  dashboard: string;
  alertsLabel: string;
  manual: string;
  settings: string;
  language: string;
  reviewAlerts: string;
  otherOutcome?: string;
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
  reviewLayout?: Partial<{
    possibleMatch: string;
    compareHeading: string;
    compareHint: string;
    noImage: string;
    unnamedRecord: string;
    reviewPointsHeading: string;
    fullEvidence: string;
    decisionHeading: string;
    actionNeeded: string;
    readyToRecord: string;
    decisionPrompt: string;
    outcomeLabel: string;
    chooseOutcome: string;
    noteLabel: string;
    noteRequiredLabel: string;
    otherNoteRequired: string;
  }>;
  unsafe?: string;
  notifications?: {
    enabledTitle: string;
    enabledDescription: string;
    emailLabel: string;
    emailHelp: string;
    languageLabel: string;
    invalidEmail?: string;
  };
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
      catalogCoverage: input.manual,
      evidence: "Audit Trail",
      settings: input.settings,
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
    resolveActions: {
      contactPending: "Waiting for supplier response",
      other: input.otherOutcome || "Other",
    },
    billing: {
      freeScanAvailableHeading: "Free Initial Catalog Scan Active",
      freeScanAvailableDescription: "You have 1 free catalog scan available. Run your first audit to check your store's products against the EU Safety Gate database for dangerous non-food products.",
      upgradeRequiredHeading: "Continue Safety Gate monitoring",
      upgradeRequiredDescription: "Your free initial scan is complete. Choose a Shopify plan to monitor new Safety Gate alerts and check changed products.",
      upgradePlanButton: "Upgrade to Pro",
      managePlanButton: "Manage subscription",
      planEyebrow: "Plan & Coverage",
      planTitle: "Subscription & Safety Monitoring",
      planActiveDescription: "Monitoring is enabled for this Shopify store. Review the latest run and any products that need attention.",
      planFreeUsedDescription: "Your free initial scan has finished. Choose a plan to start ongoing monitoring and keep exporting the audit trail.",
      planFreeAvailableDescription: "One free initial Safety Gate catalog scan is available.",
      statusLabel: "Current Plan",
      statusActivePro: "Safety Gate Pro (Active)",
      statusFreeUsed: "Free Scan Used",
      statusFreeAvailable: "Free Initial Scan",
      statusDevelopmentBypass: "Development preview (billing bypassed)",
      statusUnverified: "Subscription could not be verified",
      verificationError: "New scans are paused until Shopify billing can be checked. Your existing findings and decisions remain available.",
      pricingUnavailable: "Shopify pricing is not configured for this app.",
    },
    actions: {
      checkNewSafetyGateAlerts: "Check new Safety Gate alerts",
      checkOneProduct: "Check one product",
      checkSelectedProduct: "Check selected product",
      reviewActiveProducts: "Review active products",
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
      auditReport: "Audit report",
      protectRemainingProducts: "Protect {{count}} remaining products",
      refreshCoverage: "Refresh catalog coverage",
      viewEvidence: "View decision history",
    },
    status: {
      needsReview: input.needsReview,
      safe: input.safe,
      notChecked: input.notChecked,
      allClear: "All clear",
      resolved: "Resolved",
      dismissed: "Dismissed",
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
          active: "Needs review",
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
        emptyAllClearTitle: "All active product reviews are handled",
        emptyAllClearBody: "There are no open merchant decisions right now. Daily monitoring is still running and closed decisions stay in the audit trail.",
        emptyFilteredTitle: "No review items match these filters",
        emptyFilteredBody: "Adjust the filters or search another product. Your active queue may still be clear.",
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
        summary: "Evidence summary",
        updated: "Updated",
        details: "Details",
      },
      fullEvidence: "Full evidence",
    },
    auditReport: {
      title: "Safety audit report",
      open: "Open audit report",
      download: "Download CSV",
      viewHistory: "View audit trail",
      eyebrow: "Export-ready record",
      heading: "Your product safety decisions",
      description: "Review the complete record before exporting a CSV for your team, supplier, or audit.",
      summaryLabel: "Audit report summary",
      total: "Recorded findings",
      needsReview: "Need review",
      documented: "Decisions documented",
      generated: "Generated {{date}}",
      empty: "No product safety findings have been recorded yet.",
      tableLabel: "Safety audit report",
      product: "Product",
      status: "Status",
      risk: "Risk severity",
      decision: "Decision",
      detected: "Detected",
      notRecorded: "Not recorded",
    },
    manualCheck: {
      title: "Catalog coverage",
      subtitle: "Review check results, refresh catalog coverage, or check one selected product.",
      admin: {
        manualReviewDescription: long.manualReviewDescription,
        catalogDescription: long.manualCatalogDescription,
      },
      bulk: {
        title: "Check your catalog",
        description: "Check {{count}} products against current Safety Gate records and save the results for your team.",
        checkAllProducts: "Check remaining products",
        checkingAll: "Checking catalog...",
      },
      badges: {
        needsReview: "{{count}} need review",
        checks: "{{count}} checks",
      },
      overview: {
        productsNeedingReview: "Products needing review",
        noOpenReviews: "No open product decisions.",
      },
      coverage: {
        eyebrow: "Catalog check status",
        completeTitle: "Every current product has a saved check result",
        incompleteTitle: "{{count}} products have no saved check yet",
        completeDescription: "Every current Shopify product has a recorded Safety Gate check. New or changed products still need a fresh check.",
        incompleteDescription: "Check the remaining products to save a Safety Gate result for the current catalog.",
        percent: "{{percent}}% with a saved check",
        productsCovered: "Products checked",
        productsCoveredDescription: "Products with a recorded Safety Gate result.",
        lastRun: "Last check",
        lastRunResultWithCounts: "Checked {{checked}}, skipped {{skipped}} unchanged, created {{alerts}} review items, {{errors}} errors.",
        lastProductSafe: "Latest product check found no likely Safety Gate match.",
        lastProductNeedsReview: "Latest product check created or updated a review item.",
        noRunYet: "No catalog or product check has run yet.",
        remaining: "Not checked yet",
        remainingDescription: "Run a check to save a Safety Gate result for these products.",
        noneRemaining: "Every current product has a saved check result.",
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
      notifications: {
        enabledTitle: "Email safety alerts",
        enabledDescription: "Choose whether you receive urgent findings, a weekly summary, or both.",
        immediateTitle: "New findings",
        immediateDescription: "Email me as soon as a product needs review.",
        weeklyTitle: "Weekly monitoring summary",
        weeklyDescription: "Send a Monday summary with new findings, open cases, and the last successful run.",
        emailLabel: "Notification email",
        emailHelp: "Initially taken from Shopify. You can use a different address.",
        languageLabel: "Email language",
        invalidEmail: "Enter a valid email address before enabling email notifications.",
        ...input.notifications,
      },
      advancedMatchingSettings: "Advanced matching settings",
      automationStatusEyebrow: "Automatic monitoring",
      automationStatusTitle: "Safety Gate monitoring is working for this store",
      automationStatusDescription: "Daily EU Safety Gate updates, Shopify product changes, and audit records are handled automatically.",
      automationStatus: {
        notStarted: {
          title: "Catalog audit not confirmed",
          description: "The initial import has not completed, so catalog coverage is not confirmed yet.",
          badge: "Not verified",
        },
        scanning: {
          title: "Initial catalog audit in progress",
          description: "Products are being imported and checked. Catalog coverage will be confirmed after the audit finishes.",
          badge: "In progress",
        },
        failed: {
          title: "Initial catalog audit needs attention",
          description: "The last import or audit did not complete. Retry catalog coverage before relying on monitoring status.",
          badge: "Needs attention",
        },
        completedNoPlan: {
          title: "Initial catalog audit completed",
          description: "The initial catalog audit is complete. Ongoing automatic monitoring requires an active plan.",
          badge: "Audit complete",
        },
        active: {
          title: "Catalog audit completed",
          description: "The initial catalog audit completed and this store has an active monitoring plan.",
          badge: "Plan active",
        },
        openCatalog: "Open catalog coverage",
      },
      valueEyebrow: "Subscription value",
      valueTitle: "What stays covered",
      valueDescription: "These capabilities are the core value merchants keep when they stay subscribed.",
      included: {
        eyebrow: "Included in subscription",
        title: "What your store keeps getting every month",
        description: "Use this page to tune monitoring, but keep the value clear: the app keeps watching the catalog, preserves evidence, and helps the team act only when a product needs review.",
        monitoringTitle: "Ongoing EU monitoring",
        monitoringDescription: "New Safety Gate records are compared with monitored Shopify products without a manual scan.",
        evidenceTitle: "Exportable proof",
        evidenceDescription: "Resolved and dismissed decisions keep notes, reasons, risk context, and timestamps.",
        teamTitle: "Review workflow",
        teamDescription: "Priority review, supplier documentation, and filters help the team handle real decisions faster.",
      },
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
        title: "Safety automation",
        description: "Configure priority review for high-risk matches.",
        autoDraftTitle: "Prioritize serious risks",
        autoDraftDescription: "Automatically mark products for priority review when they match Safety Gate alerts with serious risk (threshold >= 95%).",
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
        description: "Features and capabilities included in your store monitoring plan.",
        manualTitle: "Free: manual checks",
        manualDescription: "Run checks one product at a time and see the latest product status.",
        monitorTitle: "Paid: daily monitoring and reports",
        monitorDescription: "Monitor new Safety Gate alerts against the catalog, export CSV audit reports, and keep a decision trail.",
        advancedTitle: "Advanced: automation and multilingual workflows",
        advancedDescription: "Add priority review, supplier follow-up, and EU language workflows.",
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
        productsMonitored: "Products with saved checks",
        lastSafetyGateUpdateChecked: "Last Safety Gate update checked",
        nextAutomaticCheck: "Next automatic check",
        dailyAtTime: "Daily at 03:47",
        auditReport: "Audit report",
        status: {
          factsLabel: "Current monitoring facts",
          matchesNeedingReview: "Matches needing review",
          none: "None",
          cachedEvidence: "Latest completed monitoring run",
          deltaMonitoring: "Only new Safety Gate alerts are checked",
          reviewNeeded: {
            eyebrow: "Review needed",
            title: "{{count}} products need review",
            description: "Potential Safety Gate matches need a merchant decision. Review the matches first; the rest of the catalog remains monitored in the background.",
            criticalEyebrow: "Urgent review",
            criticalTitle: "{{count}} serious-risk products need review",
            criticalDescription: "Review these products before continuing sales. Compare the product and Safety Gate evidence, then record your decision.",
          },
          coverageIncomplete: {
            eyebrow: "Coverage incomplete",
            title: "{{count}} products still need coverage",
            description: "No Safety Gate matches need review in the {{checked}} monitored products. Finish coverage for all {{total}} current products before confirming the whole catalog.",
          },
          monitoringProblem: {
            eyebrow: "Monitoring needs attention",
            title: "Catalog coverage has no recorded monitoring run",
            description: "Your current products have coverage evidence, but the app cannot confirm when Safety Gate monitoring last completed. Refresh catalog coverage to restore a reliable status.",
            action: "Refresh catalog coverage",
          },
          noActionNeeded: {
            eyebrow: "Current Safety Gate status",
            title: "No action needed",
            description: "No products in your monitored catalog currently match EU Safety Gate alerts. Monitoring continues in the background and only new alerts or changed products need work.",
            emptyCatalogTitle: "No products to monitor yet",
            emptyCatalogDescription: "Add products to your Shopify catalog and Safety Gate Monitor will be ready to cover them.",
            action: "View catalog coverage",
          },
        },
        protectionEyebrow: "Your monitoring record",
        protectionTitle: "Review recent checks and merchant decisions.",
        protectionDescription: "Counts describe results recorded in the app; they are not a product safety certification.",
        checkChangedProducts: "Check changed products",
        exportProof: "Export proof",
        proofGridLabel: "Monitoring activity",
        coveragePercent: "Catalog coverage",
        productsCoveredShort: "with a recorded check result",
        decisionsClosed: "Decisions closed",
        auditHistoryKept: "Audit history kept",
        automaticChecks: "Automatic checks",
        daily: "Daily",
        withReadOnlyShopifyAccess: "Read-only Shopify access",
        valueProofEyebrow: "Coverage action",
        valueProofTitle: "What Safety Gate Monitor keeps doing",
        valueProofDescription: "Show the team that the subscription is not a one-time scan: catalog coverage, checks, decisions, and read-only Shopify access stay active.",
        valueProofTitleComplete: "Every current product has a recorded check",
        valueProofTitleIncomplete: "{{count}} products have a recorded check",
        valueProofDescriptionComplete: "These counts show recorded check activity for the current catalog.",
        valueProofDescriptionIncomplete: "Run checks for the remaining products to add results to the current catalog record.",
        finishCoverage: "Finish catalog coverage",
        valueMetrics: {
          productsCovered: "Products checked",
          checksRun: "Checks run",
          decisionsRecorded: "Decisions recorded",
          openDecisions: "Open decisions",
          evidenceRetained: "Decisions with evidence",
        },
        priorityQueue: "Decision queue",
        recentAlertsTitle: "Products needing merchant decision",
        recentAlertsDescription: "Review likely Safety Gate matches, record a decision, and keep evidence for audits.",
        noAlertsTitle: "No products need review",
        noAlertsDescription: "There are no open product reviews right now. That is still useful: daily monitoring continues in the background and your evidence stays ready for export.",
        emptyProofMonitoring: "Daily Safety Gate monitoring is still running.",
        emptyProofEvidence: "{{count}} closed decisions are retained for audit history.",
        emptyProofCoverage: "{{count}} products have a recorded check result.",
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
      modalAccessibilityLabel: "Safety Gate match details for {{title}}",
      reviewLayout: {
        possibleMatch: "Possible Safety Gate match",
        compareHeading: "Compare the products",
        compareHint: "Check the photos, brand, model and category before deciding.",
        noImage: "No image available",
        unnamedRecord: "Safety Gate record",
        reviewPointsHeading: "Points to review",
        fullEvidence: "Full Safety Gate evidence ({{count}})",
        decisionHeading: "Record your decision",
        actionNeeded: "Action needed",
        readyToRecord: "Ready to record",
        decisionPrompt: "Choose the review outcome. You can add a note on what you checked.",
        outcomeLabel: "Review outcome",
        chooseOutcome: "Choose an outcome",
        noteLabel: "What did you check? (optional)",
        noteRequiredLabel: "What did you check? (required)",
        otherNoteRequired: "Add a note to explain the other outcome.",
        ...input.reviewLayout,
      },
      riskSeverity: "Risk severity",
      hazardType: "Hazard type",
      decisionContextTitle: "Recording compliance decisions",
      decisionContextDesc: "Recording a decision documents that this safety match was reviewed and preserves your audit trail. It does not automatically modify your Shopify product or unpublish it from your store.",
      matchesHint: long.analysisMatchesHint,
      scoreHelper: long.analysisScoreHelper,
      candidateAlerts: "Candidate alerts: {{count}}",
      seriousRisk: "Serious {{category}} risk",
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
