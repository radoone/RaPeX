import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({ dashboard: "Tableau de bord", alertsLabel: "Alertes de sécurité", manual: "Vérification manuelle", settings: "Paramètres", language: "Langue", reviewAlerts: "Examiner les alertes", search: "Rechercher", clear: "Effacer", needsReview: "À examiner", safe: "Sûr", notChecked: "Non vérifié", alertsTitle: "Alertes de sécurité", findProduct: "Trouver un produit",
  long: {
    "dashboardRecentAlertsDescription": "Les produits récemment signalés dans votre boutique sont classés pour vous aider à agir rapidement.",
    "dashboardNoAlertsDescription": "La liste des alertes apparaîtra ici après la première correspondance détectée avec un produit dangereux.",
    "alertsQueueDescription": "Gardez le tableau centré sur les décisions : filtrez par statut, recherchez des produits et traitez les correspondances au même endroit.",
    "manualReviewDescription": "Choisissez un produit parmi les dernières mises à jour du catalogue et lancez une vérification Safety Gate ciblée.",
    "manualCatalogDescription": "Les produits sont triés par dernières mises à jour Shopify afin de vérifier d’abord les changements récents.",
    "settingsThresholdDescription": "Le seuil de similarité détermine à quel point un produit doit correspondre à une alerte Safety Gate. Des valeurs plus élevées sont plus strictes et réduisent les faux positifs. Des valeurs plus basses détectent davantage de correspondances possibles.",
    "settingsStrictnessHint": "40-60% correspond à une analyse plus large. 70-85% est plus strict et produit généralement moins de faux positifs.",
    "settingsBalancedDescription": "Utilisez environ 65-70% pour un équilibre pratique entre couverture et précision dans la plupart des catalogues Shopify.",
    "analysisMatchesHint": "Commencez par la première carte de correspondance et confirmez d’abord la similarité visuelle de l’emballage, puis le modèle et la marque.",
    "analysisScoreHelper": "La correspondance globale est le score final d’examen. La correspondance d’image reflète uniquement la similarité de l’emballage."
  }
});