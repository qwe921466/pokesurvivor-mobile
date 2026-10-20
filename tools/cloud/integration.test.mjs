import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase/app';
import * as authSDK from 'firebase/auth';
import * as fireSDK from 'firebase/firestore';
const apps=[],devices=[];
let serial=0;
function boot(storage=new Map()) {
 const appId=++serial,events={};let app;
 const sdk={...authSDK,...fireSDK,runTransaction:(store,fn)=>fireSDK.runTransaction(store,tx=>fn({get:ref=>tx.get(ref),set:(ref,data)=>tx.set(ref,Object.assign({},data))})),initializeApp:config=>{app=initializeApp(config,'test-device-'+appId);apps.push(app);return app},getAuth:a=>authSDK.initializeAuth(a,{persistence:authSDK.inMemoryPersistence}),browserLocalPersistence:authSDK.inMemoryPersistence};
 const timers=new Set();const timeout=(f,ms)=>{const t=setTimeout(f,ms);timers.add(t);return t};
 const ctx={console,TextEncoder,Uint8Array,crypto:webcrypto,structuredClone,Blob,setTimeout:timeout,clearTimeout,
 location:{hostname:'localhost'},CustomEvent:class{constructor(type,o){this.type=type;this.detail=o?.detail}},
 localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 addEventListener:(t,f)=>events[t]=f,dispatchEvent(){},document:{hidden:false,addEventListener(){}},
 G:{CloudSDK:sdk,CLOUD_CONFIG:{projectId:'demo-pokesurvivor',apiKey:'fake-api-key',emulator:true}}};
 ctx.window=ctx;vm.createContext(ctx);
 for(const p of ['js/core/util.js','js/data/pokedex.js','js/data/sprites-meta.js','js/data/upgrades.js','js/data/moves.js','js/core/db.js','js/systems/gacha.js','js/core/cloud-sync.js','js/core/cloud.js'])vm.runInContext(fs.readFileSync(p,'utf8'),ctx);
 ctx.G.Sprites={hasShiny:d=>!!ctx.G.SPRITE_META[d]?.sh};
 const result={G:ctx.G,storage,events,timers,get app(){return app}};devices.push(result);return result;
}
after(async()=>{for(const d of devices)for(const t of d.timers)clearTimeout(t);await Promise.all(apps.map(deleteApp));});
const suffix=Date.now();const email=`sync-${suffix}@example.invalid`,pass='EmulatorOnly123!';
let a,b;
test('migrate a local account into a new cloud identity without changing its source save',async()=>{
 a=boot();await a.G.DB.register('CloudTester','local-pass');a.G.Gacha.pull(a.G.DB.save,1,1,'t1');a.G.DB.save.partner=1;a.G.DB.grant(1,'starter');a.G.DB.commit();
 const source=a.storage.get('pokesurvivor.mobile.save.cloudtester');
 const result=await a.G.Cloud.authenticate('register',email,pass,'CloudTester',true);assert.equal(result.ok,true,result.error);assert.equal(a.G.DB.mode,'personal-cloud');assert.equal(a.G.Cloud.status,'ok');assert.equal(a.G.DB.save.tickets.t1,998);assert.equal(a.storage.get('pokesurvivor.mobile.save.cloudtester'),source);
});
test('second device signs into the same identity, sees gacha progress, edits and first device refreshes',async()=>{
 b=boot();assert.equal((await b.G.Cloud.authenticate('login',email,pass,'',false)).ok,true);assert.equal(b.G.DB.save.tickets.t1,998);
 b.G.Gacha.pull(b.G.DB.save,10,1,'t10');b.G.DB.commit();assert.equal(await b.G.Cloud.sync(),true);assert.equal(await a.G.Cloud.sync(true),true);assert.equal(a.G.DB.save.tickets.t10,998);
});
test('real Firestore transactions stop conflicting spending and explicit resolution works',async()=>{
 a.G.DB.save.coins=25;a.G.DB.commit();b.G.DB.save.coins=15;b.G.DB.commit();await a.G.Cloud.sync();assert.equal(await b.G.Cloud.sync(),false);assert.equal(b.G.Cloud.status,'conflict');assert.equal(b.G.Cloud.conflict.save.coins,25);
 // Avoid UI flow dependencies in this headless integration test.
 b.G.Flow={afterLogin(){}};assert.equal(await b.G.Cloud.resolve('remote'),true);assert.equal(b.G.DB.save.coins,25);
});
test('cloud exports omit Firebase credentials and rankings contain only public score fields',async()=>{
 const exported=a.G.DB.exportSave();assert.ok(!/idToken|refreshToken|apiKey|password|email/.test(exported));
 a.G.Cloud.completedRun({t:65,lv:4,kills:20,dex:1,shiny:false});await new Promise(ok=>setTimeout(ok,800));
 const ranks=await b.G.Cloud.rankings();const me=ranks.find(r=>r.mine);assert.ok(me);assert.equal(me.time,65);assert.equal(me.name,'CloudTester');assert.ok(!Object.hasOwn(me,'email'));
});
test('refill and v4 fields sync to a second device, and post-update runs beyond 35 minutes can rank',async()=>{
 a.G.DB.refillResources();a.G.DB.setFav(1,true);a.G.DB.save.pstart[1]='vine-whip';a.G.DB.save.pused[1]=7;a.G.DB.save.pupg[1]={start:1};a.G.DB.commit();
 assert.equal(await a.G.Cloud.sync(),true);assert.equal(await b.G.Cloud.sync(true),true);
 assert.equal(b.G.DB.save.v,4);assert.equal(b.G.DB.save.coins,999999999);assert.equal(b.G.DB.save.tickets.t1,999999);assert.equal(b.G.DB.isFav(1),true);assert.equal(b.G.DB.save.pstart[1],'vine-whip');assert.equal(b.G.DB.save.pused[1],7);assert.equal(b.G.DB.save.pupg[1].start,1);
 b.G.Gacha.pull(b.G.DB.save,10,1,'t10');b.G.DB.commit();await b.G.Cloud.sync();await a.G.Cloud.sync(true);assert.equal(a.G.DB.save.tickets.t10,999998);
 a.G.Cloud.completedRun({t:2401,lv:50,kills:800,dex:1,shiny:false});await new Promise(ok=>setTimeout(ok,800));assert.equal((await b.G.Cloud.rankings()).find(r=>r.mine).time,2401);
});
test('signing out retains durable cloud cache and source local account',async()=>{
 await a.G.DB.logout();assert.equal(a.G.DB.loggedIn,false);assert.ok([...a.storage.keys()].some(k=>k.startsWith('pokesurvivor.mobile.cloud.')));assert.equal((await a.G.DB.login('CloudTester','local-pass')).ok,true);assert.equal(a.G.DB.mode,'local');assert.equal(a.G.DB.save.tickets.t1,998);
});
