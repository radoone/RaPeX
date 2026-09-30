# Implementačný plán — jednoduchý Safety Gate monitoring s predplatným

## Navrhovaný výsledok a pracovné pravidlá

Jeden plán za navrhovaných 9,90 € mesačne za Shopify obchod; cena a mena čakajú na potvrdenie v Shopify Partner Dashboarde. Obchodník po inštalácii dostane jeden bezplatný úvodný audit, jeho výsledok zostane dostupný a platený plán zapne nové kontroly, kontrolu zmien produktov a denné porovnávanie s novými Safety Gate alertmi. Bez ďalšieho plateného trialu v prvej verzii. Verejný marketing scan ostáva samostatný, maximálne 100 verejných produktov; jeho použitie nespotrebuje merchant scan.

Rovnaké jadro pre malé obchody, veľké katalógy a agentúry; každá Shopify inštalácia má vlastný nárok, dáta a cenu. Samostatný agentúrny portál, ďalšie plány, automatické unpublishing a právne certifikáty sú mimo tejto implementácie. Zachovať read_products a existujúce Polaris s- komponenty.

## 1. Funkčný nákup a bezpečný prístup k výsledkom — prvý PR

- Najprv opraviť potvrdený runtime blocker delta monitoringu: Firestore cursor nesmie odovzdať prázdny document ID pri existujúcom timestamp checkpointe. Pre staré checkpointy bez ID zvoliť bezpečný opakovaný prechod cez hranicu s deduplikáciou; nové checkpointy ukladajú všetky tri hodnoty až po dokončenej dávke. Regresia musí pokryť legacy stav bez ID a viac alertov s rovnakým dátumom/timestamp. Chybný beh okamžite mení hlavný stav na problém monitoringu, nezostáva „100 % protected“.
- Overiť Partner nastavenia, enrollment Shopify App Pricing, skutočný app handle a dostupnosť plánov pre dev shop; vytvoriť jeden mesačný plán a privátny test plán. Welcome link smeruje späť na dashboard. Cena a mena v listingu, webe a pláne musia zodpovedať reálne schvaľovanému účtovaniu; 9,90 € nesmie byť neoznačený prepočet inej meny.
- Centralizovať serverový billing adapter. Pre aktuálny App Pricing použiť Partner API activeSubscription; potvrdená legacy aplikácia smie mať v adapteri legacy čítanie podľa Shopify dokumentácie. Žiadne vytváranie opakovaných charges vlastným checkoutom. Plan handle z návratového URL nie je dôkaz platby.
- Ukladať na merchant root serverom overený entitlement: installed, subscriptionStatus, planHandle, monitoringEntitled, verifiedAt, validUntil. Overovať pri návrate z pricingu, prihlásení a zmenových udalostiach; naplánovať aj pravidelnú reconciliation. Rozhoduje aktuálny Shopify kontrakt a jeho koniec nároku, nie samotná požiadavka na zrušenie.
- Parent app loader prestane plošne presmerovávať. Čítanie výsledkov, zaznamenanie rozhodnutia, história, export a email settings ostanú dostupné bez aktívneho plánu. Chrániť nové skeny a platené automatické kontroly; denné joby aj produktové webhooky používajú rovnaký entitlement.
- Neznámy alebo nedostupný billing stav zobraziť ako „Predplatné sa nepodarilo overiť“ s retry, nie ako nezaplatené alebo aktívne. Dočasne nevykonávať nové drahé operácie po vypršaní overeného nároku. Pri chýbajúcom app handle ukázať konfiguráciu ako chybu, nie poslať obchodníka na koreň Adminu.
- Lokálny bypass jasne označiť ako dev režim; produkcia má billing test aj bypass vypnutý. Prvá bezplatná kontrola musí byť rezervovaná transakčne proti dvojitému spusteniu; failed alebo prázdny sken ju nespotrebuje.
- CSV presunúť na autentifikovanú resource route bez komponentu a použiť download, ktorý nespúšťa React Router data navigáciu. Exportovať všetky stránky záznamov, vrátane poznámok, aktéra, výsledku a časov; preview uvádza skutočný rozsah.

