const en = {
    translation: {
      "billingRedirect": {
        "opening": "Opening Shopify pricing plans...",
        "openPricingPlans": "Open pricing plans"
      },
      "dashboard": {
        "title": "Safety Gate EU",
        "activeAlertsBanner": {
          "title": "Active safety alerts need attention",
          "content": "Resolve {{count}} active alert to keep affected products available in your store.",
          "content_plural": "Resolve {{count}} active alerts to keep affected products available in your store.",
          "reviewAction": "Review first alert",
          "manualCheckAction": "Manual check"
        },
        "monitorCard": {
          "title": "Monitor product safety at a glance",
          "description": "Track alerts, run catalog checks, and keep regulators satisfied.",
          "reviewAction": "Review alerts"
        },
        "stats": {
          "activeAlerts": "Active alerts",
          "alertsLogged": "Alerts logged",
          "productsChecked": "Products checked",
          "allClear": "All clear",
          "open": "{{count}} open",
          "resolved": "{{count}} resolved",
          "newSetup": "New setup",
          "actionNeeded": "Action needed",
          "autoMonitoring": "Auto monitoring",
          "descriptions": {
            "activeAlerts": "Review these products today to stay compliant.",
            "activeAlertsZero": "All safety issues are resolved.",
            "alertsLogged": "Includes resolved and dismissed alerts for audit trail.",
            "alertsLoggedZero": "No historical alerts. Keep monitoring new products.",
            "productsChecked": "Automatic Shopify events continue to monitor updates.",
            "productsCheckedZero": "Run a bulk check to scan your current catalog."
          }
        },
        "bulkCheck": {
          "title": "Bulk safety check",
          "description": "Scan every product in your store against the Safety Gate database to catch hidden risks.",
          "action": "Check all products",
          "processed": "Processed {{count}}",
          "checked": "Checked {{count}}",
          "alerts": "Alerts {{count}}",
          "errors": "Errors {{count}}",
          "completed": "Completed in {{seconds}} seconds",
          "started": "Started {{date}}",
          "totalProducts": "Total products",
          "alreadyChecked": "Already checked",
          "notYetChecked": "Not yet checked",
          "includeAlreadyChecked": "Include already checked products",
          "willCheckAll": "Will check all {{count}} products",
          "willCheckUnchecked": "Will check {{count}} unchecked products (skip {{skip}} already checked)"
        },
        "recentAlerts": {
          "title": "Recent safety alerts",
          "description": "Investigate the latest matches from Safety Gate before fulfilling orders.",
          "active": "{{count}} active",
          "allResolved": "All resolved",
          "matchCount": "{{count}} match found",
          "matchCount_plural": "{{count}} matches found",
          "emptyState": {
            "heading": "No safety alerts yet",
            "content": "Great news—no products are currently flagged. Keep monitoring to maintain compliance."
          }
        },
        "quickActions": {
          "title": "Quick actions",
          "manualCheck": "Run a manual check",
          "browsePortal": "Browse Safety Gate portal",
          "description": "Regular checks and documentation help demonstrate due diligence to regulators."
        },
        "howItWorks": {
          "title": "How it works",
          "autoMonitoring": {
            "title": "Auto-monitoring",
            "description": "Products are checked against the EU database whenever they are created or updated."
          },
          "alertGeneration": {
            "title": "Alert generation",
            "description": "Matches generate alerts that you can dismiss or resolve to track compliance."
          }
        },
        "setup": {
          "title": "Setup Guide",
          "description": "Get your store ready for EU product safety compliance.",
          "progress": "{{completed}} out of {{total}} steps completed",
          "steps": {
            "step1": {
              "label": "Run your first bulk product check",
              "description": "Click \"Check all products\" to scan your entire catalog against the EU Safety Gate database."
            },
            "step2": {
              "label": "Review any safety alerts",
              "description": "Check the alerts page to review any products that match Safety Gate warnings."
            },
            "step3": {
              "label": "Configure automatic monitoring",
              "description": "Enable automatic checks in Settings to monitor new products automatically."
            }
          }
        },
        "metricsCard": {
          "activeAlertsHeading": "Active Alerts",
          "totalRecorded": "{{count}} total recorded",
          "resolutionHeading": "Resolution Rate",
          "resolved": "{{count}} resolved",
          "resolvedAndDismissed": "{{resolved}} resolved • {{dismissed}} dismissed",
          "productsCheckedHeading": "Products Checked",
          "scans": "Safety Gate scans"
        },
        "bulkResults": {
          "success": "Bulk check completed: {{processed}} processed, {{checked}} checked, {{alertsCreated}} alerts created."
        },
        "admin": {
          "actionNeeded": "Action needed",
          "actionNeededTitle": "{{count}} active alert needs review",
          "actionNeededTitle_plural": "{{count}} active alerts need review",
          "actionNeededDescription": "Review flagged products first so you can decide whether to keep them on sale, dismiss the match, or resolve the alert.",
          "criticalBannerTitle": "{{count}} active alert includes high-risk matches",
          "criticalBannerTitle_plural": "{{count}} active alerts include high-risk matches",
          "criticalBannerDescription": "{{count}} active match is marked high or serious risk. Prioritise these products before new sales continue.",
          "criticalBannerDescription_plural": "{{count}} active matches are marked high or serious risk. Prioritise these products before new sales continue.",
          "warningBannerTitle": "{{count}} active alert needs a merchant decision",
          "warningBannerTitle_plural": "{{count}} active alerts need merchant decisions",
          "warningBannerDescription": "Review these matches, dismiss false positives, or resolve confirmed issues so the queue stays actionable.",
          "storeStatus": "Store status",
          "noActiveAlertsTitle": "No active safety alerts",
          "noActiveAlertsDescription": "Your latest checks do not currently require action. Keep scanning newly added products to maintain coverage.",
          "needsReviewTitle": "Products needing review",
          "activeAlertsDescription": "Products that still need a merchant decision before the queue is clear.",
          "highRiskMatchesTitle": "High-risk matches",
          "highRiskMatchesDescription": "Serious or high-risk Safety Gate matches to review first.",
          "catalogCoverageTitle": "Catalog coverage",
          "catalogCoverageDescription": "Share of catalog already checked against Safety Gate.",
          "checksCompletedTitle": "Checks completed",
          "monitoringRunsTitle": "Monitoring checks",
          "checksCompletedDescription": "Automatic and manual checks that reduce manual catalog review work.",
          "lastMonitoringRunTitle": "Last monitoring run",
          "lastMonitoringRunDescription": "Most recent automatic, manual, or bulk Safety Gate check.",
          "auditRecordsTitle": "Audit records",
          "auditRecordsDescription": "Resolved and dismissed decisions with reasons and internal notes.",
          "auditReady": "Report ready",
          "monitoringStatusEyebrow": "Monitoring status",
          "monitoringStatusNeedsReview": "{{count}} product needs a merchant decision",
          "monitoringStatusNeedsReview_plural": "{{count}} products need merchant decisions",
          "monitoringStatusAllClear": "Catalog monitoring is running",
          "monitoringStatusDescription": "Safety Gate Monitor checks your catalog against new EU Safety Gate updates, highlights products needing review, and keeps evidence for audit reports.",
          "productsMonitored": "Catalog monitored",
          "lastSafetyGateUpdateChecked": "Last Safety Gate update checked",
          "nextAutomaticCheck": "Next automatic check",
          "dailyAtTime": "Daily at 03:47",
          "auditReport": "Audit report",
          "protectionEyebrow": "Current protection",
          "protectionTitle": "Keep EU Safety Gate monitoring active for this catalog",
          "protectionDescription": "The subscription value is ongoing protection: daily Safety Gate updates are compared with monitored Shopify products, decisions are kept for audits, and your team only reviews products that need action.",
          "checkChangedProducts": "Check changed products",
          "exportProof": "Export proof",
          "proofGridLabel": "Subscription value proof",
          "coveragePercent": "Catalog coverage",
          "productsCoveredShort": "products covered",
          "decisionsClosed": "Decisions closed",
          "auditHistoryKept": "Audit history kept",
          "automaticChecks": "Automatic checks",
          "daily": "Daily",
          "withReadOnlyShopifyAccess": "Read-only Shopify access",
          "valueProofEyebrow": "Coverage action",
          "valueProofTitle": "What Safety Gate Monitor keeps doing",
          "valueProofDescription": "Show the team that the subscription is not a one-time scan: catalog coverage, checks, decisions, and read-only Shopify access stay active.",
          "valueProofTitleComplete": "Every current product is covered",
          "valueProofTitleIncomplete": "{{count}} products already protected",
          "valueProofDescriptionComplete": "Automatic Safety Gate monitoring is active, and every current catalog product has a recorded check.",
          "valueProofDescriptionIncomplete": "Finish the remaining catalog coverage so every future Safety Gate update is compared against the full store, not only checked products.",
          "finishCoverage": "Finish catalog coverage",
          "valueMetrics": {
            "productsCovered": "Products covered",
            "checksRun": "Checks run",
            "decisionsRecorded": "Decisions recorded",
            "openDecisions": "Open decisions",
            "evidenceRetained": "Decisions with evidence"
          },
          "resolvedRateTitle": "Resolved rate",
          "resolvedRateDescription": "How much of logged alert activity has already been closed.",
          "priorityQueue": "Decision queue",
          "recentAlertsTitle": "Products needing merchant decision",
          "recentAlertsDescription": "Review likely Safety Gate matches, record a decision, and keep evidence for audits.",
          "noAlertsTitle": "No products need review",
          "noAlertsDescription": "There are no open product reviews right now. That is still useful: daily monitoring continues in the background and your evidence stays ready for export.",
          "emptyProofMonitoring": "Daily Safety Gate monitoring is still running.",
          "emptyProofEvidence": "{{count}} closed decisions are retained for audit history.",
          "emptyProofCoverage": "{{count}} products have recorded protection evidence.",
          "demoAlert": {
            "badge": "Example workflow",
            "sample": "What merchants see when a match appears",
            "title": "Likely Safety Gate match found",
            "description": "The app shows the Shopify product, the Safety Gate record, why it matched, and the action to record.",
            "reason": "Compare brand, model, category, and product photos",
            "action": "Resolve, dismiss, or follow up with the supplier",
            "evidence": "Keep notes and export an audit report"
          },
          "fallbackAlertDescription": "Matched against a Safety Gate alert.",
          "recommendedAction": "Recommended action: review the match and record a decision.",
          "coverage": "Coverage",
          "bulkCheckTitle": "Bulk catalog check",
          "bulkCheckDescription": "Scan unchecked products first, or include the whole catalog when you want a fresh pass.",
          "bulkCheckAllSummary": "This will run a full pass for all {{count}} products.",
          "bulkCheckUncheckedSummary": "This will check {{count}} remaining products and skip {{skip}} already reviewed items.",
          "latestRun": "Latest run",
          "bulkCheckSummary": "Bulk check summary",
          "bulkCheckSummaryDescription": "Keep this summary compact so merchants can confirm outcomes without opening a second screen.",
          "stats": {
            "totalProducts": "Total products",
            "alreadyChecked": "Already checked",
            "stillUnchecked": "Still unchecked",
            "checked": "Checked",
            "skipped": "Skipped",
            "alertsCreated": "Alerts created",
            "errors": "Errors"
          },
          "results": {
            "completed": "Completed",
            "alertCreated": "Alert created",
            "error": "Error",
            "skipped": "Skipped",
            "checked": "Checked"
          },
          "reviewOneProduct": "Check one product",
          "runBulkCheck": "Run bulk check"
        }
      },
      "nav": {
        "dashboard": "Dashboard",
        "safetyAlerts": "Review Queue",
        "manualCheck": "Check Product",
        "evidence": "Audit Trail",
        "settings": "Monitoring Settings"
      },
      "settings": {
        "title": "Monitoring Settings",
        "subtitle": "Control how Safety Gate Monitor watches your Shopify catalog.",
        "threshold": {
          "title": "Monitoring mode",
          "howItWorks": "How this works",
          "description": "Choose how many possible Safety Gate matches your team wants to review. Balanced monitoring is recommended for most Shopify catalogs.",
          "currentDefault": "Current environment default",
          "label": "Advanced match threshold (%)",
          "save": "Save",
          "resetToDefault": "Reset to default"
        },
        "monitoring": {
          "title": "Monitoring",
          "automatic": {
            "title": "Automatic checking",
            "description": "Products are automatically checked when created or updated via webhooks.",
            "enabled": "Enabled"
          },
          "manual": {
            "title": "Manual checks",
            "description": "Run on-demand safety checks for any product in your catalog.",
            "goToManualCheck": "Go to Manual Check"
          }
        },
        "navigation": {
          "title": "Navigation",
          "dashboard": "Dashboard",
          "viewAlerts": "View alerts",
          "manualCheck": "Manual check"
        }
      },
      "common": {
        "loading": "Loading...",
        "confirm": "Confirm",
        "cancel": "Cancel",
        "close": "Close",
        "language": "Language",
        "all": "All",
        "unknown": "Unknown"
      },
      "actions": {
        "checkAll": "Check all products",
        "checkNewSafetyGateAlerts": "Check new Safety Gate alerts",
        "checkOneProduct": "Check one product",
        "checking": "Checking...",
        "downloadAuditReport": "Download audit report",
        "viewEvidence": "View decision history",
        "reviewProductsNeedingAction": "Review {{count}} product needing action",
        "reviewProductsNeedingAction_plural": "Review {{count}} products needing action",
        "checkAllProducts": "Check all {{count}} products",
        "checkUnchecked": "Check {{count}} unchecked products",
        "manualCheck": "Check product",
        "settings": "Settings",
        "viewAlerts": "View alerts",
        "reviewAlerts": "Review alerts",
        "dashboard": "Dashboard",
        "tryAgain": "Try again",
        "retry": "Retry",
        "previous": "Previous",
        "next": "Next",
        "search": "Search",
        "clear": "Clear",
        "view": "View",
        "viewDetails": "View details",
        "reviewDecision": "Review decision",
        "resolve": "Resolve",
        "recordDecision": "Record decision",
        "reactivate": "Reactivate"
      },
      "resolveActions": {
        "menuLabel": "Resolution actions",
        "actionTaken": "Action taken",
        "noActionNeeded": "No action needed",
        "verifiedSafe": "Product verified safe",
        "removedFromSale": "Removed from sale",
        "modifiedProduct": "Product modified",
        "contactedSupplier": "Contacted supplier",
        "falsePositive": "False positive",
        "notMyProduct": "Not my product"
      },
      "dates": {
        "today": "Today",
        "yesterday": "Yesterday",
        "daysAgo": "{{count}} days ago",
        "weeksAgo": "{{count}} weeks ago"
      },
      "status": {
        "allClear": "All clear",
        "needsReview": "Needs review",
        "monitored": "Monitored",
        "runCheck": "Run check",
        "archived": "Archived",
        "resolved": "resolved",
        "dismissed": "dismissed",
        "notChecked": "Not checked",
        "safe": "Safe",
        "unsafe": "Needs review",
        "updated": "Updated",
        "flagged": "flagged"
      },
      "analysis": {
        "modalHeading": "Review Safety Gate match",
        "yourProduct": "Your Shopify product",
        "editInShopify": "Edit Product in Shopify",
        "openProductImage": "Open image for {{title}}",
        "safetyGateMatches": "Safety Gate matches",
        "riskLevel": "Risk level",
        "riskDescription": "Risk description",
        "legalProvision": "Legal provision",
        "viewOnSafetyGate": "View on Safety Gate",
        "alertNumber": "Alert {{number}}",
        "enlargedSafetyAlert": "Enlarged safety alert image",
        "fields": {
          "accessibilityLabel": "Alert matching details table",
          "field": "Field",
          "value": "Value",
          "productName": "Product name",
          "brand": "Brand",
          "model": "Model",
          "category": "Category",
          "notifyingCountry": "Notifying country",
          "origin": "Origin",
          "alertDate": "Alert date",
          "productDescription": "Product description"
        },
        "withImage": "Checked with images",
        "textOnly": "Text-only check",
        "noIssuesFound": "No Safety Issues Found",
        "potentialRisk": "Potential Safety Risk",
        "decisionRecorded": "Decision recorded",
        "checkedAt": "Checked: {{date}}",
        "productImagesUsed": "Product images: {{used}} / {{provided}}",
        "alertImagesUsed": "Alert images compared: {{count}}",
        "candidateAlerts": "Candidate alerts: {{count}}",
        "overallMatch": "Overall match",
        "imageMatch": "Image match",
        "overallMatchShort": "{{count}}% overall",
        "imageMatchShort": "{{count}}% image",
        "scoreHelper": "Overall match is the final review score. Image match reflects packaging similarity only.",
        "whyThisMatched": "Why this matched",
        "imageDominated": "This match was scored with image-first weighting, so visual packaging similarity carried more weight than text mismatch.",
        "matchesHint": "Start with the top match card below and confirm visual packaging first, then model and brand details.",
        "primaryRiskFocus": "Primary risk focus: {{category}} at {{level}} level. Confirm this first before deciding.",
        "summary": {
          "matchType": "Match type",
          "likelySafetyGateMatch": "Likely Safety Gate match",
          "noLikelyMatch": "No likely match",
          "overallMatch": "Overall score",
          "confidence": "Confidence",
          "confidenceUnknown": "Confidence unknown",
          "highConfidence": "High confidence",
          "likelyMatch": "Likely match",
          "reviewRecommended": "Review recommended",
          "nextStep": "Next step",
          "decisionRequired": "Decision required",
          "decisionRecorded": "Decision recorded"
        },
        "sections": {
          "whatHappened": "What happened?",
          "whatHappenedRisk": "This Shopify product looks like a product already reported in Safety Gate.",
          "whatHappenedSafe": "The latest check did not find a likely Safety Gate match.",
          "whatHappenedReviewed": "This match has already been reviewed and recorded.",
          "whyMatched": "Why it matched",
          "whatToDo": "What should I do?"
        },
        "merchantRecommendation": {
          "active": "Compare the product and Safety Gate images, confirm the brand or model, then record the action your store will take.",
          "safe": "No store action is required now. Re-check if the product, packaging, images, or supplier changes.",
          "reviewed": "This finding is closed. Verify the recorded outcome and evidence before reactivating it."
        },
        "supplierFollowUp": {
          "copy": "Copy supplier follow-up",
          "template": "Hi, we are reviewing {{product}} because it may match Safety Gate alert {{alert}} (risk: {{risk}}). Please confirm whether this is the same model/batch, provide product safety documentation, and explain any differences. Match reason: {{reason}}"
        },
        "technicalDetails": {
          "title": "Technical match details",
          "description": "Scores and retrieval counts are kept here for deeper review. Start with product photos, brand, model, and the recommended action above.",
          "show": "Show details",
          "hide": "Hide details"
        },
        "audit": {
          "noteLabel": "Audit note",
          "notePlaceholder": "Add what you checked, supplier evidence, or why this was dismissed.",
          "existingNotes": "Audit notes"
        },
        "focus": {
          "criticalTitle": "Action required now",
          "criticalLead": "This product has a high-confidence match. Record a decision only after review.",
          "criticalStepCompare": "Compare your product photo with the first Safety Gate match below.",
          "criticalStepDecide": "Choose an outcome in the Record decision menu based on your review.",
          "criticalStepDocument": "Add internal notes for traceability and supplier follow-up.",
          "safeTitle": "No urgent action needed",
          "safeLead": "Current result is safe. Keep monitoring product updates.",
          "safeStepMonitor": "Keep this product in automatic monitoring.",
          "safeStepRecheck": "Run a new check if images, packaging, or supplier change.",
          "safeStepClose": "Close this detail and continue with other active alerts.",
          "reviewedTitle": "Review already completed",
          "reviewedLead": "This alert is not active. Keep records clear for audits.",
          "recordedOutcome": "Recorded outcome: {{outcome}}",
          "reviewedStepAudit": "Verify the selected resolution and notes.",
          "reviewedStepReactivate": "Reactivate only if new product evidence appears."
        }
      },
      "pagination": {
        "pageOf": "Page {{current}} of {{total}} ({{count}} alerts)"
      },
      "alerts": {
        "title": "Review Queue",
        "subtitle": "Review products needing a decision.",
        "breadcrumbs": {
          "dashboard": "Dashboard",
          "current": "Review queue"
        },
        "meta": {
          "active": "{{count}} active",
          "total": "{{count}} total"
        },
        "metrics": {
          "activeHeading": "Active Alerts",
          "totalRecorded": "{{count}} total recorded",
          "resolutionHeading": "Resolution Rate",
          "resolved": "{{count}} resolved",
          "resolvedAndDismissed": "{{resolved}} resolved • {{dismissed}} dismissed",
          "dismissedHeading": "Dismissed",
          "archived": "Archived",
          "dismissedDescriptionZero": "No dismissed alerts yet",
          "dismissedDescription": "Keep notes for audit"
        },
        "pagination": {
          "previous": "Previous",
          "next": "Next"
        },
        "checklist": {
          "title": "Response checklist",
          "items": [
            "Prioritise active alerts",
            "Document remediation steps",
            "Verify before dismissing"
          ]
        },
        "table": {
          "accessibilityLabel": "Safety alerts table",
          "tabs": {
            "all": "All",
            "active": "Active",
            "resolved": "Resolved",
            "dismissed": "Dismissed"
          },
          "searchLabel": "Search alerts",
          "searchPlaceholder": "Search by product name...",
          "sort": "Sort",
          "sortBy": "Sort by",
          "sortOptions": {
            "created": "Date detected",
            "risk": "Risk level",
            "name": "Product name"
          },
          "order": "Order",
          "orderOptions": {
            "desc": "Newest first",
            "asc": "Oldest first"
          },
          "headers": {
            "product": "Product",
            "status": "Status",
            "risk": "Risk",
            "detected": "Detected",
            "actions": "Actions"
          },
          "empty": "No alerts matching your filters",
          "thumbnailLabel": "{{title}} thumbnail",
          "selectedCount": "{{count}} selected",
          "similarityTooltip": "Similarity score: {{score}}%",
          "selectAll": "Select all visible findings",
          "selectProduct": "Select finding for {{title}}",
          "reviewProduct": "Review decision for {{title}}",
          "viewProduct": "View recorded finding for {{title}}"
        },
        "admin": {
          "actionNeeded": "Action needed",
          "actionNeededTitle": "{{count}} active alert still needs a decision",
          "actionNeededTitle_plural": "{{count}} active alerts still need a decision",
          "actionNeededDescription": "Review matches, dismiss false positives, or resolve confirmed risks so the alert queue stays actionable.",
          "criticalBannerTitle": "{{count}} active alert includes high-risk products",
          "criticalBannerTitle_plural": "{{count}} active alerts include high-risk products",
          "criticalBannerDescription": "{{count}} active alert is marked high or serious risk. Resolve those products first.",
          "criticalBannerDescription_plural": "{{count}} active alerts are marked high or serious risk. Resolve those products first.",
          "warningBannerTitle": "{{count}} active alert still needs review",
          "warningBannerTitle_plural": "{{count}} active alerts still need review",
          "warningBannerDescription": "Use this queue for real decisions only: resolve confirmed risks and dismiss false positives quickly.",
          "queue": "Product decision queue",
          "queueDescription": "Confirm likely matches, dismiss false positives, or record what action was taken."
        },
        "toasts": {
          "updated": "Alert updated"
        }
      },
      "manualCheck": {
        "title": "Check Product",
        "subtitle": "Run an on-demand Safety Gate check for one product.",
        "breadcrumbs": {
          "dashboard": "Dashboard",
          "current": "Check product"
        },
        "badges": {
          "flagged": "{{count}} flagged",
          "needsReview": "{{count}} need review",
          "checks": "{{count}} checks"
        },
        "banners": {
          "failedHeading": "Check failed",
          "alertHeading": "Safety alert created",
          "alertDescription": "A potential safety issue was found for this product.",
          "textOnlyHeading": "Image comparison was not available",
          "textOnlyDescription": "This result used text fields only. If the product relies on visual differences, review the match more carefully."
        },
        "overview": {
          "title": "Checks overview",
          "productsInScope": "Products in scope",
          "productsDescription": "Latest products from your store.",
          "manualCompleted": "Manual checks completed",
          "manualCompletedDescription": "{{checked}} of {{total}} products checked",
          "coverage": "{{coverage}}% coverage",
          "productsFlagged": "Products flagged",
          "productsNeedingReview": "Products needing review",
          "noRisks": "No risks detected yet.",
          "noOpenReviews": "No open product decisions.",
          "prioritise": "Prioritise these products for action."
        },
        "bulk": {
          "title": "Catalog coverage refresh",
          "description": "Updates monitoring for {{count}} products: new or changed products get a fresh check, while unchanged products keep their evidence and are compared with new Safety Gate alerts.",
          "checkAllProducts": "Refresh catalog coverage",
          "checkingAll": "Refreshing catalog coverage..."
        },
        "catalogue": {
          "accessibilityLabel": "Product catalogue table",
          "heading": "Product Catalogue ({{count}})",
          "emptyHeading": "No products found",
          "emptyBody": "No products are available for checking.",
          "columns": {
            "product": "Product",
            "status": "Status",
            "checks": "Checks",
            "action": "Action"
          },
          "searchLabel": "Find product",
          "searchPlaceholder": "Search products by title, SKU, vendor, or type",
          "unknownVendor": "Unknown vendor",
          "noType": "No type",
          "lastChecked": "Last checked {{date}}",
          "totalChecks": "{{count}} total",
          "firstCheck": "Run your first check",
          "status": {
            "safe": "Safe",
            "unsafe": "Needs review",
            "reviewed": "Reviewed",
            "notChecked": "Not checked"
          },
          "actions": {
            "checkAgain": "Check again",
            "checkSafety": "Check safety",
            "viewForProduct": "View recorded finding for {{title}}",
            "checkAgainForProduct": "Check {{title}} again",
            "checkSafetyForProduct": "Check safety for {{title}}"
          }
        },
        "quickActions": {
          "title": "Quick Actions"
        },
        "modal": {
          "unknownProduct": "Unknown Product",
          "unknown": "Unknown"
        },
        "admin": {
          "manualReview": "On-demand review",
          "manualReviewDescription": "Pick any product from your catalog and run a targeted Safety Gate check when you need an immediate answer.",
          "checkFailed": "Check failed",
          "productFlagged": "Product flagged",
          "catalog": "Catalog",
          "catalogDescription": "Products are sorted by latest Shopify updates so merchants can re-check recent changes first."
        },
        "toasts": {
          "completed": "Safety check completed",
          "flagged": "Potential safety issue found"
        }
      },
      "portal": {
        "title": "Safety Gate Portal",
        "description": "Access the official European Safety Gate database to search for dangerous products and view detailed safety alerts.",
        "searchDatabase": "Search Database",
        "searchDescription": "Search the EU Safety Gate for dangerous products",
        "home": "Safety Gate Home",
        "homeDescription": "Access the official European Commission portal"
      },
      "errors": {
        "pageLoadFailed": "Page load failed",
        "unknown": "Something went wrong",
        "apiError": "External safety service is temporarily unavailable. Please try again later."
      },
      "evidence": {
        "title": "Audit Trail",
        "eyebrow": "Audit trail",
        "heading": "Decision and evidence history",
        "description": "Review recorded product safety decisions, notes, risk context, and supplier follow-up evidence.",
        "records": "{{count}} records",
        "empty": "No product safety decisions have been recorded yet.",
        "alertNumber": "Safety Gate alert {{number}}",
        "noNotes": "No note recorded",
        "filteredRecords": "{{visible}} of {{total}} records",
        "filters": {
          "searchLabel": "Search audit trail",
          "searchPlaceholder": "Search product, alert number, or evidence",
          "statusLabel": "Decision status",
          "noResults": "No audit records match these filters.",
          "showMore": "Show evidence",
          "showLess": "Hide evidence",
          "expandForProduct": "Show full evidence for {{title}}",
          "collapseForProduct": "Hide full evidence for {{title}}"
        },
        "table": {
          "accessibilityLabel": "Product safety evidence table",
          "product": "Product",
          "status": "Status",
          "decision": "Decision",
          "notes": "Notes / evidence",
          "updated": "Updated"
        }
      },
      "news": {
        "title": "News",
        "items": {
          "databaseUpdate": {
            "date": "Dec 2025",
            "title": "EU Safety Gate Database Updated",
            "description": "The Safety Gate database is continuously updated with new product alerts. Run regular checks to stay compliant."
          },
          "gpsr": {
            "date": "GPSR 2024",
            "title": "General Product Safety Regulation",
            "description": "Learn about GPSR requirements and how to ensure your products meet EU safety standards."
          }
        }
      },
      "settingsAdmin": {
        "configuration": "Configuration",
        "configurationDescription": "Keep the page focused on one merchant decision: how strict the checker should be when comparing products to Safety Gate alerts.",
        "currentThreshold": "Current threshold",
        "storeSetting": "Store setting",
        "currentThresholdDescription": "Lower values catch more possible matches. Higher values reduce false positives.",
        "environmentDefault": "Environment default",
        "fallback": "Fallback",
        "environmentDefaultDescription": "Used when the shop has no custom threshold saved yet.",
        "matchingStrictness": "Matching strictness",
        "monitoringModeEyebrow": "Monitoring mode",
        "advancedMatchingSettings": "Advanced matching settings",
        "automationStatusEyebrow": "Automatic monitoring",
        "automationStatusTitle": "Safety Gate monitoring is working for this store",
        "automationStatusDescription": "Daily EU Safety Gate updates, Shopify product changes, and audit records are handled automatically. Use these settings only to tune review volume and notifications.",
        "valueEyebrow": "Subscription value",
        "valueTitle": "What stays covered",
        "valueDescription": "These capabilities are the core value merchants keep when they stay subscribed.",
        "included": {
          "eyebrow": "Included in subscription",
          "title": "What your store keeps getting every month",
          "description": "Use this page to tune monitoring, but keep the value clear: the app keeps watching the catalog, preserves evidence, and helps the team act only when a product needs review.",
          "monitoringTitle": "Ongoing EU monitoring",
          "monitoringDescription": "New Safety Gate records are compared with monitored Shopify products without a manual scan.",
          "evidenceTitle": "Exportable proof",
          "evidenceDescription": "Resolved and dismissed decisions keep notes, reasons, risk context, and timestamps.",
          "teamTitle": "Review workflow",
          "teamDescription": "Slack alerts, priority review, and filters help the team handle real decisions faster."
        },
        "mode": {
          "broad": "More matches",
          "balanced": "Balanced",
          "strict": "Fewer matches"
        },
        "status": {
          "running": "Running",
          "on": "On",
          "off": "Off",
          "dailySafetyGateUpdates": "Daily Safety Gate updates",
          "shopifyProductUpdates": "New/updated Shopify products",
          "auditTrail": "Audit trail",
          "emailDigest": "Email digest",
          "autoQuarantine": "Priority review"
        },
        "strictnessHint": "40-60% is broader scanning. 70-85% is stricter and usually produces fewer false positives.",
        "guidance": "Guidance",
        "recommendedSetup": "Recommended setup",
        "guidanceItems": {
          "broadTitle": "Broad monitoring",
          "broadDescription": "Use around 50% when you prefer catching more possible matches and are comfortable reviewing more alerts.",
          "balancedTitle": "Balanced default",
          "balancedDescription": "Use around 65-70% for a practical mix of recall and precision for most Shopify catalogs.",
          "strictTitle": "Strict matching",
          "strictDescription": "Use 80%+ when your catalog is stable and you want fewer manual reviews."
        },
        "automation": {
          "eyebrow": "Real-time operations",
          "title": "Safety automation and alerts",
          "description": "Configure priority review for high-risk matches and optional Slack alerts for your team.",
          "autoDraftTitle": "Prioritize serious risks",
          "autoDraftDescription": "Automatically mark products for priority review when they match Safety Gate alerts with serious risk (threshold >= 95%).",
          "slackTitle": "Slack webhook URL",
          "slackDescription": "Receive instant Slack notifications when alerts are generated."
        },
        "exclusions": {
          "eyebrow": "Filtering rules",
          "title": "Exclusion rules",
          "description": "Exclude specific vendors or product categories from Safety Gate checks to reduce false positives.",
          "vendorsTitle": "Excluded vendors",
          "vendorsDescription": "Type a vendor name and press Enter or comma to add it.",
          "vendorsPlaceholder": "Vendor A, Vendor B, ...",
          "typesTitle": "Excluded product types",
          "typesDescription": "Type a product category or type and press Enter or comma to add it.",
          "typesPlaceholder": "Gift Card, Service, ..."
        },
        "plans": {
          "eyebrow": "Subscription value",
          "title": "Plan capabilities",
          "description": "Use these tiers to explain value before enabling Shopify Billing.",
          "manualTitle": "Free: manual checks",
          "manualDescription": "Run checks one product at a time and see the latest product status.",
          "monitorTitle": "Paid: daily monitoring and reports",
          "monitorDescription": "Monitor new Safety Gate alerts against the catalog, export CSV audit reports, and keep a decision trail.",
          "advancedTitle": "Advanced: automation and multilingual workflows",
          "advancedDescription": "Add priority review, Slack alerts, supplier follow-up, and EU language workflows."
        },
        "valueItems": {
          "dailyTitle": "Daily catalog monitoring",
          "dailyDescription": "New Safety Gate alerts are checked against monitored products without the merchant starting a manual scan.",
          "auditTitle": "Audit-ready evidence",
          "auditDescription": "Resolved and dismissed decisions keep notes, reasons, and review history for exportable reports.",
          "workflowTitle": "Shopify-native review workflow",
          "workflowDescription": "Merchants review only products needing a decision, then resolve, dismiss, or follow up with suppliers."
        },
        "saveAll": "Save all settings",
        "workspace": "Workspace",
        "onDemand": "On demand"
      },
      "onboarding": {
        "title": "Monitor your catalog against EU Safety Gate",
        "subtitle": "Find possible dangerous-product matches, review them in Shopify, and keep audit evidence for every decision.",
        "value": {
          "monitor": {
            "title": "Daily EU Safety Gate monitoring",
            "description": "New Safety Gate alerts are checked against your Shopify catalog."
          },
          "review": {
            "title": "Merchant decision workflow",
            "description": "Compare the match, decide what to do, and keep the queue actionable."
          },
          "audit": {
            "title": "Audit-ready evidence",
            "description": "Resolved and dismissed decisions keep notes for exports and supplier follow-up."
          }
        },
        "stepIndicator": "Step {{current}} of {{total}}",
        "back": "Back",
        "nextStep": "Next Step",
        "finishButton": "Finish Setup & Go to Dashboard",
        "steps": {
          "sensitivity": {
            "title": "Step 1: Set match strictness",
            "description": "Choose how closely a product should match a Safety Gate record before it needs review.",
            "label": "Match strictness",
            "thresholdLabel": "Match threshold: {{value}}%",
            "broad": "40% (Broad - More warnings)",
            "balanced": "70% (Recommended - Balanced)",
            "strict": "90% (Strict - Fewer warnings)",
            "calibration": {
              "broadTitle": "Broad Detection Mode",
              "broadDesc": "High sensitivity. Catches loosely related matches. Recommended if you sell high-risk product categories (toys, electronics) and want complete coverage, but expect some false positives.",
              "balancedTitle": "Balanced Detection Mode",
              "balancedDesc": "Standard sensitivity. Optimized balance between precision and alert volume. Scans titles, descriptions, and matches key brands and model structures.",
              "strictTitle": "Strict Detection Mode",
              "strictDesc": "High precision. Filters out minor similarities. Alerts will trigger only for very clear brand/model name matches. Low rate of false alerts."
            }
          },
          "scan": {
            "title": "Step 2: Import and monitor current catalog",
            "description": "Import your current Shopify products into Safety Gate monitoring, then compare the catalog with recent Safety Gate alerts.",
            "label": "Catalog import",
            "toScan": "Products to import for monitoring: {{count}}",
            "scanning": "Importing catalog and comparing products with Safety Gate alerts...",
            "complete": "Catalog is now monitored",
            "scanned": "Products Scanned: {{count}}",
            "imported": "Products imported for monitoring: {{count}}",
            "monitored": "Products compared with Safety Gate alerts: {{count}}",
            "alerts": "Risk Alerts Created: {{count}}",
            "startButton": "Import and monitor current catalog"
          },
          "automation": {
            "title": "Step 3: Auto-Monitoring & Alerts",
            "description": "Configure priority review and optional Slack alerts for your store.",
            "label": "Safety Automation",
            "webhooks": {
              "title": "Real-time Webhook Scanning",
              "desc": "Products are automatically checked against the EU database whenever created or updated."
            },
            "quarantine": {
            "title": "Prioritize Serious Risks",
            "desc": "Automatically mark products for priority review when they match Safety Gate alerts with serious risk (threshold >= 95%).",
            "label": "Enable priority review"
            },
            "slack": {
              "title": "Slack Alert Integration (Optional)",
              "desc": "Paste your Slack Incoming Webhook URL to get instant Slack alerts.",
              "placeholder": "https://hooks.slack.com/services/..."
            }
          }
        }
      },
      "uxEnhancements": {
        "complianceRing": {
          "title": "Monitored catalog health",
          "subtitle": "Share of checked products without open review items",
          "scoreLabel": "Clear"
        },
        "activityTimeline": {
          "eyebrow": "Audit trail",
          "title": "Decision and evidence history",
          "description": "Recorded safety checks, product decisions, and evidence kept for audit reports.",
          "noActivity": "No audit events yet. Run monitoring to start building evidence.",
          "actions": {
            "check": "Product checked",
            "quarantine": "Product marked for review",
            "resolve": "Decision recorded: resolved",
            "dismiss": "Decision recorded: dismissed"
          },
          "details": {
            "checkSafe": "Product checked and verified as safe.",
            "checkUnsafe": "Product needs review. Decision record created.",
            "bulkScanned": "Bulk catalog scan completed.",
            "autoDrafted": "Product marked for priority review.",
            "reason": "Reason: {{reason}}",
            "noReason": "No reason specified."
          },
          "types": {
            "automatic": "System Event",
            "manual": "Merchant Event",
            "bulk": "Bulk Event"
          }
        },
        "alerts": {
          "floating": {
            "selectedCount": "{{count}} selected alert",
            "selectedCount_plural": "{{count}} selected alerts",
            "resolveSelected": "Resolve Selected",
            "dismissSelected": "Dismiss Selected"
          },
          "quickFilters": {
            "title": "Quick Filters",
            "allAlerts": "All records",
            "allAlertsDesc": "Show all safety warnings in catalog.",
            "needsReview": "Needs Review",
            "needsReviewDesc": "Pending safety alerts.",
            "highRisk": "High Risk Only",
            "highRiskDesc": "Serious risk levels requiring action.",
            "resolved": "Resolved / Dismissed",
            "resolvedDesc": "Past alerts kept for auditing."
          }
        }
      }
    }
  } as const;

export default en;
