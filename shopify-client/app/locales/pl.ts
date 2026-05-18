import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({ dashboard: "Panel", alertsLabel: "Alerty bezpieczeństwa", manual: "Kontrola ręczna", settings: "Ustawienia", language: "Język", reviewAlerts: "Przejrzyj alerty", search: "Szukaj", clear: "Wyczyść", needsReview: "Wymaga przeglądu", safe: "Bezpieczny", notChecked: "Nie sprawdzono", alertsTitle: "Alerty bezpieczeństwa", findProduct: "Znajdź produkt",
  long: {
    "dashboardRecentAlertsDescription": "Najnowsze oznaczone produkty z Twojego sklepu są uporządkowane tak, aby można było szybko podjąć działania.",
    "dashboardNoAlertsDescription": "Lista alertów pojawi się tutaj po wykryciu pierwszego dopasowania z niebezpiecznym produktem.",
    "alertsQueueDescription": "Utrzymuj tabelę skupioną na decyzjach: filtruj po statusie, wyszukuj produkty i obsługuj dopasowania w jednym miejscu.",
    "manualReviewDescription": "Wybierz produkt z ostatnich aktualizacji katalogu i uruchom ukierunkowaną kontrolę Safety Gate.",
    "manualCatalogDescription": "Produkty są sortowane według najnowszych aktualizacji Shopify, aby najpierw sprawdzać świeże zmiany.",
    "settingsThresholdDescription": "Próg podobieństwa określa, jak blisko produkt musi pasować do alertu Safety Gate. Wyższe wartości są bardziej rygorystyczne i ograniczają fałszywe alarmy. Niższe wartości wykrywają więcej możliwych dopasowań.",
    "settingsStrictnessHint": "40-60% oznacza szersze skanowanie. 70-85% jest bardziej rygorystyczne i zwykle daje mniej fałszywych alarmów.",
    "settingsBalancedDescription": "Użyj około 65-70%, aby uzyskać praktyczną równowagę między zasięgiem a precyzją dla większości katalogów Shopify.",
    "analysisMatchesHint": "Zacznij od górnej karty dopasowania i najpierw potwierdź wizualne podobieństwo opakowania, potem model i markę.",
    "analysisScoreHelper": "Ogólne dopasowanie to końcowy wynik oceny. Dopasowanie obrazu odzwierciedla tylko podobieństwo opakowania."
  }
});