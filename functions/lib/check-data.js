// Skript na kontrolu RAPEX dát vo Firestore
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
async function checkRapexData() {
    try {
        // Initialize Firebase Admin
        initializeApp();
        const db = getFirestore();
        console.log("🔍 Kontrola RAPEX dát...\n");
        // 1. Skontrolujeme meta kolekciu
        console.log("📊 Kontrola meta kolekcie:");
        const metaDoc = await db.collection("rapex_meta").doc("loader_state").get();
        if (metaDoc.exists) {
            const metaData = metaDoc.data();
            console.log("✅ Meta dáta nájdené:");
            console.log(`   - Posledný beh: ${metaData?.last_run_status}`);
            console.log(`   - Posledný dátum: ${metaData?.last_alert_date?.toDate()?.toLocaleDateString('sk-SK')}`);
            console.log(`   - Spracovaných záznamov: ${metaData?.last_run_processed_records || 0}`);
        }
        else {
            console.log("❌ Meta kolekcia neexistuje (funkcia sa ešte nespustila)");
        }
        console.log("\n" + "=".repeat(50) + "\n");
        // 2. Skontrolujeme RAPEX alerty
        console.log("🚨 Kontrola RAPEX alertov:");
        const alertsSnapshot = await db.collection("rapex_alerts").limit(5).get();
        if (!alertsSnapshot.empty) {
            console.log(`✅ Nájdených ${alertsSnapshot.size} RAPEX alertov (zobrazených prvých 5):`);
            let counter = 1;
            alertsSnapshot.forEach((doc) => {
                const data = doc.data();
                console.log(`\n${counter}. Alert ID: ${doc.id}`);
                console.log(`   📅 Dátum: ${data.meta?.alert_date?.toDate()?.toLocaleDateString('sk-SK')}`);
                console.log(`   🏷️  Produkt: ${data.fields?.product_category || 'Neznámy'}`);
                console.log(`   ⚠️  Riziko: ${data.fields?.risk_level || 'Neznámy'}`);
                console.log(`   🇪🇺 Krajina: ${data.fields?.notifying_country || 'Neznáma'}`);
                counter++;
            });
            // Spočítaj celkový počet
            const totalCount = (await db.collection("rapex_alerts").count().get()).data().count;
            console.log(`\n📈 Celkový počet alertov v databáze: ${totalCount}`);
        }
        else {
            console.log("❌ Žiadne RAPEX alerty sa nenašli");
            console.log("💡 Skúste spustiť funkciu manuálne najprv:");
            console.log("   curl https://europe-west1-rapex-99a2c.cloudfunctions.net/manualRapexLoader");
        }
    }
    catch (error) {
        console.error("❌ Chyba pri kontrole dát:", error);
    }
}
// Spusti kontrolu
checkRapexData();
