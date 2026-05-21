const sk = {
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
        "close": "Zatvoriť",
        "language": "Jazyk",
        "all": "Všetky",
        "unknown": "Neznáme"
      },
      "actions": {
        "checkAll": "Skontrolovať všetky produkty",
        "checkNewSafetyGateAlerts": "Skontrolovať nové Safety Gate alerty",
        "checkOneProduct": "Skontrolovať jeden produkt",
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
        "search": "Hľadať",
        "clear": "Vymazať",
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
        "modalHeading": "Skontrolovať zhodu zo Safety Gate",
        "yourProduct": "Váš produkt v Shopify",
        "editInShopify": "Upraviť produkt v Shopify",
        "safetyGateMatches": "Zhody v Safety Gate",
        "riskLevel": "Úroveň rizika",
        "riskDescription": "Popis rizika",
        "legalProvision": "Právne ustanovenie",
        "viewOnSafetyGate": "Zobraziť v Safety Gate",
        "alertNumber": "Alert {{number}}",
        "enlargedSafetyAlert": "Zväčšený obrázok bezpečnostného upozornenia",
        "fields": {
          "accessibilityLabel": "Tabuľka podrobností o zhode alertu",
          "field": "Pole",
          "value": "Hodnota",
          "productName": "Názov produktu",
          "brand": "Značka",
          "model": "Model",
          "category": "Kategória",
          "notifyingCountry": "Oznamujúca krajina",
          "origin": "Pôvod",
          "alertDate": "Dátum alertu",
          "productDescription": "Popis produktu"
        },
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
          "accessibilityLabel": "Tabuľka katalógu produktov",
          "heading": "Katalóg produktov ({{count}})",
          "emptyHeading": "Žiadne produkty",
          "emptyBody": "Nie sú dostupné žiadne produkty na kontrolu.",
          "columns": {
            "product": "Produkt",
            "status": "Stav",
            "checks": "Kontroly",
            "action": "Akcia"
          },
          "searchLabel": "Nájsť produkt",
          "searchPlaceholder": "Hľadajte podľa názvu, SKU, dodávateľa alebo typu",
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
      },
      "onboarding": {
        "title": "Vitajte v Safety Gate EU",
        "subtitle": "Zabezpečte súlad svojho obchodu Shopify s legislatívou EÚ v 3 jednoduchých krokoch.",
        "stepIndicator": "Krok {{current}} z {{total}}",
        "back": "Späť",
        "nextStep": "Ďalší krok",
        "finishButton": "Dokončiť nastavenie a prejsť na prehľad",
        "steps": {
          "sensitivity": {
            "title": "Krok 1: Nastavenie citlivosti AI porovnávania",
            "description": "Určite, ako tesne sa musí produkt zhodovať so záznamom v Safety Gate, aby sa spustilo upozornenie.",
            "label": "Nastavenia citlivosti",
            "thresholdLabel": "Prah citlivosti: {{value}}%",
            "broad": "40% (Voľný - Viac varovaní)",
            "balanced": "70% (Odporúčaný - Vyvážený)",
            "strict": "90% (Prísny - Menej varovaní)",
            "calibration": {
              "broadTitle": "Režim širokej detekcie",
              "broadDesc": "Vysoká citlivosť. Zachytí aj vzdialenejšie podobnosti. Odporúča sa, ak predávate rizikové kategórie (hračky, elektronika) a chcete maximálne pokrytie, no očakávate viac falošných upozornení.",
              "balancedTitle": "Režim vyváženej detekcie",
              "balancedDesc": "Štandardná citlivosť. Optimalizovaný pomer medzi presnosťou a počtom upozornení. Skenuje názvy, popisy a overuje kľúčové značky a modelové štruktúry.",
              "strictTitle": "Režim prísnej detekcie",
              "strictDesc": "Vysoká presnosť. Filtruje drobné podobnosti. Varovania sa spustia len pri veľmi jasných zhodách názvov značiek/modelov. Minimálna miera falošných upozornení."
            }
          },
          "scan": {
            "title": "Krok 2: Spustenie prvého skenovania katalógu",
            "description": "Naskenujte svoj aktívny katalóg produktov v Shopify proti databáze Safety Gate na identifikáciu existujúcich rizík.",
            "label": "Prvé skenovanie",
            "toScan": "Produkty na skenovanie: {{count}}",
            "scanning": "Porovnávam produkty s databázou Safety Gate...",
            "complete": "Skenovanie katalógu dokončené!",
            "scanned": "Naskenované produkty: {{count}}",
            "alerts": "Vytvorené varovania: {{count}}",
            "startButton": "Spustiť skenovanie katalógu"
          },
          "automation": {
            "title": "Krok 3: Automatický monitoring a upozornenia",
            "description": "Nakonfigurujte si automatickú karanténu rizikových produktov a notifikácie v reálnom čase.",
            "label": "Bezpečnostná automatizácia",
            "webhooks": {
              "title": "Skenovanie v reálnom čase",
              "desc": "Produkty sa automaticky skontrolujú voči EÚ databáze pri každom vytvorení alebo aktualizácii."
            },
            "quarantine": {
              "title": "Automatická karanténa vážnych rizík",
              "desc": "Automaticky zmeniť stav produktov v Shopify na Koncept (Draft), ak vykazujú vážnu zhodu s nebezpečným produktom (skóre >= 95%).",
              "label": "Zapnúť automatickú karanténu (Draft)"
            },
            "notify": {
              "title": "Nastavenia upozornení",
              "label": "Posielať e-mailové reporty o rizikových zhodách"
            },
            "slack": {
              "title": "Slack integrácia (Voliteľné)",
              "desc": "Vložte URL adresu prichádzajúceho webhooku Slack pre okamžité odosielanie upozornení.",
              "placeholder": "https://hooks.slack.com/services/..."
            }
          }
        }
      },
      "uxEnhancements": {
        "complianceRing": {
          "title": "Miera Súladu",
          "subtitle": "Percento produktov obchodu overených ako bezpečné",
          "scoreLabel": "Súlad"
        },
        "activityTimeline": {
          "title": "Záznam Nedávnej Aktivity",
          "description": "Historický prehľad bezpečnostných skenov a správy upozornení.",
          "noActivity": "Žiadne nedávne udalosti. Udržujte produkty aktualizované.",
          "actions": {
            "check": "Kontrola produktu dokončená",
            "quarantine": "Produkt automaticky stiahnutý (karanténa)",
            "resolve": "Upozornenie vyriešené",
            "dismiss": "Upozornenie zamietnuté"
          },
          "details": {
            "checkSafe": "Produkt bol skontrolovaný a označený ako bezpečný.",
            "checkUnsafe": "Bolo zistené bezpečnostné riziko! Vytvorené upozornenie.",
            "bulkScanned": "Hromadný sken katalógu bol dokončený.",
            "autoDrafted": "Stav produktu bol v Shopify zmenený na Koncept.",
            "reason": "Dôvod: {{reason}}",
            "noReason": "Dôvod nebol špecifikovaný."
          },
          "types": {
            "automatic": "Systémová udalosť",
            "manual": "Akcia obchodníka",
            "bulk": "Hromadný sken"
          }
        },
        "alerts": {
          "floating": {
            "selectedCount": "{{count}} vybrané upozornenie",
            "selectedCount_plural": "{{count}} vybraných upozornení",
            "resolveSelected": "Vyriešiť vybrané",
            "dismissSelected": "Zamietnuť vybrané"
          },
          "quickFilters": {
            "title": "Rýchle filtre",
            "allAlerts": "Všetky upozornenia",
            "allAlertsDesc": "Zobraziť všetky bezpečnostné varovania.",
            "needsReview": "Vyžaduje kontrolu",
            "needsReviewDesc": "Nevyriešené bezpečnostné upozornenia.",
            "highRisk": "Iba vysoké riziko",
            "highRiskDesc": "Závažné úrovne rizika vyžadujúce akciu.",
            "resolved": "Vyriešené / Zamietnuté",
            "resolvedDesc": "Historické upozornenia uchované pre audit."
          }
        }
      }
    }
  } as const;

export default sk;
