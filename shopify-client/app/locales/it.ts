import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({ dashboard: "Dashboard", alertsLabel: "Avvisi di sicurezza", manual: "Controllo manuale", settings: "Impostazioni", language: "Lingua", reviewAlerts: "Rivedi avvisi", search: "Cerca", clear: "Cancella", needsReview: "Da esaminare", safe: "Sicuro", notChecked: "Non controllato", alertsTitle: "Avvisi di sicurezza", findProduct: "Trova prodotto",
  long: {
    "dashboardRecentAlertsDescription": "I prodotti segnalati più di recente nel tuo negozio sono ordinati per aiutarti ad agire rapidamente.",
    "dashboardNoAlertsDescription": "L’elenco degli avvisi apparirà qui dopo la prima corrispondenza rilevata con un prodotto pericoloso.",
    "alertsQueueDescription": "Mantieni la tabella orientata alle decisioni: filtra per stato, cerca prodotti e gestisci le corrispondenze da un unico punto.",
    "manualReviewDescription": "Scegli un prodotto dagli ultimi aggiornamenti del catalogo ed esegui un controllo mirato Safety Gate.",
    "manualCatalogDescription": "I prodotti sono ordinati in base agli ultimi aggiornamenti Shopify, così puoi controllare prima le modifiche recenti.",
    "settingsThresholdDescription": "La soglia di similarità determina quanto un prodotto deve corrispondere a un avviso Safety Gate. Valori più alti sono più severi e riducono i falsi positivi. Valori più bassi rilevano più possibili corrispondenze.",
    "settingsStrictnessHint": "40-60% è una scansione più ampia. 70-85% è più severo e di solito produce meno falsi positivi.",
    "settingsBalancedDescription": "Usa circa 65-70% per un equilibrio pratico tra copertura e precisione nella maggior parte dei cataloghi Shopify.",
    "analysisMatchesHint": "Inizia dalla prima scheda di corrispondenza e conferma prima la somiglianza visiva della confezione, poi modello e marca.",
    "analysisScoreHelper": "La corrispondenza complessiva è il punteggio finale di revisione. La corrispondenza immagine riflette solo la somiglianza della confezione."
  }
});