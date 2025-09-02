# 🚨 RaPeX Monorepo

[![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com/)
[![Shopify](https://img.shields.io/badge/Shopify-7AB55C?style=for-the-badge&logo=shopify&logoColor=white)](https://www.shopify.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![AI](https://img.shields.io/badge/AI-Gemini%202.5%20Flash%20Lite-blue?style=for-the-badge&logo=google)](https://ai.google.dev/)

> **Monorepo containing Firebase backend for RAPEX alerts and Shopify client integration**

## 📋 O Projekte

Tento projekt implementuje **inteligentný automatický delta loader** pre dáta z európskeho systému rýchleho varovania (RAPEX) o nebezpečných výrobkoch.

**Hlavné účely:**
- 🤖 **Pre AI systémy**: Poskytuje štruktúrované dáta pre analýzu bezpečnosti výrobkov
- 🔍 **Pre vývojárov**: Umožňuje rýchle vyhľadávanie a filtrovanie RAPEX alertov
- 📊 **Pre analytikov**: Poskytuje kompletnú históriu alertov pre reporting
- 🛡️ **Pre spotrebiteľov**: Pomáha identifikovať potenciálne nebezpečné výrobky
- 🧠 **AI Safety Check**: Automatická analýza bezpečnosti nových produktov

### 🎯 **Čo projekt robí:**
1. **Automaticky sťahuje** nové RAPEX alerty z oficiálneho európskeho datasetu
2. **Ukladá do Firestore** všetky detaily vrátane metadát
3. **Optimalizuje prenos** dát pomocou delta-loading prístupu
4. **Poskytuje API** pre manuálne spúšťanie a testovanie
5. **Udržiava stav** posledného behu pre efektívne aktualizácie
6. **AI analýza** bezpečnosti produktov pomocou Google Gemini

## ✨ Kľúčové Funkcie

### 🤖 **Automatizácia & Inteligentné Spracovanie**
- **🕐 Automatický denný import**: Spúšťa sa každý deň o 13:03 (Bratislava čas) pomocou Cloud Scheduler
- **🔄 Delta-Loading**: Sťahuje iba nové záznamy od posledného behu (optimalizuje prenos dát)
- **📦 Kompletné dáta**: Ukladá celý JSON payload každého záznamu pre maximálnu flexibilitu
- **🛡️ Fault-tolerant**: Obsahuje error handling a stavové riadenie

### 🆕 **Nové Funkcie (v2.0)**
- **🚀 Firebase Functions Gen2**: Modernejšia architektúra s lepším výkonom
- **🌐 Manuálny HTTP trigger**: Možnosť spustiť funkciu manuálne cez API endpoint
- **📊 Real-time monitoring**: Lepšie logovanie a sledovanie stavu
- **⚡ ES Modules**: Moderný JavaScript s lepšou podporou pre development
- **🤖 AI-Powered Product Safety Analysis**: Automatická analýza bezpečnosti výrobkov pomocou Google Gemini AI

## 🏗️ Architektúra

### **Cloud Functions (Gen2)**
- **Primárna funkcia**: `dailyRapexDeltaLoader`
  - **Typ**: Scheduled function (automatické spúšťanie)
  - **Runtime**: Node.js 20
  - **Region**: `europe-west1` (pre optimálny výkon v EU)
  - **Jazyk**: TypeScript s ES Modules

- **Sekundárna funkcia**: `manualRapexLoader` ⭐ **NOVÉ**
  - **Typ**: HTTP trigger (manuálne spúšťanie)
  - **Endpoint**: `https://europe-west1-{project-id}.cloudfunctions.net/manualRapexLoader`
  - **Metóda**: GET
  - **Účel**: Testovanie a manuálne spúšťanie

- **AI Safety Checker**: `checkProductSafetyAPI` ⭐ **NOVÉ**
  - **Typ**: HTTP trigger (AI analýza bezpečnosti)
  - **Endpoint**: `https://europe-west1-{project-id}.cloudfunctions.net/checkProductSafetyAPI`
  - **Metódy**: GET, POST
  - **Účel**: Kontrola bezpečnosti výrobkov pomocou AI analýzy RAPEX alertov
  - **AI Model**: Google Gemini 2.5 Flash Lite
  - **Autentifikácia**: Vyžaduje API kľúč (X-API-Key header)

### **Úložisko dát**
- **Databáza**: Google Firestore
  - **Hlavná kolekcia**: `rapex_alerts`
    - **Document ID**: `recordid` z RAPEX datasetu
    - **Štruktúra**:
      ```json
      {
        "meta": {
          "datasetid": "string",
          "recordid": "string",
          "record_timestamp": "ISO string",
          "alert_date": "Firestore Timestamp",
          "ingested_at": "Firestore Timestamp"
        },
        "fields": {
          // Kompletný RAPEX payload
          "product_category": "string",
          "risk_level": "string",
          "notifying_country": "string",
          // ... všetky ostatné polia
        }
      }
      ```

  - **Stavová kolekcia**: `rapex_meta/loader_state`
    - **Účel**: Sledovanie posledného úspešného behu
    - **Polia**:
      - `last_alert_date`: Dátum posledného spracovaného alertu
      - `last_record_timestamp`: Časová pečiatka posledného záznamu
      - `last_run_status`: "SUCCESS" | "FAILURE" | "IN_PROGRESS"
      - `last_run_processed_records`: Počet spracovaných záznamov

## Zdroj Dát

- **Dataset**: [EU-RAPEX-en - Rapid Alert System for non-food dangerous products](https://public.opendatasoft.com/explore/dataset/healthref-europe-rapex-en/)
- **API**: OpenDataSoft Records API (v1)

## 📁 Monorepo Structure

```
rapex/
├── firebase/                    # Firebase backend
│   ├── functions/               # Cloud Functions (RAPEX loader & AI)
│   │   ├── src/                 # TypeScript source files
│   │   │   ├── index.ts         # Main functions entry point
│   │   │   ├── product-safety-checker.ts # AI safety analysis
│   │   │   └── check-data.ts    # RAPEX data processing
│   │   ├── package.json         # Functions dependencies
│   │   ├── tsconfig.json        # TypeScript config
│   │   └── .env.example         # Environment variables template
│   ├── firebase.json            # Firebase configuration
│   ├── firestore.rules          # Firestore security rules
│   └── firestore.indexes.json   # Firestore indexes
├── shopify-client/             # Shopify client application
│   └── ra-pex/                  # Main Shopify app
│       ├── app/                 # Remix application
│       │   ├── routes/          # App routes
│       │   │   ├── app.manual-check.tsx    # Manual safety check
│       │   │   ├── app.alerts.tsx          # Safety alerts dashboard
│       │   │   ├── app._index.tsx          # Main dashboard
│       │   │   └── auth.*.tsx              # Authentication routes
│       │   ├── services/        # Business logic services
│       │   │   ├── rapex-checker.server.ts # Server-side API calls
│       │   │   └── rapex-checker.client.ts # Client utilities
│       │   ├── db.server.ts      # Prisma database client
│       │   └── shopify.server.ts # Shopify API client
│       ├── prisma/              # Database schema & migrations
│       │   ├── schema.prisma    # Prisma schema
│       │   └── migrations/      # Database migrations
│       ├── public/              # Static assets
│       ├── scripts/             # Utility scripts
│       ├── package.json         # App dependencies
│       ├── tsconfig.json        # TypeScript config
│       ├── RAPEX_SETUP.md       # Setup documentation
│       └── Dockerfile           # Docker configuration
└── package.json                # Root workspace configuration
```

## 🚀 Rýchle Nastavenie

### **Predpoklady**
- ✅ [Node.js](https://nodejs.org/) 20+
- ✅ [Firebase CLI](https://firebase.google.com/docs/cli)
- ✅ Firebase projekt s povolenými Functions a Firestore
- ✅ Oprávnenia na deploy do Google Cloud
- ✅ Google AI API kľúč pre Gemini

### **Inštalácia & Príprava**
```bash
# 1. Naklonujte repository
git clone https://github.com/radoone/RaPeX.git
cd rapex

# 2. Inštalujte závislosti pre celý workspace
npm install

# 3. Prihláste sa do Firebase
firebase login

# 4. Nastavte projekt
firebase use {project-id}

# 5. Nastavte Google AI API kľúč
gcloud secrets create GOOGLE_API_KEY --replication-policy=automatic --project={project-id}
echo -n 'YOUR_GEMINI_API_KEY' | gcloud secrets versions add GOOGLE_API_KEY --data-file=- --project={project-id}

# 6. Nastavte RAPEX API kľúč
gcloud secrets create RAPEX_API_KEY --replication-policy=automatic --project={project-id}
echo -n 'YOUR_RAPEX_API_KEY' | gcloud secrets versions add RAPEX_API_KEY --data-file=- --project={project-id}
```

### **Práca s jednotlivými projektmi**
```bash
# Firebase backend
npm run firebase:deploy

# Shopify client development
npm run shopify:dev

# Build všetkých projektov
npm run build
```

### **Nasadenie**
```bash
# Nasadenie Firebase projektu (z firebase adresára)
cd firebase
firebase deploy --only functions,firestore --project {project-id}

# Alebo z root adresára
npm run firebase:deploy
```

## 🧪 Testovanie a Manuálne Spúšťanie

### **🤖 AI Product Safety Analysis** ⭐ **NAJNOVŠIE**

#### **Endpoint**: `checkProductSafetyAPI`
**URL**: `https://europe-west1-{project-id}.cloudfunctions.net/checkProductSafetyAPI`

#### **Autentifikácia**
```bash
# Nastavenie API kľúča ako environment premennej
export RAPEX_API_KEY="your-rapex-api-key-here"
```

#### **GET Request (Query Parameters)**
```bash
curl -sS "https://europe-west1-{project-id}.cloudfunctions.net/checkProductSafetyAPI?name=USB+charger&category=electronics&description=Fast+charger" \
  -H "Accept: application/json" \
  -H "X-API-Key: $RAPEX_API_KEY"
```

#### **POST Request (JSON Body)**
```bash
curl -sS -X POST https://europe-west1-{project-id}.cloudfunctions.net/checkProductSafetyAPI \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $RAPEX_API_KEY" \
  -d '{
    "name": "USB charger",
    "category": "electronics",
    "description": "Fast USB charger with EU plug",
    "brand": "Foo",
    "model": "Bar123"
  }'
```

#### **Response Schema**
```json
{
  "isSafe": false,
  "warnings": [
    {
      "alertId": "640f16555b7f223f80f272ac7351d4f19050145f",
      "similarity": 70,
      "riskLevel": "serious",
      "reason": "AI analysis found similarity with RAPEX alert...",
      "alertDetails": {
        "meta": {
          "recordid": "string",
          "alert_date": "2025-08-29T00:00:00.000Z",
          "ingested_at": "2025-09-02T15:50:36.948Z"
        },
        "fields": {
          "product_category": "Electrical appliances and equipment",
          "product_description": "Cord extension set with USB charger...",
          "risk_level": "serious",
          "notifying_country": "Hungary"
        }
      }
    }
  ],
  "recommendation": "⚡ CAUTION: Found alerts for similar products. Review safety concerns before purchase.",
  "checkedAt": "2025-09-02T20:02:39.338Z"
}
```

#### **AI Analysis Features**
- **Smart Matching**: AI porovnáva nový produkt s RAPEX alertami z posledných 7 dní
- **Similarity Scoring**: Hodnotí podobnosť (0-100) na základe kategórie, popisu, značky
- **Risk Assessment**: Identifikuje úroveň rizika a poskytuje odporúčania
- **Real-time Data**: Používa aktuálne RAPEX dáta z Firestore databázy

### **🛍️ Shopify Integration** ⭐ **NOVÉ**

#### **Prehľad**
Projekt teraz obsahuje kompletnú integráciu so Shopify platformou pre automatickú kontrolu bezpečnosti produktov.

#### **Komponenty integrácie**
- **Shopify App**: Kompletná aplikácia s admin rozhraním
- **Manual Product Check**: Manuálna kontrola jednotlivých produktov
- **Automated Webhooks**: Automatická kontrola pri vytvorení/upravení produktov
- **Safety Alerts Dashboard**: Prehľad všetkých bezpečnostných upozornení
- **Database Integration**: Prisma s SQLite pre lokálne uloženie alertov

#### **Nastavenie Shopify aplikácie**
```bash
# Prejdite do Shopify klienta
cd shopify-client/ra-pex

# Vytvorte .env súbor
echo "RAPEX_API_KEY=your-rapex-api-key-here" > .env
echo "FIREBASE_FUNCTIONS_BASE_URL=https://europe-west1-{project-id}.cloudfunctions.net" >> .env

# Spustite development server
npm run dev
```

#### **Funkcie Shopify aplikácie**
- **📋 Product Selection**: Interaktívny výber produktov na kontrolu
- **🔍 Safety Analysis**: Real-time analýza pomocou RAPEX databázy
- **⚠️ Alert Management**: Správa a sledovanie bezpečnostných upozornení
- **📊 Dashboard**: Prehľad štatistík a výsledkov kontrol
- **🔧 Manual Override**: Manuálne prepísanie výsledkov kontroly

#### **Webhook integrácie**
Aplikácia automaticky reaguje na tieto Shopify webhooky:
- `products/create` - Kontrola nových produktov
- `products/update` - Re-kontrola upravených produktov
- `app/uninstalled` - Čistenie dát pri odinštalovaní

#### **Bezpečnosť a autentifikácia**
- **API Key Protection**: Všetky API volania chránené RAPEX API kľúčom
- **CORS Support**: Podpora pre cross-origin požiadavky
- **Error Handling**: Robustné spracovanie chýb a výpadkov
- **Rate Limiting**: Ochrana pred preťažením API

### **Možnosť 1: HTTP API Endpoint** ⭐ **NAJĽAHŠIE**
```bash
# Manuálne spustenie cez HTTP
curl -X GET https://europe-west1-{project-id}.cloudfunctions.net/manualRapexLoader
```

**Odpoveď:**
```json
{
  "success": true,
  "message": "RAPEX loader completed successfully",
  "timestamp": "2025-09-02T18:00:00.000Z"
}
```

### **Možnosť 2: Webový prehliadač**
Otvorte priamo v prehliadači:
```
https://europe-west1-{project-id}.cloudfunctions.net/manualRapexLoader
```

### **Možnosť 3: Google Cloud Console**
1. **Cloud Scheduler** → Nájdite `firebase-schedule-dailyRapexDeltaLoader...` → "Force run"
2. **Cloud Functions** → `manualRapexLoader` → "Test function"
3. **Logs** → Sledujte real-time logy a výsledky

### **Monitoring a Debugging**
```bash
# Sledovanie logov
firebase functions:log --only dailyRapexDeltaLoader --project {project-id}
firebase functions:log --only manualRapexLoader --project {project-id}
firebase functions:log --only checkProductSafetyAPI --project {project-id}

# Kontrola stavu funkcií
firebase functions:list --project {project-id}
```

## 🔮 Budúce Rozšírenia

### **Plánované Funkcie**
- 🔍 **Produktové párovanie**: ✅ **IMPLEMENTOVANÉ** - `checkProductSafetyAPI` s AI analýzou
- ⚡ **Vyhľadávanie**: Full-text search a filter capabilities
- 📊 **Analytics API**: REST API pre štatistiky a reporty
- 🤖 **AI integrácie**: ✅ **IMPLEMENTOVANÉ** - Google Gemini 2.5 Flash Lite integrácia
- 📱 **Webhook notifikácie**: Automatické upozornenia na nové alerty

### **Použitie pre AI Systémy**

#### **Príklady Query:**
```javascript
// Vyhľadanie alertov podľa kategórie
const dangerousToys = await db.collection('rapex_alerts')
  .where('fields.product_category', '==', 'toys')
  .where('fields.risk_level', '==', 'serious')
  .orderBy('meta.alert_date', 'desc')
  .limit(10)
  .get();

// Kontrola bezpečnosti produktu
async function checkProductSafety(productName, category) {
  const alerts = await db.collection('rapex_alerts')
    .where('fields.product_category', '==', category)
    .where('fields.product_description', '>=', productName.toLowerCase())
    .where('fields.product_description', '<=', productName.toLowerCase() + '\uf8ff')
    .get();

  return alerts.docs.map(doc => doc.data());
}
```

#### **AI Prompt Template:**
```
Analyzuj tieto RAPEX alerty a identifikuj trendy v bezpečnosti výrobkov:

Produkt: {product_category}
Riziko: {risk_level}
Krajina: {notifying_country}
Popis: {product_description}

Poskytni odporúčania pre spotrebiteľov a výrobcov.

**Nové AI Endpoint**: `checkProductSafetyAPI` automaticky analyzuje produkty pomocou Gemini AI
```

## 🔐 Konfigurácia a Bezpečnosť

### **Secrets Management**
- **GOOGLE_API_KEY**: Uložený v Google Secret Manager
- **Automatické bindovanie**: Funkcia automaticky získava prístup k secretu
- **Bezpečnosť**: Kľúče nie sú v kóde ani v logoch

### **Autentifikácia**
- **HTTP Functions**: Vyžadujú API kľúč (X-API-Key header)
- **Scheduled Functions**: Spúšťajú sa automaticky s service account oprávneniami
- **CORS**: Povolené pre webové aplikácie

### **Rate Limiting & Quotas**
- **Timeout**: 120 sekúnd pre AI analýzu
- **Memory**: 512 MiB pre AI processing
- **Region**: europe-west1 (optimálne pre EU)

## 📞 Kontakt & Podpora

- 🐛 **Issues**: [GitHub Issues](https://github.com/radoone/RaPeX/issues)
- 📖 **Dokumentácia**: [Firebase Docs](https://firebase.google.com/docs/functions)
- 🎯 **RAPEX Dataset**: [OpenDataSoft](https://public.opendatasoft.com/explore/dataset/healthref-europe-rapex-en/)

## 📄 Licencia

Tento projekt je open-source a je určený pre vzdelávacie a bezpečnostné účely.
