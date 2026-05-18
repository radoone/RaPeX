import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({ dashboard: "Översikt", alertsLabel: "Säkerhetsvarningar", manual: "Manuell kontroll", settings: "Inställningar", language: "Språk", reviewAlerts: "Granska varningar", search: "Sök", clear: "Rensa", needsReview: "Behöver granskas", safe: "Säker", notChecked: "Inte kontrollerad", alertsTitle: "Säkerhetsvarningar", findProduct: "Hitta produkt",
  long: {
    "dashboardRecentAlertsDescription": "De senast flaggade produkterna i din butik är sorterade så att du snabbt kan agera.",
    "dashboardNoAlertsDescription": "Din varningslista visas här efter den första upptäckta matchningen med en farlig produkt.",
    "alertsQueueDescription": "Håll tabellen fokuserad på beslut: filtrera efter status, sök produkter och hantera matchningar från ett ställe.",
    "manualReviewDescription": "Välj en produkt från de senaste kataloguppdateringarna och kör en riktad Safety Gate-kontroll.",
    "manualCatalogDescription": "Produkterna är sorterade efter de senaste Shopify-uppdateringarna så att nya ändringar kan kontrolleras först.",
    "settingsThresholdDescription": "Likhetströskeln avgör hur nära en produkt måste matcha en Safety Gate-varning. Högre värden är striktare och minskar falska positiva. Lägre värden hittar fler möjliga matchningar.",
    "settingsStrictnessHint": "40-60% är bredare skanning. 70-85% är striktare och ger vanligtvis färre falska positiva.",
    "settingsBalancedDescription": "Använd cirka 65-70% för en praktisk balans mellan täckning och precision för de flesta Shopify-kataloger.",
    "analysisMatchesHint": "Börja med det översta matchningskortet och bekräfta först förpackningens visuella likhet, sedan modell och varumärke.",
    "analysisScoreHelper": "Övergripande matchning är den slutliga granskningspoängen. Bildmatchning visar endast förpackningslikhet."
  }
});