Acceptance: po free scane vidím nálezy; môžem ich vyriešiť; upgrade otvorí reálny plán; schválenie test plánu zapne monitoring; zrušenie ukončí nárok v správnom čase; CSV sa stiahne a stránka ostane funkčná. Billing API výpadok nevygeneruje nový free scan.

## 2. Spoľahlivý audit a pravdivé stavy — druhý PR

- Nahradiť fire-and-forget úvodný scan durable jobom. Cloud Tasks doručuje autentifikované dávky workeru na stabilnom app serveri; worker z offline Shopify session stránkuje celý katalóg a posiela dávky Firebase. Job má transakčný lease, idempotentné dávky, cursor, progress, retry a uložený posledný heartbeat. Žiadny token v URL alebo vo verejnom job dokumente.
- Vektorizovať texty v dávkach 50–100, existujúce vektory obnovovať podľa sourceUpdatedAt a vyhľadávať kandidátov v celej dostupnej Safety Gate databáze. LLM použiť len na shortlist. Bootstrap nesmie skončiť po jednej dávke 300 alertov z ročného okna. Denné delta behy stránkujú nové alerty až po stanovený koniec okna; checkpoint posunú iba za dokončenú dávku.
- Oddeliť uložený/importovaný produkt, dokončený retrieval a výsledok možnej zhody. Embedding ani sourceUpdatedAt neznamená, že bola kontrola dokončená. Zdieľaná projekcia stavov riadi súhrny, katalóg, filtre, product extension a emailové metriky.
- Na produkt ukladať auditovanú sourceUpdatedAt, posledný dokončený retrieval a checkpoint Safety Gate. Nezmenený produkt bez kandidátov je dokončená kontrola bez nálezu aj bez LLM záznamu. Zmenená verzia produktu čaká na novú kontrolu. Výnimky z monitoringu sú samostatný stav, nie „bez nálezu“.
- Pridať products/delete spracovanie a reconciliation katalógu; zmazané produkty sa nezapočítajú do aktuálneho pokrytia, historické rozhodnutia zostanú oddelene. Prah a výnimky sa uplatnia rovnako v manual, webhook aj scheduled cestách.
- Monitor run uchováva okno, čísla, backlog, partial/complete a chyby. UI zelený stav vyžaduje dokončenú kontrolu, žiadny backlog a aktuálnu Safety Gate ingestion; zobraziť warning pri poslednom úspechu staršom než 36 hodín alebo zistenom nezískanom týždennom reporte. Čas najbližšej kontroly ukazovať s časovou zónou.
- Chyba monitoringu zostane viditeľná po reload až do úspešného obnovenia daného behu. Individuálna úspešná kontrola produktu ju nesmie prekryť; Last successful monitoring run a Last product check sú odlišné údaje. Overené 30. 9.: po failed catalog refresh a úspešnom snowboard checku chyba zmizla a Last check ukazovalo Today.
- Existujúcim embedding-only produktom pri migrácii nastaviť „Zahrnutý do monitoringu, prvá kontrola čaká“; nedoplniť fiktívny completed výsledok. Následný bootstrap beží po obnovení platného alebo rezervovaného bezplatného nároku.

Acceptance: katalógy 0, 22, 301 a 5000 produktov; worker restart uprostred dávky; duplicate task; čiastočne chybný import; žiadni kandidáti; nové alerty s rovnakým timestamp; zmazaný produkt; výpadok zdroja. Súhrn a riadky vždy opisujú rovnaký stav. Veľký katalóg nedostane silent truncation.

## 3. Emaily, ktoré dokazujú vykonanú prácu — tretí PR

