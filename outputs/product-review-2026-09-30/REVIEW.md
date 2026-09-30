# Safety Gate Monitor — produktové review

Dátum: 30. september 2026. Cieľ: jednoduché používanie, predaj cez Shopify App Store a dlhodobé predplatné. Použitý Product Design audit, aktuálny verejný web, autentifikovaný lokálny Shopify náhľad a kontrola zdrojov. Staršie screenshoty neboli použité ako dôkaz.

## Verdikt

Produkt má zrozumiteľný problém a dobrý základ: oficiálne Safety Gate dáta, vlastný Shopify katalóg, obrazové porovnanie a zaznamenanie rozhodnutia. Najsilnejšia časť je modal porovnania produktov. Pred plateným uvedením treba dokončiť spoľahlivosť monitoringu, nákupu, emailov, exportu a pravdivé vykazovanie vykonanej práce. Reálny follow-up test odhalil HTTP 500 pri obnove katalógu napriek zelenému „100 % protected“. Ďalšie nastavovania teraz neprinesú toľko hodnoty ako dôveryhodný tok „zapnem → vidím výsledok → dostanem email → vyriešim nález“.

Potvrdené smerovanie: jeden plán 9,90 € mesačne za obchod; bezplatný úvodný sken a následne platený monitoring; okamžité nálezy a týždenný prehľad. Obslúžiť malé obchody, veľké katalógy aj agentúry rovnakým jednoduchým jadrom. Správa viacerých obchodov z jedného portálu nie je súčasťou prvej implementácie.

## Čo je dobré

- Verejný web vysvetľuje použitie verejných dát a nevyžaduje Shopify prístup pre prvý public scan. Limit 100 produktov je uvedený.
- Ilustrácie sú označené ako fiktívne; možné zhody sú prezentované ako podnet na overenie. Toto buduje dôveru.
- Review Queue má názvy produktov, fotky, závažnosť, vyhľadávanie, filtre a akciu pri každom produkte.
- Modal dáva Shopify produkt a Safety Gate záznam vedľa seba, oddeľuje vizuálnu podobnosť od celkového skóre a vysvetľuje dôvod nálezu.
- Rozhodnutie nemení publikovanie produktu. Pri Other sa poznámka stane povinnou a bez nej ostáva uloženie zablokované; overené bez uloženia rozhodnutia.
- Nastavenie adresáta a jazyka emailov už existuje. Backend používa Brevo a oddeľuje accepted od delivered.
- História a report majú existujúci základ; produktová akcia sa otvorí priamo z Shopify produktu.
- Jedna cena za obchod znižuje rozhodovanie pri nákupe.

## Prejdený tok a dôkazy

| Krok | Obrazovka / akcia | Stav |
|---|---|---|
| 1 | Verejný web na úzkej a širokej obrazovke | Čitateľný, chýba priama cesta na inštaláciu |
| 2 | Public free-scan formulár | Jasný limit a email confirmation; odoslanie neoverené |
| 3 | Verejný pricing | Cena je jasná, CTA vracia iba na free scan |
| 4 | About / dôvera | Transparentné vysvetlenie, viditeľná podpora; privacy odkaz chýba |
| 5 | Shopify dashboard | Funkčný, ale protichodné a príliš silné tvrdenia o ochrane |
| 6 | Review Queue | Použiteľná; duplicitné akcie a chyby plurálov |
| 7 | Match modal + Other | Silná časť produktu; required note funguje v UI |
| 8 | Catalog Coverage | Súhrn hovorí 100 % protected, riadky hovoria Not checked |
| 9 | Settings a email | Existujú, ale priveľa nastavení a chýba stav doručovania |
| 10 | Manage subscription → Shopify pricing | Potvrdená 404 v aktuálnom dev obchode |
| 11 | Audit Trail a report preview | Otvárajú sa, história obsahuje aj nevyriešené nálezy |
| 12 | Download CSV | Potvrdený pád reportu, súbor sa nepodarilo stiahnuť |
| 13 | Shopify produkt → Run Safety Gate check | Dialóg sa otvoril; samotná kontrola nespustená |

### 1–4. Akvizícia a dôvera

![Verejný web](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/04-desktop.jpg)

![Free scan formulár](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/02-free-scan.jpg)

![Verejná cena](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/03-pricing.jpg)

![About](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/05-about.jpg)

Najväčšia medzera: návštevník, ktorý už chce kúpiť, nenájde na zachytenom webe priamu inštaláciu aplikácie. Pricing vedie znovu na formulár. Aj zdroj free-scan výsledkového emailu končí odkazom na EU portál, bez install CTA. Free scan a inštalovaný merchant scan sú odlišné služby; treba ich na webe jasne oddeliť a výsledkový email prepojiť s pokračovaním v Shopify.

