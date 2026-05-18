import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({ dashboard: "Panel", alertsLabel: "Alertas de seguridad", manual: "Comprobación manual", settings: "Configuración", language: "Idioma", reviewAlerts: "Revisar alertas", search: "Buscar", clear: "Borrar", needsReview: "Necesita revisión", safe: "Seguro", notChecked: "No comprobado", alertsTitle: "Alertas de seguridad", findProduct: "Buscar producto",
  long: {
    "dashboardRecentAlertsDescription": "Los productos marcados más recientes de tu tienda se ordenan para que puedas actuar rápido.",
    "dashboardNoAlertsDescription": "La lista de alertas aparecerá aquí cuando se detecte la primera coincidencia con un producto peligroso.",
    "alertsQueueDescription": "Mantén la tabla centrada en decisiones: filtra por estado, busca productos y resuelve coincidencias desde un solo lugar.",
    "manualReviewDescription": "Elige un producto de las últimas actualizaciones del catálogo y ejecuta una comprobación específica de Safety Gate.",
    "manualCatalogDescription": "Los productos se ordenan por las últimas actualizaciones de Shopify para revisar primero los cambios recientes.",
    "settingsThresholdDescription": "El umbral de similitud determina cuánto debe parecerse un producto a una alerta de Safety Gate. Los valores más altos son más estrictos y reducen falsos positivos. Los valores más bajos detectan más coincidencias posibles.",
    "settingsStrictnessHint": "40-60% es una revisión más amplia. 70-85% es más estricto y normalmente genera menos falsos positivos.",
    "settingsBalancedDescription": "Usa alrededor de 65-70% para una mezcla práctica de cobertura y precisión en la mayoría de catálogos Shopify.",
    "analysisMatchesHint": "Empieza por la primera tarjeta de coincidencia y confirma primero la similitud visual del embalaje, después el modelo y la marca.",
    "analysisScoreHelper": "La coincidencia general es la puntuación final de revisión. La coincidencia de imagen refleja solo la similitud del embalaje."
  }
});