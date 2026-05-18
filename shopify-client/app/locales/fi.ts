import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({ dashboard: "Hallintapaneeli", alertsLabel: "Turvallisuushälytykset", manual: "Manuaalinen tarkistus", settings: "Asetukset", language: "Kieli", reviewAlerts: "Tarkista hälytykset", search: "Hae", clear: "Tyhjennä", needsReview: "Vaatii tarkistuksen", safe: "Turvallinen", notChecked: "Ei tarkistettu", alertsTitle: "Turvallisuushälytykset", findProduct: "Etsi tuote",
  long: {
    "dashboardRecentAlertsDescription": "Kauppasi uusimmat merkityt tuotteet on järjestetty niin, että niihin voi reagoida nopeasti.",
    "dashboardNoAlertsDescription": "Hälytyslista ilmestyy tähän, kun ensimmäinen vaaralliseen tuotteeseen liittyvä osuma havaitaan.",
    "alertsQueueDescription": "Pidä taulukko päätöksiin keskittyneenä: suodata tilan mukaan, hae tuotteita ja käsittele osumat yhdessä paikassa.",
    "manualReviewDescription": "Valitse tuote viimeisimmistä katalogipäivityksistä ja suorita kohdennettu Safety Gate -tarkistus.",
    "manualCatalogDescription": "Tuotteet on järjestetty viimeisimpien Shopify-päivitysten mukaan, jotta tuoreet muutokset voidaan tarkistaa ensin.",
    "settingsThresholdDescription": "Samankaltaisuuskynnys määrittää, kuinka läheisesti tuotteen on vastattava Safety Gate -hälytystä. Korkeammat arvot ovat tiukempia ja vähentävät vääriä positiivisia. Alemmat arvot löytävät enemmän mahdollisia osumia.",
    "settingsStrictnessHint": "40-60% on laajempi skannaus. 70-85% on tiukempi ja tuottaa yleensä vähemmän vääriä positiivisia.",
    "settingsBalancedDescription": "Käytä noin 65-70% käytännölliseen tasapainoon kattavuuden ja tarkkuuden välillä useimmissa Shopify-katalogeissa.",
    "analysisMatchesHint": "Aloita ylimmästä osumakortista ja vahvista ensin pakkauksen visuaalinen samankaltaisuus, sitten malli ja brändi.",
    "analysisScoreHelper": "Kokonaisosuma on lopullinen arviointipiste. Kuvaosuma kuvaa vain pakkauksen samankaltaisuutta."
  }
});