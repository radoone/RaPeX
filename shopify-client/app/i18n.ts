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
        }
      },
      "nav": {
        "dashboard": "Dashboard",
        "safetyAlerts": "Safety Alerts",
        "manualCheck": "Manual Check",
        "settings": "Settings",
        "quickGuide": "Quick Guide"
      },
      "settings": {
        "title": "Settings"
      },
      "guide": {
        "title": "Quick Guide",
        "importance": {
          "title": "Why monitoring Safety Gate is critical",
          "description": "Protecting your business and customers requires active monitoring of the EU Safety Gate database.",
          "points": {
            "safety": {
              "title": "Consumer Safety",
              "description": "Prevent injuries and health risks by identifying dangerous products before they reach your customers."
            },
            "compliance": {
              "title": "Legal Compliance (GPSR)",
              "description": "The new General Product Safety Regulation (GPSR) requires strict adherence to safety standards. Monitoring alerts helps you stay compliant and avoid fines."
            },
            "reputation": {
              "title": "Brand Reputation",
              "description": "Selling unsafe products can destroy customer trust. Proactive monitoring demonstrates your commitment to quality and safety."
            },
            "business": {
              "title": "Business Continuity",
              "description": "Avoid costly product recalls, market bans, and legal actions that could threaten your business operations."
            }
          }
        }
      },
      "common": {
        "loading": "Loading...",
        "confirm": "Confirm",
        "cancel": "Cancel"
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
        }
      },
      "nav": {
        "dashboard": "Nástenka",
        "safetyAlerts": "Bezpečnostné upozornenia",
        "manualCheck": "Manuálna kontrola",
        "settings": "Nastavenia",
        "quickGuide": "Rýchly návod"
      },
      "settings": {
        "title": "Nastavenia"
      },
      "guide": {
        "title": "Rýchly návod",
        "importance": {
          "title": "Prečo je monitorovanie Safety Gate kritické",
          "description": "Ochrana vášho podnikania a zákazníkov vyžaduje aktívne monitorovanie databázy Safety Gate EÚ.",
          "points": {
            "safety": {
              "title": "Bezpečnosť spotrebiteľov",
              "description": "Predchádzajte zraneniam a zdravotným rizikám identifikáciou nebezpečných produktov skôr, ako sa dostanú k vašim zákazníkom."
            },
            "compliance": {
              "title": "Právny súlad (GPSR)",
              "description": "Nové nariadenie o všeobecnej bezpečnosti výrobkov (GPSR) vyžaduje prísne dodržiavanie bezpečnostných noriem. Monitorovanie upozornení vám pomáha zostať v súlade a vyhnúť sa pokutám."
            },
            "reputation": {
              "title": "Reputácia značky",
              "description": "Predaj nebezpečných produktov môže zničiť dôveru zákazníkov. Proaktívne monitorovanie dokazuje váš záväzok ku kvalite a bezpečnosti."
            },
            "business": {
              "title": "Kontinuita podnikania",
              "description": "Vyhnite sa nákladnému sťahovaniu produktov, zákazom na trhu a právnym krokom, ktoré by mohli ohroziť vaše podnikanie."
            }
          }
        }
      },
      "common": {
        "loading": "Načítava sa...",
        "confirm": "Potvrdiť",
        "cancel": "Zrušiť"
      }
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