- Zachovať Brevo vo Firebase. Nový relevantný nález dostane okamžitý email s produktom, konkrétnym rizikom, stručným dôvodom a jedným CTA. Použiť Shopify Admin deep link s kanonickým parametrom open; po prihlásení zachovať cieľ a overiť, že alert patrí danému shopu.
- Každý pondelok o 08:00 Europe/Bratislava poslať jeden týždenný prehľad za predchádzajúcich sedem dní, aj keď boli nálezy. Obsah: monitorované produkty, nové spracované Safety Gate alerty, dokončené behy, nové nálezy, otvorené prípady a posledný úspešný beh. Počty načítať z dokončených runov, nie odvodzovať z absencie alertov alebo celkového počtu embeddingov.
- „Bez nových nálezov“ použiť len pri dokončenom monitoringu daného obdobia; staré otvorené prípady uviesť osobitne. Pri chybe/medzere použiť „Monitoring je neúplný“ a konkrétnu akciu. Po skončení predplatného prestať s pravidelným plateným prehľadom.
- Rozdeliť preferencie immediateAlerts a weeklySummary; existujúce emailNotifications=true migrovať na obe zapnuté, false na obe vypnuté. Zachovať Shopify contact email, upraviteľný adresát a vybraný jazyk.
- Doplniť lokalizované šablóny pre všetkých 24 ponúkaných jazykov. Accepted ostane odlišné od delivered. Pridať bounded retry pre pending/failed s rovnakým idempotency kľúčom, reconciliation nejasného provider výsledku a bez duplicitného doručenia. Bounce/blocked ukázať merchantovi a zastaviť opakovanie na daný adresát.
- V Settings ukázať posledný email, jeho stav a náhľad. „Poslať test“ odošle iba na uloženú merchant adresu, je rate limited a mimo safety audit výsledkov.

Acceptance: klik z emailu po odhlásení otvorí správny alert; cudzie alert ID sa neotvorí; retry nevytvorí duplicitu; accepted nie je delivered; týždeň s nulou, s novým nálezom, so starým otvoreným nálezom a s výpadkom; vypnutie preferencií; DST; všetky jazyky. Skutočné doručenie potvrdiť až Brevo webhookom na test adresáte.

## 4. Jednoduché používanie a predaj — štvrtý PR

- Dashboard: jeden hlavný stav „Kontrola prebieha / Treba posúdiť / Žiadne nové nálezy / Monitoring má problém / Monitoring pozastavený“. Jedna primárna akcia a tri fakty: rozsah katalógu, posledný úspech, otvorené prípady. Vynechať protected, 24/7 a guarantee wording bez dôkazu. Odstrániť duplicitné CTA a surové locale kľúče.
- Prvý visit automaticky rezervuje scan. Zobraziť fázu, počet spracovaných produktov, priebeh a možnosť bezpečne odísť. Po výsledku až potom ponúknuť „Zapnúť priebežný monitoring — 9,90 €/mesiac“. Netreba sprievodcu nastavením percent alebo technických režimov.
- Základné Settings: adresát, preferencie emailov, jazyk a plán. Matching režimy, percentá, výnimky a automation presunúť do jednej sekcie Advanced. Balanced zachovať ako predvolený režim.
- Pridať waiting_for_supplier ako otvorený review stav; contacted_supplier ho nastaví namiesto resolved. Ukladať nemenné decision events s aktérom a časom; resolved/dismissed označovať ako históriu. Existujúce contacted_supplier prípady migrovať do waiting_for_supplier so zachovaním pôvodnej udalosti.
- Modal: zachovať fotky, krátky dôvod, model/brand/batch a merchant rozhodnutie. Interný hash a skóre sú secondary. Produktová akcia ukáže existujúci stav a link na nález; lokalizovať obe extensions a overiť inline block.
- Web, pricing karta a výsledkový free-scan email pridajú install CTA na overený App Store listing. Do publikovania listingu CTA vedie na jasné oznámenie dostupnosti; nevymýšľať URL. Pridať privacy, podmienky služby, konkrétnu podporu, data retention a popis zrušenia cez Shopify.
- EN a SK texty kompletne upraviť; ostatné EU locales aktualizovať v jadre workflow aj dlhých vysvetleniach. Opraviť plurály, dátumy, mobile reflow, focus návrat modalu a tabuľkové accessibility warnings.

Acceptance: nový merchant bez nastavení dosiahne výsledok; v bežnom toku nepotrebuje rozumieť threshold percentám; awaiting supplier ostane otvorený; zero findings nevyzerá ako certifikát; všetky hlavné obrazovky fungujú na úzkom displeji, s klávesnicou a pri zväčšení textu.

## 5. Overenie hodnoty a pripravenosť na App Store

