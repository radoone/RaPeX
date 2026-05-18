import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({ dashboard: "Painel", alertsLabel: "Alertas de segurança", manual: "Verificação manual", settings: "Definições", language: "Idioma", reviewAlerts: "Rever alertas", search: "Pesquisar", clear: "Limpar", needsReview: "Requer revisão", safe: "Seguro", notChecked: "Não verificado", alertsTitle: "Alertas de segurança", findProduct: "Encontrar produto",
  long: {
    "dashboardRecentAlertsDescription": "Os produtos assinalados mais recentes da sua loja estão ordenados para ajudar a agir rapidamente.",
    "dashboardNoAlertsDescription": "A lista de alertas aparecerá aqui após a primeira correspondência detetada com um produto perigoso.",
    "alertsQueueDescription": "Mantenha a tabela focada em decisões: filtre por estado, pesquise produtos e resolva correspondências num só local.",
    "manualReviewDescription": "Escolha um produto das últimas atualizações do catálogo e execute uma verificação Safety Gate direcionada.",
    "manualCatalogDescription": "Os produtos são ordenados pelas atualizações Shopify mais recentes para rever primeiro as alterações novas.",
    "settingsThresholdDescription": "O limiar de similaridade determina o quanto um produto deve corresponder a um alerta Safety Gate. Valores mais altos são mais rigorosos e reduzem falsos positivos. Valores mais baixos detetam mais correspondências possíveis.",
    "settingsStrictnessHint": "40-60% é uma análise mais ampla. 70-85% é mais rigoroso e normalmente gera menos falsos positivos.",
    "settingsBalancedDescription": "Use cerca de 65-70% para uma mistura prática de cobertura e precisão na maioria dos catálogos Shopify.",
    "analysisMatchesHint": "Comece pelo cartão de correspondência superior e confirme primeiro a semelhança visual da embalagem, depois o modelo e a marca.",
    "analysisScoreHelper": "A correspondência geral é a pontuação final de revisão. A correspondência de imagem reflete apenas a semelhança da embalagem."
  }
});