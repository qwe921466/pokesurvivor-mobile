/* Personal project only. Firestore carries bounded room metadata and SDP, never battle frames. */
G.Social = (() => {
  // Halloween changes collision maps and rewards; older clients must use their own rooms.
  const PROTOCOL = 3, MAX_PLAYERS = 4;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const random = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), x => alphabet[x % 32]).join('');
  let ctx, room = null, session = random(16), stop, expiryTimer, generation = 0, startedRun = 0, busy = false;
  const listeners = new Set();
  const emit = what => listeners.forEach(fn => fn(what));
  const member = (ready = false) => ({ name:G.DB.user, dex:G.DB.save.partner, shiny:!!G.DB.save.partnerShiny,
    session, ready });
  const ref = id => ctx.S.doc(ctx.fs, 'mobileRooms', id);
  const live = d => d && d.protocol === PROTOCOL && d.state !== 'closed' && d.expiresAt.toMillis() > Date.now();
  function localClose(why = 'room-closed') {
    generation++; stop?.(); stop = null; clearTimeout(expiryTimer);
    if (G.Coop?.active && G.Coop.isHost) G.Game.quit();
    room = null; startedRun = 0;
    // Deliver the disconnect before discarding the run, so the game banks earned progress.
    G.Net?.close(); emit(why);
  }
  async function start() { ctx = await G.Cloud.roomSession(); return 'ok'; }
  async function safe(fn) {
    if (busy) return {ok:false,error:'正在處理房間，請稍候。'};
    busy = true;
    try { await fn(); return {ok:true}; }
    catch(e) { return {ok:false,error:G.Cloud.errorText(e)}; }
    finally { busy = false; }
  }
  async function transact(fn) {
    // A concurrent roster edit can fail the own-member diff rule before the SDK
    // retries its stale transaction. Re-read a bounded number of times; never relax the rule.
    for (let attempt=0;;attempt++) {
      try { return await ctx.S.runTransaction(ctx.fs,fn); }
      catch(e) {
        if (attempt>=3 || !/permission-denied|aborted/.test(e.code||'')) throw e;
        await new Promise(resolve=>setTimeout(resolve,100+Math.random()*250));
      }
    }
  }
  async function attach(id) {
    const token = ++generation; startedRun = 0;
    stop = ctx.S.onSnapshot(ref(id), {includeMetadataChanges:true}, snap => {
      if (generation !== token || snap.metadata.fromCache || snap.metadata.hasPendingWrites) return;
      const d = snap.exists() ? snap.data() : null;
      if (!live(d) || d.members[ctx.uid]?.session !== session) { localClose(); return; }
      const members = Object.entries(d.members).map(([uid,m]) => ({uid,...m}))
        .sort((a,b) => a.uid === d.host ? -1 : b.uid === d.host ? 1 : a.uid.localeCompare(b.uid));
      room = {id, ...d, members, isHost:d.host === ctx.uid};
      clearTimeout(expiryTimer);
      expiryTimer = setTimeout(() => localClose(), Math.max(1,d.expiresAt.toMillis()-Date.now()));
      G.Net.open(id,room.isHost,d.host); G.Net.syncMembers(members);
      emit('room');
      if (d.state === 'playing' && d.run > startedRun) {
        // Only the server-confirmed host transition may start a run; peer messages cannot.
        if (G.Game?.state !== 'ui' || !d.members[ctx.uid].ready) return;
        startedRun = d.run;
        G.Flow.startCoop({room:id,run:d.run,seed:d.seed,host:d.host,members,hw:G.Halloween ? G.Halloween.isOn(d.updatedAt.toDate()) : false});
      }
    }, () => { if (generation === token) { localClose(); G.UI?.toast('房間連線中斷，請重新加入。',3500); } });
  }
  async function prepare() {
    if (room) throw Error('請先離開目前房間。');
    ctx = await G.Cloud.roomSession(true);
    if (!G.DB.save.partner) throw Error('請先選擇初始寶可夢。');
    session = random(16);
  }
  function createRoom() { return safe(async () => {
    await prepare();
    const id = random(10);
    await transact(async tx => {
      const target = ref(id); if ((await tx.get(target)).exists()) throw Error('房間碼重複，請再試一次。');
      tx.set(target,{host:ctx.uid,protocol:PROTOCOL,state:'lobby',members:{[ctx.uid]:member()},
        run:0,seed:0,createdAt:ctx.S.serverTimestamp(),updatedAt:ctx.S.serverTimestamp(),
        expiresAt:ctx.S.Timestamp.fromMillis(Date.now()+2*60*60*1000)});
    });
    await attach(id);
  }); }
  function joinRoom(input) { return safe(async () => {
    const id = String(input).toUpperCase().replace(/[\s-]/g,'');
    if (!/^[A-HJ-NP-Z2-9]{10}$/.test(id)) throw Error('請輸入 10 位房間碼。');
    await prepare();
    await transact(async tx => {
      const target = ref(id), snap = await tx.get(target), d = snap.exists() ? snap.data() : null;
      if (!live(d)) throw Error('房間不存在、已到期或版本不同，請房主更新遊戲後建立新房。');
      if (d.state !== 'lobby') throw Error('這個房間正在戰鬥，請等下一局。');
      if (d.members[ctx.uid]) throw Error('這個帳號已在房間內。請原裝置離開，或請房主建立新房。');
      if (Object.keys(d.members).length >= MAX_PLAYERS) throw Error('房間已滿（最多 4 人）。');
      tx.set(target,{...d,members:{...d.members,[ctx.uid]:member()},updatedAt:ctx.S.serverTimestamp()});
    });
    await attach(id);
  }); }
  async function update(fn) {
    if (!room) throw Error('尚未加入房間。');
    const id = room.id;
    await transact(async tx => {
      const target = ref(id), snap = await tx.get(target), d = snap.exists() ? snap.data() : null;
      if (!live(d) || d.members[ctx.uid]?.session !== session) throw Error('房間已關閉，請重新加入。');
      const next = fn(d);
      if (next) tx.set(target,{...next,updatedAt:ctx.S.serverTimestamp()});
    });
  }
  function ready(value) { return safe(async () => {
    if (value) {
      await G.Cloud.roomSession(true);
      if (!room || (!room.isHost && G.Net.mode(room.host) !== 'direct')) throw Error('請等候與房主連線成功。');
    }
    await update(d => {
      if (d.state !== 'lobby') throw Error('戰鬥已開始。');
      return {...d,members:{...d.members,[ctx.uid]:member(value)}};
    });
  }); }
  function begin() { return safe(async () => {
    await G.Cloud.roomSession(true);
    await update(d => {
      const others = Object.keys(d.members).filter(uid => uid !== ctx.uid);
      if (d.host !== ctx.uid || d.state !== 'lobby' || !others.length ||
        others.some(uid => !d.members[uid].ready || G.Net.mode(uid) !== 'direct'))
        throw Error('需要至少 2 位玩家，且所有朋友都已連線並按下準備。');
      return {...d,state:'playing',run:d.run+1,seed:crypto.getRandomValues(new Uint32Array(1))[0]%1000000,
        members:{...d.members,[ctx.uid]:member(true)}};
    });
  }); }
  async function leaveRoom() {
    if (!room) return;
    try { await update(d => {
      if (d.host === ctx.uid) return {...d,state:'closed'};
      const members = {...d.members}; delete members[ctx.uid]; return {...d,members};
    }); } finally { localClose('left'); }
  }
  function dropMember(uid) {
    if (!room?.isHost || uid === ctx.uid) return Promise.resolve();
    return update(d => {
      if (d.host !== ctx.uid || !d.members[uid]) return null;
      const members = {...d.members}; delete members[uid]; return {...d,members};
    }).catch(e => G.UI?.toast(G.Cloud.errorText(e)));
  }
  function setOpen(value) {
    if (!value || !room?.isHost) return;
    update(d => ({...d,state:'lobby',members:Object.fromEntries(Object.entries(d.members)
      .map(([u,m])=>[u,{...m,ready:false}]))})).catch(e => G.UI.toast(G.Cloud.errorText(e)));
  }
  function setPlaying(value) {
    if (!value && room && !room.isHost && G.Net.mode(room.host) !== 'direct') {
      leaveRoom().catch(() => {}); return;
    }
    if (!value && room) update(d => ({...d,members:{...d.members,[ctx.uid]:{...d.members[ctx.uid],ready:false}}}))
      .catch(() => {}); // Earned progress is committed independently of room metadata.
  }
  function profileData() {
    const s=G.DB.save,st=s.stats,prof=s.profile||{};
    const unlocked=G.AchDefs.LIST.filter(a=>s.ach?.[a.id]);
    return {name:G.DB.user,favs:(prof.favs||[]).slice(0,3).map(f=>({dex:f.dex|0,shiny:!!f.shiny})),title:prof.title||'',
      best:{solo:st.bestTime|0,group:st.bestGroupTime|0,level:st.bestLevel|0,bosses:st.bossesTotal|0,
        legends:Object.keys(s.legends||{}).length,kills:st.totalKills|0,medals:unlocked.length},
      medals:unlocked.slice().sort((a,b)=>(b.tier-a.tier)||(s.ach[b.id]-s.ach[a.id])).slice(0,8).map(a=>a.id)};
  }
  G.DB.onLeave(leaveRoom);
  return {MAX_PLAYERS,PROTOCOL,start,createRoom,joinRoom,leaveRoom,ready,begin,dropMember,setOpen,setPlaying,profileData,
    publishProfile(){},getProfile:async()=>null,on(fn){listeners.add(fn);},
    acceptStart(cfg){return room?.id===cfg.room && room.state==='playing' && room.run===cfg.run && startedRun===cfg.run;},
    get room(){return room;},get uid(){return ctx?.uid;},get me(){return G.DB.cloudUid?{name:G.DB.user}:null;},
    get started(){return !!ctx;},get friends(){return [];},get session(){return session;},
    get transport(){return ctx;}};
})();