- Ukladať produktové udalosti install, scan_started/completed/failed, result_viewed, pricing_opened, subscription_activated/ended, alert_reviewed, weekly_summary_accepted/delivered a export_completed. Bez raw produktových opisov alebo emailov v analytike; oddeliť public lead scan a merchant funnel.
- Reportovať čas do prvého výsledku, dokončenie scanov, aktiváciu predplatného, obnovu po prvom mesiaci, otvorené prípady, doručiteľnosť a náklad na shop. Doručený email ani page view neoznačovať ako dôkaz retencie.
- Zmerať náklady pre katalógy 100, 1000 a 5000 produktov vrátane bootstrapu, zmien a mesačných delta behov. Jeden plán zachovať; verejne nesľubovať unlimited rozsah, kým reprezentatívne dáta nepotvrdia udržateľnosť. Vydanie blokovať pri neudržateľných nákladoch namiesto tichého obmedzenia služby.
- Pred review nasadiť stabilný HTTPS app server; Cloudflare dev tunnel nie je merchant hosting. Overiť privacy webhooks, HMAC, purge vrátane email indexov, podporu, test pricing, reinštaláciu, zrušenie a správanie bez aktívneho nároku. Výmaz nesmie byť odackovaný ako hotový pri zlyhaní bez durable retry.
- Po každom client PR: npx tsc --noEmit, npm run lint, npm run build a autentifikovaný Shopify smoke test príslušných zmien. Firebase: build/lint a regresné testy pre jobs, entitlement, emaily a checkpoints. Pred release kompletný tok install → free scan → výsledok → test plán → denný monitoring → nález → email → rozhodnutie → CSV → koniec predplatného.
- Existujúce dáta migrovať additive a idempotentne; nezmazať históriu. Zavádzať najprv na dev obchode, potom internom platenom pilote. Žiadna automatická publikácia Partner verzie alebo reálne charge v rámci implementácie bez osobitného release kroku.

Stav k 30. 9. 2026 je historický; aktuálny výsledok a runtime dôkazy sú v [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Implementačný stav a rozhodnutia — 1. 10. 2026

- Používateľ rozhodol, že e-mailové úlohy sa zatiaľ nevykonávajú. Existujúci emailový kód a nastavenia v repozitári zostávajú; nové emailové zmeny ani emailové konfiguračné kroky nie sú súčasťou aktívnej implementácie.
- Firebase scheduled monitoring, počiatočný stránkovaný audit a produktové create/update úlohy používajú Cloud Tasks, takže spracovanie pokračuje po zatvorení Shopify Adminu. To vyžaduje dostupný stabilný app host pre Shopify webhooky a raz zaregistrované webhook subscription.
- Dňa 1. 10. bola nasadená durable obsluha `products/delete`: zmazanie označí produkt a súvisiace alerty bez mazania kontrol, rozhodnutí a auditu. Staršie alebo rovnaké update verzie produkt neobnovia. Kód Shopify servera registruje delete webhook, no obchod ho musí po nasadení znovu otvoriť/autentifikovať; túto registráciu a prihlásený smoke test sa nepodarilo potvrdiť, pretože pracovný Mac bol zamknutý.
- Rozhodnutie k cene: 9,90 €/mesiac je návrh v pláne, nie potvrdená live Shopify cena. Kým sa neoverí Partner Dashboard plán a mena a nenastavia sa Partner API údaje (`SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_TOKEN`, `SHOPIFY_APP_GID`), platený entitlement a reálny platený monitoring nie sú overené. V rámci tejto implementácie sa nepublikuje nová Partner verzia ani nevytvára reálny charge.
- PR 2 je implementovaný pre durable úvodný audit, progress, version-aware coverage, run history a produktové eventy. Katalógová reconciliation pre prípad vynechaného `products/delete` webhooku zostáva nedokončená; preto netvrdiť, že stratený Shopify webhook bude automaticky opravený.
- PR 4 rozhodnutia `waiting_for_supplier`, nemenný decision audit a zjednodušený merchant tok sú implementované podľa status dokumentu. Marketingový App Store listing, právne/support informácie, analytics, nákladové meranie a smoke testy extensions zostávajú pred release.
- Nasadené 1. 10.: Firebase `startShopifyProductChangeAPI` a `shopifyProductChangeTask`; Cloud Run `safety-gate-shopify-00006-ptw`. Lokálne kontroly po zmene: Shopify `tsc`, lint, build a 10 testov; Firebase lint a 19 testov. Produkčný HTTP health check pre app root vrátil 200. Reálny authenticated task flow ešte nebol pozorovaný od `queued` po `completed`.