Vo footeri a formulári chýba viditeľný privacy odkaz. Shopify vyžaduje privacy policy v App Store listingu; obsah musí zodpovedať skutočným uloženým dátam a emailovému spracovaniu. [Shopify privacy requirements](https://shopify.dev/docs/apps/launch/privacy-requirements).

### 5. Dashboard

![Dashboard](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/06-dashboard.jpg)

Viditeľný rozpor: „20 protected / 91 %“, „22/22 / 100 % catalog protected“ a dva vážne nevyriešené nálezy. Posledná kontrola je spred týždňa, ale panel oznamuje každodenný monitoring. To nepreukazuje zlyhanie produkčného scheduleru; preukazuje, že UI rozlišuje plánovaný režim a skutočné zdravie nedostatočne.

Nahradiť protected/verified/safe výsledkami práce: „22 produktov zahrnutých do monitoringu“, „2 možné zhody na posúdenie“, „posledná úspešná kontrola“. Samotný import alebo embedding nie je vykonaná bezpečnostná kontrola. „0 nálezov“ nie je osvedčenie bezpečnosti.

Dashboard má tri vrcholy hierarchie: tri stavové karty, urgentný panel a value panel. Opakuje rovnaké čísla a CTA. Odporúčam jeden hlavný stav, jednu akciu a pod ním tri stručné fakty. Viditeľný je aj surový kľúč `dashboard.admin.allTimeChecksDescription` a chybný plurál „2 serious-risk product“.

### 6–7. Review a rozhodnutie

![Review Queue](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/07-review-queue.jpg)

![Porovnanie produktov](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/08-match-review.jpg)

Zachovať porovnanie vedľa seba. Pred dlhým AI vysvetlením ukázať stručné identifikátory, konkrétny druh rizika a dátum/oficiálny odkaz na alert. Interný hash alertu schovať do detailov. Skóre neprezentovať ako pravdepodobnosť, že výrobok je nebezpečný.

„Contacted supplier (Pending response)“ dnes server ukladá cez resolve ako resolved. Obchodník však iba čaká na odpoveď. Zaviesť stav čaká na dodávateľa, ktorý zostáva otvorenou úlohou. Oddeliť zaznamenanie priebežnej akcie od ukončenia prípadu. Zmeny dôkazov alebo nový relevantný alert musia vedieť založiť nový review bez prepisovania starej rozhodovacej histórie.

### 8. Katalóg

![Katalóg](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/09-catalog.jpg)

Súhrn považuje embedding alebo sourceUpdatedAt za pokrytie. Riadky bez individuálneho check záznamu zobrazujú Not checked. Pri vector prefiltri je nulový počet LLM kontrol legitímny, ale stav sa musí opierať o dokončený retrieval, nie o existenciu snapshotu. Jednotný výsledok má byť zdieľaný medzi dashboardom, filtrom a riadkom.

V zdroji je limit 300 produktov pri importovaní; bootstrap monitoringu spracuje obmedzenú dávku Safety Gate alertov v ročnom okne. To nie je úplný prvý audit katalógu proti celej databáze. Potrebné sú pokračovateľné dávky a jasné vykazovanie rozsahu. Chýba registrácia products/delete webhooku, preto treba riešiť aj vyradenie zmazaných produktov z aktuálneho pokrytia.

### 9–10. Emaily a predplatné

![Nastavenia](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/10-settings.jpg)

![Shopify pricing 404](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/11-shopify-pricing.jpg)

Potvrdená 404 sa týka tejto aplikácie a dev obchodu. Partner nastavenia neboli otvorené, takže príčinu — handle, publikovanie plánov či dostupnosť test plánu — nemožno potvrdiť. Lokálny billing bypass vracia active payment a UI ho označí ako Pro Active. V náhľade musí byť rozpoznateľný test režim. Produkcia musí predplatné naozaj overovať.

Zdroj parent app loaderu a ďalších stránok presmeruje neplatiaceho merchant po freeScanUsed na pricing. Výsledok bezplatného skenu preto môže byť zablokovaný pri ďalšom načítaní. Platiť má za nové kontroly a monitoring; existujúci výsledok, rozhodnutie, nastavenie emailov a dáta majú zostať dostupné.

Konkrétne emailové medzery zo zdrojov:

- Email odkaz používa `alertId`, loader Review Queue číta `open`. Navyše email otvára raw app URL; treba merchant odkaz do Shopify Admin, zachovanie cieľa po prihlásení a shop scoping.
- Weekly clear summary sa odošle podľa absencie nových alert dokumentov, bez overenia dokončeného monitoringu, backlogu či starších otvorených nálezov. „Nič nové“ môže existovať aj pri výpadku.
- V týždni s novým nálezom sa weekly summary úplne vynechá. Zvolený produktový smer je jeden prehľad každý týždeň, aj keď boli nálezy.
- Denný monitoring a produktové webhooky nemajú rovnaké platené entitlement gating ako UI. Bez zosúladenia môže obchod naďalej dostávať platenú službu bez predplatného.
- Failed email notification dokument pri opakovaní skončí ako duplicate; nie je to spoľahlivý retry mechanizmus.
- UI ponúka 24 jazykov emailu, obsah zatiaľ rozlišuje SK a ostatné jazyky posiela v EN.
- Chýba merchant viditeľný posledný email / doručenie / chyba a náhľad alebo test email.

Shopify App Pricing spravuje cenu a plány v Partner Dashboarde. Aktuálna dokumentácia rozlišuje nové Partner API `activeSubscription` od legacy integrácií; enrollment aplikácie treba overiť pri implementácii. [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing).

### 11–12. História a export

![Auditná história](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/12-audit-history.jpg)

![Report](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/13-audit-report.jpg)

![Pád po CSV exporte](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/14-export-error.jpg)

Preview funguje. Download CSV následne naviguje komponent na loader vracajúci CSV namiesto dát; render potom padá pri records.filter. Export má byť samostatná resource route a skutočné stiahnutie bez klientského prechodu stránky.

História momentálne vyzerá skôr ako prehľad posledného stavu alertov. Audit potrebuje aj postupnosť udalostí: kto, kedy, čo skontroloval, dôkaz, výsledok a následné zmeny. Export má prehľadne obsahovať poznámky a identifikáciu aktéra; preview musí ukázať rozsah exportu. Existujúci limit 1000 záznamov nesmie ticho skracovať „complete record“.

### 13. Produktová akcia

![Produktová akcia](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/15-product-action.jpg)

Dialóg sa otvorí správne, ale používateľ najprv vidí iba všeobecný text a Run check. Ukázať názov produktu, existujúci stav, poslednú kontrolu a odkaz na existujúci nález. Strings sú v zdroji hardcoded EN. Blok na produktovej stránke nebol pridaný ani overený; jeho aktivovanie v Shopify musí byť samostatný acceptance krok.

## Priorita a obchodný prínos

| Priorita | Zmena | Prečo |
|---|---|---|
| P0 pred predajom | Oprava Firestore delta cursoru a zobrazenia zlyhania | Reálna obnova katalógu skončila HTTP 500, UI zostalo zelené |
| P0 pred predajom | Funkčný Shopify pricing, návrat do app, serverové nároky | Bez toho nie je dôveryhodná platená služba |
| P0 pred predajom | Výsledky free scanu bez plošného paywallu | Obchodník musí najprv vidieť hodnotu |
| P0 pred predajom | Pravdivé pokrytie a monitoring health | Žiadna falošná istota počas výpadku |
| P0 pred predajom | Funkčný CSV export | Aktuálne zlyháva sľubovaný výstup |
| P0 pred predajom | Email deep link a retry | Upozornenie musí viesť ku konkrétnej akcii |
| P1 | Pokračovateľný prvý audit bez limitu 300 | Väčší obchod potrebuje celý katalóg |
| P1 | Týždenný prehľad práce a otvorených úloh | Dôvod zostať predplatiteľom aj bez nových zhôd |
| P1 | Jednoduchší dashboard a nastavenia | Menší počet rozhodnutí a kratší čas na úlohu |
| P1 | Follow-up stav a nemenné udalosti rozhodnutí | Tímy potrebujú pokračovať v rozpracovaných prípadoch |
| P1 | Inštalácia z webu/emailu, privacy a podpora | Dokončený predajný tok |
| P2 | Viac obchodov pre agentúry, členovia a priraďovanie | Po overení dopytu a základnej retencie |

## Limity overenia

Review potvrdzuje aktuálne obrazovky existujúceho dev obchodu, uvedené chyby interakcií a dokončenie individuálnej kontroly cez Shopify produktovú akciu. Nepotvrdzuje prvú inštaláciu nového obchodu, dokončenie čerstvého celého skenu, nákup alebo zrušenie predplatného, produkčné scheduler runy, skutočné doručenie emailu, funkciu inline blocku ani úspešné odoslanie public scanu. Neboli uložené merchant rozhodnutia, menené Shopify produkty alebo email preferences. Follow-up kontroly zapisujú check výsledky a monitoring stav; samostatný test email nebol odoslaný, prípadné automatické notifikácie neboli overené u poskytovateľa.

Screenshoty a DOM ukazujú popisky formulárov a rozlíšenie rizika aj textom. Nejde o WCAG certifikáciu: treba overiť klávesnicu, fokus pri zavretí modalu, screen reader tabuľky, zoom a mobilný merchant flow. V browser logu sa objavilo upozornenie na Polaris primary table header.

Plán implementácie je v [IMPLEMENTATION_PLAN.md](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/IMPLEMENTATION_PLAN.md).

## Follow-up: reálne spustené kontroly 30. 9. 2026

Po povolení používateľa bola cez Shopify More actions → Run Safety Gate check spustená kontrola produktu „skuska“. Dokončila sa o 15:12:38 so stavom Needs review, Serious risk, overall 97 % a image 100 %. Po reload dashboardu sa počet kontrol zmenil z 9 na 10 a pribudol dnešný záznam v histórii. Existujúce dva otvorené prípady ostali dva; rozhodnutie nebolo uložené.

![Dokončená kontrola produktu](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/16-product-check-result.jpg)

Následne bol spustený Refresh catalog coverage. Beh skončil chybou HTTP 500: `Only a direct child can be used as a query boundary. Found: "rapex_alerts".` Aplikácia chybu ukázala, ale nad ňou stále uvádzala All current products are protected a 100 % protected. To potvrdzuje runtime blocker monitoringu aj zavádzajúci hlavný stav.

![Zlyhaná obnova katalógu](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/17-catalog-refresh-failed.jpg)

Lokálny zdroj v `firebase/functions/src/merchant-monitoring.ts:310` volá trojhodnotový `startAfter` s `checkpointDocId || ""`. Chyba je konzistentná s legacy checkpointom, ktorý má timestamp bez document ID. Obsah konkrétneho produkčného checkpointu nebol priamo načítaný; bezpečná oprava musí pokryť tento stav aj rovnaké timestampy bez preskočenia alertov.

V katalógu bol následne spustený individuálny check „The Multi-managed Snowboard“. Po obnovení lokálneho náhľadu bol výsledok uložený ako Safe / Today, počet kontrol 11 a filter Safe 4. Potvrdzuje to dokončenú cestu bez nálezu, nie bezpečnostný certifikát produktu. Zlyhanie monitoringu už po reload nebolo viditeľné a karta Last check ukazovala dnešný individuálny výsledok. Posledná kontrola jedného produktu preto musí zostať oddelená od posledného úspešného behu celého monitoringu.

![Uložený výsledok bez nálezu](/Users/radoone/Devel/rapex/outputs/product-review-2026-09-30/screenshots/18-safe-check-persisted.jpg)

Na nezmenenom klientskom kóde prešli `npx tsc --noEmit`, `npm run lint` a `npm run build` pod repo Node 24.14.1. Logy sú uložené pri reporte. Tieto kontroly nepotvrdzujú úspešný Firestore monitoring, billing ani email delivery. Aplikačné opravy v tomto review neboli implementované.

## Implementačný follow-up: 1. 10. 2026

Od pôvodného review pribudli durable Firebase Cloud Task workflows pre denný Safety Gate monitoring, úvodný stránkovaný audit a Shopify produktové zmeny. Dňa 1. 10. bola nasadená aj Shopify `products/delete` trasa a Firebase cleanup worker. Delete označí produkt a jeho alerty ako zmazané a zachová históriu kontrol a rozhodnutí. Opravy monitorovacieho Firestore cursoru a verziovo presné pokrytie produktov sú implementované podľa aktuálneho zdrojového kódu.

Nasadenie bolo overené health checkom Shopify Cloud Run root (HTTP 200), odmietnutím neautorizovaného Firebase ingressu (HTTP 401) a odmietnutím unsigned delete webhook požiadavky (HTTP 400). Unit/build validácie prešli: Shopify 10 testov a Firebase 19 testov. Tieto dôkazy nepotvrdzujú Shopify login, samotnú registráciu delete subscription, spracovanie reálnej merchant task od `queued` po `completed`, aktívny Partner billing, email delivery ani katalógovú reconciliation pri nedoručenom Shopify webhooku. Autentifikovaný UI test sa nepodarilo vykonať, lebo bol Mac zamknutý. Podrobný aktuálny stav je v [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); pôvodný review vyššie zostáva snapshotom z 30. 9. 2026.
