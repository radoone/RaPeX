# RaPeX Daily Alert Loader

## O Projekte

Tento projekt implementuje automatický denný "delta loader" pre dáta z európskeho systému rýchleho varovania (RAPEX) o nebezpečných výrobkoch. Využíva Firebase Cloud Functions na sťahovanie nových záznamov z verejného datasetu na OpenDataSoft a ukladá ich do databázy Firestore pre ďalšiu analýzu a spracovanie, napríklad pre dotazovanie pomocou AI (Gemini).

Cieľom je udržiavať aktuálnu lokálnu kópiu RAPEX alertov s kompletným dátovým payloadom pre budúce využitie.

## Kľúčové Funkcie

- **Automatický denný import**: Funkcia sa spúšťa raz denne pomocou Cloud Scheduler.
- **Delta-Loading**: Sťahujú sa iba nové alebo aktualizované záznamy od posledného úspešného behu, čím sa minimalizuje prenos dát a počet zápisov do databázy.
- **Ukladanie kompletných dát**: Do Firestore sa ukladá celý JSON payload každého záznamu, aby sa predišlo strate informácií a umožnila sa flexibilná analýza v budúcnosti.
- **Odolnosť**: Logika obsahuje základné riadenie stavu a je pripravená na budúce rozšírenie o pokročilejšie spracovanie chýb.

## Architektúra

- **Cloud Function**: `dailyRapexDeltaLoader`
  - **Runtime**: Node.js 20
  - **Jazyk**: TypeScript
- **Trigger**: Cloud Scheduler, ktorý publikuje správu do Pub/Sub témy každý deň o 3:13 ráno (čas Europe/Bratislava).
- **Databáza**: Google Firestore
  - **Hlavná kolekcia**: `rapex_alerts`
    - Document ID: `recordid` z datasetu.
    - Štruktúra: Obsahuje `meta` objekt (s metadátami ako `alert_date`, `ingested_at`) a `fields` objekt (s kompletnými dátami z API).
  - **Stavová kolekcia**: `rapex_meta/loader_state`
    - Udržiava stav posledného behu, konkrétne `last_alert_date` a `last_record_timestamp`, ktoré sú kľúčové pre delta-loading.

## Zdroj Dát

- **Dataset**: [EU-RAPEX-en - Rapid Alert System for non-food dangerous products](https://public.opendatasoft.com/explore/dataset/healthref-europe-rapex-en/)
- **API**: OpenDataSoft Records API (v1)

## Nastavenie a Nasadenie

1.  **Predpoklady**: Nainštalovaný [Node.js](https://nodejs.org/) a [Firebase CLI](https://firebase.google.com/docs/cli).
2.  **Inštalácia závislostí**: V adresári `functions` spustite `npm install`.
3.  **Nasadenie**: Spustite príkaz `firebase deploy --only functions,firestore --project <VASE-PROJECT-ID>`.

## Testovanie

Funkciu je možné manuálne spustiť (mimo jej plánu) cez Google Cloud Console:
1.  Prejdite do sekcie **Cloud Scheduler**.
2.  Nájdite úlohu s názvom `firebase-schedule-dailyRapexDeltaLoader...`.
3.  Kliknite na "Force run" pre okamžité spustenie.
4.  Výsledky a logy behu je možné sledovať v sekcii **Cloud Functions** -> Logs.

## Budúce Rozšírenia

- Implementácia funkcie `checkProductAgainstRapex(product)` na heuristické párovanie produktov (napr. z e-shopu) voči záznamom v databáze `rapex_alerts`.
- Pridanie normalizovaných polí pre lepšie a rýchlejšie vyhľadávanie.
