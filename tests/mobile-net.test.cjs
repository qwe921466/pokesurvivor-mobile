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
