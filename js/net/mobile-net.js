/* Host-star WebRTC. No TURN and no database relay; only two SDP writes per pair/attempt. */
G.Net = (() => {
  const ICE = [{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}];
  const peers = new Map(), handlers = new Set(), peerHandlers = new Set();
  let roomId, uid, hostUid, isHost=false, ctx, members=[], generation=0, retryAt=0;
  const stats={sent:0,recv:0,relaySent:0,sentBytes:0,jsonBytes:0,recvBytes:0,binarySent:0,binaryRecv:0,invalidBinary:0};
  const emit = (u,mode) => peerHandlers.forEach(fn=>fn(u,mode));
  const signalRef = guest => ctx.S.doc(ctx.fs,'mobileRooms',roomId,'signals',guest);
  const current = (u,p) => peers.get(u)===p && p.generation===generation && p.mode!=='closed' && p.mode!=='failed';
  function drop(u,silent=false) {
    const p=peers.get(u); if(!p)return;
    p.mode='closed'; clearTimeout(p.timer);clearTimeout(p.disconnectTimer);p.stop?.();
    p.pc?.close(); peers.delete(u); if(!silent)emit(u,'closed');
  }
  function close() {
    generation++; for(const u of [...peers.keys()])drop(u);
    roomId=null;hostUid=null;isHost=false;members=[];
  }
  function open(id,host,hostId) {
    if(roomId===id)return;
    close(); ctx=G.Social.transport;uid=ctx.uid;roomId=id;hostUid=hostId;isHost=host;
  }
  function fail(u,p) {
    if(!current(u,p))return;
    p.mode='failed';clearTimeout(p.timer);clearTimeout(p.disconnectTimer);p.pc?.close();
    emit(u,'failed'); // Explicit retry only, never a paid fallback or unlimited retry loop.
  }
  function make(u,session) {
    const p={generation,session,mode:'connecting',pc:null,dc:null,nonce:null,binaryVersion:0};
    peers.set(u,p);
    p.timer=setTimeout(()=>fail(u,p),25000);
    emit(u,'connecting'); return p;
  }
  function createPC(u,p) {
    const pc=p.pc=new RTCPeerConnection({iceServers:ICE});
    pc.onconnectionstatechange=()=>{
      if(!current(u,p))return;
      clearTimeout(p.disconnectTimer);
      if(pc.connectionState==='failed'||pc.connectionState==='closed')fail(u,p);
      else if(pc.connectionState==='disconnected')p.disconnectTimer=setTimeout(()=>fail(u,p),12000);
    };
    return pc;
  }
  function gather(pc) {
    if(pc.iceGatheringState==='complete')return Promise.resolve();
    return new Promise(resolve=>{
      const done=()=>{clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',changed);resolve();};
      const changed=()=>{if(pc.iceGatheringState==='complete')done();};
      const timer=setTimeout(done,6000);
      pc.addEventListener('icegatheringstatechange',changed);
    });
  }
  function wire(u,p,dc) {
    p.dc=dc;dc.binaryType='arraybuffer';
    dc.onopen=()=>{
      if(!current(u,p)){dc.close();return;}
      clearTimeout(p.timer);p.mode='direct';
      dc.send(JSON.stringify({k:'net-cap',binary:G.NetCodec.version}));emit(u,'direct');
    };
    dc.onclose=()=>fail(u,p);
    dc.onmessage=e=>{
      if(!current(u,p))return;
      let msg;
      try {
        const size=typeof e.data==='string'?G.NetCodec.size(e.data):e.data.byteLength;
        if(!size||size>1024*1024)return;
        if(typeof e.data==='string') {
          msg=JSON.parse(e.data);
          if(msg?.k==='net-cap'){p.binaryVersion=msg.binary===G.NetCodec.version?msg.binary:0;return;}
        } else {
          if(p.binaryVersion!==G.NetCodec.version)throw Error('codec');
          msg=G.NetCodec.decode(e.data);stats.binaryRecv++;
        }
        // Start is exclusively authorized by the room transaction. Peers carry battle frames only.
        if(!msg||msg.k!=='f'||(!isHost&&u!==hostUid))return;
        const stateOK=a=>Array.isArray(a)&&a.length>=15;
        if(msg.p) {
          if(isHost) { if(!stateOK(msg.p))return; }
          else if(typeof msg.p!=='object'||Array.isArray(msg.p)||
            Object.keys(msg.p).length>4||Object.entries(msg.p).some(([id,a])=>!members.some(m=>m.uid===id)||!stateOK(a)))return;
        }
        if(msg.ev&&(!Array.isArray(msg.ev)||msg.ev.some(ev=>!Array.isArray(ev))))return;
        stats.recvBytes+=size;stats.recv++;
        handlers.forEach(fn=>fn(u,msg));
      } catch { stats.invalidBinary++; }
    };
  }
  async function offer(u,p) {
    try {
      const pc=createPC(u,p);wire(u,p,pc.createDataChannel('g',{ordered:true}));
      await pc.setLocalDescription(await pc.createOffer());await gather(pc);
      if(!current(u,p))return;
      p.nonce=crypto.randomUUID();
      const ref=signalRef(u),hostSession=G.Social.session;
      await ctx.S.setDoc(ref,{hostSession,guestSession:p.session,nonce:p.nonce,
        offer:pc.localDescription.sdp,answer:'',updatedAt:ctx.S.serverTimestamp()});
      if(!current(u,p))return;
      p.stop=ctx.S.onSnapshot(ref,{includeMetadataChanges:true},snap=>{
        if(!current(u,p)||!snap.exists()||snap.metadata.hasPendingWrites||snap.metadata.fromCache)return;
        const d=snap.data();
        if(d.nonce!==p.nonce||d.guestSession!==p.session||d.hostSession!==hostSession||!d.answer||p.answered)return;
        p.answered=true;
        pc.setRemoteDescription({type:'answer',sdp:d.answer}).catch(()=>fail(u,p));
      },()=>fail(u,p));
    } catch { fail(u,p); }
  }
  function listen(u,p) {
    const ref=signalRef(uid);
    p.stop=ctx.S.onSnapshot(ref,{includeMetadataChanges:true},async snap=>{
      if(peers.get(u)!==p||p.generation!==generation||!snap.exists()||snap.metadata.fromCache||snap.metadata.hasPendingWrites)return;
      const d=snap.data();
      if(d.hostSession!==p.session||d.guestSession!==G.Social.session||d.nonce===p.nonce)return;
      // A host's explicit lobby retry replaces the failed connection, without a new listener.
      if(G.Social.room?.state!=='lobby')return;
      try {
        p.nonce=d.nonce;p.answered=false;p.mode='connecting';
        if(p.pc){p.pc.onconnectionstatechange=null;if(p.dc)p.dc.onclose=null;p.pc.close();}
        clearTimeout(p.timer);p.timer=setTimeout(()=>fail(u,p),25000);
        const pc=createPC(u,p);pc.ondatachannel=e=>wire(u,p,e.channel);
        emit(u,'connecting');
        await pc.setRemoteDescription({type:'offer',sdp:d.offer});
        await pc.setLocalDescription(await pc.createAnswer());await gather(pc);
        if(!current(u,p)||p.pc!==pc)return;
        await ctx.S.runTransaction(ctx.fs,async tx=>{
          const snap=await tx.get(ref),now=snap.data();
          if(!current(u,p)||now?.nonce!==d.nonce)return;
          tx.set(ref,{...now,answer:pc.localDescription.sdp,updatedAt:ctx.S.serverTimestamp()});
        });
      } catch { fail(u,p); }
    },()=>fail(u,p));
  }
  function syncMembers(list) {
    if(!roomId)return;members=list;
    const targets=isHost?list.filter(m=>m.uid!==uid):list.filter(m=>m.uid===hostUid);
    for(const u of [...peers.keys()])if(!targets.some(m=>m.uid===u&&m.session===peers.get(u).session))drop(u);
    for(const m of targets)if(!peers.has(m.uid)){
      const p=make(m.uid,m.session);
      if(isHost)offer(m.uid,p);else listen(m.uid,p);
    }
  }
  function retry() {
    if(!isHost||G.Social.room?.state!=='lobby'||Date.now()<retryAt)return;
    retryAt=Date.now()+5000;
    for(const [u,p] of peers)if(p.mode==='failed'){drop(u,true);}
    syncMembers(members);
  }
  function send(to,msg) {
    const p=peers.get(to);
    if(!roomId||p?.mode!=='direct'||p.dc.readyState!=='open'||msg?.k!=='f')return;
    // Bound queued data during a suspended/background peer instead of exhausting memory.
    if(p.dc.bufferedAmount>2*1024*1024)return;
    try {
      const json=JSON.stringify(msg),len=G.NetCodec.size(json);
      const packed=p.binaryVersion===G.NetCodec.version?G.NetCodec.encode(msg):null;
      const binary=packed&&packed.byteLength<len,body=binary?packed:json;
      p.dc.send(body);stats.sent++;stats.sentBytes+=binary?packed.byteLength:len;stats.jsonBytes+=len;
      if(binary)stats.binarySent++;
    } catch { fail(to,p); }
  }
  return {open,close,syncMembers,retry,send,toHost(msg){if(!isHost)send(hostUid,msg);},
    broadcast(msg,except){for(const u of peers.keys())if(u!==except)send(u,msg);},
    on(fn){handlers.add(fn);},off(fn){handlers.delete(fn);},onPeer(fn){peerHandlers.add(fn);},
    mode:u=>peers.get(u)?.mode||'closed',slow:()=>false,peers:()=>[...peers.keys()],
    get uid(){return uid;},get hostUid(){return hostUid;},get isHost(){return isHost;},
    get open_(){return !!roomId;},stats};
})();
