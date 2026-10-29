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
function boot(user='roomuser'+(++serial),options={}) {
 const db=env.authenticatedContext(user).firestore(),starts=[],closed=[];
 // Clone VM plain objects into the SDK realm, preserving Timestamp/FieldValue objects.
 const clone=v=>v?.constructor?.name==='Object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)])):v;
 const S={...SDK,setDoc:(r,d)=>SDK.setDoc(r,clone(d)),runTransaction:(s,fn)=>SDK.runTransaction(s,t=>fn({get:r=>t.get(r),set:(r,d)=>t.set(r,clone(d))}))};
 const G={DB:{user,cloudUid:user,save:{partner:1,partnerShiny:false},onLeave(){}},
   Cloud:{roomSession:async()=>({S,fs:db,uid:user}),errorText:e=>e.message},
   Net:{open(){},syncMembers(){},close(){closed.push(true)},mode:()=> 'direct'},
   Game:{state:'ui'},Flow:{startCoop:c=>starts.push(c)},UI:{toast(){}}};
 const c={G,crypto:webcrypto,Uint8Array,Uint32Array,setTimeout,clearTimeout,setInterval(){},performance:{now:()=>1000}};vm.createContext(c);
 vm.runInContext(fs.readFileSync('js/systems/halloween.js','utf8'),c);
 G.Halloween={isOn:G.Halloween.isOn,on:!!options.localHw};
 const source=fs.readFileSync('js/net/mobile-rooms.js','utf8');
 // Retain an old client's version guard to verify existing rooms remain isolated and usable.
 vm.runInContext(options.protocol===2?source.replace('const PROTOCOL = 3,','const PROTOCOL = 2,'):source,c);
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

test('protocol 2 supports battle reconnection and host removal without granting edits to other members',async()=>{
 const h=boot(undefined,{protocol:2}),a=boot(undefined,{protocol:2}),b=boot(undefined,{protocol:2});await h.G.Social.createRoom();await until(()=>h.G.Social.room);
 const id=h.G.Social.room.id;await a.G.Social.joinRoom(id);await b.G.Social.joinRoom(id);
 await until(()=>h.G.Social.room.members.length===3&&a.G.Social.room&&b.G.Social.room);
 assert.equal(h.G.Social.room.protocol,2);
 await a.G.Social.ready(true);await b.G.Social.ready(true);await until(()=>h.G.Social.room.members.filter(m=>m.ready).length===2);
 await h.G.Social.begin();await until(()=>a.G.Social.room.state==='playing');
 const signal=['mobileRooms',id,'signals',a.user];
 const offer={hostSession:h.G.Social.session,guestSession:a.G.Social.session,nonce:webcrypto.randomUUID(),offer:'reconnect',answer:'',updatedAt:SDK.serverTimestamp()};
 await SDK.setDoc(SDK.doc(h.db,...signal),offer);await SDK.setDoc(SDK.doc(a.db,...signal),{...offer,answer:'connected'});
 const row=(await SDK.getDoc(SDK.doc(h.db,'mobileRooms',id))).data();
 await assertFails(SDK.setDoc(SDK.doc(h.db,'mobileRooms',id),{...row,members:{...row.members,[a.user]:{...row.members[a.user],dex:25}},updatedAt:SDK.serverTimestamp()}));
 await assertFails(SDK.setDoc(SDK.doc(a.db,'mobileRooms',id),{...row,members:{[h.user]:row.members[h.user],[a.user]:row.members[a.user]},updatedAt:SDK.serverTimestamp()}));
 await h.G.Social.dropMember(a.user);await until(()=>!a.G.Social.room&&h.G.Social.room.members.length===2);
 assert.equal(b.G.Social.room.members.find(m=>m.uid===b.user).dex,1);
 await assertFails(SDK.getDoc(SDK.doc(a.db,...signal)));
 await h.G.Social.leaveRoom();
});

test('protocol 3 and previous clients reject each others rooms before changing membership',async()=>{
 const old=boot(undefined,{protocol:2}),current=boot();
 try {
  assert.equal((await old.G.Social.createRoom()).ok,true);await until(()=>old.G.Social.room);
  const rejected=await current.G.Social.joinRoom(old.G.Social.room.id);
  assert.equal(rejected.ok,false);assert.match(rejected.error,/版本不同/);
  assert.equal(old.G.Social.room.members.length,1);assert.equal(current.G.Social.room,null);
  const olderGuest=boot(undefined,{protocol:2});
  assert.equal((await current.G.Social.createRoom()).ok,true);await until(()=>current.G.Social.room);
  assert.equal(current.G.Social.room.protocol,3);
  const reverse=await olderGuest.G.Social.joinRoom(current.G.Social.room.id);
  assert.equal(reverse.ok,false);assert.match(reverse.error,/版本不同/);
  assert.equal(current.G.Social.room.members.length,1);assert.equal(olderGuest.G.Social.room,null);
 } finally {await old.G.Social.leaveRoom();await current.G.Social.leaveRoom();}
});

test('host and guest use the server start timestamp for Halloween even when local flags disagree',async()=>{
 const h=boot(undefined,{localHw:false}),g=boot(undefined,{localHw:true});
 try {
  await h.G.Social.createRoom();await until(()=>h.G.Social.room);
  assert.equal((await g.G.Social.joinRoom(h.G.Social.room.id)).ok,true);
  await until(()=>g.G.Social.room&&h.G.Social.room.members.length===2);
  assert.equal((await g.G.Social.ready(true)).ok,true);
  await until(()=>h.G.Social.room.members.find(m=>m.uid===g.user).ready);
  assert.equal((await h.G.Social.begin()).ok,true);
  await until(()=>h.starts.length===1&&g.starts.length===1);
  const expected=h.G.Halloween.isOn(h.G.Social.room.updatedAt.toDate());
  assert.equal(h.G.Social.room.updatedAt.toMillis(),g.G.Social.room.updatedAt.toMillis());
  assert.equal(h.starts[0].hw,expected);assert.equal(g.starts[0].hw,expected);
  assert.notEqual(h.G.Halloween.on,g.G.Halloween.on);
  assert.ok([h,g].some(d=>d.starts[0].hw!==d.G.Halloween.on));
 } finally {await h.G.Social.leaveRoom();}
});
