import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({
  dashboard: "Přehled",
  alertsLabel: "Bezpečnostní upozornění",
  manual: "Ruční kontrola",
  settings: "Nastavení",
  language: "Jazyk",
  reviewAlerts: "Zkontrolovat upozornění",
  search: "Hledat",
  clear: "Vymazat",
  needsReview: "Vyžaduje kontrolu",
  safe: "Bezpečné",
  unsafe: "Nebezpečné",
  notChecked: "Nezkontrolováno",
  alertsTitle: "Bezpečnostní upozornění",
  findProduct: "Najít produkt",
  all: "Vše",
  unknown: "Neznámé",
  close: "Zavřít",
  long: {
    "dashboardRecentAlertsDescription": "Nejnovější označené produkty z vašeho obchodu jsou seřazené tak, aby obchodník mohl rychle jednat.",
    "dashboardNoAlertsDescription": "Seznam upozornění se zobrazí po první zjištěné shodě s nebezpečným produktem.",
    "alertsQueueDescription": "Udržujte tabulku zaměřenou na rozhodnutí: filtrujte podle stavu, hledejte názvy produktů a řešte shody z jednoho místa.",
    "manualReviewDescription": "Vyberte produkt z posledních aktualizací katalogu a spusťte cílenou kontrolu Safety Gate.",
    "manualCatalogDescription": "Produkty jsou seřazeny podle posledních aktualizací v Shopify, aby bylo možné nejdříve znovu zkontrolovat čerstvé změny.",
    "settingsThresholdDescription": "Práh podobnosti určuje, jak blízko musí produkt odpovídat upozornění Safety Gate. Vyšší hodnoty znamenají přísnější shodu a méně falešných poplachů. Nižší hodnoty zachytí více možných shod.",
    "settingsStrictnessHint": "40-60% znamená širší skenování. 70-85% je přísnější a obvykle vytváří méně falešných poplachů.",
    "settingsBalancedDescription": "Použijte přibližně 65-70% pro praktickou rovnováhu mezi záchytem a přesností u většiny Shopify katalogů.",
    "analysisMatchesHint": "Začněte první kartou shody níže a nejdříve potvrďte vizuální podobnost obalu, potom model a značku.",
    "analysisScoreHelper": "Celková shoda je finální skóre pro rozhodnutí. Shoda obrázku vyjadřuje pouze podobnost obalu."
  }
});