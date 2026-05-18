import { buildCoreLocale } from "./core-locale";

export default buildCoreLocale({ dashboard: "Nadzorna ploča", alertsLabel: "Sigurnosna upozorenja", manual: "Ručna provjera", settings: "Postavke", language: "Jezik", reviewAlerts: "Pregledaj upozorenja", search: "Traži", clear: "Očisti", needsReview: "Potrebna provjera", safe: "Sigurno", notChecked: "Nije provjereno", alertsTitle: "Sigurnosna upozorenja", findProduct: "Pronađi proizvod",
  long: {
    "dashboardRecentAlertsDescription": "Najnoviji označeni proizvodi iz vaše trgovine poredani su tako da možete brzo reagirati.",
    "dashboardNoAlertsDescription": "Popis upozorenja pojavit će se ovdje nakon prve pronađene podudarnosti s opasnim proizvodom.",
    "alertsQueueDescription": "Držite tablicu usmjerenu na odluke: filtrirajte po statusu, pretražujte proizvode i rješavajte podudaranja s jednog mjesta.",
    "manualReviewDescription": "Odaberite proizvod iz najnovijih ažuriranja kataloga i pokrenite ciljanu Safety Gate provjeru.",
    "manualCatalogDescription": "Proizvodi su poredani po najnovijim Shopify ažuriranjima kako bi se prvo provjerile svježe promjene.",
    "settingsThresholdDescription": "Prag sličnosti određuje koliko proizvod mora odgovarati Safety Gate upozorenju. Više vrijednosti su strože i smanjuju lažno pozitivne rezultate. Niže vrijednosti pronalaze više mogućih podudaranja.",
    "settingsStrictnessHint": "40-60% je šire skeniranje. 70-85% je strože i obično daje manje lažno pozitivnih rezultata.",
    "settingsBalancedDescription": "Koristite oko 65-70% za praktičnu ravnotežu između obuhvata i preciznosti za većinu Shopify kataloga.",
    "analysisMatchesHint": "Počnite s prvom karticom podudaranja i najprije potvrdite vizualnu sličnost ambalaže, zatim model i marku.",
    "analysisScoreHelper": "Ukupno podudaranje je završna ocjena pregleda. Podudaranje slike prikazuje samo sličnost ambalaže."
  }
});