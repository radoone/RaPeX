import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

const resources = {
  en: {
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
        "language": "Language",
        "all": "All",
        "unknown": "Unknown"
      },
      "actions": {
        "checkAll": "Check all products",
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
  },
  sk: {
    translation: {
      "dashboard": {
        "title": "Safety Gate EÚ",
        "activeAlertsBanner": {
          "title": "Aktívne bezpečnostné upozornenia vyžadujú pozornosť",
          "content": "Vyriešte {{count}} aktívne upozornenie, aby ste udržali dotknuté produkty dostupné vo vašom obchode.",
          "content_plural": "Vyriešte {{count}} aktívne upozornenia, aby ste udržali dotknuté produkty dostupné vo vašom obchode.",
          "reviewAction": "Skontrolovať prvé upozornenie",
          "manualCheckAction": "Manuálna kontrola"
        },
        "monitorCard": {
          "title": "Monitorujte bezpečnosť produktov na prvý pohľad",
          "description": "Sledujte upozornenia, spúšťajte kontroly katalógu a udržujte regulátorov spokojných.",
          "reviewAction": "Skontrolovať upozornenia"
        },
        "stats": {
          "activeAlerts": "Aktívne upozornenia",
          "alertsLogged": "Zaznamenané upozornenia",
          "productsChecked": "Skontrolované produkty",
          "allClear": "Všetko čisté",
          "open": "{{count}} otvorené",
          "resolved": "{{count}} vyriešené",
          "newSetup": "Nové nastavenie",
          "actionNeeded": "Potrebná akcia",
          "autoMonitoring": "Auto monitoring",
          "descriptions": {
            "activeAlerts": "Skontrolujte tieto produkty dnes, aby ste zostali v súlade s predpismi.",
            "activeAlertsZero": "Všetky bezpečnostné problémy sú vyriešené.",
            "alertsLogged": "Zahŕňa vyriešené a zamietnuté upozornenia pre audit.",
            "alertsLoggedZero": "Žiadne historické upozornenia. Pokračujte v monitorovaní nových produktov.",
            "productsChecked": "Automatické udalosti Shopify naďalej monitorujú aktualizácie.",
            "productsCheckedZero": "Spustite hromadnú kontrolu na skenovanie vášho aktuálneho katalógu."
          }
        },
        "bulkCheck": {
          "title": "Hromadná bezpečnostná kontrola",
          "description": "Naskenujte každý produkt vo vašom obchode voči databáze Safety Gate, aby ste odhalili skryté riziká.",
          "action": "Skontrolovať všetky produkty",
          "processed": "Spracované {{count}}",
          "checked": "Skontrolované {{count}}",
          "alerts": "Upozornenia {{count}}",
          "errors": "Chyby {{count}}",
          "completed": "Dokončené za {{seconds}} sekúnd",
          "started": "Spustené {{date}}",
          "totalProducts": "Produkty v rozsahu",
          "alreadyChecked": "Už skontrolované",
          "notYetChecked": "Zatiaľ nekontrolované",
          "includeAlreadyChecked": "Zahrnúť už skontrolované produkty",
          "willCheckAll": "Skontroluje všetkých {{count}} produktov",
          "willCheckUnchecked": "Skontroluje {{count}} nekontrolovaných (preskočí {{skip}} už skontrolovaných)"
        },
        "recentAlerts": {
          "title": "Nedávne bezpečnostné upozornenia",
          "description": "Preskúmajte najnovšie zhody zo Safety Gate pred vybavením objednávok.",
          "active": "{{count}} aktívne",
          "allResolved": "Všetky vyriešené",
          "matchCount": "{{count}} zhoda",
          "matchCount_plural": "{{count}} zhody",
          "emptyState": {
            "heading": "Zatiaľ žiadne bezpečnostné upozornenia",
            "content": "Skvelé správy – momentálne nie sú označené žiadne produkty. Pokračujte v monitorovaní na udržanie súladu."
          }
        },
        "quickActions": {
          "title": "Rýchle akcie",
          "manualCheck": "Spustiť manuálnu kontrolu",
          "browsePortal": "Prehliadať portál Safety Gate",
          "description": "Pravidelné kontroly a dokumentácia pomáhajú preukázať náležitú starostlivosť regulátorom."
        },
        "howItWorks": {
          "title": "Ako to funguje",
          "autoMonitoring": {
            "title": "Auto-monitoring",
            "description": "Produkty sú kontrolované voči databáze EÚ vždy, keď sú vytvorené alebo aktualizované."
          },
          "alertGeneration": {
            "title": "Generovanie upozornení",
            "description": "Zhody generujú upozornenia, ktoré môžete zamietnuť alebo vyriešiť na sledovanie súladu."
          }
        },
        "setup": {
          "title": "Sprievodca nastavením",
          "description": "Pripravte svoj obchod na súlad s bezpečnosťou produktov EÚ.",
          "progress": "{{completed}} z {{total}} krokov dokončených",
          "steps": {
            "step1": {
              "label": "Spustite prvú hromadnú kontrolu produktov",
              "description": "Kliknite na \"Skontrolovať všetky produkty\" a naskenujte celý katalóg voči databáze EU Safety Gate."
            },
            "step2": {
              "label": "Skontrolujte bezpečnostné upozornenia",
              "description": "Pozrite stránku upozornení a skontrolujte produkty, ktoré zodpovedajú varovaniam Safety Gate."
            },
            "step3": {
              "label": "Nastavte automatické monitorovanie",
              "description": "Povoľte automatické kontroly v Nastaveniach, aby sa nové produkty kontrolovali automaticky."
            }
          }
        },
        "metricsCard": {
          "activeAlertsHeading": "Aktívne upozornenia",
          "totalRecorded": "{{count}} zaznamenaných",
          "resolutionHeading": "Miera vyriešenia",
          "resolved": "{{count}} vyriešených",
          "resolvedAndDismissed": "{{resolved}} vyriešených • {{dismissed}} zamietnutých",
          "productsCheckedHeading": "Skontrolované produkty",
          "scans": "Kontroly Safety Gate"
        },
        "bulkResults": {
          "success": "Hromadná kontrola dokončená: {{processed}} spracovaných, {{checked}} skontrolovaných, {{alertsCreated}} vytvorených upozornení."
        },
        "admin": {
          "actionNeeded": "Potrebná akcia",
          "actionNeededTitle": "{{count}} aktívne upozornenie vyžaduje kontrolu",
          "actionNeededTitle_plural": "{{count}} aktívne upozornenia vyžadujú kontrolu",
          "actionNeededDescription": "Najprv skontrolujte označené produkty, aby ste vedeli rozhodnúť, či ich ponechať v predaji, zamietnuť zhodu alebo uzavrieť upozornenie.",
          "criticalBannerTitle": "{{count}} aktívne upozornenie obsahuje vysokorizikové zhody",
          "criticalBannerTitle_plural": "{{count}} aktívne upozornenia obsahujú vysokorizikové zhody",
          "criticalBannerDescription": "{{count}} aktívna zhoda je označená ako vysoké alebo vážne riziko. Tieto produkty riešte prednostne ešte pred ďalším predajom.",
          "criticalBannerDescription_plural": "{{count}} aktívne zhody sú označené ako vysoké alebo vážne riziko. Tieto produkty riešte prednostne ešte pred ďalším predajom.",
          "warningBannerTitle": "{{count}} aktívne upozornenie potrebuje rozhodnutie merchanta",
          "warningBannerTitle_plural": "{{count}} aktívne upozornenia potrebujú rozhodnutie merchanta",
          "warningBannerDescription": "Skontrolujte tieto zhody, zamietnite falošné poplachy alebo potvrdené problémy uzavrite, aby bol zoznam stále použiteľný.",
          "storeStatus": "Stav obchodu",
          "noActiveAlertsTitle": "Žiadne aktívne bezpečnostné upozornenia",
          "noActiveAlertsDescription": "Posledné kontroly momentálne nevyžadujú zásah. Pokračujte v skenovaní novo pridaných produktov, aby ste udržali pokrytie.",
          "activeAlertsDescription": "Produkty, pri ktorých ešte treba rozhodnúť.",
          "catalogCoverageTitle": "Pokrytie katalógu",
          "catalogCoverageDescription": "Podiel katalógu, ktorý už bol skontrolovaný voči Safety Gate.",
          "checksCompletedTitle": "Dokončené kontroly",
          "checksCompletedDescription": "Zahŕňa automatické aj manuálne kontroly.",
          "resolvedRateTitle": "Miera uzavretia",
          "resolvedRateDescription": "Aká časť zaznamenaných upozornení už bola uzavretá.",
          "priorityQueue": "Prioritný zoznam",
          "recentAlertsTitle": "Nedávne bezpečnostné upozornenia",
          "recentAlertsDescription": "Najnovšie označené produkty z vášho obchodu, zoradené tak, aby na ne merchant vedel rýchlo reagovať.",
          "noAlertsTitle": "Zatiaľ žiadne upozornenia",
          "noAlertsDescription": "Zoznam upozornení sa zobrazí po prvej zistenej nebezpečnej zhode produktu.",
          "fallbackAlertDescription": "Zhoda s upozornením v databáze Safety Gate.",
          "coverage": "Pokrytie",
          "bulkCheckTitle": "Hromadná kontrola katalógu",
          "bulkCheckDescription": "Najprv skontrolujte nekontrolované produkty alebo zahrňte celý katalóg, ak chcete spustiť nový úplný prechod.",
          "bulkCheckAllSummary": "Spustí sa úplná kontrola všetkých {{count}} produktov.",
          "bulkCheckUncheckedSummary": "Skontroluje sa zostávajúcich {{count}} produktov a preskočí sa {{skip}} už skontrolovaných položiek.",
          "latestRun": "Posledný beh",
          "bulkCheckSummary": "Súhrn hromadnej kontroly",
          "bulkCheckSummaryDescription": "Súhrn ostáva kompaktný, aby merchant vedel potvrdiť výsledky bez otvárania ďalšej obrazovky.",
          "stats": {
            "totalProducts": "Všetky produkty",
            "alreadyChecked": "Už skontrolované",
            "stillUnchecked": "Ešte nekontrolované",
            "checked": "Skontrolované",
            "skipped": "Preskočené",
            "alertsCreated": "Vytvorené upozornenia",
            "errors": "Chyby"
          },
          "results": {
            "completed": "Dokončené",
            "alertCreated": "Upozornenie vytvorené",
            "error": "Chyba",
            "skipped": "Preskočené",
            "checked": "Skontrolované"
          },
          "reviewOneProduct": "Skontrolovať jeden produkt",
          "runBulkCheck": "Spustiť hromadnú kontrolu"
        }
      },
      "nav": {
        "dashboard": "Nástenka",
        "safetyAlerts": "Bezpečnostné upozornenia",
        "manualCheck": "Manuálna kontrola",
        "settings": "Nastavenia"
      },
      "settings": {
        "title": "Nastavenia",
        "subtitle": "Nakonfigurujte prahy a preferencie pre monitorovanie Safety Gate.",
        "threshold": {
          "title": "Prah podobnosti",
          "howItWorks": "Ako to funguje",
          "description": "Prah podobnosti určuje, ako presne musí produkt zodpovedať upozorneniu Safety Gate. Vyššie hodnoty (napr. 80%) znamenajú prísnejšie porovnávanie s menším počtom falošných zhôd. Nižšie hodnoty (napr. 40%) zachytia viac potenciálnych zhôd, ale môžu zahŕňať falošné zhody.",
          "currentDefault": "Aktuálne predvolené prostredie",
          "label": "Prah podobnosti (%)",
          "save": "Uložiť",
          "resetToDefault": "Obnoviť predvolené"
        },
        "monitoring": {
          "title": "Monitorovanie",
          "automatic": {
            "title": "Automatická kontrola",
            "description": "Produkty sú automaticky kontrolované pri vytvorení alebo aktualizácii cez webhooky.",
            "enabled": "Povolené"
          },
          "manual": {
            "title": "Manuálne kontroly",
            "description": "Spustite kontroly bezpečnosti na požiadanie pre akýkoľvek produkt vo vašom katalógu.",
            "goToManualCheck": "Prejsť na manuálnu kontrolu"
          }
        },
        "navigation": {
          "title": "Navigácia",
          "dashboard": "Nástenka",
          "viewAlerts": "Zobraziť upozornenia",
          "manualCheck": "Manuálna kontrola"
        }
      },
      "common": {
        "loading": "Načítava sa...",
        "confirm": "Potvrdiť",
        "cancel": "Zrušiť",
        "language": "Jazyk",
        "all": "Všetky",
        "unknown": "Neznáme"
      },
      "actions": {
        "checkAll": "Skontrolovať všetky produkty",
        "checking": "Kontrolujem...",
        "checkAllProducts": "Skontrolovať všetkých {{count}} produktov",
        "checkUnchecked": "Skontrolovať {{count}} nekontrolovaných",
        "manualCheck": "Manuálna kontrola",
        "settings": "Nastavenia",
        "viewAlerts": "Zobraziť upozornenia",
        "reviewAlerts": "Skontrolovať upozornenia",
        "dashboard": "Nástenka",
        "tryAgain": "Skúsiť znova",
        "retry": "Skúsiť znova",
        "previous": "Predchádzajúca",
        "next": "Ďalšia",
        "view": "Zobraziť",
        "viewDetails": "Zobraziť detaily",
        "resolve": "Vyriešiť",
        "reactivate": "Reaktivovať"
      },
      "resolveActions": {
        "menuLabel": "Akcie riešenia",
        "actionTaken": "Vykonaná akcia",
        "noActionNeeded": "Akcia nie je potrebná",
        "verifiedSafe": "Produkt overený ako bezpečný",
        "removedFromSale": "Stiahnuté z predaja",
        "modifiedProduct": "Produkt upravený",
        "contactedSupplier": "Kontaktovaný dodávateľ",
        "falsePositive": "Falošná zhoda",
        "notMyProduct": "Nie je môj produkt"
      },
      "dates": {
        "today": "Dnes",
        "yesterday": "Včera",
        "daysAgo": "Pred {{count}} dňami",
        "weeksAgo": "Pred {{count}} týždňami"
      },
      "status": {
        "allClear": "Všetko čisté",
        "needsReview": "Vyžaduje kontrolu",
        "monitored": "Monitorované",
        "runCheck": "Spustiť kontrolu",
        "archived": "Archivované",
        "resolved": "vyriešené",
        "dismissed": "zamietnuté",
        "notChecked": "Nekontrolované",
        "safe": "Bezpečné",
        "unsafe": "Nebezpečné",
        "updated": "Aktualizované",
        "flagged": "označené"
      },
      "analysis": {
        "withImage": "Kontrola s obrázkami",
        "textOnly": "Len textová kontrola",
        "noIssuesFound": "Neboli nájdené bezpečnostné problémy",
        "potentialRisk": "Potenciálne bezpečnostné riziko",
        "checkedAt": "Skontrolované: {{date}}",
        "productImagesUsed": "Obrázky produktu: {{used}} / {{provided}}",
        "alertImagesUsed": "Porovnané obrázky alertov: {{count}}",
        "candidateAlerts": "Kandidátne alerty",
        "overallMatch": "Celková zhoda",
        "imageMatch": "Zhoda obrázka",
        "overallMatchShort": "{{count}}% celkom",
        "imageMatchShort": "{{count}}% obrázok",
        "scoreHelper": "Celková zhoda je finálne skóre pre rozhodnutie. Zhoda obrázka vyjadruje len podobnosť obalu.",
        "whyThisMatched": "Prečo vznikla zhoda",
        "imageDominated": "Táto zhoda bola skórovaná image-first vážením, takže vizuálna podobnosť obalu mala vyššiu váhu než textové rozdiely.",
        "matchesHint": "Začnite prvou kartou zhody nižšie. Najprv potvrďte podobnosť obalu, potom model a značku.",
        "primaryRiskFocus": "Hlavné riziko na kontrolu: {{category}} na úrovni {{level}}. Toto overte ako prvé.",
        "focus": {
          "criticalTitle": "Potrebná okamžitá akcia",
          "criticalLead": "Produkt má zhodu s vysokou istotou. Vyriešte ho až po kontrole.",
          "criticalStepCompare": "Porovnajte fotku produktu s prvou zhodou zo Safety Gate nižšie.",
          "criticalStepDecide": "Vyberte riešenie v menu Vyriešiť podľa výsledku kontroly.",
          "criticalStepDocument": "Doplňte internú poznámku kvôli dohľadateľnosti a komunikácii s dodávateľom.",
          "safeTitle": "Nie je potrebná urgentná akcia",
          "safeLead": "Aktuálny výsledok je bezpečný. Pokračujte v monitorovaní zmien produktu.",
          "safeStepMonitor": "Nechajte produkt v automatickom monitorovaní.",
          "safeStepRecheck": "Spustite novú kontrolu pri zmene obrázkov, obalu alebo dodávateľa.",
          "safeStepClose": "Zatvorte detail a pokračujte na ďalšie aktívne upozornenia.",
          "reviewedTitle": "Kontrola už bola uzavretá",
          "reviewedLead": "Tento alert nie je aktívny. Udržujte záznam čistý pre audit.",
          "reviewedStepAudit": "Overte zvolený typ riešenia a poznámky.",
          "reviewedStepReactivate": "Reaktivujte len ak pribudnú nové dôkazy o produkte."
        }
      },
      "pagination": {
        "pageOf": "Strana {{current}} z {{total}} ({{count}} upozornení)"
      },
      "alerts": {
        "title": "Bezpečnostné upozornenia",
        "subtitle": "Filtrovať a spracovať zhody zo Safety Gate.",
        "breadcrumbs": {
          "dashboard": "Nástenka",
          "current": "Bezpečnostné upozornenia"
        },
        "meta": {
          "active": "{{count}} aktívne",
          "total": "{{count}} celkom"
        },
        "metrics": {
          "activeHeading": "Aktívne upozornenia",
          "totalRecorded": "{{count}} zaznamenaných",
          "resolutionHeading": "Miera vyriešenia",
          "resolved": "{{count}} vyriešených",
          "resolvedAndDismissed": "{{resolved}} vyriešených • {{dismissed}} zamietnutých",
          "dismissedHeading": "Zamietnuté",
          "archived": "Archivované",
          "dismissedDescriptionZero": "Zatiaľ žiadne zamietnuté upozornenia",
          "dismissedDescription": "Uchovávajte poznámky pre audit"
        },
        "pagination": {
          "previous": "Predchádzajúca",
          "next": "Ďalšia"
        },
        "checklist": {
          "title": "Kontrolný zoznam reakcie",
          "items": [
            "Uprednostnite aktívne upozornenia",
            "Zaznamenajte kroky nápravy",
            "Overte pred zamietnutím"
          ]
        },
        "table": {
          "accessibilityLabel": "Tabuľka bezpečnostných upozornení",
          "tabs": {
            "all": "Všetky",
            "active": "Aktívne",
            "resolved": "Vyriešené",
            "dismissed": "Zamietnuté"
          },
          "searchLabel": "Hľadať upozornenia",
          "searchPlaceholder": "Hľadajte podľa názvu produktu...",
          "sort": "Triediť",
          "sortBy": "Triediť podľa",
          "sortOptions": {
            "created": "Dátum zistenia",
            "risk": "Úroveň rizika",
            "name": "Názov produktu"
          },
          "order": "Poradie",
          "orderOptions": {
            "desc": "Najnovšie ako prvé",
            "asc": "Najstaršie ako prvé"
          },
          "headers": {
            "product": "Produkt",
            "status": "Stav",
            "risk": "Riziko",
            "detected": "Zistené",
            "actions": "Akcie"
          },
          "empty": "Žiadne upozornenia pre zvolené filtre",
          "thumbnailLabel": "Náhľad {{title}}",
          "selectedCount": "Vybratých: {{count}}",
          "similarityTooltip": "Miera podobnosti: {{score}}%"
        },
        "admin": {
          "actionNeeded": "Potrebná akcia",
          "actionNeededTitle": "{{count}} aktívne upozornenie ešte čaká na rozhodnutie",
          "actionNeededTitle_plural": "{{count}} aktívne upozornenia ešte čakajú na rozhodnutie",
          "actionNeededDescription": "Skontrolujte zhody, zamietnite falošné poplachy alebo uzavrite potvrdené riziká, aby zoznam upozornení ostal použiteľný.",
          "criticalBannerTitle": "{{count}} aktívne upozornenie obsahuje vysokorizikové produkty",
          "criticalBannerTitle_plural": "{{count}} aktívne upozornenia obsahujú vysokorizikové produkty",
          "criticalBannerDescription": "{{count}} aktívne upozornenie je označené ako vysoké alebo vážne riziko. Najprv vyriešte tieto produkty.",
          "criticalBannerDescription_plural": "{{count}} aktívne upozornenia sú označené ako vysoké alebo vážne riziko. Najprv vyriešte tieto produkty.",
          "warningBannerTitle": "{{count}} aktívne upozornenie stále čaká na kontrolu",
          "warningBannerTitle_plural": "{{count}} aktívne upozornenia stále čakajú na kontrolu",
          "warningBannerDescription": "Tento zoznam používajte len na reálne rozhodnutia: potvrdené riziká vyriešte a falošné zhody rýchlo zamietnite.",
          "queue": "Zoznam upozornení",
          "queueDescription": "Tabuľka je zameraná na rozhodnutia: filtrujte podľa stavu, hľadajte podľa názvu produktu a spracujte zhody na jednom mieste."
        },
        "toasts": {
          "updated": "Upozornenie bolo aktualizované"
        }
      },
      "manualCheck": {
        "title": "Manuálna bezpečnostná kontrola",
        "subtitle": "Spustite cielenú kontrolu Safety Gate pre konkrétny produkt.",
        "breadcrumbs": {
          "dashboard": "Nástenka",
          "current": "Manuálna kontrola"
        },
        "badges": {
          "flagged": "{{count}} označených",
          "checks": "{{count}} kontrol"
        },
        "banners": {
          "failedHeading": "Kontrola zlyhala",
          "alertHeading": "Vytvorené bezpečnostné upozornenie",
          "alertDescription": "Pre tento produkt bola nájdená potenciálna bezpečnostná hrozba.",
          "textOnlyHeading": "Porovnanie podľa obrázkov nebolo dostupné",
          "textOnlyDescription": "Tento výsledok použil len textové polia. Ak produkt závisí od vizuálnych rozdielov, zhodu skontrolujte dôkladnejšie."
        },
        "overview": {
          "title": "Prehľad kontrol",
          "productsInScope": "Produkty v rozsahu",
          "productsDescription": "Najnovšie produkty z vášho obchodu.",
          "manualCompleted": "Dokončené manuálne kontroly",
          "manualCompletedDescription": "{{checked}} z {{total}} produktov skontrolovaných",
          "coverage": "{{coverage}}% pokrytie",
          "productsFlagged": "Produkty s rizikom",
          "noRisks": "Zatiaľ neboli zistené žiadne riziká.",
          "prioritise": "Uprednostnite tieto produkty na akciu."
        },
        "catalogue": {
          "heading": "Katalóg produktov ({{count}})",
          "emptyHeading": "Žiadne produkty",
          "emptyBody": "Nie sú dostupné žiadne produkty na kontrolu.",
          "columns": {
            "product": "Produkt",
            "status": "Stav",
            "checks": "Kontroly",
            "action": "Akcia"
          },
          "unknownVendor": "Neznámy dodávateľ",
          "noType": "Bez typu",
          "lastChecked": "Naposledy kontrolované {{date}}",
          "totalChecks": "{{count}} celkom",
          "firstCheck": "Spustite prvú kontrolu",
          "status": {
            "safe": "Bezpečné",
            "unsafe": "Nebezpečné",
            "notChecked": "Nekontrolované"
          },
          "actions": {
            "checkAgain": "Skontrolovať znova",
            "checkSafety": "Skontrolovať bezpečnosť"
          }
        },
        "quickActions": {
          "title": "Rýchle akcie"
        },
        "modal": {
          "unknownProduct": "Neznámy produkt",
          "unknown": "Neznáme"
        },
        "admin": {
          "manualReview": "Manuálna kontrola",
          "manualReviewDescription": "Vyberte produkt z posledných aktualizácií katalógu a spustite cielenú kontrolu Safety Gate na požiadanie.",
          "checkFailed": "Kontrola zlyhala",
          "productFlagged": "Produkt označený",
          "catalog": "Katalóg",
          "catalogDescription": "Produkty sú zoradené podľa posledných aktualizácií v Shopify, aby bolo možné najprv skontrolovať čerstvé zmeny."
        },
        "toasts": {
          "completed": "Bezpečnostná kontrola je dokončená",
          "flagged": "Našiel sa možný bezpečnostný problém"
        }
      },
      "portal": {
        "title": "Portál Safety Gate",
        "description": "Prístup k oficiálnej databáze Safety Gate na vyhľadávanie nebezpečných produktov a detailných upozornení.",
        "searchDatabase": "Vyhľadať v databáze",
        "searchDescription": "Vyhľadajte nebezpečné produkty v EU Safety Gate",
        "home": "Hlavná stránka Safety Gate",
        "homeDescription": "Prístup k oficiálnemu portálu Európskej komisie"
      },
      "errors": {
        "pageLoadFailed": "Načítanie stránky zlyhalo",
        "unknown": "Niekde nastala chyba",
        "apiError": "Externá bezpečnostná služba je dočasne nedostupná. Skúste to prosím neskôr."
      },
      "news": {
        "title": "Novinky",
        "items": {
          "databaseUpdate": {
            "date": "Dec 2025",
            "title": "Aktualizovaná databáza Safety Gate",
            "description": "Databáza Safety Gate sa priebežne aktualizuje o nové upozornenia. Spúšťajte pravidelné kontroly, aby ste ostali v súlade."
          },
          "gpsr": {
            "date": "GPSR 2024",
            "title": "Nariadenie o všeobecnej bezpečnosti výrobkov",
            "description": "Zistite požiadavky GPSR a ako zabezpečiť, že vaše produkty spĺňajú štandardy EÚ."
          }
        }
      },
      "settingsAdmin": {
        "configuration": "Konfigurácia",
        "configurationDescription": "Stránka je zameraná na jedno rozhodnutie merchanta: aké prísne má byť porovnávanie produktov s upozorneniami Safety Gate.",
        "currentThreshold": "Aktuálny prah",
        "storeSetting": "Nastavenie obchodu",
        "currentThresholdDescription": "Nižšie hodnoty zachytia viac možných zhôd. Vyššie hodnoty znižujú počet falošných poplachov.",
        "environmentDefault": "Predvolená hodnota prostredia",
        "fallback": "Záloha",
        "environmentDefaultDescription": "Použije sa vtedy, keď obchod ešte nemá uložený vlastný prah.",
        "matchingStrictness": "Prísnosť porovnávania",
        "strictnessHint": "40-60% znamená širšie skenovanie. 70-85% je prísnejšie a zvyčajne vytvára menej falošných zhôd.",
        "guidance": "Odporúčania",
        "recommendedSetup": "Odporúčané nastavenie",
        "guidanceItems": {
          "broadTitle": "Širšie monitorovanie",
          "broadDescription": "Použite okolo 50%, ak chcete zachytiť viac možných zhôd a neprekáža vám viac manuálneho preverovania.",
          "balancedTitle": "Vyvážený základ",
          "balancedDescription": "Použite približne 65-70% pre praktický pomer medzi zachytením zhôd a presnosťou pre väčšinu Shopify katalógov.",
          "strictTitle": "Prísne porovnávanie",
          "strictDescription": "Použite 80%+ ak je váš katalóg stabilný a chcete menej manuálnych kontrol."
        },
        "workspace": "Pracovné prostredie",
        "onDemand": "Na požiadanie"
      }
    }
  }
};

const i18nInstance = i18n.use(initReactI18next);

// Only use language detector on the client
if (typeof window !== "undefined") {
  i18nInstance.use(LanguageDetector);
}

i18nInstance.init({
  resources,
  fallbackLng: "en",
  lng: typeof window === "undefined" ? "en" : undefined, // Force English on server to prevent singleton pollution
  interpolation: {
    escapeValue: false
  }
});

export default i18n;
