const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),{webcrypto}=require('node:crypto');
const tick=()=>new Promise(r=>setImmediate(r));
function boot(host=true){
 const writes=[],pcs=[],callbacks=new Map(),events=[],received=[];
 let channel;
 class PC{
  constructor(options){this.options=options;this.iceGatheringState='complete';pcs.push(this);}
  createDataChannel(){channel={readyState:'open',bufferedAmount:0,sent:[],send(d){this.sent.push(d)},close(){}};return channel;}
  async createOffer(){return {type:'offer',sdp:'offer-with-candidates'};}
  async createAnswer(){return {type:'answer',sdp:'answer-with-candidates'};}
  async setLocalDescription(d){this.localDescription=d;}
  async setRemoteDescription(d){this.remoteDescription=d;}
  close(){this.closed=true;}
 }
 const S={doc:(_, ...p)=>p.join('/'),serverTimestamp:()=>0,setDoc:async(r,d)=>writes.push({r,d}),
  runTransaction:async(_,fn)=>fn({get:async()=>({data:()=>({nonce:'offer-nonce'})}),set:(r,d)=>writes.push({r,d})}),
  onSnapshot:(r,o,fn)=>{callbacks.set(r,fn);return()=>callbacks.delete(r);}};
 const G={Social:{transport:{S,fs:{},uid:host?'host':'guest'},session:(host?'A':'B').repeat(16),room:{state:'lobby'}}};
 const context={G,crypto:webcrypto,RTCPeerConnection:PC,setTimeout,clearTimeout,TextEncoder,TextDecoder,ArrayBuffer,Uint8Array,DataView};
 vm.createContext(context);
 vm.runInContext(fs.readFileSync('js/net/codec.js','utf8'),context);
 vm.runInContext(fs.readFileSync('js/net/mobile-net.js','utf8'),context);
 G.Net.onPeer((u,s)=>events.push([u,s]));G.Net.on((u,m)=>received.push(m));
 G.Net.open('ROOM',host,'host');
 G.Net.syncMembers([{uid:'host',session:'A'.repeat(16)},{uid:'guest',session:'B'.repeat(16)}]);
 return {G,context,writes,pcs,callbacks,events,received,get dc(){return channel;}};
}
test('only bounded SDP is written to Firestore; gameplay uses the direct channel and forged starts are ignored',async()=>{
 const b=boot();try{
 await tick();assert.equal(b.writes.length,1);assert.equal(b.pcs[0].options.iceServers.length,1);
 const {r,d}=b.writes[0];b.callbacks.get(r)({exists:()=>true,metadata:{},data:()=>({...d,answer:'answer'})});
 await tick();assert.equal(b.pcs[0].remoteDescription.type,'answer');
 b.dc.onopen();assert.equal(b.G.Net.mode('guest'),'direct');
 for(let i=0;i<500;i++)b.G.Net.send('guest',{k:'f',ev:[]});
 assert.equal(b.writes.length,1);assert.equal(b.G.Net.stats.relaySent,0);
 b.dc.onmessage({data:JSON.stringify({k:'start',host:'guest'})});assert.equal(b.received.length,0);
 b.dc.onmessage({data:JSON.stringify({k:'f',ev:[]})});assert.equal(b.received.length,1);
 b.dc.bufferedAmount=3*1024*1024;const sent=b.G.Net.stats.sent;b.G.Net.send('guest',{k:'f',ev:[]});assert.equal(b.G.Net.stats.sent,sent);
 }finally{b.G.Net.close();}
});
test('disconnect emits failure without background retries; explicit retry creates a new negotiation',async()=>{
 const b=boot();try{
 await tick();b.dc.onopen();b.dc.onclose();assert.equal(b.G.Net.mode('guest'),'failed');
 await tick();assert.equal(b.writes.length,1);
 b.G.Net.retry();await tick();assert.equal(b.writes.length,2);
 assert.notEqual(b.writes[0].d.nonce,b.writes[1].d.nonce);
 b.G.Net.close();assert.equal(b.callbacks.size,0);assert.ok(b.events.some(([,s])=>s==='closed'));
 }finally{b.G.Net.close();}
});
test('leaving during async negotiation cannot write a late offer or retain listeners',async()=>{
 const b=boot();b.G.Net.close();await tick();assert.equal(b.writes.length,0);assert.equal(b.callbacks.size,0);
});
test('malformed battle envelopes and oversized payloads are discarded',async()=>{
 const b=boot();try{
 await tick();b.dc.onopen();
 for(const msg of [{k:'f',ev:'bad'},{k:'f',ev:[null]},{k:'f',p:[0]}, {k:'f',padding:'x'.repeat(1048576)}])
 b.dc.onmessage({data:JSON.stringify(msg)});
 assert.equal(b.received.length,0);
 }finally{b.G.Net.close();}
});
test('guest accepts the host player-state map and level-up event, in JSON and binary',async()=>{
 const b=boot(false);try{
 await b.callbacks.get('mobileRooms/ROOM/signals/guest')({exists:()=>true,metadata:{},
   data:()=>({nonce:'offer-nonce',offer:'test',hostSession:'A'.repeat(16),guestSession:'B'.repeat(16)})});
 b.pcs[0].ondatachannel({channel:b.pcs[0].createDataChannel()});b.dc.onopen();
 const frame={k:'f',p:{host:Array(15).fill(0)},ev:[['lv',2]],lu:[1,2]};
 b.dc.onmessage({data:JSON.stringify(frame)});assert.equal(b.received.length,1);
 b.dc.onmessage({data:JSON.stringify({k:'net-cap',binary:b.G.NetCodec.version})});
 b.dc.onmessage({data:vm.runInContext('G.NetCodec.encode('+JSON.stringify(frame)+')',b.context)});assert.equal(b.received.length,2);
 b.dc.onmessage({data:JSON.stringify({k:'f',p:{outsider:Array(15).fill(0)}})});
 assert.equal(b.received.length,2);
 }finally{b.G.Net.close();}
});

