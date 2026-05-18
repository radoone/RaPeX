import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({
  dashboard: "Dashboard",
  alertsLabel: "Sicherheitswarnungen",
  manual: "Manuelle Prüfung",
  settings: "Einstellungen",
  language: "Sprache",
  reviewAlerts: "Warnungen prüfen",
  search: "Suchen",
  clear: "Löschen",
  needsReview: "Prüfung erforderlich",
  safe: "Sicher",
  unsafe: "Unsicher",
  notChecked: "Nicht geprüft",
  alertsTitle: "Sicherheitswarnungen",
  findProduct: "Produkt finden",
  all: "Alle",
  unknown: "Unbekannt",
  close: "Schließen",
  long: {
    "dashboardRecentAlertsDescription": "Die neuesten markierten Produkte aus Ihrem Shop sind so sortiert, dass Händler schnell handeln können.",
    "dashboardNoAlertsDescription": "Ihre Warnungsliste erscheint hier, sobald der erste Treffer mit einem gefährlichen Produkt erkannt wurde.",
    "alertsQueueDescription": "Halten Sie die Tabelle auf Entscheidungen fokussiert: nach Status filtern, Produktnamen suchen und Treffer direkt an einem Ort bearbeiten.",
    "manualReviewDescription": "Wählen Sie ein Produkt aus den neuesten Katalogaktualisierungen und starten Sie eine gezielte Safety Gate-Prüfung.",
    "manualCatalogDescription": "Produkte sind nach den neuesten Shopify-Aktualisierungen sortiert, damit neue Änderungen zuerst erneut geprüft werden können.",
    "settingsThresholdDescription": "Der Ähnlichkeitsschwellenwert bestimmt, wie genau ein Produkt mit einer Safety Gate-Warnung übereinstimmen muss. Höhere Werte bedeuten strengere Treffer mit weniger Fehlalarmen. Niedrigere Werte finden mehr mögliche Treffer.",
    "settingsStrictnessHint": "40-60% ist eine breitere Suche. 70-85% ist strenger und erzeugt normalerweise weniger Fehlalarme.",
    "settingsBalancedDescription": "Verwenden Sie etwa 65-70% für eine praktische Mischung aus Trefferquote und Präzision bei den meisten Shopify-Katalogen.",
    "analysisMatchesHint": "Beginnen Sie mit der obersten Trefferkarte und prüfen Sie zuerst die visuelle Verpackungsähnlichkeit, danach Modell und Marke.",
    "analysisScoreHelper": "Die Gesamtübereinstimmung ist die finale Bewertung. Die Bildübereinstimmung zeigt nur die Verpackungsähnlichkeit."
  }
});