import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

async function checkRapexData() {
  try {
    initializeApp();
    const db = getFirestore();
    console.log('🔍 Kontrola Safety Gate dát...\n');
    
    const alertsSnapshot = await db.collection('rapex_alerts').limit(3).get();
    
    if (!alertsSnapshot.empty) {
      console.log('✅ Nájdené Safety Gate alerty:');
      
      let counter = 1;
      alertsSnapshot.forEach((doc) => {
        const data = doc.data();
        console.log('\n' + counter + '. Alert ID: ' + doc.id);
        console.log('   Fields:', Object.keys(data.fields || {}));
        console.log('   Risk level:', data.fields?.risk_level);
        console.log('   Risk type:', data.fields?.risk_type);
        console.log('   Risk description:', data.fields?.risk_description);
        console.log('   Alert type:', data.fields?.alert_type);
        console.log('   Technical defect:', data.fields?.technical_defect);
        console.log('   Sample fields:', JSON.stringify(data.fields, null, 2).substring(0, 500) + '...');
        counter++;
      });
    } else {
      console.log('❌ Žiadne Safety Gate alerty sa nenašli');
    }
  } catch (error) {
    console.error('❌ Chyba:', error);
  }
}

checkRapexData();