test('battle recovery makes only one automatic same-session negotiation per run and leaving cancels it',async()=>{
 const b=boot();try{
 await tick();b.dc.onopen();b.G.Social.room={state:'playing',run:1};b.dc.onclose();
 await new Promise(r=>setTimeout(r,1600));await tick();assert.equal(b.writes.length,2);
 b.dc.onopen();b.dc.onclose();await new Promise(r=>setTimeout(r,1600));assert.equal(b.writes.length,2);
 b.G.Social.room={state:'lobby',run:1};b.G.Net.retry();await tick();b.dc.onopen();
 b.G.Social.room={state:'playing',run:2};b.dc.onclose();b.G.Net.close();
 await new Promise(r=>setTimeout(r,1600));assert.equal(b.writes.length,3);assert.equal(b.callbacks.size,0);
 }finally{b.G.Net.close();}
});

test('backpressure stops enqueuing above 64 KiB and resumes after the channel drains',async()=>{
 const b=boot();try{
 assert.equal(b.G.Net.busy('guest'),true);
 await tick();b.dc.onopen();assert.equal(b.G.Net.busy('guest'),false);
 b.dc.bufferedAmount=65537;
 assert.equal(b.G.Net.busy('guest'),true);
 assert.equal(b.G.Net.send('guest',{k:'f',ev:[['lp']]}),false);
 assert.equal(b.G.Net.stats.sent,0);
 b.dc.bufferedAmount=0;
 assert.equal(b.G.Net.send('guest',{k:'f',ev:[['lp']]}),true);
 assert.equal(b.G.Net.stats.sent,1);assert.equal(b.writes.length,1);
 b.dc.onclose();assert.equal(b.G.Net.busy('guest'),true);
 }finally{b.G.Net.close();}
});

