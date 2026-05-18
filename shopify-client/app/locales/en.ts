const en = {
    translation: {
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
          "activeAlertsDescription": "Products that still need a decision.",
          "catalogCoverageTitle": "Catalog coverage",
          "catalogCoverageDescription": "Share of catalog already checked against Safety Gate.",
          "checksCompletedTitle": "Checks completed",
          "checksCompletedDescription": "Includes automatic and manual checks.",
          "resolvedRateTitle": "Resolved rate",
          "resolvedRateDescription": "How much of logged alert activity has already been closed.",
          "priorityQueue": "Priority queue",
          "recentAlertsTitle": "Recent safety alerts",
          "recentAlertsDescription": "Most recent flagged products from your store, ordered so merchants can act quickly.",
          "noAlertsTitle": "No alerts yet",
          "noAlertsDescription": "Your alerts list will appear here after the first unsafe product match is detected.",
          "fallbackAlertDescription": "Matched against a Safety Gate alert.",
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
        "safetyAlerts": "Safety Alerts",
        "manualCheck": "Manual Check",
        "settings": "Settings"
      },
      "settings": {
        "title": "Settings",
        "subtitle": "Configure thresholds and preferences for Safety Gate monitoring.",
        "threshold": {
          "title": "Similarity Threshold",
          "howItWorks": "How this works",
          "description": "The similarity threshold determines how closely a product must match a Safety Gate alert. Higher values (e.g., 80%) mean stricter matching with fewer false positives. Lower values (e.g., 40%) catch more potential matches but may include false positives.",
          "currentDefault": "Current environment default",
          "label": "Similarity threshold (%)",
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
        "checkAllProducts": "Check all {{count}} products",
        "checkUnchecked": "Check {{count}} unchecked products",
        "manualCheck": "Manual check",
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
        "resolve": "Resolve",
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
        "unsafe": "Unsafe",
        "updated": "Updated",
        "flagged": "flagged"
      },
      "analysis": {
        "modalHeading": "Review Safety Gate match",
        "yourProduct": "Your Shopify product",
        "safetyGateMatches": "Safety Gate matches",
        "riskLevel": "Risk level",
        "riskDescription": "Risk description",
        "legalProvision": "Legal provision",
        "viewOnSafetyGate": "View on Safety Gate",
        "alertNumber": "Alert {{number}}",
        "enlargedSafetyAlert": "Enlarged safety alert image",
        "fields": {
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
        "checkedAt": "Checked: {{date}}",
        "productImagesUsed": "Product images: {{used}} / {{provided}}",
        "alertImagesUsed": "Alert images compared: {{count}}",
        "candidateAlerts": "Candidate alerts",
        "overallMatch": "Overall match",
        "imageMatch": "Image match",
        "overallMatchShort": "{{count}}% overall",
        "imageMatchShort": "{{count}}% image",
        "scoreHelper": "Overall match is the final review score. Image match reflects packaging similarity only.",
        "whyThisMatched": "Why this matched",
        "imageDominated": "This match was scored with image-first weighting, so visual packaging similarity carried more weight than text mismatch.",
        "matchesHint": "Start with the top match card below and confirm visual packaging first, then model and brand details.",
        "primaryRiskFocus": "Primary risk focus: {{category}} at {{level}} level. Confirm this first before deciding.",
        "focus": {
          "criticalTitle": "Action required now",
          "criticalLead": "This product has a high-confidence match. Resolve only after review.",
          "criticalStepCompare": "Compare your product photo with the first Safety Gate match below.",
          "criticalStepDecide": "Choose a resolution in the Resolve menu based on your review.",
          "criticalStepDocument": "Add internal notes for traceability and supplier follow-up.",
          "safeTitle": "No urgent action needed",
          "safeLead": "Current result is safe. Keep monitoring product updates.",
          "safeStepMonitor": "Keep this product in automatic monitoring.",
          "safeStepRecheck": "Run a new check if images, packaging, or supplier change.",
          "safeStepClose": "Close this detail and continue with other active alerts.",
          "reviewedTitle": "Review already completed",
          "reviewedLead": "This alert is not active. Keep records clear for audits.",
          "reviewedStepAudit": "Verify the selected resolution and notes.",
          "reviewedStepReactivate": "Reactivate only if new product evidence appears."
        }
      },
      "pagination": {
        "pageOf": "Page {{current}} of {{total}} ({{count}} alerts)"
      },
      "alerts": {
        "title": "Safety alerts",
        "subtitle": "Filter and action matches from Safety Gate.",
        "breadcrumbs": {
          "dashboard": "Dashboard",
          "current": "Safety alerts"
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
          "similarityTooltip": "Similarity score: {{score}}%"
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
          "queue": "Alert queue",
          "queueDescription": "Keep the table focused on decisions: filter by status, search product names, and resolve matches directly from one place."
        },
        "toasts": {
          "updated": "Alert updated"
        }
      },
      "manualCheck": {
        "title": "Manual safety check",
        "subtitle": "Run a targeted Safety Gate check for a specific product.",
        "breadcrumbs": {
          "dashboard": "Dashboard",
          "current": "Manual check"
        },
        "badges": {
          "flagged": "{{count}} flagged",
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
          "noRisks": "No risks detected yet.",
          "prioritise": "Prioritise these products for action."
        },
        "catalogue": {
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
            "unsafe": "Unsafe",
            "notChecked": "Not checked"
          },
          "actions": {
            "checkAgain": "Check again",
            "checkSafety": "Check safety"
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
          "manualReview": "Manual review",
          "manualReviewDescription": "Pick any product from your latest catalog updates and run a targeted Safety Gate check on demand.",
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
        "workspace": "Workspace",
        "onDemand": "On demand"
      }
    }
  } as const;

export default en;
