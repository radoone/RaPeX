import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({ dashboard: "Nadzorna plošča", alertsLabel: "Varnostna opozorila", manual: "Ročni pregled", settings: "Nastavitve", language: "Jezik", reviewAlerts: "Preglej opozorila", search: "Išči", clear: "Počisti", needsReview: "Zahteva pregled", safe: "Varno", notChecked: "Ni preverjeno", alertsTitle: "Varnostna opozorila", findProduct: "Najdi izdelek",
  long: {
    "dashboardRecentAlertsDescription": "Najnovejši označeni izdelki iz vaše trgovine so razvrščeni tako, da lahko hitro ukrepate.",
    "dashboardNoAlertsDescription": "Seznam opozoril se bo prikazal tukaj po prvi zaznani ujemanji z nevarnim izdelkom.",
    "alertsQueueDescription": "Tabela naj ostane osredotočena na odločitve: filtrirajte po stanju, iščite izdelke in rešujte ujemanja na enem mestu.",
    "manualReviewDescription": "Izberite izdelek iz najnovejših posodobitev kataloga in zaženite ciljno preverjanje Safety Gate.",
    "manualCatalogDescription": "Izdelki so razvrščeni po najnovejših posodobitvah Shopify, da najprej preverite sveže spremembe.",
    "settingsThresholdDescription": "Prag podobnosti določa, kako blizu se mora izdelek ujemati z opozorilom Safety Gate. Višje vrednosti so strožje in zmanjšajo lažno pozitivne zadetke. Nižje vrednosti zaznajo več možnih ujemanj.",
    "settingsStrictnessHint": "40-60% pomeni širše skeniranje. 70-85% je strožje in običajno ustvari manj lažno pozitivnih zadetkov.",
    "settingsBalancedDescription": "Uporabite približno 65-70% za praktično ravnovesje med zajemom in natančnostjo pri večini Shopify katalogov.",
    "analysisMatchesHint": "Začnite z zgornjo kartico ujemanja in najprej potrdite vizualno podobnost embalaže, nato model in znamko.",
    "analysisScoreHelper": "Skupno ujemanje je končna ocena pregleda. Ujemanje slike prikazuje samo podobnost embalaže."
  }
});