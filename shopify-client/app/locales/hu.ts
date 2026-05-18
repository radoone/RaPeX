import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({ dashboard: "Irányítópult", alertsLabel: "Biztonsági riasztások", manual: "Kézi ellenőrzés", settings: "Beállítások", language: "Nyelv", reviewAlerts: "Riasztások áttekintése", search: "Keresés", clear: "Törlés", needsReview: "Ellenőrzést igényel", safe: "Biztonságos", notChecked: "Nincs ellenőrizve", alertsTitle: "Biztonsági riasztások", findProduct: "Termék keresése",
  long: {
    "dashboardRecentAlertsDescription": "Az üzlet legutóbb megjelölt termékei úgy vannak rendezve, hogy gyorsan lehessen intézkedni.",
    "dashboardNoAlertsDescription": "A riasztási lista itt jelenik meg az első veszélyes termékkel kapcsolatos találat után.",
    "alertsQueueDescription": "Tartsa a táblát döntésközpontúan: szűrjön állapot szerint, keressen termékeket, és kezelje a találatokat egy helyen.",
    "manualReviewDescription": "Válasszon egy terméket a legutóbbi katalógusfrissítésekből, és futtasson célzott Safety Gate ellenőrzést.",
    "manualCatalogDescription": "A termékek a legutóbbi Shopify frissítések szerint vannak rendezve, hogy az új változások kerüljenek előre.",
    "settingsThresholdDescription": "A hasonlósági küszöb határozza meg, mennyire kell egy terméknek megfelelnie egy Safety Gate riasztásnak. A magasabb értékek szigorúbbak és kevesebb téves találatot adnak. Az alacsonyabb értékek több lehetséges találatot jeleznek.",
    "settingsStrictnessHint": "A 40-60% szélesebb keresés. A 70-85% szigorúbb, és általában kevesebb téves találatot eredményez.",
    "settingsBalancedDescription": "A legtöbb Shopify katalógushoz használjon körülbelül 65-70%-ot a lefedettség és pontosság gyakorlati egyensúlyához.",
    "analysisMatchesHint": "Kezdje a legfelső találati kártyával, és először a csomagolás vizuális hasonlóságát, majd a modellt és márkát ellenőrizze.",
    "analysisScoreHelper": "Az összesített találat a végső értékelési pontszám. A képi találat csak a csomagolás hasonlóságát mutatja."
  }
});