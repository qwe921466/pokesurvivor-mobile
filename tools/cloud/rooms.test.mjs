import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import * as SDK from 'firebase/firestore';
let env,serial=0;const devices=[];
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-pokesurvivor',firestore:{host:'127.0.0.1',port:8089,rules:fs.readFileSync('cloud/firestore.rules','utf8')}})});
after(async()=>{for(const d of devices)await d.G.Social.leaveRoom().catch(()=>{});await env.cleanup();});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await sleep(40);}assert.ok(fn(),'room listener timed out');}
function boot(user='roomuser'+(++serial)) {
 const db=env.authenticatedContext(user).firestore(),starts=[],closed=[];
 // Clone VM plain objects into the SDK realm, preserving Timestamp/FieldValue objects.
 const clone=v=>v?.constructor?.name==='Object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)])):v;
 const S={...SDK,setDoc:(r,d)=>SDK.setDoc(r,clone(d)),runTransaction:(s,fn)=>SDK.runTransaction(s,t=>fn({get:r=>t.get(r),set:(r,d)=>t.set(r,clone(d))}))};
 const G={DB:{user,cloudUid:user,save:{partner:1,partnerShiny:false},onLeave(){}},
   Cloud:{roomSession:async()=>({S,fs:db,uid:user}),errorText:e=>e.message},
   Net:{open(){},syncMembers(){},close(){closed.push(true)},mode:()=> 'direct'},
   Game:{state:'ui'},Flow:{startCoop:c=>starts.push(c)},UI:{toast(){}}};
 const c={G,crypto:webcrypto,Uint8Array,Uint32Array,setTimeout,clearTimeout};vm.createContext(c);
 vm.runInContext(fs.readFileSync('js/net/mobile-rooms.js','utf8'),c);
 const d={G,db,user,starts,closed};devices.push(d);return d;
}
let host,guests,code;
test('actual room client creates, joins concurrently up to four, rejects a fifth and duplicate account',async()=>{
 host=boot();assert.equal((await host.G.Social.createRoom()).ok,true);await until(()=>host.G.Social.room);
 code=host.G.Social.room.id;assert.match(code,/^[A-HJ-NP-Z2-9]{10}$/);
 guests=[boot(),boot(),boot(),boot()];
 const results=await Promise.all(guests.map(g=>g.G.Social.joinRoom(code)));
 assert.equal(results.filter(r=>r.ok).length,3,JSON.stringify(results));
 guests=guests.filter((_,i)=>results[i].ok);
 await until(()=>host.G.Social.room.members.length===4&&guests.every(g=>g.G.Social.room));
 const duplicate=boot(guests[0].user);assert.equal((await duplicate.G.Social.joinRoom(code)).ok,false);
 const record=(await SDK.getDoc(SDK.doc(host.db,'mobileRooms',code))).data();
 assert.ok(!JSON.stringify(record).match(/email|password|token|coins|tickets|payload/i));
});
test('only prepared players can start; host transition starts each device exactly once',async()=>{
 assert.equal((await host.G.Social.begin()).ok,false);
 await Promise.all(guests.map(async g=>assert.equal((await g.G.Social.ready(true)).ok,true)));
 await until(()=>host.G.Social.room.members.filter(m=>m.ready).length===3);
 assert.equal((await guests[0].G.Social.begin()).ok,false);
 assert.equal((await host.G.Social.begin()).ok,true);
 await until(()=>[host,...guests].every(g=>g.starts.length===1));
 assert.equal(host.starts[0].members.length,4);
 await sleep(100);assert.equal(host.starts.length,1);
 const outsider=boot();assert.equal((await outsider.G.Social.joinRoom(code)).ok,false);
});
test('return to lobby clears readiness; character changes sync on ready; runs retain distinct sequence',async()=>{
 host.G.Social.setOpen(true);await until(()=>host.G.Social.room.state==='lobby'&&guests.every(g=>g.G.Social.room.state==='lobby'));
 assert.ok(host.G.Social.room.members.every(m=>!m.ready));
 guests[0].G.DB.save.partner=25;
 await Promise.all(guests.map(g=>g.G.Social.ready(true)));
 await until(()=>host.G.Social.room.members.filter(m=>m.ready).length===3);
 assert.equal(host.G.Social.room.members.find(m=>m.uid===guests[0].user).dex,25);
 await host.G.Social.begin();await until(()=>[host,...guests].every(g=>g.starts.length===2));
 assert.equal(host.starts[1].run,2);
});
test('guests leave without replacing others; host closing disconnects remaining guests',async()=>{
 await guests[0].G.Social.leaveRoom();await until(()=>host.G.Social.room.members.length===3);
 let settled=0;host.G.Coop={active:true,isHost:true};host.G.Game.quit=()=>{settled++;host.G.Coop.active=false;};
 await host.G.Social.leaveRoom();await until(()=>guests.slice(1).every(g=>!g.G.Social.room));
 assert.ok(guests[1].closed.length);assert.equal(settled,1);
});
const member=session=>({name:'Tester',dex:1,shiny:false,ready:false,session});
async function fixture(code='ABCDEFGH23') {
 const a=env.authenticatedContext('rulehost').firestore(),b=env.authenticatedContext('ruleguest').firestore();
 const row={host:'rulehost',protocol:1,state:'lobby',members:{rulehost:member('A'.repeat(16))},
 run:0,seed:0,createdAt:SDK.serverTimestamp(),updatedAt:SDK.serverTimestamp(),expiresAt:SDK.Timestamp.fromMillis(Date.now()+600000)};
 await env.withSecurityRulesDisabled(async c=>SDK.setDoc(SDK.doc(c.firestore(),'mobileRooms',code),row));
 const r=(await SDK.getDoc(SDK.doc(b,'mobileRooms',code))).data();
 await SDK.setDoc(SDK.doc(b,'mobileRooms',code),{...r,members:{...r.members,ruleguest:member('B'.repeat(16))},updatedAt:SDK.serverTimestamp()});
 return {a,b,code,row:(await SDK.getDoc(SDK.doc(a,'mobileRooms',code))).data()};
}
test('room rules deny anonymous reads, enumeration, foreign membership edits and guest starts',async()=>{
 const {a,b,code,row}=await fixture();
 const outsider=env.authenticatedContext('outsider').firestore(),anon=env.unauthenticatedContext().firestore();
 await assertFails(SDK.getDoc(SDK.doc(anon,'mobileRooms',code)));
 await assertFails(SDK.getDocs(SDK.collection(a,'mobileRooms')));
 const bad={...row,updatedAt:SDK.serverTimestamp()};
 await assertFails(SDK.setDoc(SDK.doc(b,'mobileRooms',code),{...bad,host:'ruleguest'}));
 await assertFails(SDK.setDoc(SDK.doc(b,'mobileRooms',code),{...bad,state:'playing',run:1}));
 await assertFails(SDK.setDoc(SDK.doc(b,'mobileRooms',code),{...bad,members:{...row.members,rulehost:member('C'.repeat(16))}}));
 await assertFails(SDK.setDoc(SDK.doc(outsider,'mobileRooms',code),{...bad,state:'closed'}));
 await assertFails(SDK.setDoc(SDK.doc(b,'mobileRooms',code),{...bad,email:'not-allowed'}));
 await assertFails(SDK.setDoc(SDK.doc(b,'mobileRooms',code),{...bad,members:{...row.members,ruleguest:member('D'.repeat(16))}}));
});
test('SDP visible only to its two endpoints; guests cannot forge offers, nonce, or unrelated data',async()=>{
 const {a,b,code}=await fixture('ABCDEFGH24');
 const path=['mobileRooms',code,'signals','ruleguest'];
 const d={hostSession:'A'.repeat(16),guestSession:'B'.repeat(16),nonce:webcrypto.randomUUID(),offer:'test-offer',answer:'',updatedAt:SDK.serverTimestamp()};
 await assertFails(SDK.setDoc(SDK.doc(b,...path),d));
 await SDK.setDoc(SDK.doc(a,...path),d);
 await SDK.getDoc(SDK.doc(b,...path));
 const outsider=env.authenticatedContext('third').firestore();
 await assertFails(SDK.getDoc(SDK.doc(outsider,...path)));
 await assertFails(SDK.setDoc(SDK.doc(b,...path),{...d,answer:'ok',offer:'forged'}));
 await assertFails(SDK.setDoc(SDK.doc(b,...path),{...d,answer:'ok',nonce:webcrypto.randomUUID()}));
 await assertFails(SDK.setDoc(SDK.doc(a,...path),{...d,offer:'x'.repeat(24001)}));
 await SDK.setDoc(SDK.doc(b,...path),{...d,answer:'test-answer'});
 await assertFails(SDK.setDoc(SDK.doc(b,...path),{...d,answer:'replacement'}));
});
test('closed and expired rooms reject membership and signaling writes',async()=>{
 const {a,b,code,row}=await fixture('ABCDEFGH25');
 await SDK.setDoc(SDK.doc(a,'mobileRooms',code),{...row,state:'closed',updatedAt:SDK.serverTimestamp()});
 await assertFails(SDK.setDoc(SDK.doc(b,'mobileRooms',code),{...row,updatedAt:SDK.serverTimestamp()}));
 await assertFails(SDK.getDoc(SDK.doc(b,'mobileRooms',code,'signals','ruleguest')));
 await env.withSecurityRulesDisabled(async c=>SDK.setDoc(SDK.doc(c.firestore(),'mobileRooms','ABCDEFGH26'),{...row,expiresAt:SDK.Timestamp.fromMillis(1)}));
 await assertFails(SDK.setDoc(SDK.doc(b,'mobileRooms','ABCDEFGH26'),{...row,updatedAt:SDK.serverTimestamp()}));
});
