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
          "started": "Started {{date}}"
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
        }
      },
      "nav": {
        "dashboard": "Dashboard",
        "safetyAlerts": "Safety Alerts",
        "manualCheck": "Manual Check",
        "settings": "Settings"
      },
      "settings": {
        "title": "Settings"
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
        "manualCheck": "Manual check",
        "settings": "Settings",
        "viewAlerts": "View alerts",
        "reviewAlerts": "Review alerts",
        "dashboard": "Dashboard",
        "tryAgain": "Try again",
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
          "thumbnailLabel": "{{title}} thumbnail"
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
          "alertDescription": "A potential safety issue was found for this product."
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
          "started": "Spustené {{date}}"
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
        }
      },
      "nav": {
        "dashboard": "Nástenka",
        "safetyAlerts": "Bezpečnostné upozornenia",
        "manualCheck": "Manuálna kontrola",
        "settings": "Nastavenia"
      },
      "settings": {
        "title": "Nastavenia"
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
        "manualCheck": "Manuálna kontrola",
        "settings": "Nastavenia",
        "viewAlerts": "Zobraziť upozornenia",
        "reviewAlerts": "Skontrolovať upozornenia",
        "dashboard": "Nástenka",
        "tryAgain": "Skúsiť znova",
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
          "thumbnailLabel": "Náhľad {{title}}"
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
          "alertDescription": "Pre tento produkt bola nájdená potenciálna bezpečnostná hrozba."
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
