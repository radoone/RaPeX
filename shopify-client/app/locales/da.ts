import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({
  dashboard: "Dashboard",
  alertsLabel: "Sikkerhedsadvarsler",
  manual: "Manuel kontrol",
  settings: "Indstillinger",
  language: "Sprog",
  reviewAlerts: "Gennemgå advarsler",
  search: "Søg",
  clear: "Ryd",
  needsReview: "Kræver gennemgang",
  safe: "Sikker",
  unsafe: "Usikker",
  notChecked: "Ikke kontrolleret",
  alertsTitle: "Sikkerhedsadvarsler",
  findProduct: "Find produkt",
  all: "Alle",
  unknown: "Ukendt",
  close: "Luk",
  long: {
    "dashboardRecentAlertsDescription": "De senest markerede produkter fra din butik er sorteret, så du hurtigt kan handle.",
    "dashboardNoAlertsDescription": "Din advarselsliste vises her, når den første usikre produktmatch er fundet.",
    "alertsQueueDescription": "Hold tabellen fokuseret på beslutninger: filtrér efter status, søg efter produktnavne, og løs matches fra ét sted.",
    "manualReviewDescription": "Vælg et produkt fra de seneste katalogopdateringer, og kør en målrettet Safety Gate-kontrol.",
    "manualCatalogDescription": "Produkter er sorteret efter de seneste Shopify-opdateringer, så nye ændringer kan kontrolleres først.",
    "settingsThresholdDescription": "Lighedstærsklen bestemmer, hvor tæt et produkt skal matche en Safety Gate-advarsel. Højere værdier giver strengere matching med færre falske positiver. Lavere værdier finder flere mulige matches.",
    "settingsStrictnessHint": "40-60% er bredere scanning. 70-85% er strengere og giver normalt færre falske positiver.",
    "settingsBalancedDescription": "Brug omkring 65-70% for en praktisk balance mellem dækning og præcision for de fleste Shopify-kataloger.",
    "analysisMatchesHint": "Start med det øverste matchkort nedenfor, og bekræft først emballagens visuelle lighed, derefter model og brand.",
    "analysisScoreHelper": "Samlet match er den endelige vurderingsscore. Billedmatch afspejler kun emballagens lighed."
  }
});