function coopBoot(host=true){
 const sent=[],teamSync=[];let receive,blocked=true,accept=true;
 class Player{
  constructor(mon){Object.assign(this,{dex:mon.dex,anim:{},hp:100,maxHp:100,moveAngle:0,magnet:78,aim:0,xpMul:1});}
  activeGroup(){return [];}
 }
 const G={Net:{uid:host?'host':'guest',slow:()=>false,busy:()=>blocked,on:fn=>receive=fn,onPeer(){},
  send:(u,msg)=>{if(!accept)return false;sent.push(msg);return true;},
  toHost(msg){return this.send('host',msg);}},
  Player,DEX_BY:{25:{dex:25}},baseStartOf:()=>'',Sprites:{preload(){}},
  EnemyMgr:{all:()=>[]},Judgment:{netState:()=>null},Items:{BY:{}},Moves:{BY_ID:{}},
  Skins:{get:(id,dex)=>id==='witch'&&dex===25?{}:null},Social:{me:{name:'Test'}},
  U:{dist2:(x,y,a,b)=>(x-a)**2+(y-b)**2}};
 const context={G,performance:{now:()=>1000},setTimeout,clearTimeout,document:{addEventListener(){}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('js/net/coop.js','utf8'),context);
 const local=new Player({dex:25});
 G.Coop.begin({host:'host',members:[{uid:'host',name:'Host',dex:25},{uid:'guest',name:'Guest',dex:25}]},local,
  {team:()=>({time:1,level:1,xp:0,xpNext:1,kills:0,bosses:0,coins:0,t1:0,t10:0,cn:42}),
   syncTeam:s=>teamSync.push(s),hold(){},waiting(){},levelStart(){},resume(){}});
 return {G,sent,teamSync,receive:(u,m)=>receive(u,m),set blocked(v){blocked=v;},set accept(v){accept=v;}};
}

test('host retains critical events under backpressure and drains bounded batches without losing order',()=>{
 const b=coopBoot();try{
 for(let i=0;i<501;i++)b.G.Coop.broadcast(['say',String(i),1]);
 b.G.Coop.tick(.1);assert.equal(b.sent.length,0);assert.equal(b.G.Coop.mate('guest').q.length,501);
 b.blocked=false;b.accept=false;b.G.Coop.tick(.1);
 assert.equal(b.sent.length,0);assert.equal(b.G.Coop.mate('guest').q.length,501);
 b.accept=true;b.G.Coop.tick(.1);b.G.Coop.tick(.1);
 assert.deepEqual(b.sent.map(f=>f.ev.length),[500,1]);
 assert.equal(b.sent[0].ev[0][1],'0');assert.equal(b.sent[1].ev[0][1],'500');
 assert.equal(b.sent[0].tk[2],42);
 }finally{b.G.Coop.end();}
});

test('guest hold and level-choice state survive a blocked or failed send',()=>{
 const b=coopBoot(false);try{
 b.G.Coop.holdStart();b.G.Coop.localPicked();assert.equal(b.sent.length,0);
 b.blocked=false;b.accept=false;b.G.Coop.tick(.1);assert.equal(b.sent.length,0);
 b.accept=true;b.G.Coop.tick(.1);assert.equal(b.sent.length,1);
 assert.deepEqual(Array.from(b.sent[0].ev,e=>e[0]),['hs','lp']);assert.equal(b.sent[0].h,1);
 b.G.Coop.holdEnd();assert.equal(b.sent[1].h,0);assert.equal(b.sent[1].ev[0][0],'he');
 }finally{b.G.Coop.end();}
});

test('co-op validates companion skin IDs and receives the shared candy count',()=>{
 const host=coopBoot(),guest=coopBoot(false);try{
 host.receive('guest',{k:'f',ev:[['sm',{dex:25,sk:'witch'}]]});
 assert.equal(host.G.Coop.mate('guest').pl.anim.skin,'witch');
 host.receive('guest',{k:'f',ev:[['sm',{dex:25,sk:'unknown'}]]});
 assert.equal(host.G.Coop.mate('guest').pl.anim.skin,null);
 guest.receive('host',{k:'f',tk:[2,3,42],ev:[],p:{}});
 assert.equal(guest.teamSync[0].cn,42);
 guest.receive('host',{k:'f',tk:[2,3,Infinity],ev:[],p:{}});
 assert.equal(guest.teamSync[1].cn,0);
 }finally{host.G.Coop.end();guest.G.Coop.end();}
});
