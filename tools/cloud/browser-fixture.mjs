// Creates only an emulator fixture; refuses any non-demo project.
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,createUserWithEmailAndPassword,updateProfile} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,setDoc,serverTimestamp} from 'firebase/firestore';
import vm from 'node:vm';import fs from 'node:fs';import {webcrypto} from 'node:crypto';
const projectId='demo-pokesurvivor';if(!projectId.startsWith('demo-'))throw Error('Emulator only');
const app=initializeApp({projectId,apiKey:'fake-api-key'});const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});const db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',8089);
const email='browser-fixture@example.invalid',password='EmulatorOnly123!';
const c=await createUserWithEmailAndPassword(auth,email,password);await updateProfile(c.user,{displayName:'BrowserTester'});
const context={G:{},TextEncoder,Uint8Array,crypto:webcrypto,structuredClone,Blob,addEventListener(){},document:{addEventListener(){}},localStorage:{getItem(){return null},setItem(){}}};context.window=context;vm.createContext(context);for(const path of ['js/core/util.js','js/data/pokedex.js','js/core/db.js'])vm.runInContext(fs.readFileSync(path,'utf8'),context);
const save=context.G.DB.newSave('BrowserTester');save.partner=1;save.starter=1;save.owned[1]={at:Date.now(),from:'starter'};
await setDoc(doc(db,'mobileSaves',c.user.uid),{payload:JSON.stringify(save),revision:1,op:'browser-fixture',updatedAt:serverTimestamp()});
await setDoc(doc(db,'mobileRanks',c.user.uid),{name:'BrowserTester',time:0,level:0,kills:0,dex:0,shiny:false,updatedAt:serverTimestamp()});
await deleteApp(app);console.log('Emulator browser fixture ready.');
