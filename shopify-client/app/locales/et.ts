import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({ dashboard: "Töölaud", alertsLabel: "Ohutusteated", manual: "Käsitsi kontroll", settings: "Seaded", language: "Keel", reviewAlerts: "Vaata teateid", search: "Otsi", clear: "Tühjenda", needsReview: "Vajab ülevaatust", safe: "Ohutu", notChecked: "Kontrollimata", alertsTitle: "Ohutusteated", findProduct: "Leia toode",
  long: {
    "dashboardRecentAlertsDescription": "Teie poe viimased märgitud tooted on järjestatud nii, et kaupmees saaks kiiresti tegutseda.",
    "dashboardNoAlertsDescription": "Hoiatuste loend ilmub siia pärast esimese ohtliku tootega seotud vaste tuvastamist.",
    "alertsQueueDescription": "Hoidke tabel otsustele keskendununa: filtreerige oleku järgi, otsige tooteid ja lahendage vasted ühest kohast.",
    "manualReviewDescription": "Valige toode viimastest kataloogi uuendustest ja käivitage sihitud Safety Gate kontroll.",
    "manualCatalogDescription": "Tooted on sorteeritud viimaste Shopify uuenduste järgi, et värskeid muudatusi saaks esimesena kontrollida.",
    "settingsThresholdDescription": "Sarnasuse lävi määrab, kui täpselt peab toode vastama Safety Gate hoiatusele. Kõrgemad väärtused on rangemad ja vähendavad valepositiivseid tulemusi. Madalamad väärtused leiavad rohkem võimalikke vasteid.",
    "settingsStrictnessHint": "40-60% on laiem skaneerimine. 70-85% on rangem ja annab tavaliselt vähem valepositiivseid tulemusi.",
    "settingsBalancedDescription": "Kasutage umbes 65-70%, et saavutada praktiline tasakaal katvuse ja täpsuse vahel enamiku Shopify kataloogide jaoks.",
    "analysisMatchesHint": "Alustage allolevast esimesest vastekaardist ja kinnitage esmalt pakendi visuaalne sarnasus, seejärel mudel ja kaubamärk.",
    "analysisScoreHelper": "Üldine vaste on lõplik hindamisskoor. Pildi vaste näitab ainult pakendi sarnasust."
  }
});