import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({ dashboard: "Dashboard", alertsLabel: "Veiligheidsmeldingen", manual: "Handmatige controle", settings: "Instellingen", language: "Taal", reviewAlerts: "Meldingen beoordelen", search: "Zoeken", clear: "Wissen", needsReview: "Moet worden beoordeeld", safe: "Veilig", notChecked: "Niet gecontroleerd", alertsTitle: "Veiligheidsmeldingen", findProduct: "Product zoeken",
  long: {
    "dashboardRecentAlertsDescription": "De meest recent gemarkeerde producten uit je winkel zijn zo gesorteerd dat je snel kunt handelen.",
    "dashboardNoAlertsDescription": "Je meldingenlijst verschijnt hier zodra de eerste match met een gevaarlijk product is gevonden.",
    "alertsQueueDescription": "Houd de tabel gericht op beslissingen: filter op status, zoek producten en handel matches vanaf één plek af.",
    "manualReviewDescription": "Kies een product uit de nieuwste catalogusupdates en voer een gerichte Safety Gate-controle uit.",
    "manualCatalogDescription": "Producten zijn gesorteerd op de nieuwste Shopify-updates, zodat recente wijzigingen eerst opnieuw kunnen worden gecontroleerd.",
    "settingsThresholdDescription": "De similariteitsdrempel bepaalt hoe sterk een product moet overeenkomen met een Safety Gate-melding. Hogere waarden zijn strenger en verminderen fout-positieven. Lagere waarden vinden meer mogelijke matches.",
    "settingsStrictnessHint": "40-60% is bredere scanning. 70-85% is strenger en levert meestal minder fout-positieven op.",
    "settingsBalancedDescription": "Gebruik ongeveer 65-70% voor een praktische mix van bereik en precisie voor de meeste Shopify-catalogi.",
    "analysisMatchesHint": "Begin met de bovenste matchkaart en bevestig eerst de visuele overeenkomst van de verpakking, daarna model en merk.",
    "analysisScoreHelper": "De algemene match is de uiteindelijke beoordelingsscore. De afbeeldingsmatch toont alleen verpakkingsgelijkenis."
  }
});