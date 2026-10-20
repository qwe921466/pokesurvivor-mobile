// Disposable demo emulator accounts only. Never receives a production project or credential.
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,createUserWithEmailAndPassword,signInWithEmailAndPassword,updateProfile} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,getDoc,setDoc,serverTimestamp} from 'firebase/firestore';
import vm from 'node:vm';import fs from 'node:fs';import {webcrypto} from 'node:crypto';
const app=initializeApp({projectId:'demo-pokesurvivor',apiKey:'fake-api-key'});
const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
const db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',8089);
const context={G:{},TextEncoder,Uint8Array,crypto:webcrypto,structuredClone,Blob,addEventListener(){},
 document:{addEventListener(){}},localStorage:{getItem(){return null},setItem(){}}};
context.window=context;vm.createContext(context);
for(const path of ['js/core/util.js','js/data/pokedex.js','js/core/db.js'])vm.runInContext(fs.readFileSync(path,'utf8'),context);
for(let i=1;i<=4;i++){
 const email=`coop${i}@example.invalid`,password='EmulatorOnly123!';
 let c;try{c=await createUserWithEmailAndPassword(auth,email,password);}
 catch(e){if(e.code!=='auth/email-already-in-use')throw e;c=await signInWithEmailAndPassword(auth,email,password);}
 await updateProfile(c.user,{displayName:'CoopTester'+i});
 const ref=doc(db,'mobileSaves',c.user.uid);if((await getDoc(ref)).exists())continue;
 const save=context.G.DB.newSave('CoopTester'+i),dex=[1,4,7,25][i-1];
 save.partner=dex;save.starter=dex;save.owned[dex]={at:Date.now(),from:'starter'};
 await setDoc(ref,{payload:JSON.stringify(save),revision:1,op:'coop-fixture',updatedAt:serverTimestamp()});
}
await deleteApp(app);console.log('Four emulator-only co-op fixtures ready.');
