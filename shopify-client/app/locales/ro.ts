import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({ dashboard: "Tablou de bord", alertsLabel: "Alerte de siguranță", manual: "Verificare manuală", settings: "Setări", language: "Limbă", reviewAlerts: "Revizuiește alertele", search: "Caută", clear: "Șterge", needsReview: "Necesită revizuire", safe: "Sigur", notChecked: "Neverificat", alertsTitle: "Alerte de siguranță", findProduct: "Găsește produs",
  long: {
    "dashboardRecentAlertsDescription": "Cele mai recente produse marcate din magazin sunt ordonate pentru ca comercianții să poată acționa rapid.",
    "dashboardNoAlertsDescription": "Lista alertelor va apărea aici după prima potrivire detectată cu un produs periculos.",
    "alertsQueueDescription": "Păstrați tabelul orientat pe decizii: filtrați după stare, căutați produse și rezolvați potrivirile dintr-un singur loc.",
    "manualReviewDescription": "Alegeți un produs din cele mai recente actualizări ale catalogului și rulați o verificare Safety Gate țintită.",
    "manualCatalogDescription": "Produsele sunt sortate după cele mai recente actualizări Shopify, astfel încât modificările noi să fie verificate primele.",
    "settingsThresholdDescription": "Pragul de similaritate stabilește cât de aproape trebuie să se potrivească un produs cu o alertă Safety Gate. Valorile mai mari sunt mai stricte și reduc alarmele false. Valorile mai mici găsesc mai multe potriviri posibile.",
    "settingsStrictnessHint": "40-60% înseamnă scanare mai largă. 70-85% este mai strict și de obicei produce mai puține alarme false.",
    "settingsBalancedDescription": "Folosiți aproximativ 65-70% pentru un echilibru practic între acoperire și precizie în majoritatea cataloagelor Shopify.",
    "analysisMatchesHint": "Începeți cu primul card de potrivire și confirmați mai întâi similaritatea vizuală a ambalajului, apoi modelul și marca.",
    "analysisScoreHelper": "Potrivirea generală este scorul final de revizuire. Potrivirea imaginii reflectă doar similaritatea ambalajului."
  }
});