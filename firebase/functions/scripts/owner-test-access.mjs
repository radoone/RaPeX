// Owner-only maintenance. No subscription fields are changed; no app route grants access.
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/firebase-admin.js';
import { installationKey } from '../lib/product-lifecycle.js';
const shop=process.argv.find(a=>a.startsWith('--shop='))?.slice(7);
const enable=process.argv.includes('--enable'),disable=process.argv.includes('--disable');
if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || enable===disable) throw new Error('Use --shop=example.myshopify.com and exactly one of --enable / --disable');
const merchant=db.collection('merchants').doc(encodeURIComponent(shop));const event=merchant.collection('owner_test_access_events').doc();
await db.runTransaction(async tx=>{
 const snapshot=await tx.get(merchant);
 if(!snapshot.exists || snapshot.get('installationRetiredAt') || snapshot.get('shop')!==shop)throw new Error('Expected a live matching installed merchant');
 const grant={enabled:enable,shop,installation:installationKey(snapshot.data()),expiresAt:null,updatedAt:FieldValue.serverTimestamp(),authorization:'Explicit app owner request'};
 tx.update(merchant,{ownerTestAccess:grant});tx.create(event,{...grant,action:enable?'enable':'disable'});
});
console.log(JSON.stringify({shop,ownerTestAccess:enable,until:enable?'owner_revokes':'disabled',subscriptionChanged:false}));
